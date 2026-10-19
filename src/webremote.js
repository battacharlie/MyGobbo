// Telecomando dal browser (telefono, tablet, altro computer): un piccolo
// server che mostra una pagina con i comandi essenziali. L'indirizzo
// contiene un codice segreto (token): senza il codice non si entra.
//   GET  /r/<token>         la pagina
//   GET  /r/<token>/state   lo stato semplificato (JSON)
//   POST /r/<token>/cmd     un comando (JSON)
// La pagina moderatore (/m/<codice moderatore>/...) ha un suo codice e mostra
// solo gli input che la regia sceglie, con pochi comandi.
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

let server = null;
let current = null; // { port, token, modToken }
let lastError = null;
let getState = () => null;
let run = () => {};
let onChange = () => {};
let getModState = () => null;
let runMod = () => false;

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function status() {
  const running = !!server && !!current;
  return {
    running,
    port: current && current.port,
    urls: running ? addresses().map((a) => `http://${a}:${current.port}/r/${current.token}`) : [],
    modUrls: running && current.modToken ? addresses().map((a) => `http://${a}:${current.port}/m/${current.modToken}`) : [],
    path: running ? `/r/${current.token}` : null,
    error: lastError
  };
}

const pageCache = {};
function page(file) {
  if (!pageCache[file]) pageCache[file] = fs.readFileSync(path.join(__dirname, 'webremote', file), 'utf8');
  return pageCache[file];
}

// Le due pagine: telecomando completo (r) e moderatore (m).
function route(kind, code) {
  if (!current || !code) return null;
  if (kind === 'r' && code === current.token) return { file: 'page.html', state: getState, run };
  if (kind === 'm' && code === current.modToken) return { file: 'moderator.html', state: getModState, run: runMod };
  return null;
}

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const reply = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(body);
  };
  const r = route(parts[0], parts[1]);
  if (!r) return reply(404, 'text/plain; charset=utf-8', 'IGOR: link non valido / invalid link');
  const sub = parts[2] || '';
  if (sub === '' && req.method === 'GET') return reply(200, 'text/html; charset=utf-8', page(r.file));
  if (sub === 'state' && req.method === 'GET') return reply(200, 'application/json', JSON.stringify(r.state()));
  if (sub === 'cmd' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => {
      body += d;
      if (body.length > 10000) req.destroy();
    });
    req.on('end', () => {
      let ok = false;
      try {
        ok = r.run(JSON.parse(body));
      } catch { /* JSON non valido */ }
      reply(ok ? 200 : 400, 'application/json', JSON.stringify({ ok: !!ok }));
    });
    return;
  }
  reply(404, 'text/plain; charset=utf-8', 'not found');
}

function stop() {
  if (server) server.close();
  server = null;
  current = null;
}

// settings: { enabled, port, token, modToken }; stateFn: stato per la pagina;
// runCommand: controlla ed esegue un comando del telecomando (true = fatto); changed: lo stato del server è cambiato;
// mod: { stateFn, runCommand } per la pagina moderatore.
function configure(settings, stateFn, runCommand, changed, mod = {}) {
  getState = stateFn;
  run = runCommand;
  onChange = changed;
  getModState = mod.stateFn || (() => null);
  runMod = mod.runCommand || (() => false);
  const want = settings && settings.enabled && settings.token
    ? { port: settings.port, token: settings.token, modToken: settings.modToken || '' } : null;
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
    onChange();
  });
  srv.listen(want.port, '0.0.0.0', () => onChange());
  server = srv;
  current = want;
}

module.exports = { configure, stop, status };
