// Formatta i millisecondi come MM:SS (o H:MM:SS oltre l'ora).
// Il segno meno indica il tempo oltre la scadenza.
function formatTime(ms) {
  const negative = ms < 0;
  // Arrotonda per eccesso: 9:59.4 mostra 10:00 → si vede "00:00" solo a zero.
  const total = negative ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return (negative && total > 0 ? '−' : '') + body;
}
