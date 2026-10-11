// Testo del TelePrompt: tutto quello che arriva (copia e incolla da Word,
// Blocco note, Pages, TextEdit, oppure file .docx, .rtf, .txt, .html)
// diventa un HTML semplice e sicuro: paragrafi <p> con grassetto, corsivo,
// sottolineato, barrato, colore, evidenziatore e dimensione relativa.
// Carattere, interlinea e spaziatura si scelgono poi per tutto il testo.
(function (root) {
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE', 'UL', 'OL',
    'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'DD', 'DT', 'DL', 'BODY', 'HTML', 'CENTER', 'ADDRESS', 'FIGURE', 'MAIN', 'NAV', 'ASIDE', 'TBODY', 'THEAD', 'HR']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'IMG', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'CANVAS',
    'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'XML']);
  const HEADING_SIZE = { H1: 1.6, H2: 1.35, H3: 1.15 };
  const FONT_SIZES = [0, 7.5, 10, 12, 13.5, 18, 24, 36];

  const probe = document.createElement('canvas').getContext('2d');
  // Colore CSS -> #rrggbb, oppure null se non valido o trasparente.
  function normColor(value) {
    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    if (!v || v === 'transparent' || v === 'auto' || v === 'windowtext' || v === 'inherit' || v === 'initial') return null;
    probe.fillStyle = '#010203';
    probe.fillStyle = v;
    const out = probe.fillStyle;
    if (out === '#010203' && v !== '#010203') return null;
    if (out.startsWith('rgba')) {
      const [r, g, b, a] = out.match(/[\d.]+/g).map(Number);
      if (!(a > 0)) return null;
      return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    }
    return out;
  }
  function isDark(hex) {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) < 40 && ((n >> 8) & 255) < 40 && (n & 255) < 40;
  }

  function escapeHtml(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function parseSize(value, parentPt) {
    if (!value) return null;
    const m = String(value).trim().match(/^([\d.]+)(pt|px|em|rem|%)$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!(n > 0)) return null;
    switch (m[2]) {
      case 'pt': return n;
      case 'px': return n * 0.75;
      case 'em': case 'rem': return (parentPt || 12) * n;
      case '%': return ((parentPt || 12) * n) / 100;
    }
    return null;
  }

  // Stile di un elemento, ereditato dal genitore.
  function styleOf(el, parent) {
    const st = { ...parent };
    const tag = el.nodeName;
    if (tag === 'B' || tag === 'STRONG') st.b = true;
    if (tag === 'I' || tag === 'EM') st.i = true;
    if (tag === 'U' || tag === 'INS') st.u = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') st.s = true;
    if (tag === 'MARK') st.bg = '#ffff00';
    if (HEADING_SIZE[tag]) {
      st.b = true;
      st.rel = HEADING_SIZE[tag];
    }
    if (tag === 'FONT') {
      const c = normColor(el.getAttribute('color'));
      if (c) st.color = c;
      const sz = Number(el.getAttribute('size'));
      if (sz >= 1 && sz <= 7) st.size = FONT_SIZES[sz];
    }
    const css = el.style;
    if (css) {
      if (css.fontWeight) st.b = css.fontWeight === 'bold' || css.fontWeight === 'bolder' || Number(css.fontWeight) >= 600;
      if (css.fontStyle) st.i = css.fontStyle === 'italic' || css.fontStyle === 'oblique';
      const deco = css.textDecorationLine || css.textDecoration;
      if (deco) {
        st.u = deco.includes('underline');
        st.s = deco.includes('line-through');
      }
      if (css.color) {
        const c = normColor(css.color);
        if (c) st.color = c;
        else if (/^(windowtext|auto|black)$/i.test(css.color)) st.color = null;
      }
      const bg = css.backgroundColor;
      if (bg) st.bg = normColor(bg);
      const size = parseSize(css.fontSize, parent.size);
      if (size) {
        st.size = size;
        st.rel = null;
      }
    }
    return st;
  }

  // Converte un albero HTML in paragrafi di "pezzi" di testo con uno stile.
  function collect(rootNode) {
    const paragraphs = [];
    let current = null;
    const flush = () => {
      if (current) paragraphs.push(current);
      current = null;
    };
    const ensure = (align) => {
      if (!current) current = { align, runs: [] };
      return current;
    };
    const walk = (node, st, align) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const text = child.nodeValue.replace(/[ \t\n\r\f]+/g, ' ');
          if (!text) continue;
          const p = ensure(align);
          if (!p.runs.length && text === ' ') continue;
          p.runs.push({ text: p.runs.length ? text : text.replace(/^ /, ''), st });
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = child.nodeName.toUpperCase();
        if (SKIP.has(tag)) continue;
        if (tag === 'BR') {
          ensure(align).runs.push({ br: true, st });
          continue;
        }
        const cst = styleOf(child, st);
        if (BLOCK.has(tag)) {
          const a = (child.style && child.style.textAlign) || child.getAttribute('align') || (tag === 'CENTER' ? 'center' : align);
          flush();
          if (tag === 'LI') ensure(a).runs.push({ text: '• ', st: cst });
          walk(child, cst, a);
          // Paragrafo vuoto (riga bianca in Word): resta come spazio.
          if (current) flush();
          else if (tag === 'P' || tag === 'DIV') paragraphs.push({ align: a, runs: [] });
        } else {
          walk(child, cst, align);
        }
      }
    };
    walk(rootNode, { b: false, i: false, u: false, s: false, color: null, bg: null, size: null, rel: null }, 'left');
    flush();
    return paragraphs;
  }

  function serialize(paragraphs) {
    // Dimensione di base: quella usata per la maggior parte del testo.
    const weights = new Map();
    // Il testo senza dimensione indicata conta come 12 pt.
    for (const p of paragraphs) for (const r of p.runs) if (r.text) weights.set(r.st.size || 12, (weights.get(r.st.size || 12) || 0) + r.text.length);
    let base = 12;
    let best = 0;
    for (const [size, w] of weights) if (w > best) { best = w; base = size; }
    // Toglie le righe vuote all'inizio e alla fine.
    const isEmpty = (p) => !p.runs.some((r) => r.text && r.text.trim());
    while (paragraphs.length && isEmpty(paragraphs[0])) paragraphs.shift();
    while (paragraphs.length && isEmpty(paragraphs[paragraphs.length - 1])) paragraphs.pop();

    const html = paragraphs.map((p) => {
      let body = '';
      let open = null;
      let buf = '';
      const close = () => {
        if (open !== null) body += wrap(buf, open);
        open = null;
        buf = '';
      };
      for (const r of p.runs) {
        if (r.br) {
          close();
          body += '<br>';
          continue;
        }
        const key = styleKey(r.st, base);
        if (key !== open) {
          close();
          open = key;
        }
        buf += escapeHtml(r.text);
      }
      close();
      body = body.replace(/ +$/, '');
      if (!p.runs.some((r) => r.text && r.text.trim())) body = '';
      const align = ['center', 'right', 'justify'].includes(p.align) ? ` style="text-align:${p.align}"` : '';
      return `<p${align}>${body || '<br>'}</p>`;
    });
    return html.join('');
  }

  function styleKey(st, base) {
    const css = [];
    if (st.color && !isDark(st.color)) css.push(`color:${st.color}`);
    if (st.bg && st.bg !== '#ffffff') css.push(`background-color:${st.bg}`);
    let rel = (st.size || 12) / base;
    if (!st.size && st.rel) rel = st.rel;
    rel = Math.max(0.4, Math.min(4, Math.round(rel * 100) / 100));
    if (Math.abs(rel - 1) >= 0.05) css.push(`font-size:${rel}em`);
    return JSON.stringify([st.b, st.i, st.u, st.s, css.join(';')]);
  }

  function wrap(text, key) {
    const [b, i, u, s, css] = JSON.parse(key);
    let out = css ? `<span style="${css}">${text}</span>` : text;
    if (s) out = `<s>${out}</s>`;
    if (u) out = `<u>${out}</u>`;
    if (i) out = `<i>${out}</i>`;
    if (b) out = `<b>${out}</b>`;
    return out;
  }

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return serialize(collect(doc.body));
  }

  function textToHtml(text, markdown) {
    return String(text || '').replace(/\r\n?/g, '\n').split('\n').map((line) => {
      let t = line.replace(/\t/g, '    ');
      let bold = false;
      if (markdown && /^#{1,6}\s/.test(t)) {
        t = t.replace(/^#{1,6}\s+/, '');
        bold = true;
      }
      if (!t.trim()) return '<p><br></p>';
      const body = escapeHtml(t);
      return `<p>${bold ? `<b>${body}</b>` : body}</p>`;
    }).join('').replace(/^(<p><br><\/p>)+|(<p><br><\/p>)+$/g, '');
  }

  // --- RTF (TextEdit su Mac, WordPad, Word) ------------------------------------
  const RTF_SKIP = new Set(['fonttbl', 'stylesheet', 'info', 'pict', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
    'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore',
    'fldinst', 'object', 'nonshppict', 'shp', 'filetbl', 'revtbl', 'footnote', 'annotation', 'bkmkstart', 'bkmkend', 'expandedcolortbl']);
  const RTF_CHARS = { emdash: '\u2014', endash: '\u2013', bullet: '\u2022', lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201c', rdblquote: '\u201d', tab: ' ', emspace: ' ', enspace: ' ', qmspace: ' ' };
  const cp1252 = new TextDecoder('windows-1252');

  function rtfToHtml(rtf) {
    const colors = [];
    let colorEntry = { r: 0, g: 0, b: 0, set: false };
    const paragraphs = [];
    let para = { align: 'left', html: '' };
    let st = { b: false, i: false, u: false, s: false, cf: 0, cb: 0, fs: 24, skip: false, dest: null, uc: 1, align: 'left' };
    const stack = [];
    let skipChars = 0;
    let groupStart = false;

    const emit = (text) => {
      if (st.skip || !text) return;
      if (st.dest === 'colortbl') return;
      if (skipChars > 0) {
        const n = Math.min(skipChars, text.length);
        skipChars -= n;
        text = text.slice(n);
        if (!text) return;
      }
      const css = [];
      if (st.b) css.push('font-weight:bold');
      if (st.i) css.push('font-style:italic');
      const deco = [st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' ');
      if (deco) css.push(`text-decoration:${deco}`);
      if (st.cf && colors[st.cf]) css.push(`color:${colors[st.cf]}`);
      if (st.cb && colors[st.cb]) css.push(`background-color:${colors[st.cb]}`);
      css.push(`font-size:${st.fs / 2}pt`);
      para.html += `<span style="${css.join(';')}">${escapeHtml(text)}</span>`;
    };
    const endPara = () => {
      paragraphs.push(`<p style="text-align:${st.align}">${para.html}</p>`);
      para = { align: st.align, html: '' };
    };

    let i = 0;
    const n = rtf.length;
    while (i < n) {
      const ch = rtf[i];
      if (ch === '{') {
        stack.push({ ...st });
        groupStart = true;
        i++;
        continue;
      }
      if (ch === '}') {
        if (st.dest === 'colortbl') st.dest = null;
        st = stack.pop() || st;
        groupStart = false;
        i++;
        continue;
      }
      if (ch === '\\') {
        const next = rtf[i + 1];
        if (next === '\\' || next === '{' || next === '}') {
          emit(next);
          i += 2;
        } else if (next === '\'') {
          const byte = parseInt(rtf.substr(i + 2, 2), 16);
          if (skipChars > 0) skipChars--;
          else emit(cp1252.decode(new Uint8Array([byte])));
          i += 4;
        } else if (next === '*') {
          st.skip = true;
          i += 2;
        } else if (next === '~') {
          emit('\u00a0');
          i += 2;
        } else if (next === '_') {
          emit('-');
          i += 2;
        } else if (next === '\n' || next === '\r') {
          if (!st.skip) endPara();
          i += 2;
        } else if (/[a-z]/i.test(next)) {
          const m = /^([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i + 1, i + 40));
          const word = m[1];
          const param = m[2] !== undefined ? Number(m[2]) : null;
          i += 1 + m[0].length;
          const first = groupStart;
          groupStart = false;
          if (first && RTF_SKIP.has(word)) {
            st.skip = true;
            continue;
          }
          switch (word) {
            case 'colortbl': st.dest = 'colortbl'; colors.length = 0; colorEntry = { r: 0, g: 0, b: 0, set: false }; break;
            case 'red': colorEntry.r = param; colorEntry.set = true; break;
            case 'green': colorEntry.g = param; colorEntry.set = true; break;
            case 'blue': colorEntry.b = param; colorEntry.set = true; break;
            case 'par': if (!st.skip) endPara(); break;
            case 'line': if (!st.skip) para.html += '<br>'; break;
            case 'pard': st.align = 'left'; para.align = 'left'; break;
            case 'plain': Object.assign(st, { b: false, i: false, u: false, s: false, cf: 0, cb: 0, fs: 24 }); break;
            case 'b': st.b = param !== 0; break;
            case 'i': st.i = param !== 0; break;
            case 'ul': st.u = param !== 0; break;
            case 'ulnone': st.u = false; break;
            case 'strike': st.s = param !== 0; break;
            case 'cf': st.cf = param || 0; break;
            case 'cb': case 'highlight': case 'chcbpat': st.cb = param || 0; break;
            case 'fs': st.fs = param || 24; break;
            case 'qc': st.align = 'center'; break;
            case 'qr': st.align = 'right'; break;
            case 'qj': st.align = 'justify'; break;
            case 'ql': st.align = 'left'; break;
            case 'uc': st.uc = param || 0; break;
            case 'u': {
              const code = param < 0 ? param + 65536 : param;
              emit(String.fromCharCode(code));
              skipChars = st.uc;
              break;
            }
            default:
              if (RTF_CHARS[word]) emit(RTF_CHARS[word]);
          }
        } else {
          i += 2;
        }
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        i++;
        continue;
      }
      if (st.dest === 'colortbl' && !st.skip) {
        if (ch === ';') {
          colors.push(colorEntry.set ? '#' + [colorEntry.r, colorEntry.g, colorEntry.b].map((v) => v.toString(16).padStart(2, '0')).join('') : null);
          colorEntry = { r: 0, g: 0, b: 0, set: false };
        }
        i++;
        continue;
      }
      // Testo normale fino al prossimo carattere speciale.
      let j = i;
      while (j < n && !'\\{}\r\n'.includes(rtf[j])) j++;
      groupStart = false;
      emit(rtf.slice(i, j));
      i = j;
    }
    if (para.html) endPara();
    return sanitizeHtml(paragraphs.join(''));
  }

  // --- Word .docx (anche Pages esporta in questo formato) --------------------
  const HIGHLIGHT = { darkBlue: 'darkblue', darkCyan: 'darkcyan', darkGreen: 'darkgreen', darkMagenta: 'darkmagenta', darkRed: 'darkred',
    darkYellow: 'olive', darkGray: 'darkgray', lightGray: 'lightgray' };

  function docxToHtml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const attr = (el, name) => (el ? el.getAttribute(name) : null);
    const child = (el, name) => (el ? [...el.children].find((c) => c.nodeName === name) : null);
    const flag = (rPr, name) => {
      const e = child(rPr, name);
      if (!e) return null;
      const v = attr(e, 'w:val');
      return !(v === '0' || v === 'false' || v === 'none');
    };
    const out = [];
    for (const p of doc.getElementsByTagName('w:p')) {
      let anc = p.parentElement;
      let fallback = false;
      while (anc) {
        if (anc.nodeName === 'mc:Fallback') fallback = true;
        anc = anc.parentElement;
      }
      if (fallback) continue;
      const pPr = child(p, 'w:pPr');
      const jc = attr(child(pPr, 'w:jc'), 'w:val');
      const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc] || 'left';
      const pStyle = attr(child(pPr, 'w:pStyle'), 'w:val') || '';
      const heading = /^(heading|titolo|title)\s*1?$/i.test(pStyle) ? 1.6 : /^(heading|titolo)\s*2$/i.test(pStyle) ? 1.35 : /^(heading|titolo)\s*\d$/i.test(pStyle) ? 1.15 : 0;
      let html = '';
      for (const r of p.getElementsByTagName('w:r')) {
        if (r.parentElement !== p && r.parentElement.nodeName !== 'w:hyperlink' && r.parentElement.nodeName !== 'w:ins' && r.parentElement.nodeName !== 'w:smartTag') continue;
        const rPr = child(r, 'w:rPr');
        const css = [];
        const b = flag(rPr, 'w:b');
        if (b || (b === null && heading)) css.push('font-weight:bold');
        if (flag(rPr, 'w:i')) css.push('font-style:italic');
        const deco = [flag(rPr, 'w:u') && 'underline', (flag(rPr, 'w:strike') || flag(rPr, 'w:dstrike')) && 'line-through'].filter(Boolean).join(' ');
        if (deco) css.push(`text-decoration:${deco}`);
        const color = attr(child(rPr, 'w:color'), 'w:val');
        if (color && /^[0-9a-f]{6}$/i.test(color)) css.push(`color:#${color}`);
        const hl = attr(child(rPr, 'w:highlight'), 'w:val');
        const shd = attr(child(rPr, 'w:shd'), 'w:fill');
        if (hl && hl !== 'none') css.push(`background-color:${HIGHLIGHT[hl] || hl.toLowerCase()}`);
        else if (shd && /^[0-9a-f]{6}$/i.test(shd)) css.push(`background-color:#${shd}`);
        const sz = Number(attr(child(rPr, 'w:sz'), 'w:val'));
        if (sz > 0) css.push(`font-size:${sz / 2}pt`);
        else if (heading) css.push(`font-size:${heading}em`);
        let text = '';
        for (const t of r.children) {
          if (t.nodeName === 'w:t') text += escapeHtml(t.textContent);
          else if (t.nodeName === 'w:tab') text += ' ';
          else if (t.nodeName === 'w:br' || t.nodeName === 'w:cr') text += '<br>';
          else if (t.nodeName === 'w:noBreakHyphen') text += '-';
        }
        if (text) html += `<span style="${css.join(';')}">${text}</span>`;
      }
      out.push(`<p style="text-align:${align}">${html}</p>`);
    }
    return sanitizeHtml(out.join(''));
  }

  // File letto dal processo principale -> HTML del TelePrompt.
  function importToHtml(file) {
    switch (file.kind) {
      case 'docx': return docxToHtml(file.content);
      case 'rtf': return rtfToHtml(file.content);
      case 'html': return sanitizeHtml(file.content);
      default: return textToHtml(file.content, /\.md$/i.test(file.name));
    }
  }

  root.TextConv = { sanitizeHtml, textToHtml, rtfToHtml, docxToHtml, importToHtml };
})(window);
