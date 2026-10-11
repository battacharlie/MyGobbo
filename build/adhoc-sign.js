// Firma "ad-hoc" dell'app per Mac (senza certificato Apple): i Mac con
// processore Apple non aprono programmi del tutto privi di firma. Gira dopo
// l'impacchettamento e prima della creazione del .dmg e dello .zip.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
