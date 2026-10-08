const $ = (id) => document.getElementById(id);

function render(state) {
  const { settings, remainingMs } = state;
  const c = settings.colors;
  document.documentElement.style.setProperty('--bg', c.background);
  document.documentElement.style.setProperty('--fg', c.text);
  document.documentElement.style.setProperty('--end', c.end);

  $('title').textContent = settings.showTitle ? settings.title : '';
  $('message').textContent = settings.showMessage ? settings.message : '';

  const time = $('time');
  const finished = remainingMs <= 0;
  // A tempo scaduto: senza tempo extra il testo finale prende il posto dei numeri,
  // con il tempo extra i numeri continuano in negativo e il testo va sotto.
  const showEndText = finished && settings.endText && !settings.overtime;
  $('endnote').textContent = finished && settings.overtime ? settings.endText : '';
  time.textContent = showEndText ? settings.endText : formatTime(remainingMs);
  time.classList.toggle('end-text', !!showEndText);
  // Rimpicciolisce i numeri quando sono più lunghi di MM:SS, così restano nello schermo.
  const len = time.textContent.length;
  time.style.fontSize = !showEndText && len > 5 ? `min(${(32 * 5 / len).toFixed(1)}vw, 60vh)` : '';
  time.classList.toggle('blink', finished && state.running);

  let color = c.text;
  if (finished) color = c.end;
  else if (remainingMs <= settings.warningSec * 1000) color = c.warning;
  time.style.color = color;
}

window.countdown.onState(render);
window.countdown.getState().then(render);
