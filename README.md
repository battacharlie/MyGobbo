# Mio Countdown

Countdown a schermo intero sul **secondo monitor** di Windows, con una **finestra di controllo** sul monitor principale da cui cambiare durata, testi e colori in tempo reale.

## Cosa fa

- **Schermo countdown** (secondo monitor): finestra senza bordi a tutto schermo con titolo, tempo e messaggio.
- **Finestra di controllo** (monitor principale):
  - avvia / pausa / azzera, più ±10 s e ±1 min anche a timer in corsa;
  - durata in minuti e secondi, con pulsanti rapidi (5, 10, 15, 20, 30, 45, 60 min);
  - titolo sopra il countdown e messaggio sotto, aggiornati mentre scrivi e attivabili/disattivabili;
  - testo da mostrare a tempo scaduto;
  - colore di avviso negli ultimi N secondi e colore di fine;
  - opzione per continuare a contare in negativo dopo lo zero;
  - scelta del monitor su cui mostrare il countdown.
- Scorciatoie nella finestra di controllo: **barra spaziatrice** avvia/pausa, **R** azzera.
- Le impostazioni vengono salvate e ritrovate al riavvio.
- Con un solo monitor collegato lo schermo countdown appare come anteprima in finestra; se colleghi il secondo monitor si sposta da solo a tutto schermo.

## Avvio in sviluppo

Serve [Node.js](https://nodejs.org/) 20 o successivo.

```bash
npm install
npm start
```

## Creare l'eseguibile per Windows

Su un PC Windows:

```bash
npm install
npm run dist
```

Nella cartella `dist/` trovi:

- `Mio Countdown Setup x.y.z.exe` – installer;
- `Mio Countdown x.y.z.exe` – versione portable, da avviare senza installare.

In alternativa, ogni push su `main` fa partire la GitHub Action **Build Windows**, che crea gli stessi `.exe`: li scarichi dalla pagina dell'esecuzione in *Actions → Build Windows → Artifacts*.

## Struttura

```
src/
  main.js          processo principale: finestre, monitor, stato del timer
  preload.js       ponte sicuro tra finestre e processo principale
  format.js        formattazione del tempo
  control/         finestra di controllo
  display/         schermo del countdown
```

Il timer vive nel processo principale ed è basato sull'orario di fine, quindi resta preciso anche se una finestra rallenta; le due finestre ricevono lo stesso stato circa 10 volte al secondo.
