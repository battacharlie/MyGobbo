// Comandi via HTTP per Companion (Stream Deck) e simili: un piccolo server
// che risponde a indirizzi come http://127.0.0.1:8765/api/cut oppure
// /api/program/2. Il comando viene passato alla regia, che lo esegue.
const http = require('http');
const os = require('os');
const { ACTIONS } = require('./shared/actions');

let server = null;
let current = null; // { port, lan }
let lastError = null;
let send = null;
let onChange = null;

function addresses(lan) {
  if (!lan) return ['127.0.0.1'];
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out.length ? out : ['127.0.0.1'];
}

function status() {
  return { running: !!server && !!current, port: current && current.port, lan: current && current.lan, addresses: current ? addresses(current.lan) : [], error: lastError };
}

function helpPage() {
  const rows = ACTIONS.map((a) => {
    const url = `/api/${a.id}${a.arg === 'scene' ? '/1' : ''}${a.arg === 'value' ? '?value=64' : ''}`;
    return `<tr><td><a href="${url}">${url}</a></td><td>${a.label}</td></tr>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>IGOR - ABit/s</title>
<body style="font:14px sans-serif;background:#15171c;color:#e8eaf0"><h2>IGOR - ABit/s: comandi HTTP / HTTP commands</h2>
<p>Companion: modulo "Generic HTTP", azione GET con uno di questi indirizzi. / Companion: "Generic HTTP" module, GET action with one of these URLs.</p>
<table cellpadding="6">${rows}</table></body>`;
}

function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/api' || url.pathname === '/api/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(helpPage());
    return;
  }
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  let id = parts.join('/');
  let arg = null;
  // L'ultimo pezzo numerico è il numero della scena (es. program/2).
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
    arg = Number(parts.pop());
    id = parts.join('/');
  }
  const action = ACTIONS.find((a) => a.id === id);
  const reply = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!action) return reply(404, { ok: false, error: `unknown command: ${id}` });
  if (action.arg === 'scene' && !(arg >= 1)) return reply(400, { ok: false, error: 'scene number missing, e.g. /api/program/1' });
  const value = url.searchParams.has('value') ? Number(url.searchParams.get('value')) : null;
  const ok = send ? send({ id, arg, value, source: 'http' }) : false;
  reply(ok ? 200 : 503, { ok, command: id, arg, value });
}

function stop() {
  if (server) server.close();
  server = null;
  current = null;
}

// Avvia, riavvia o ferma il server secondo le impostazioni.
function configure(settings, sendAction, changed) {
  send = sendAction;
  onChange = changed;
  const want = settings && settings.enabled ? { port: settings.port, lan: !!settings.lan } : null;
  if (JSON.stringify(want) === JSON.stringify(current) && (server || !want)) return;
  stop();
  lastError = null;
  if (!want) return;
  const srv = http.createServer(handle);
  srv.on('error', (err) => {
    lastError = err.code === 'EADDRINUSE' ? `port ${want.port} in use` : String(err.message || err);
    if (server === srv) {
      server = null;
      current = null;
    }
    if (onChange) onChange();
  });
  srv.listen(want.port, want.lan ? '0.0.0.0' : '127.0.0.1', () => {
    if (onChange) onChange();
  });
  server = srv;
  current = want;
}

module.exports = { configure, stop, status };
