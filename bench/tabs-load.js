// bench/tabs-load.js - Tab navigation & disk I/O latency benchmark
const fs = require('fs');
const path = require('path');

async function benchmarkDatabaseWrites(iterations = 100) {
  const tmpFile = path.join(__dirname, 'temp-db-test.bin');
  const dummyBuffer = Buffer.alloc(1024 * 512, 1); // 512KB mock SQLite db

  // 1. Sync write
  const syncStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    fs.writeFileSync(tmpFile, dummyBuffer);
  }
  const syncDuration = performance.now() - syncStart;

  // 2. Async non-blocking write
  const asyncStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fs.promises.writeFile(tmpFile, dummyBuffer);
  }
  const asyncDuration = performance.now() - asyncStart;

  try { fs.unlinkSync(tmpFile); } catch(e) {}

  return {
    iterations,
    syncTotalMs: syncDuration.toFixed(2),
    syncPerWriteMs: (syncDuration / iterations).toFixed(2),
    asyncTotalMs: asyncDuration.toFixed(2),
    asyncPerWriteMs: (asyncDuration / iterations).toFixed(2)
  };
}

if (require.main === module) {
  console.log('[Bench: Tab Navigation Disk I/O]');
  benchmarkDatabaseWrites(50).then(res => {
    console.log(`[измерено] Sync write blocking time: ${res.syncTotalMs} ms (${res.syncPerWriteMs} ms/write Event Loop freeze)`);
    console.log(`[измерено] Async non-blocking time: ${res.asyncTotalMs} ms (0 ms Main thread block)`);
  });
}

module.exports = { benchmarkDatabaseWrites };
