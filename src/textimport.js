// Lettura dei file di testo per il TelePrompt. Qui si legge solo il file
// (e si estrae il testo dai .docx, che sono archivi zip): la conversione in
// testo formattato avviene nella regia (control/textconv.js).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEXT_EXT = ['txt', 'rtf', 'docx', 'html', 'htm', 'md'];

// Estrae un file da un archivio zip (formato dei .docx).
function unzipEntry(buf, wanted) {
  // Fine della "directory centrale": firma 0x06054b50 negli ultimi byte.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Il file non è un documento Word valido.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  const text = buf.toString('utf8');
  // Testo salvato in ANSI (Windows-1252): i caratteri non validi diventano �.
  return text.includes('�') ? buf.toString('latin1') : text.replace(/^﻿/, '');
}

// Restituisce { name, kind, content } con kind = text, html, rtf o docx.
function readTextFile(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const buf = fs.readFileSync(file);
  const name = path.basename(file);
  if (ext === 'docx') {
    const content = unzipEntry(buf, 'word/document.xml');
    if (!content) throw new Error('Il documento Word non contiene testo.');
    return { name, kind: 'docx', content };
  }
  if (ext === 'rtf') return { name, kind: 'rtf', content: buf.toString('latin1') };
  if (ext === 'html' || ext === 'htm') return { name, kind: 'html', content: decodeText(buf) };
  return { name, kind: 'text', content: decodeText(buf) };
}

module.exports = { readTextFile, TEXT_EXT, unzipEntry };
