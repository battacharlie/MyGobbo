const $ = (id) => document.getElementById(id);
const send = (cmd) => window.countdown.send(cmd);
const update = (patch) => send({ type: 'update-settings', patch });

let state = null;
let initialized = false;

// Riempie i campi solo al primo stato ricevuto, per non sovrascrivere
// quello che l'utente sta scrivendo.
function initFields(s) {
  $('in-min').value = Math.floor(s.durationSec / 60);
  $('in-sec').value = s.durationSec % 60;
  $('in-title').value = s.title;
  $('in-message').value = s.message;
  $('in-end').value = s.endText;
  $('chk-title').checked = s.showTitle;
  $('chk-message').checked = s.showMessage;
  $('chk-overtime').checked = s.overtime;
  $('in-warn').value = s.warningSec;
  for (const key of Object.keys(s.colors)) $(`col-${key}`).value = s.colors[key];

  const presets = $('presets');
  presets.innerHTML = '';
  for (const min of s.presets) {
    const b = document.createElement('button');
    b.textContent = `${min} min`;
    b.onclick = () => {
      $('in-min').value = min;
      $('in-sec').value = 0;
      send({ type: 'set-duration', seconds: min * 60 });
    };
    presets.appendChild(b);
  }
}

function render(next) {
  state = next;
  const s = state.settings;
  if (!initialized) {
    initFields(s);
    initialized = true;
  }

  const finished = state.remainingMs <= 0;
  $('p-time').textContent = formatTime(state.remainingMs);
  $('p-time').style.color = finished
    ? s.colors.end
    : state.remainingMs <= s.warningSec * 1000 ? s.colors.warning : '#fff';
  $('p-title').textContent = s.showTitle ? s.title : '';
  $('p-status').textContent = state.running
    ? (finished ? 'Tempo extra' : 'In corso')
    : (finished ? 'Scaduto' : 'In pausa');

  const startBtn = $('btn-start');
  startBtn.textContent = state.running ? '❚❚ Pausa' : '▶ Avvia';
  startBtn.classList.toggle('pause', state.running);

  const sel = $('sel-display');
  const options = state.displays.map((d) => `${d.id}|${d.label}`).join('\n');
  if (sel.dataset.options !== options) {
    sel.dataset.options = options;
    sel.innerHTML = '';
    for (const d of state.displays) {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.label;
      sel.appendChild(o);
    }
  }
  if (state.displayId != null) sel.value = String(state.displayId);
}

function toggleStart() {
  send({ type: state && state.running ? 'pause' : 'start' });
}

$('btn-start').onclick = toggleStart;
$('btn-reset').onclick = () => send({ type: 'reset' });
document.querySelectorAll('[data-adjust]').forEach((b) => {
  b.onclick = () => send({ type: 'adjust', seconds: Number(b.dataset.adjust) });
});

$('btn-set').onclick = () => {
  const min = Math.max(0, Number($('in-min').value) || 0);
  const sec = Math.min(59, Math.max(0, Number($('in-sec').value) || 0));
  send({ type: 'set-duration', seconds: min * 60 + sec });
};
for (const id of ['in-min', 'in-sec']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-set').click(); });
}

$('in-title').oninput = (e) => update({ title: e.target.value });
$('in-message').oninput = (e) => update({ message: e.target.value });
$('in-end').oninput = (e) => update({ endText: e.target.value });
$('chk-title').onchange = (e) => update({ showTitle: e.target.checked });
$('chk-message').onchange = (e) => update({ showMessage: e.target.checked });
$('chk-overtime').onchange = (e) => update({ overtime: e.target.checked });
$('in-warn').oninput = (e) => update({ warningSec: Math.max(0, Number(e.target.value) || 0) });
for (const key of ['background', 'text', 'warning', 'end']) {
  $(`col-${key}`).oninput = (e) => update({ colors: { [key]: e.target.value } });
}
$('sel-display').onchange = (e) => update({ displayId: Number(e.target.value) });
$('btn-toggle-display').onclick = () => send({ type: 'toggle-display' });

// Scorciatoie da tastiera, ignorate mentre si scrive in un campo.
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); toggleStart(); }
  else if (e.key === 'r' || e.key === 'R') send({ type: 'reset' });
});

window.countdown.onState(render);
window.countdown.getState().then(render);
