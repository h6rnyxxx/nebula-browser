const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head><style>body { margin:0; overflow:hidden; background:transparent; }</style></head>
    <body>
      <canvas id="c" width="512" height="512"></canvas>
      <script>
        const c = document.getElementById('c');
        const ctx = c.getContext('2d');

        function roundedRect(ctx, x, y, w, h, r) {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + r);
          ctx.lineTo(x + w, y + h - r);
          ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          ctx.lineTo(x + r, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
        }

        roundedRect(ctx, 24, 24, 464, 464, 105);
        const bgGrad = ctx.createLinearGradient(40, 40, 470, 470);
        bgGrad.addColorStop(0, '#100a24');
        bgGrad.addColorStop(0.5, '#1e113d');
        bgGrad.addColorStop(1, '#341559');
        ctx.fillStyle = bgGrad;
        ctx.fill();

        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.stroke();

        const radGlow1 = ctx.createRadialGradient(190, 200, 10, 190, 200, 200);
        radGlow1.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
        radGlow1.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = radGlow1;
        ctx.fill();

        const radGlow2 = ctx.createRadialGradient(320, 290, 10, 320, 290, 220);
        radGlow2.addColorStop(0, 'rgba(236, 72, 153, 0.4)');
        radGlow2.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = radGlow2;
        ctx.fill();

        const stars = [
          [110, 120, 2], [140, 340, 1.5], [370, 140, 2.5], 
          [390, 380, 1.8], [210, 100, 1.2], [330, 90, 1.5]
        ];
        ctx.fillStyle = '#ffffff';
        stars.forEach(([x, y, r]) => {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        });

        ctx.save();
        ctx.translate(256, 256);
        ctx.rotate(-30 * Math.PI / 180);

        ctx.shadowColor = '#818cf8';
        ctx.shadowBlur = 22;

        ctx.beginPath();
        ctx.ellipse(0, 0, 180, 56, 0, 0, Math.PI * 2);
        ctx.lineWidth = 14;

        const ringGrad = ctx.createLinearGradient(-180, 0, 180, 0);
        ringGrad.addColorStop(0, '#38bdf8');
        ringGrad.addColorStop(0.35, '#818cf8');
        ringGrad.addColorStop(0.7, '#ec4899');
        ringGrad.addColorStop(1, '#fb923c');
        ctx.strokeStyle = ringGrad;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.shadowColor = '#c084fc';
        ctx.shadowBlur = 30;

        const coreGrad = ctx.createRadialGradient(230, 230, 8, 256, 256, 70);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.2, '#c4b5fd');
        coreGrad.addColorStop(0.6, '#6366f1');
        coreGrad.addColorStop(1, '#1e1438');

        ctx.beginPath();
        ctx.arc(256, 256, 62, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.translate(256, 256);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, -28);
        ctx.quadraticCurveTo(0, 0, 28, 0);
        ctx.quadraticCurveTo(0, 0, 0, 28);
        ctx.quadraticCurveTo(0, 0, -28, 0);
        ctx.quadraticCurveTo(0, 0, 0, -28);
        ctx.fill();
        ctx.restore();
      </script>
    </body>
    </html>
  `;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 400));

  const image = await win.webContents.capturePage();
  const buildDir = path.join(__dirname, 'build');
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir);

  const png512 = image.toPNG();
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);

  const png256 = image.resize({ width: 256, height: 256 }).toPNG();
  const icoBuffer = createIcoFromPng(png256);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);

  console.log('Иконки успешно сгенерированы: build/icon.png и build/icon.ico');
  app.quit();
});

function createIcoFromPng(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const dir = Buffer.alloc(16);
  dir.writeUInt8(0, 0);
  dir.writeUInt8(0, 1);
  dir.writeUInt8(0, 2);
  dir.writeUInt8(0, 3);
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(pngBuffer.length, 8);
  dir.writeUInt32LE(22, 12);

  return Buffer.concat([header, dir, pngBuffer]);
}