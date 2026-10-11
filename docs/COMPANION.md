# IGOR - ABit/s — Companion / Stream Deck guide / Guida

[English](#english) · [Italiano](#italiano)

---

## English

IGOR can be controlled from **Bitfocus Companion** (and so from an Elgato Stream Deck) with Companion's ready-made **Generic HTTP** module. No special IGOR module is needed: every Stream Deck button simply calls an address such as `http://192.168.1.20:8765/api/cut`.

### 1. Turn on the HTTP commands in IGOR

1. In the bottom bar, click the **Companion / Stream Deck** icon (the one with four small squares).
2. Tick **Accept commands over HTTP**. The default **Port** is **8765**; change it only if another program already uses it.
3. If Companion runs on **another computer**, also tick **Also accept commands from other computers on the network**. If Companion runs on the same PC as IGOR, leave it off.
4. The window shows the address IGOR is listening on, for example `Running on http://192.168.1.20:8765`. Note the IP address: Companion needs it.
5. The first time you enable network access, Windows may ask whether to allow IGOR through the firewall: allow it on **private** networks.

Quick test: open `http://IP-OF-THE-PC:8765/api` in a browser. You should see the list of IGOR commands. Click one: the reply `{"ok":true,…}` means IGOR received it.

### 2. Add the connection in Companion

1. In Companion open **Connections**, search for **Generic HTTP** (module "Generic: HTTP Requests") and add it.
2. In its settings, set **Base URL** to `http://IP-OF-THE-PC:8765/api/`. Use `127.0.0.1` as the IP when Companion and IGOR are on the same PC.
3. Save.

### 3. Create the buttons

For each Stream Deck button: **Press actions → Generic HTTP → GET**, and in **URI** write the command from the table below (for example `cut`, or `program/2`). With the Base URL above, Companion calls `http://IP-OF-THE-PC:8765/api/cut`.

You can also leave the Base URL empty and write the full address in each button's URI.

### 4. Commands

| URI (after `/api/`) | What it does |
| --- | --- |
| `cut` | CUT: puts the preview scene on air at once (studio mode) |
| `fade` | FADE: dissolve to the preview scene (studio mode) |
| `program/N` | Puts scene number N on air, e.g. `program/2` |
| `preview/N` | Puts scene number N in preview, e.g. `preview/1` (studio mode) |
| `studio` | Turns studio mode on / off |
| `timer/toggle` | Timer: start / pause |
| `timer/reset` | Timer: reset |
| `video/toggle` | Video on air: play / pause |
| `video/restart` | Video on air: from the beginning |
| `prompter/toggle` | TelePrompt: start / pause |
| `prompter/faster` | TelePrompt: faster |
| `prompter/slower` | TelePrompt: slower |
| `prompter/speed?value=120` | TelePrompt: set the speed (pixels per second on 1080, 0–2000) |
| `prompter/next` | TelePrompt: next paragraph |
| `prompter/prev` | TelePrompt: previous paragraph |
| `prompter/top` | TelePrompt: back to the beginning |
| `output/toggle` | Show / hide the output |

Example full addresses: `http://192.168.1.20:8765/api/cut`, `http://192.168.1.20:8765/api/program/3`, `http://192.168.1.20:8765/api/prompter/speed?value=80`.

### Good to know

- **Scene numbers** count from the top of IGOR's inputs list: the first scene is 1, the second 2, and so on. Moving scenes in the list changes their numbers.
- **Timer, video and TelePrompt** commands act on the selected element of that type; if none is selected, on the one on air; otherwise on the first in the list.
- **CUT, FADE and preview** only work in studio mode. In light mode, scene and studio commands are ignored.
- IGOR answers every request: `200` with `"ok":true` when it received the command, `404` for an unknown command, `400` when the scene number is missing, `503` if the control window is not ready.
- IGOR's own help page is always at `http://IP-OF-THE-PC:8765/api`.

---

## Italiano

IGOR si comanda da **Bitfocus Companion** (e quindi da uno Stream Deck di Elgato) con il modulo già pronto di Companion **Generic HTTP**. Non serve un modulo apposito per IGOR: ogni tasto dello Stream Deck chiama semplicemente un indirizzo come `http://192.168.1.20:8765/api/cut`.

### 1. Attivare i comandi HTTP in IGOR

1. Nella barra in basso fai clic sull'icona **Companion / Stream Deck** (quella con i quattro quadratini).
2. Spunta **Accetta comandi via HTTP**. La **Porta** di base è **8765**; cambiala solo se un altro programma la usa già.
3. Se Companion è su **un altro computer**, spunta anche **Accetta comandi anche da altri computer della rete**. Se Companion è sullo stesso PC di IGOR, lasciala spenta.
4. La finestra mostra l'indirizzo su cui IGOR ascolta, per esempio `Attivo su http://192.168.1.20:8765`. Annota l'indirizzo IP: serve a Companion.
5. La prima volta che attivi l'accesso dalla rete, Windows può chiedere se lasciar passare IGOR dal firewall: consentilo sulle reti **private**.

Prova veloce: apri `http://IP-DEL-PC:8765/api` in un browser. Deve comparire l'elenco dei comandi di IGOR. Facendo clic su uno, la risposta `{"ok":true,…}` vuol dire che IGOR l'ha ricevuto.

### 2. Aggiungere il collegamento in Companion

1. In Companion apri **Connections**, cerca **Generic HTTP** (modulo "Generic: HTTP Requests") e aggiungilo.
2. Nelle sue impostazioni metti in **Base URL** `http://IP-DEL-PC:8765/api/`. Usa `127.0.0.1` come IP se Companion e IGOR sono sullo stesso PC.
3. Salva.

### 3. Creare i tasti

Per ogni tasto dello Stream Deck: **Press actions → Generic HTTP → GET**, e in **URI** scrivi il comando dalla tabella qui sotto (per esempio `cut`, oppure `program/2`). Con la Base URL di prima, Companion chiama `http://IP-DEL-PC:8765/api/cut`.

Puoi anche lasciare vuota la Base URL e scrivere l'indirizzo completo nell'URI di ogni tasto.

### 4. Comandi

| URI (dopo `/api/`) | Cosa fa |
| --- | --- |
| `cut` | CUT: manda subito in onda la scena in anteprima (modalità studio) |
| `fade` | FADE: dissolvenza verso la scena in anteprima (modalità studio) |
| `program/N` | Manda in onda la scena numero N, es. `program/2` |
| `preview/N` | Mette in anteprima la scena numero N, es. `preview/1` (modalità studio) |
| `studio` | Attiva / disattiva la modalità studio |
| `timer/toggle` | Timer: avvia / pausa |
| `timer/reset` | Timer: azzera |
| `video/toggle` | Video in onda: riproduci / pausa |
| `video/restart` | Video in onda: da capo |
| `prompter/toggle` | TelePrompt: avvia / pausa |
| `prompter/faster` | TelePrompt: più veloce |
| `prompter/slower` | TelePrompt: più lento |
| `prompter/speed?value=120` | TelePrompt: imposta la velocità (pixel al secondo su 1080, da 0 a 2000) |
| `prompter/next` | TelePrompt: paragrafo successivo |
| `prompter/prev` | TelePrompt: paragrafo precedente |
| `prompter/top` | TelePrompt: torna all'inizio |
| `output/toggle` | Mostra / nascondi l'uscita |

Esempi di indirizzi completi: `http://192.168.1.20:8765/api/cut`, `http://192.168.1.20:8765/api/program/3`, `http://192.168.1.20:8765/api/prompter/speed?value=80`.

### Da sapere

- I **numeri delle scene** si contano dall'alto nell'elenco degli input di IGOR: la prima scena è la 1, la seconda la 2 e così via. Spostando le scene nell'elenco cambiano anche i numeri.
- I comandi di **timer, video e TelePrompt** agiscono sull'elemento di quel tipo selezionato; se non ce n'è uno selezionato, su quello in onda; altrimenti sul primo dell'elenco.
- **CUT, FADE e anteprima** funzionano solo in modalità studio. In modalità light i comandi delle scene e della modalità studio vengono ignorati.
- IGOR risponde a ogni richiesta: `200` con `"ok":true` quando ha ricevuto il comando, `404` per un comando sconosciuto, `400` se manca il numero della scena, `503` se la regia non è pronta.
- La pagina di aiuto di IGOR è sempre a `http://IP-DEL-PC:8765/api`.
