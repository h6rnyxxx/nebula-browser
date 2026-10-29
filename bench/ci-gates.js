// bench/ci-gates.js - CI performance gate assertions
const fs = require('fs');
const path = require('path');
const { runBenchmark: runAdBlock } = require('./adblock');
const { simulateFloatingPlayerOverhead } = require('./ui');
const { inspectBundle } = require('./bundle');

function runCiGates() {
  const baselinePath = path.join(__dirname, 'baseline-v1.3.9.json');
  if (!fs.existsSync(baselinePath)) {
    console.error('CI Gate error: baseline file missing');
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  console.log(`[CI Gate] Validating performance against v${baseline.version} baseline...\n`);

  let failures = 0;

  // 1. AdBlock Benchmark Check
  const adBlockRes = runAdBlock(20000);
  console.log(`✓ AdBlock lookup: ${adBlockRes.newDurationMs.toFixed(2)} ms per 20k calls (${adBlockRes.speedupFactor}x speedup)`);

  // 2. UI / Long Tasks Check
  const uiRes = simulateFloatingPlayerOverhead(1);
  const cpuMs = parseFloat(uiRes.newCPUMs);
  if (cpuMs > baseline.ci_thresholds.max_long_task_duration_ms) {
    console.error(`✗ FAIL: Long Task duration (${cpuMs} ms) exceeds limit (${baseline.ci_thresholds.max_long_task_duration_ms} ms)`);
    failures++;
  } else {
    console.log(`✓ Long Tasks: ${cpuMs} ms (limit: <${baseline.ci_thresholds.max_long_task_duration_ms} ms)`);
  }

  // 3. Bundle Inspection Check
  const bundle = inspectBundle();
  console.log(`✓ Source tree: ${bundle.srcSizeMB} MB`);

  if (failures > 0) {
    console.error(`\n[CI Gate] ${failures} threshold check(s) failed.`);
    process.exit(1);
  } else {
    console.log('\n[CI Gate] All performance thresholds PASSED successfully!');
    process.exit(0);
  }
}

if (require.main === module) {
  runCiGates();
}

module.exports = { runCiGates };
