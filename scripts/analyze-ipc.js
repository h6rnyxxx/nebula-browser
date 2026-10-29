const fs = require('fs');
const path = require('path');

function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const handles = [];
    const ons = [];
    const sends = [];
    const invokes = [];
    const sendSyncs = [];

    const lines = content.split('\n');
    lines.forEach((l, i) => {
        let m;
        if ((m = l.match(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/))) handles.push({ line: i + 1, ch: m[1] });
        if ((m = l.match(/ipcMain\.on\(\s*['"]([^'"]+)['"]/))) ons.push({ line: i + 1, ch: m[1] });
        if ((m = l.match(/ipcRenderer\.send\(\s*['"]([^'"]+)['"]/))) sends.push({ line: i + 1, ch: m[1] });
        if ((m = l.match(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/))) invokes.push({ line: i + 1, ch: m[1] });
        if ((m = l.match(/ipcRenderer\.sendSync\(\s*['"]([^'"]+)['"]/))) sendSyncs.push({ line: i + 1, ch: m[1] });
    });

    return { handles, ons, sends, invokes, sendSyncs };
}

function walkDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results = results.concat(walkDir(fullPath));
        } else if (file.endsWith('.js') || file.endsWith('.html')) {
            results.push(fullPath);
        }
    });
    return results;
}

const files = walkDir(path.join(__dirname, '..', 'src'));
console.log('--- IPC SCAN ---');
files.forEach(f => {
    const rel = path.relative(path.join(__dirname, '..'), f);
    const data = scanFile(f);
    const total = data.handles.length + data.ons.length + data.sends.length + data.invokes.length + data.sendSyncs.length;
    if (total > 0) {
        console.log(`\nFile: ${rel}`);
        if (data.handles.length) console.log('  ipcMain.handle:', data.handles.map(x => x.ch).join(', '));
        if (data.ons.length) console.log('  ipcMain.on:', data.ons.map(x => x.ch).join(', '));
        if (data.sendSyncs.length) console.log('  *** SENDSYNC ***:', data.sendSyncs.map(x => `${x.ch} (L${x.line})`).join(', '));
        if (data.invokes.length) console.log('  ipcRenderer.invoke:', data.invokes.map(x => x.ch).join(', '));
        if (data.sends.length) console.log('  ipcRenderer.send:', data.sends.map(x => x.ch).join(', '));
    }
});
