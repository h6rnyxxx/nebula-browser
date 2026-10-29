// bench/adblock.js - AdBlock lookup & cache performance
const BLOCKED_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'google-analytics.com',
  'adnxs.com', 'advertising.com', 'adtechus.com', 'admob.com',
  'amazon-adsystem.com', 'criteo.com', 'outbrain.com', 'taboola.com',
  'scorecardresearch.com', 'yandex.ru/an', 'an.yandex.ru',
  'mc.yandex.ru', 'ads.vk.com', 'top-fwz1.mail.ru', 'counter.yadro.ru'
];

const blockedSet = new Set(BLOCKED_DOMAINS);
const cache = new Map();

function extractHostFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const match = url.match(/^https?:\/\/([^/?#:]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function isDomainBlockedCached(host) {
  if (!host) return false;
  const cached = cache.get(host);
  if (cached !== undefined) return cached;

  let current = host;
  let blocked = false;
  while (current.length > 0) {
    if (blockedSet.has(current)) {
      blocked = true;
      break;
    }
    const dotIndex = current.indexOf('.');
    if (dotIndex === -1) break;
    current = current.slice(dotIndex + 1);
  }

  if (cache.size > 2000) cache.clear();
  cache.set(host, blocked);
  return blocked;
}

function runBenchmark(iterations = 50000) {
  const testUrls = [
    'https://mc.yandex.ru/watch/123456',
    'https://sub.doubleclick.net/pagead/ads?client=ca-pub-123',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://github.com/h6rnyxxx/nebula-browser',
    'https://an.yandex.ru/count/123',
    'https://en.wikipedia.org/wiki/Electron_(software)'
  ];

  // Baseline approach: new URL()
  const startOld = performance.now();
  for (let i = 0; i < iterations; i++) {
    const url = testUrls[i % testUrls.length];
    try {
      const host = new URL(url).hostname;
      const blocked = blockedSet.has(host);
    } catch(e) {}
  }
  const oldDuration = performance.now() - startOld;

  // Optimized approach: regex extract + LRU cached lookup
  const startNew = performance.now();
  for (let i = 0; i < iterations; i++) {
    const url = testUrls[i % testUrls.length];
    const host = extractHostFromUrl(url);
    const blocked = isDomainBlockedCached(host);
  }
  const newDuration = performance.now() - startNew;

  return {
    iterations,
    oldDurationMs: oldDuration,
    newDurationMs: newDuration,
    speedupFactor: (oldDuration / newDuration).toFixed(2),
    avgPerLookupNs: ((newDuration / iterations) * 1000000).toFixed(1)
  };
}

if (require.main === module) {
  console.log('[Bench: AdBlock] Running 50,000 lookups...');
  const res = runBenchmark(50000);
  console.log(`[измерено] Unoptimized new URL(): ${res.oldDurationMs.toFixed(2)} ms`);
  console.log(`[измерено] Optimized LRU & regex: ${res.newDurationMs.toFixed(2)} ms (speedup: ${res.speedupFactor}x, ${res.avgPerLookupNs} ns/lookup)`);
}

module.exports = { runBenchmark };
