# IGOR - ABit/s — Mini manuale / Quick guide

*Versione / Version 0.4.15*

[Italiano](#italiano) · [English](#english) · [Español](MANUALE-ES.md) · [Français](MANUALE-FR.md) · [中文](MANUALE-ZH.md) · [العربية](MANUALE-AR.md)

---

## Italiano

### Cos'è
IGOR è una piccola regia video per Windows e Mac. La **regia** sta sul monitor principale, l'**uscita** va a tutto schermo sul secondo monitor (con un solo monitor appare come finestra). In uscita si compongono segnali NDI, videocamere e schede di acquisizione, video e immagini, un timer, un banner di testo e un teleprompter. L'uscita va ai fotogrammi al secondo del suo monitor (Auto); dalla barra in basso si possono ridurre per usare meno risorse.

### La regia in breve
- **Menu in alto**
  - *File*: importa ed esporta la configurazione, colore di sfondo dell'uscita.
  - *Visualizza*: modalità light, modalità studio, istruzioni sì/no, ripristina la disposizione, questo manuale.
- **Barra in basso**
  - A sinistra (blu): **Ripristina finestre tab** riporta tutte le schede dei dettagli al loro posto iniziale; **Separa Finestra Dettagli** apre i dettagli input in una finestra a parte (lo stesso pulsante, *Riunisci Finestra Dettagli*, li riporta nella regia).
  - A destra (grigio), a icone: **NDI** (verde = l'uscita è inviata in rete come sorgente "IGOR - ABit/s", rosso = spento; passando sopra si vedono nome e ricevitori collegati), **monitor** (mostra/nascondi l'uscita), scelta del **monitor** e dei **fotogrammi al secondo**, **importa** ed **esporta** la configurazione (file `.igor`), **lingua** (italiano, inglese, spagnolo, francese, cinese, arabo), **controller MIDI**, **Companion / Stream Deck** e **telecomando dal telefono** (QR code: dalla stessa rete Wi-Fi si mandano in onda le scene, si usano CUT e FADE, si mostrano e nascondono gli input e si avviano timer e TelePrompt).
  - I monitor sono numerati così: il principale è il numero 1, gli altri seguono da sinistra a destra.
- **Anteprima** (in alto): trascina un elemento per spostarlo, un angolo per ridimensionarlo (Maiusc mantiene le proporzioni). Su video e immagini le maniglie arancioni ritagliano.
- **Colonna degli input** (a destra): il pulsante blu **+** aggiunge un input (NDI, periferica, media, timer, Banner di Testo, TelePrompt). Per creare una scena premi **Aggiungi scena** in basso, clicca sugli input da metterci dentro (anche più di uno, o nessuno per una scena vuota) e poi **Aggiungi**; il pulsante **LIGHT** passa alla modalità light, e diventa **STUDIO** per tornare alla modalità completa (vedi sotto).
  - L'elenco va dal primo piano allo sfondo; si trascina per cambiare l'ordine o per mettere un input in una scena (Ctrl al rilascio = anche in quella scena).
  - **Mostra tutti**, sopra l'elenco, rende di nuovo visibili tutti gli input.
  - Su ogni riga: 👁 visibile/nascosto, ↺ ripristina misure e impostazioni dell'input, cestino rosso per eliminare.
  - Ctrl + clic o Maiusc + clic selezionano più righe; con il clic destro compaiono *Elimina* e *Ripristina input* per tutte le righe selezionate.
- **Dettagli input** (in basso): le impostazioni dell'input selezionato, divise in schede.
  - Ogni scheda si sposta trascinando il titolo e si allarga o si alza dai bordi destro e inferiore, in modo indipendente dalle altre.
  - Un clic sul titolo (o sulla linguetta ▾) la riduce a barra.
  - Il pulsante ⧉ apre la scheda in una finestra separata, che puoi mettere dove vuoi (anche su un altro monitor); *Riporta nella regia* la rimette a posto.

### Colori
- Rosso: in onda, e il tasto *Elimina*.
- Verde: anteprima.
- Blu e grigio IGOR: pulsanti di comando (CUT blu, FADE grigio).

### Scene e modalità studio
Una scena raccoglie più input; in onda va una scena alla volta. Gli input fuori dalle scene restano sempre visibili. Con la **modalità studio** compaiono due schermi: a sinistra l'**anteprima** (verde), a destra quello che è **in onda** (rosso); al centro **CUT** (cambio secco) e **FADE** (dissolvenza), con la scelta della durata della dissolvenza.

### Modalità light e full
- **Full**: tutte le funzioni, con scene e modalità studio.
- **Light** (pulsante LIGHT): per computer meno potenti. Le scene e la modalità studio si spengono; gli input della scena in onda diventano un elenco semplice, nelle stesse posizioni, e l'uscita non si interrompe. Le altre scene vengono messe da parte e le loro sorgenti (videocamere, NDI, video) si chiudono. In light si possono aggiungere solo timer, TelePrompt, immagini, una periferica di acquisizione e un segnale NDI.
- Con il pulsante STUDIO si torna a full: le scene ritornano e la scena di prima torna in onda con le modifiche fatte nel frattempo. Gli input aggiunti in light restano fuori dalle scene.

### Gli elementi
- **Timer**: conto alla rovescia o cronometro, tre colori (partenza, scadenza vicina, tempo superato), cornice lampeggiante a tempo scaduto, orologio quando è fermo, segnale acustico allo scadere (campanella o file audio, uscita audio a scelta, ripetizione). Barra spaziatrice = avvia/pausa.
- **Banner di Testo**: fascia di testo che scorre se è più lunga dello schermo.
- **TelePrompt**: testo che sale alla velocità scelta; si scrive, si incolla o si importa (.docx, .rtf, .txt, .html); carattere in punti; pulsanti con icona per specchio e linea di lettura; pausa e play automatici quando esce o entra in onda.
- **NDI**, **Periferica di acquisizione**, **Media** (video e immagini): adatta / riempi / deforma, ritaglio in % o in pixel; per i video: timeline trascinabile con inizio e fine segnabili, ripeti, riproduci quando in onda, pausa e riavvolgi quando non in onda, audio Follow.
- **Tasto destro su un input**: copia, taglia, incolla, copia e incolla attributi (solo l'aspetto, tra input dello stesso tipo).

### Controllo remoto
- **MIDI**: scegli un comando, premi *Impara* e tocca un tasto del controller.
- **Companion**: attiva *Accetta comandi via HTTP* e usa indirizzi come `http://127.0.0.1:8765/api/cut` (modulo *Generic HTTP*). Guida completa: [COMPANION.md](COMPANION.md).

### Consigli
- *Visualizza → Ripristina la disposizione delle finestre* rimette schede e zone come all'inizio.
- La configurazione si salva da sola; per portarla su un altro PC usa l'icona *Esporta* nella barra in basso.

---

## English

### What it is
IGOR is a small video mixer for Windows and Mac. The **control window** sits on the main monitor, the **output** goes full screen on the second monitor (with only one monitor it appears as a window). The output combines NDI sources, cameras and capture cards, videos and images, a timer, a text banner and a teleprompter. The output runs at its monitor's frame rate (Auto); you can lower it from the bottom bar to use fewer resources.

### The control window at a glance
- **Top menu**
  - *File*: import and export the configuration, output background colour.
  - *View*: light mode, studio mode, instructions on/off, reset the layout, this guide.
- **Bottom bar**
  - On the left (blue): **Reset panel windows** puts all detail panels back in their original place; **Separate Details Window** opens the input details in a window of their own (the same button, *Rejoin Details Window*, brings them back).
  - On the right (grey), as icons: **NDI** (green = the output is sent over the network as the "IGOR - ABit/s" source, red = off; hover to see the name and connected receivers), **monitor** (show/hide the output), choice of **monitor** and **frames per second**, **import** and **export** the configuration (`.igor` file), **language** (Italian, English, Spanish, French, Chinese, Arabic), **MIDI controller**, **Companion / Stream Deck** and **phone remote** (QR code: from the same Wi-Fi network you put scenes on air, use CUT and FADE, show and hide inputs, and start timers and TelePrompts).
  - Monitors are numbered like this: the main one is number 1, the others follow from left to right.
- **Preview** (top): drag an element to move it, a corner to resize it (Shift keeps the proportions). On videos and images the orange handles crop.
- **Inputs column** (right): the blue **+** button adds an input (NDI, capture device, media, timer, Text Banner, TelePrompt). To create a scene press **Add scene** at the bottom, click the inputs to put inside (more than one, or none for an empty scene) and then **Add**; the **LIGHT** button switches to light mode and becomes **STUDIO** to go back to full mode (see below).
  - The list goes from foreground to background; drag to change the order or to put an input in a scene (Ctrl on release = also in that scene).
  - **Show all**, above the list, makes all inputs visible again.
  - On each row: 👁 visible/hidden, ↺ reset the input size and settings, red bin to delete.
  - Ctrl + click or Shift + click select several rows; right-click shows *Delete* and *Reset input* for all the selected rows.
- **Input details** (bottom): the settings of the selected input, split into panels.
  - Each panel moves by dragging its title and gets wider or taller from its right and bottom edges, independently of the others.
  - Clicking the title (or the ▾ tab) collapses it to a bar.
  - The ⧉ button opens the panel in a separate window that you can place anywhere (even on another monitor); *Bring back to the control window* puts it back.

### Colours
- Red: on air, and the *Delete* button.
- Green: preview.
- IGOR blue and grey: command buttons (CUT blue, FADE grey).

### Scenes and studio mode
A scene groups several inputs; one scene at a time is on air. Inputs outside scenes are always visible. **Studio mode** shows two screens: the **preview** on the left (green) and what is **on air** on the right (red); in the middle **CUT** (hard switch) and **FADE** (dissolve), with the choice of dissolve duration.

### Light and full mode
- **Full**: all features, with scenes and studio mode.
- **Light** (LIGHT button): for less powerful computers. Scenes and studio mode are switched off; the inputs of the scene on air become a simple list, in the same positions, and the output is not interrupted. The other scenes are set aside and their sources (cameras, NDI, videos) are closed. In light mode you can only add timers, TelePrompts, images, one capture device and one NDI signal.
- The STUDIO button goes back to full mode: the scenes return and the previous scene goes back on air with the changes made in the meantime. Inputs added in light mode stay outside the scenes.

### Elements
- **Timer**: countdown or stopwatch, three colours (start, close to the end, time up), blinking frame when time is up, clock when stopped, sound signal when time is up (bell or audio file, choice of audio output, repeat). Space bar = start/pause.
- **Text Banner**: a strip of text that scrolls when it is longer than the screen.
- **TelePrompt**: text that rises at the chosen speed; type, paste or import it (.docx, .rtf, .txt, .html); font size in points; icon buttons for mirror and reading line; automatic pause and play when it leaves or goes on air.
- **NDI**, **Capture device**, **Media** (videos and images): fit / fill / stretch, crop in % or pixels; for videos: draggable timeline with markable start and end, loop, play when on air, pause and rewind when not on air, Follow audio.
- **Right-click on an input**: copy, cut, paste, copy and paste attributes (look only, between inputs of the same type).

### Remote control
- **MIDI**: choose a command, press *Learn* and touch a key on the controller.
- **Companion**: turn on *Accept commands over HTTP* and use addresses like `http://127.0.0.1:8765/api/cut` (*Generic HTTP* module). Full guide: [COMPANION.md](COMPANION.md).

### Tips
- *View → Reset the window layout* puts panels and zones back as they were at the start.
- The configuration is saved automatically; to move it to another PC use the *Export* icon in the bottom bar.
