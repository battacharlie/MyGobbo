// Comandi che si possono dare a distanza: da un controller MIDI o da
// Companion (Stream Deck) con una richiesta HTTP. Li esegue la regia.
//   id      nome del comando (anche nell'indirizzo: /api/<id>[/<numero>])
//   label   descrizione (tradotta nella regia)
//   arg     'scene' = serve il numero della scena, 'value' = valore 0-127 (MIDI CC)
(function (root) {
  const ACTIONS = [
    { id: 'cut', label: 'CUT: manda in onda l\'anteprima' },
    { id: 'fade', label: 'FADE: dissolvenza verso l\'anteprima' },
    { id: 'program', label: 'Manda in onda la scena numero…', arg: 'scene' },
    { id: 'preview', label: 'Metti in anteprima la scena numero…', arg: 'scene' },
    { id: 'studio', label: 'Attiva/disattiva la modalità studio' },
    { id: 'timer/toggle', label: 'Timer: avvia/pausa' },
    { id: 'timer/reset', label: 'Timer: azzera' },
    { id: 'video/toggle', label: 'Video in onda: riproduci/pausa' },
    { id: 'video/restart', label: 'Video in onda: da capo' },
    { id: 'prompter/toggle', label: 'TelePrompt: avvia/pausa' },
    { id: 'prompter/faster', label: 'TelePrompt: più veloce' },
    { id: 'prompter/slower', label: 'TelePrompt: più lento' },
    { id: 'prompter/speed', label: 'TelePrompt: velocità (manopola o cursore MIDI)', arg: 'value' },
    { id: 'prompter/next', label: 'TelePrompt: paragrafo successivo' },
    { id: 'prompter/prev', label: 'TelePrompt: paragrafo precedente' },
    { id: 'prompter/top', label: 'TelePrompt: torna all\'inizio' },
    { id: 'output/toggle', label: 'Mostra/nascondi l\'uscita' }
  ];
  const api = { ACTIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Actions = api;
})(typeof window !== 'undefined' ? window : globalThis);
