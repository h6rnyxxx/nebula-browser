// bench/bundle.js - Packaging & bundle size inspector
const fs = require('fs');
const path = require('path');

function getDirectorySize(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function inspectBundle() {
  const rootDir = path.resolve(__dirname, '..');
  const srcSize = getDirectorySize(path.join(rootDir, 'src'));
  const unpackedDir = path.join(rootDir, 'setup', 'win-unpacked');
  const unpackedSize = getDirectorySize(unpackedDir);

  const asarPath = path.join(unpackedDir, 'resources', 'app.asar');
  const asarSize = fs.existsSync(asarPath) ? fs.statSync(asarPath).size : 0;

  const distDir = path.join(rootDir, 'setup');
  let installerSize = 0;
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    const exe = files.find(f => f.endsWith('.exe') && !f.includes('unpacked'));
    if (exe) {
      installerSize = fs.statSync(path.join(distDir, exe)).size;
    }
  }

  return {
    srcSizeMB: (srcSize / (1024 * 1024)).toFixed(2),
    asarSizeMB: (asarSize / (1024 * 1024)).toFixed(2),
    unpackedSizeMB: (unpackedSize / (1024 * 1024)).toFixed(2),
    installerSizeMB: (installerSize / (1024 * 1024)).toFixed(2)
  };
}

if (require.main === module) {
  const res = inspectBundle();
  console.log('[Bench: Bundle Size]');
  console.log(`[измерено] Source tree size: ${res.srcSizeMB} MB`);
  if (parseFloat(res.asarSizeMB) > 0) {
    console.log(`[измерено] app.asar size: ${res.asarSizeMB} MB`);
    console.log(`[измерено] win-unpacked total: ${res.unpackedSizeMB} MB`);
    console.log(`[измерено] Installer .exe: ${res.installerSizeMB} MB`);
  } else {
    console.log(`[оценка] Run build to inspect packaged binary sizes.`);
  }
}

module.exports = { inspectBundle };
