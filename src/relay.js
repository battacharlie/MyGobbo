// Telecomando da internet: IGOR si collega in uscita al ponte (relay/worker.js,
// su Cloudflare Workers), quindi non serve aprire porte sul router.
// Manda lo stato quando cambia e aspetta i comandi del telefono.
let current = null; // { url, room, key }
let session = 0; // cambia a ogni configure: i giri vecchi si fermano
let lastError = null;
let connected = false;
let getState = () => null;
let run = () => false;
let onChange = () => {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(ok, err) {
  if (connected === ok && lastError === err) return;
  connected = ok;
  lastError = err;
  onChange();
}

async function call(cfg, method, sub, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.url}/igor/${cfg.room}/${sub}`, {
      method,
      body,
      headers: { 'X-Igor-Key': cfg.key, 'Content-Type': 'application/json' },
      signal: ctrl.signal
    });
    if (res.status === 403) throw new Error('code already used by another IGOR: press "New code"');
    if (!res.ok) throw new Error(`relay ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Manda lo stato quando cambia (e comunque ogni 20 s, così il ponte sa che IGOR c'è).
async function stateLoop(id, cfg) {
  let last = '';
  let sentAt = 0;
  while (id === session) {
    try {
      const text = JSON.stringify(getState());
      if (text !== last || Date.now() - sentAt > 20000) {
        await call(cfg, 'PUT', 'state', text, 10000);
        last = text;
        sentAt = Date.now();
        setStatus(true, null);
      }
      await sleep(400);
    } catch (err) {
      setStatus(false, String(err.message || err));
      last = '';
      await sleep(5000);
    }
  }
}

async function cmdLoop(id, cfg) {
  while (id === session) {
    try {
      const data = await call(cfg, 'GET', 'cmds', undefined, 35000);
      if (id !== session) return;
      for (const c of data.cmds || []) {
        try {
          run(c);
        } catch { /* comando non valido */ }
      }
    } catch {
      await sleep(5000);
    }
  }
}

function status() {
  return {
    running: !!current,
    connected: !!current && connected,
    url: current ? `${current.url}/r/${current.room}` : null,
    error: current ? lastError : null
  };
}

function stop() {
  if (current) {
    const cfg = current;
    call(cfg, 'POST', 'bye', '{}', 3000).catch(() => {});
  }
  session++;
  current = null;
  connected = false;
  lastError = null;
}

// settings: { url, room, key } oppure null (spento).
function configure(settings, stateFn, runCommand, changed) {
  getState = stateFn;
  run = runCommand;
  onChange = changed;
  const want = settings && settings.url && settings.room && settings.key
    ? { url: String(settings.url).replace(/\/+$/, ''), room: settings.room, key: settings.key }
    : null;
  if (JSON.stringify(want) === JSON.stringify(current)) return;
  stop();
  if (!want) return;
  current = want;
  const id = session;
  stateLoop(id, want);
  cmdLoop(id, want);
}

module.exports = { configure, stop, status };
