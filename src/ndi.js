// Accesso a NDI tramite il modulo nativo @stagetimerio/grandiose (NDI SDK 6).
// Il modulo è facoltativo: se manca o non si carica, l'app funziona lo stesso
// e gli input NDI risultano non disponibili.
let grandiose = null;
let loadError = null;
try {
  grandiose = require('@stagetimerio/grandiose');
} catch (err) {
  loadError = err.message;
}

let finder = null;
let found = [];
let stopped = false;

async function discoveryLoop() {
  try {
    finder = await grandiose.find({ showLocalSources: true });
    while (!stopped) {
      await finder.wait(2000);
      found = finder.sources();
    }
  } catch (err) {
    loadError = `Ricerca NDI non riuscita: ${err.message}`;
  }
}

module.exports = {
  get available() {
    return !!grandiose;
  },
  get error() {
    return loadError;
  },
  grandiose,
  startDiscovery() {
    if (grandiose) discoveryLoop();
  },
  stopDiscovery() {
    stopped = true;
    if (finder) finder.destroy().catch(() => {});
  },
  sources() {
    return found.map((s) => ({ name: s.name, urlAddress: s.urlAddress }));
  }
};
