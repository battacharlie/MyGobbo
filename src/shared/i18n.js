// Lingua dell'interfaccia: i testi sono scritti in italiano nel codice e
// t() li traduce quando serve. Le traduzioni stanno in i18n-<lingua>.js;
// un testo che manca in una lingua si mostra in inglese.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const DICTS = node ? {
    en: require('./i18n-en'),
    es: require('./i18n-es'),
    fr: require('./i18n-fr'),
    zh: require('./i18n-zh'),
    ar: require('./i18n-ar')
  } : { en: root.I18N_EN, es: root.I18N_ES, fr: root.I18N_FR, zh: root.I18N_ZH, ar: root.I18N_AR };
  // Codice e nome mostrato nella tendina della lingua.
  const LANGS = [['it', 'IT'], ['en', 'EN'], ['es', 'ES'], ['fr', 'FR'], ['zh', '中文'], ['ar', 'عربي']];
  let lang = 'it';

  function normLang(l) {
    return LANGS.some(([code]) => code === l) ? l : 'it';
  }

  function setLang(l) {
    lang = normLang(l);
  }

  function getLang() {
    return lang;
  }

  // t('Eliminare "{name}"?', { name }) sostituisce anche i segnaposto.
  function t(text, vars) {
    let out = text;
    if (lang !== 'it') {
      const own = DICTS[lang] || {};
      const en = DICTS.en || {};
      if (own[text] !== undefined) out = own[text];
      else if (en[text] !== undefined) out = en[text];
    }
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return out;
  }

  const api = { t, setLang, getLang, normLang, LANGS };
  if (node) module.exports = api;
  else root.I18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
