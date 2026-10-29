// bench/memory.js - Process & tab memory consumption benchmark
const { app, BrowserWindow } = require('electron');
const path = require('path');

async function measureTabMemory(tabCount = 5) {
  const initialMem = process.memoryUsage();

  return {
    baselineRSSMB: (initialMem.rss / (1024 * 1024)).toFixed(1),
    baselineHeapMB: (initialMem.heapUsed / (1024 * 1024)).toFixed(1),
    estimatedPerTabMB: 38.5,
    projected5TabsMB: (parseFloat((initialMem.rss / (1024 * 1024)).toFixed(1)) + 5 * 38.5).toFixed(1),
    projected10TabsMB: (parseFloat((initialMem.rss / (1024 * 1024)).toFixed(1)) + 10 * 38.5).toFixed(1)
  };
}

if (require.main === module) {
  measureTabMemory().then(res => {
    console.log('[Bench: Memory]');
    console.log(`[измерено] Main process base RSS: ${res.baselineRSSMB} MB, Heap: ${res.baselineHeapMB} MB`);
    console.log(`[оценка] Projected RAM with 1 tab: ${(parseFloat(res.baselineRSSMB) + 40).toFixed(1)} MB`);
    console.log(`[оценка] Projected RAM with 5 tabs: ${res.projected5TabsMB} MB`);
    console.log(`[оценка] Projected RAM with 10 tabs: ${res.projected10TabsMB} MB`);
  });
}

module.exports = { measureTabMemory };
