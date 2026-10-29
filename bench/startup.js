// bench/startup.js - Startup profiling benchmark
const { spawn } = require('child_process');
const path = require('path');

function measureStartup() {
  return new Promise((resolve, reject) => {
    const electronBinary = require('electron');
    const appPath = path.resolve(__dirname, '..');
    const start = performance.now();

    const proc = spawn(electronBinary, [appPath, '--bench-startup'], {
      env: { ...process.env, NEBULA_BENCH: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let readyTime = null;

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      if (text.includes('WINDOW_READY_TO_SHOW') && !readyTime) {
        readyTime = performance.now() - start;
        proc.kill();
      }
    });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({
        durationMs: readyTime || (performance.now() - start),
        status: readyTime ? 'measured' : 'timed_out_estimate'
      });
    }, 10000);

    proc.on('exit', () => {
      clearTimeout(timeout);
      resolve({
        durationMs: readyTime || (performance.now() - start),
        status: 'completed'
      });
    });

    proc.on('error', reject);
  });
}

if (require.main === module) {
  console.log('[Bench: Startup] Measuring cold start...');
  measureStartup().then(res => {
    console.log(`[измерено] Cold startup duration: ${res.durationMs.toFixed(1)} ms`);
  }).catch(err => {
    console.error('Bench error:', err);
  });
}

module.exports = { measureStartup };
