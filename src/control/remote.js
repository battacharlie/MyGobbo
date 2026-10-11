// Controllo remoto della regia: controller MIDI (con "impara") e comandi
// HTTP per Companion / Stream Deck. Le azioni sono elencate in
// shared/actions.js e vengono eseguite qui, come se si premessero i pulsanti.
// Usa le funzioni e lo stato di control.js (stesso spazio globale).
const Remote = (() => {
  const { ACTIONS } = window.Actions;
  const actionById = (id) => ACTIONS.find((a) => a.id === id);

  // --- Esecuzione delle azioni ---------------------------------------------------

  // Elemento di un certo tipo su cui agire: quello selezionato, altrimenti il
  // primo in onda, altrimenti il primo dell'elenco.
  function target(type, extra = () => true) {
    const sel = selectedLayer();
    if (sel && sel.type === type && extra(sel)) return sel;
    const onAir = onAirLayers().filter((l) => l.type === type && extra(l));
    if (onAir.length) return onAir[onAir.length - 1];
    return allLayers(state.layers).find((l) => l.type === type && extra(l)) || null;
  }

  function sceneNumber(n) {
    return scenesInOrder()[Number(n) - 1] || null;
  }

  function execute({ id, arg, value }) {
    if (!state) return false;
    const isVideo = (l) => l.mediaKind !== 'image';
    switch (id) {
      case 'cut':
      case 'fade':
        if (!state.studio) return false;
        send({ type: 'take', kind: id });
        return true;
      case 'program': {
        const scene = sceneNumber(arg);
        if (!scene) return false;
        send({ type: 'program', id: scene.id, force: true });
        return true;
      }
      case 'preview': {
        const scene = sceneNumber(arg);
        if (!scene) return false;
        send({ type: 'preview', id: scene.id });
        return true;
      }
      case 'studio':
        send({ type: 'set-studio', on: !state.studio });
        return true;
      case 'timer/toggle':
      case 'timer/reset': {
        const timer = target('timer');
        if (!timer) return false;
        const action = id === 'timer/reset' ? 'reset' : timer.run.running ? 'pause' : 'start';
        send({ type: 'timer', id: timer.id, action });
        return true;
      }
      case 'video/toggle':
      case 'video/restart': {
        const video = target('media', isVideo);
        if (!video) return false;
        updateLayer(id === 'video/restart' ? { playing: true, restartAt: Date.now() } : { playing: !video.playing }, video);
        return true;
      }
      case 'output/toggle':
        send({ type: 'toggle-display' });
        return true;
    }
    if (id.startsWith('prompter/')) {
      const p = target('prompter');
      if (!p) return false;
      switch (id) {
        case 'prompter/toggle': sendPrompter(p.run.running ? 'pause' : 'start', {}, p); break;
        case 'prompter/faster': updateLayer({ speed: Math.min(2000, p.speed + 5) }, p); break;
        case 'prompter/slower': updateLayer({ speed: Math.max(0, p.speed - 5) }, p); break;
        case 'prompter/speed': {
          // Manopola MIDI (0-127) oppure ?value= in pixel al secondo da HTTP.
          if (value == null || Number.isNaN(value)) return false;
          const speed = arguments[0].source === 'midi' ? Math.round((value / 127) * 300) : clamp(Math.round(value), 0, 2000);
          updateLayer({ speed }, p);
          break;
        }
        case 'prompter/next': jumpParagraph(1, p); break;
        case 'prompter/prev': jumpParagraph(-1, p); break;
        case 'prompter/top': sendPrompter('top', {}, p); break;
        default: return false;
      }
      return true;
    }
    return false;
  }

  api.onRemoteAction((action) => execute(action));

  // --- MIDI --------------------------------------------------------------------

  let midiAccess = null;
  let midiError = null;
  let learning = null; // { action, arg } in attesa di un tasto
  let lastMessage = '';
  const chosen = { action: ACTIONS[0].id, scene: 1 }; // comando scelto nella finestra
  const ccValues = new Map();

  async function initMidi() {
    if (midiAccess || !navigator.requestMIDIAccess) return;
    try {
      midiAccess = await navigator.requestMIDIAccess();
      const attach = () => {
        for (const input of midiAccess.inputs.values()) input.onmidimessage = onMidi;
        if ($('dlg-midi').open) renderMidi();
      };
      midiAccess.onstatechange = attach;
      attach();
    } catch (err) {
      midiError = String(err && err.message || err);
    }
  }

  // Nota (note:canale:numero) o controllo (cc:canale:numero).
  function parseMidi(data) {
    const kind = data[0] & 0xf0;
    const ch = (data[0] & 0x0f) + 1;
    if (kind === 0x90 && data[2] > 0) return { key: `note:${ch}:${data[1]}`, value: data[2], label: `${t('Nota')} ${data[1]} · ${t('canale')} ${ch}` };
    if (kind === 0xb0) return { key: `cc:${ch}:${data[1]}`, value: data[2], cc: true, label: `CC ${data[1]} · ${t('canale')} ${ch}` };
    return null;
  }

  function keyLabel(key) {
    const [kind, ch, n] = key.split(':');
    return kind === 'note' ? `${t('Nota')} ${n} · ${t('canale')} ${ch}` : `CC ${n} · ${t('canale')} ${ch}`;
  }

  function onMidi(e) {
    const msg = parseMidi(e.data);
    if (!msg) return;
    lastMessage = msg.label;
    if (learning) {
      const midi = (state.midi || []).filter((m) => !(m.key === msg.key && m.action === learning.action && m.arg === learning.arg));
      midi.push({ key: msg.key, action: learning.action, arg: learning.arg });
      learning = null;
      send({ type: 'set-midi', midi });
      ccValues.set(msg.key, msg.value);
      return;
    }
    if ($('dlg-midi').open) {
      const el = $('midi-last');
      if (el) el.textContent = msg.label;
    }
    const prev = ccValues.get(msg.key) || 0;
    ccValues.set(msg.key, msg.value);
    for (const m of state.midi || []) {
      if (m.key !== msg.key) continue;
      const action = actionById(m.action);
      if (!action) continue;
      if (action.arg === 'value') {
        execute({ id: m.action, value: msg.value, source: 'midi' });
      } else if (!msg.cc || (msg.value >= 64 && prev < 64)) {
        // Un pulsante CC conta solo quando viene premuto (sale sopra metà corsa).
        execute({ id: m.action, arg: m.arg, source: 'midi' });
      }
    }
  }

  function actionLabel(id, arg) {
    const a = actionById(id);
    if (!a) return id;
    return a.arg === 'scene' ? `${t(a.label)} ${arg}` : t(a.label);
  }

  function renderMidi() {
    const dlg = $('dlg-midi');
    const inputs = midiAccess ? [...midiAccess.inputs.values()] : [];
    const devices = !navigator.requestMIDIAccess || midiError
      ? h('div', { class: 'notice' }, t('MIDI non disponibile su questo computer.'), midiError ? h('div', { class: 'muted small' }, midiError) : null)
      : h('p', { class: 'muted small' }, inputs.length
        ? `${t('Controller collegati')}: ${inputs.map((i) => i.name).join(', ')}`
        : t('Nessun controller MIDI collegato. Collegalo: compare qui da solo.'));

    const actionSel = h('select', {}, ACTIONS.map((a) => h('option', { value: a.id }, t(a.label))));
    actionSel.value = chosen.action;
    const sceneNum = h('input', { type: 'number', min: 1, step: 1, value: chosen.scene, style: 'width:64px', title: t('Numero della scena') });
    const updateScene = () => {
      chosen.action = actionSel.value;
      sceneNum.hidden = actionById(actionSel.value).arg !== 'scene';
    };
    actionSel.addEventListener('change', updateScene);
    sceneNum.addEventListener('input', () => { chosen.scene = Math.max(1, Math.floor(Number(sceneNum.value) || 1)); });
    updateScene();
    const learnBtn = h('button', {
      class: learning ? 'warn' : 'primary',
      onclick: () => {
        if (learning) learning = null;
        else {
          const a = actionById(actionSel.value);
          learning = { action: a.id, arg: a.arg === 'scene' ? Math.max(1, Math.floor(Number(sceneNum.value) || 1)) : null };
        }
        renderMidi();
      }
    }, learning ? t('Annulla') : t('Impara'));

    const rows = (state.midi || []).map((m, i) => h('tr', {},
      h('td', { class: 'key' }, keyLabel(m.key)),
      h('td', {}, actionLabel(m.action, m.arg)),
      h('td', {}, h('button', {
        class: 'small-btn',
        onclick: () => send({ type: 'set-midi', midi: state.midi.filter((_, j) => j !== i) })
      }, '✕'))));

    dlg.replaceChildren(...[
      h('h2', {}, t('Controller MIDI')),
      devices,
      help(t('Scegli un comando, premi "Impara" e poi tocca un tasto, un pad o una manopola del controller.')),
      h('div', { class: 'row' }, actionSel, sceneNum, learnBtn),
      learning ? h('p', { class: 'notice' }, t('In attesa: tocca il controllo da usare per "{action}"…', { action: actionLabel(learning.action, learning.arg) })) : null,
      h('p', { class: 'muted small' }, `${t('Ultimo segnale ricevuto')}: `, h('span', { id: 'midi-last' }, lastMessage || '—')),
      rows.length ? h('table', {}, rows) : h('p', { class: 'muted small' }, t('Nessun comando assegnato.')),
      help(t('La scena numero 1 è la prima scena dall\'alto nell\'elenco (il numero è scritto accanto al nome). "Velocità TelePrompt" va assegnata a una manopola o a un cursore.')),
      h('div', { class: 'row end' },
        rows.length ? h('button', { onclick: () => { if (confirm(t('Togliere tutti i comandi MIDI?'))) send({ type: 'set-midi', midi: [] }); } }, t('Togli tutti')) : null,
        h('button', { onclick: () => { learning = null; dlg.close(); } }, t('Chiudi')))].filter(Boolean));
  }

  // --- HTTP (Companion / Stream Deck) -----------------------------------------------

  function renderHttp() {
    const dlg = $('dlg-http');
    const cfg = state.http || {};
    const st = state.httpStatus || {};
    const enabled = h('input', { type: 'checkbox' });
    enabled.checked = !!cfg.enabled;
    enabled.addEventListener('change', () => send({ type: 'set-http', http: { enabled: enabled.checked } }));
    const lan = h('input', { type: 'checkbox' });
    lan.checked = !!cfg.lan;
    lan.addEventListener('change', () => send({ type: 'set-http', http: { lan: lan.checked } }));
    const port = h('input', { type: 'number', min: 1024, max: 65535, step: 1, value: cfg.port || 8765, style: 'width:90px' });
    port.addEventListener('change', () => send({ type: 'set-http', http: { port: Number(port.value) } }));

    const host = (st.addresses && st.addresses[0]) || '127.0.0.1';
    const base = `http://${host}:${st.port || cfg.port || 8765}`;
    let statusLine;
    if (st.error) statusLine = h('div', { class: 'notice' }, t('Il server non è partito: {error}', { error: st.error }));
    else if (st.running) statusLine = h('p', { class: 'ok small' }, t('Attivo su {urls}', { urls: (st.addresses || []).map((a) => `http://${a}:${st.port}`).join(', ') }));
    else statusLine = h('p', { class: 'muted small' }, t('Spento.'));

    const rows = ACTIONS.map((a) => {
      const path = `/api/${a.id}${a.arg === 'scene' ? '/1' : ''}${a.arg === 'value' ? '?value=120' : ''}`;
      return h('tr', {},
        h('td', { class: 'key' }, `${base}${path}`),
        h('td', {}, t(a.label)),
        h('td', {}, h('button', { class: 'small-btn', title: t('Copia'), onclick: () => navigator.clipboard.writeText(`${base}${path}`) }, '⧉')));
    });

    dlg.replaceChildren(
      h('h2', {}, t('Companion / Stream Deck')),
      h('div', { class: 'row' },
        h('label', { class: 'check' }, enabled, t('Accetta comandi via HTTP')),
        h('label', { class: 'field inline' }, h('span', {}, t('Porta')), port)),
      h('label', { class: 'check' }, lan, t('Accetta comandi anche da altri computer della rete')),
      statusLine,
      help(t('In Companion aggiungi una connessione "Generic HTTP", poi su un tasto un\'azione "GET" con uno di questi indirizzi. Se Companion è su un altro computer attiva l\'opzione della rete e usa l\'indirizzo di questo computer.')),
      help(t('Per le scene cambia il numero finale (/1, /2, …): è il numero scritto accanto alla scena nell\'elenco. La velocità del TelePrompt si dà in pixel al secondo con ?value=.')),
      h('table', {}, rows),
      h('div', { class: 'row end' }, h('button', { onclick: () => dlg.close() }, t('Chiudi'))));
  }

  function openMidi() {
    initMidi().then(renderMidi);
    renderMidi();
    $('dlg-midi').showModal();
  }

  function openHttp() {
    renderHttp();
    $('dlg-http').showModal();
  }

  $('dlg-midi').addEventListener('close', () => { learning = null; });

  // I comandi MIDI funzionano anche a finestra chiusa, se ce ne sono di assegnati.
  let started = false;
  function onState(s) {
    if (!started && s.midi && s.midi.length) {
      started = true;
      initMidi();
    }
    // Le finestre aperte si aggiornano, ma non mentre si sta scegliendo o scrivendo.
    const busy = ['INPUT', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
    if ($('dlg-midi').open && !busy) renderMidi();
    if ($('dlg-http').open && !busy) renderHttp();
  }

  return { execute, onState, openMidi, openHttp, handleMidi: onMidi };
})();

function openMidiDialog() { Remote.openMidi(); }
function openHttpDialog() { Remote.openHttp(); }
if (state) Remote.onState(state);
