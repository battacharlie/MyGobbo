// Numeri dei monitor come li mostra Windows (Impostazioni > Schermo).
// Electron non li conosce: su Windows chiediamo l'elenco dei monitor
// (nome \\.\DISPLAYn e posizione in pixel) e lo abbiniamo agli schermi di
// Electron in base alla posizione. Altrove, o se la richiesta non riesce,
// il monitor principale è il numero 1 e gli altri seguono.
const { execFile } = require('child_process');
const { screen } = require('electron');

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class IgorMonitors {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct MONITORINFOEX { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
  public delegate bool EnumProc(IntPtr h, IntPtr hdc, ref RECT r, IntPtr d);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, EnumProc cb, IntPtr d);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFOEX mi);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  public static string List() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }
    StringBuilder sb = new StringBuilder();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr h, IntPtr hdc, ref RECT r, IntPtr d) {
      MONITORINFOEX mi = new MONITORINFOEX();
      mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      if (GetMonitorInfo(h, ref mi)) sb.AppendFormat("{0}|{1}|{2}\\n", mi.szDevice, mi.rcMonitor.L, mi.rcMonitor.T);
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
"@
[IgorMonitors]::List()
`;

let windowsList = []; // [{ number, x, y }] in pixel fisici

function queryWindows() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 15000 }, (err, stdout) => {
        if (err) {
          console.error('Numeri dei monitor di Windows non disponibili:', err.message);
          return resolve([]);
        }
        resolve(parseList(stdout));
      });
  });
}

// Righe "\\.\DISPLAY2|1920|0" -> { number: 2, x: 1920, y: 0 }
function parseList(text) {
  return String(text).split(/\r?\n/).map((line) => {
    const m = line.trim().match(/DISPLAY(\d+)\|(-?\d+)\|(-?\d+)$/i);
    return m ? { number: Number(m[1]), x: Number(m[2]), y: Number(m[3]) } : null;
  }).filter(Boolean);
}

// Aggiorna l'elenco (all'avvio e quando cambiano i monitor).
async function refresh() {
  windowsList = await queryWindows();
}

// Origine dello schermo in pixel fisici, come la vede Windows.
function physicalOrigin(display) {
  if (process.platform === 'win32' && screen.dipToScreenRect) {
    const r = screen.dipToScreenRect(null, display.bounds);
    return { x: r.x, y: r.y };
  }
  return { x: display.bounds.x, y: display.bounds.y };
}

// Numero di ogni schermo di Electron: Map(id -> numero).
function numbers(displays = screen.getAllDisplays()) {
  const result = new Map();
  const used = new Set();
  for (const d of displays) {
    const o = physicalOrigin(d);
    const match = windowsList.find((w) => !used.has(w.number) && Math.abs(w.x - o.x) <= 2 && Math.abs(w.y - o.y) <= 2);
    if (match) {
      result.set(d.id, match.number);
      used.add(match.number);
    }
  }
  // Schermi senza corrispondenza: principale per primo, poi gli altri nell'ordine.
  const primaryId = screen.getPrimaryDisplay().id;
  const rest = displays.filter((d) => !result.has(d.id)).sort((a, b) => (b.id === primaryId) - (a.id === primaryId));
  let n = 1;
  for (const d of rest) {
    while (used.has(n)) n++;
    result.set(d.id, n);
    used.add(n);
  }
  return result;
}

module.exports = { refresh, numbers, parseList, queryWindows };
