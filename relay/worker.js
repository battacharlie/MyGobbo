// Ponte su internet per il telecomando di IGOR.
// IGOR (sul computer della regia) si collega in uscita e:
//   PUT  /igor/<stanza>/state   manda lo stato semplificato
//   GET  /igor/<stanza>/cmds    aspetta i comandi (fino a 25 s, poi riprova)
// sempre con l'intestazione X-Igor-Key: la chiave della regia. La prima
// regia che usa una stanza ne registra la chiave; le altre vengono rifiutate.
// Il telefono usa la stessa pagina della rete locale:
//   GET  /r/<stanza>            la pagina
//   GET  /r/<stanza>/state      lo stato
//   POST /r/<stanza>/cmd        un comando (passa alla regia)
// La stanza è il codice segreto dell'indirizzo: chi non lo conosce non entra.
import PAGE from '../src/webremote/page.html';

const ROOM_RE = /^[A-Za-z0-9_-]{16,64}$/;
const WAIT_MS = 25000;
const MAX_QUEUE = 50;
const MAX_BODY = 200000;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'r' || parts[0] === 'igor') && ROOM_RE.test(parts[1] || '')) {
      const room = env.ROOMS.get(env.ROOMS.idFromName(parts[1]));
      return room.fetch(request);
    }
    return new Response('IGOR', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });
  }
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = null; // ultimo stato mandato dalla regia
    this.seen = 0; // ultima volta che la regia si è fatta sentire
    this.queue = []; // comandi in attesa
    this.waiter = null; // richiesta della regia in attesa di comandi
  }

  async checkKey(request) {
    const key = request.headers.get('X-Igor-Key') || '';
    if (key.length < 16) return false;
    const hash = await sha256(key);
    const saved = await this.ctx.storage.get('keyHash');
    if (!saved) {
      await this.ctx.storage.put('keyHash', hash);
      return true;
    }
    return saved === hash;
  }

  flush() {
    if (!this.waiter) return;
    const { resolve, timer } = this.waiter;
    this.waiter = null;
    clearTimeout(timer);
    resolve(json({ cmds: this.queue.splice(0) }));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const sub = parts[2] || '';

    if (parts[0] === 'igor') {
      if (!(await this.checkKey(request))) return json({ ok: false, error: 'key' }, 403);
      this.seen = Date.now();
      if (sub === 'state' && request.method === 'PUT') {
        const text = await request.text();
        if (text.length > MAX_BODY) return json({ ok: false }, 413);
        this.state = text;
        return json({ ok: true });
      }
      if (sub === 'cmds' && request.method === 'GET') {
        if (this.queue.length) return json({ cmds: this.queue.splice(0) });
        if (this.waiter) this.flush();
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (this.waiter && this.waiter.resolve === resolve) this.waiter = null;
            resolve(json({ cmds: [] }));
          }, WAIT_MS);
          this.waiter = { resolve, timer };
        });
      }
      if (sub === 'bye' && request.method === 'POST') {
        this.state = null;
        this.seen = 0;
        return json({ ok: true });
      }
      return json({ ok: false }, 404);
    }

    // Telefono
    if (sub === '' && request.method === 'GET') {
      return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    const online = this.state && Date.now() - this.seen < WAIT_MS + 15000;
    if (sub === 'state' && request.method === 'GET') {
      if (!online) return json({ ok: false, error: 'offline' }, 503);
      return new Response(this.state, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (sub === 'cmd' && request.method === 'POST') {
      if (!online) return json({ ok: false, error: 'offline' }, 503);
      const text = await request.text();
      if (text.length > 20000) return json({ ok: false }, 413);
      let cmd;
      try {
        cmd = JSON.parse(text);
      } catch {
        return json({ ok: false }, 400);
      }
      this.queue.push(cmd);
      if (this.queue.length > MAX_QUEUE) this.queue.shift();
      this.flush();
      return json({ ok: true });
    }
    return json({ ok: false }, 404);
  }
}
