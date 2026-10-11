# IGOR - ABit/s — Mini manuale / Quick guide

[Italiano](#italiano) · [English](#english)

---

## Italiano

### Cos'è
IGOR è una piccola regia video per Windows. La **regia** sta sul monitor principale, l'**uscita** va a tutto schermo sul secondo monitor (con un solo monitor appare come finestra). In uscita si compongono segnali NDI, videocamere e schede di acquisizione, video e immagini, un timer, un banner di testo e un teleprompter. L'uscita non supera mai i 25 fotogrammi al secondo.

### La regia in breve
- **Menu in alto**
  - *File*: importa ed esporta la configurazione (file `.igor`); *File → Uscita*: monitor dell'uscita, fotogrammi al secondo, colore di sfondo, mostra/nascondi uscita, **invia l'uscita in NDI** (in rete compare come sorgente "IGOR - ABit/s", con il numero di ricevitori collegati).
  - *Visualizza*: modalità light, modalità studio, istruzioni sì/no, ripristina la disposizione, dettagli input in una finestra separata, lingua, questo manuale.
  - *Controllo remoto*: controller MIDI e Companion / Stream Deck.
- **Anteprima** (in alto): trascina un elemento per spostarlo, un angolo per ridimensionarlo (Maiusc mantiene le proporzioni). Su video e immagini le maniglie arancioni ritagliano.
- **Colonna degli input** (a destra): il pulsante **Modalità light** passa dalla modalità full a quella light e viceversa (vedi sotto); il pulsante blu **+** aggiunge un elemento (scena, NDI, periferica, media, timer, Banner di Testo, TelePrompt). L'elenco va dal primo piano allo sfondo; si trascina per cambiare l'ordine o per mettere un input in una scena (Ctrl al rilascio = anche in quella scena).
- **Dettagli input** (in basso): le impostazioni dell'input selezionato, divise in schede.
  - Ogni scheda si sposta trascinando il titolo e si allarga o si alza dai bordi destro e inferiore, in modo indipendente dalle altre.
  - Un clic sul titolo (o sulla linguetta ▾) la riduce a barra.
  - Il pulsante ⧉ apre la scheda in una finestra separata, che puoi mettere dove vuoi (anche su un altro monitor); *Riporta nella regia* la rimette a posto. Il ⧉ in basso a destra porta in una finestra tutti i dettagli.
  - In basso: *Ripristina misure* e il tasto rosso *Elimina input*.

### Colori
- Rosso: in onda, e il tasto *Elimina*.
- Verde: anteprima.
- Blu e grigio IGOR: pulsanti di comando (CUT blu, FADE grigio).

### Scene e modalità studio
Una scena raccoglie più input; in onda va una scena alla volta. Gli input fuori dalle scene restano sempre visibili. Con la **modalità studio** compaiono due schermi: a sinistra l'**anteprima** (verde), a destra quello che è **in onda** (rosso); al centro **CUT** (cambio secco) e **FADE** (dissolvenza).

### Modalità light e full
- **Full**: tutte le funzioni, con scene e modalità studio.
- **Light**: per computer meno potenti. Le scene e la modalità studio si spengono; gli input della scena in onda diventano un elenco semplice, nelle stesse posizioni, e l'uscita non si interrompe. Le altre scene vengono messe da parte e le loro sorgenti (videocamere, NDI, video) si chiudono.
- Tornando a full, le scene ritornano e la scena di prima torna in onda con le modifiche fatte nel frattempo. Gli input aggiunti in light restano fuori dalle scene.

### Gli elementi
- **Timer**: conto alla rovescia o cronometro, tre colori (partenza, scadenza vicina, tempo superato), cornice lampeggiante a tempo scaduto, orologio quando è fermo. Barra spaziatrice = avvia/pausa.
- **Banner di Testo**: fascia di testo che scorre se è più lunga dello schermo.
- **TelePrompt**: testo che sale alla velocità scelta; si scrive, si incolla o si importa (.docx, .rtf, .txt, .html); specchio e linea di lettura.
- **NDI**, **Periferica di acquisizione**, **Media** (video e immagini): adatta / riempi / deforma, ritaglio, modi di riproduzione e audio per i video.

### Controllo remoto
- **MIDI**: scegli un comando, premi *Impara* e tocca un tasto del controller.
- **Companion**: attiva *Accetta comandi via HTTP* e usa indirizzi come `http://127.0.0.1:8765/api/cut` (modulo *Generic HTTP*).

### Consigli
- *Visualizza → Ripristina la disposizione delle finestre* rimette schede e zone come all'inizio.
- La configurazione si salva da sola; per portarla su un altro PC usa *File → Esporta*.

---

## English

### What it is
IGOR is a small video mixer for Windows. The **control window** sits on the main monitor, the **output** goes full screen on the second monitor (with only one monitor it appears as a window). The output combines NDI sources, cameras and capture cards, videos and images, a timer, a text banner and a teleprompter. The output never goes above 25 frames per second.

### The control window at a glance
- **Top menu**
  - *File*: import and export the configuration (`.igor` file); *File → Output*: output monitor, frames per second, background colour, show/hide output, **send the output over NDI** (it appears on the network as the "IGOR - ABit/s" source, with the number of connected receivers).
  - *View*: light mode, studio mode, instructions on/off, reset the layout, input details in a separate window, language, this guide.
  - *Remote control*: MIDI controller and Companion / Stream Deck.
- **Preview** (top): drag an element to move it, a corner to resize it (Shift keeps the proportions). On videos and images the orange handles crop.
- **Inputs column** (right): the **Light mode** button switches between full and light mode (see below); the blue **+** button adds an element (scene, NDI, capture device, media, timer, Text Banner, TelePrompt). The list goes from foreground to background; drag to change the order or to put an input in a scene (Ctrl on release = also in that scene).
- **Input details** (bottom): the settings of the selected input, split into panels.
  - Each panel moves by dragging its title and gets wider or taller from its right and bottom edges, independently of the others.
  - Clicking the title (or the ▾ tab) collapses it to a bar.
  - The ⧉ button opens the panel in a separate window that you can place anywhere (even on another monitor); *Bring back to the control window* puts it back. The ⧉ at the bottom right moves all the details to a window.
  - At the bottom: *Reset size* and the red *Delete input* button.

### Colours
- Red: on air, and the *Delete* button.
- Green: preview.
- IGOR blue and grey: command buttons (CUT blue, FADE grey).

### Scenes and studio mode
A scene groups several inputs; one scene at a time is on air. Inputs outside scenes are always visible. **Studio mode** shows two screens: the **preview** on the left (green) and what is **on air** on the right (red); in the middle **CUT** (hard switch) and **FADE** (dissolve).

### Light and full mode
- **Full**: all features, with scenes and studio mode.
- **Light**: for less powerful computers. Scenes and studio mode are switched off; the inputs of the scene on air become a simple list, in the same positions, and the output is not interrupted. The other scenes are set aside and their sources (cameras, NDI, videos) are closed.
- Back in full mode, the scenes return and the previous scene goes back on air with the changes made in the meantime. Inputs added in light mode stay outside the scenes.

### Elements
- **Timer**: countdown or stopwatch, three colours (start, close to the end, time up), blinking frame when time is up, clock when stopped. Space bar = start/pause.
- **Text Banner**: a strip of text that scrolls when it is longer than the screen.
- **TelePrompt**: text that rises at the chosen speed; type, paste or import it (.docx, .rtf, .txt, .html); mirror and reading line.
- **NDI**, **Capture device**, **Media** (videos and images): fit / fill / stretch, crop, play and audio modes for videos.

### Remote control
- **MIDI**: choose a command, press *Learn* and touch a key on the controller.
- **Companion**: turn on *Accept commands over HTTP* and use addresses like `http://127.0.0.1:8765/api/cut` (*Generic HTTP* module).

### Tips
- *View → Reset the window layout* puts panels and zones back as they were at the start.
- The configuration is saved automatically; to move it to another PC use *File → Export*.
