// Lingua dell'interfaccia: i testi sono scritti in italiano nel codice e
// t() li traduce in inglese quando serve. Le traduzioni stanno in i18n-en.js.
(function (root) {
  const EN = typeof module !== 'undefined' && module.exports ? require('./i18n-en') : root.I18N_EN;
  let lang = 'it';

  function setLang(l) {
    lang = l === 'en' ? 'en' : 'it';
  }

  function getLang() {
    return lang;
  }

  // t('Eliminare "{name}"?', { name }) sostituisce anche i segnaposto.
  function t(text, vars) {
    let out = lang === 'en' && EN[text] !== undefined ? EN[text] : text;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return out;
  }

  const api = { t, setLang, getLang };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
