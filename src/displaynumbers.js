// Numeri dei monitor mostrati nella regia.
//
// Windows non rende disponibile il numero che compare in Impostazioni >
// Schermo: il nome interno dei monitor (\\.\DISPLAYn) spesso è diverso (per
// esempio il monitor 2 di Windows può chiamarsi DISPLAY5). Per questo i
// numeri seguono una regola semplice e prevedibile: il monitor principale è
// il numero 1, gli altri seguono da sinistra a destra (e dall'alto in basso).
const { screen } = require('electron');

// Numero di ogni schermo: Map(id -> numero).
function numbers(displays = screen.getAllDisplays(), primaryId = screen.getPrimaryDisplay().id) {
  const sorted = [...displays].sort((a, b) =>
    (b.id === primaryId) - (a.id === primaryId) ||
    a.bounds.x - b.bounds.x ||
    a.bounds.y - b.bounds.y);
  return new Map(sorted.map((d, i) => [d.id, i + 1]));
}

// Nulla da chiedere al sistema: resta per chi aggiorna i numeri quando
// cambiano i monitor.
function refresh() {
  return Promise.resolve();
}

module.exports = { refresh, numbers };
