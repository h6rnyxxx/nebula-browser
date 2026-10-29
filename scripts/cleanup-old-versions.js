const fs = require('fs');
const path = require('path');
const https = require('https');

const token = process.env.GH_TOKEN;
const owner = 'h6rnyxxx';
const repo = 'nebula-browser';
const KEEP_VERSION = '1.4.1';
const KEEP_TAG = 'v1.4.1';

// 1. Clean local setup/ directory
console.log('[Cleanup] Cleaning local setup/ directory...');
const setupDir = path.resolve(__dirname, '..', 'setup');
if (fs.existsSync(setupDir)) {
    const files = fs.readdirSync(setupDir);
    let deletedCount = 0;
    let freedBytes = 0;

    for (const f of files) {
        if (f.includes('1.4.1') || f === 'latest.yml' || f === 'builder-debug.yml' || f === 'builder-effective-config.yaml' || f === 'win-unpacked') {
            console.log(`  [KEEP] ${f}`);
            continue;
        }

        const fullPath = path.join(setupDir, f);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
                freedBytes += stat.size;
                fs.unlinkSync(fullPath);
                deletedCount++;
                console.log(`  [DELETED] ${f} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);
            }
        } catch (e) {
            console.error(`  [ERROR deleting ${f}]:`, e.message);
        }
    }
    console.log(`[Cleanup] Deleted ${deletedCount} local files. Freed: ${(freedBytes / (1024 * 1024)).toFixed(1)} MB\n`);
}

// 2. Clean GitHub releases & tags
function githubApi(endpoint, method = 'GET') {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.github.com',
            path: endpoint,
            method: method,
            headers: {
                'User-Agent': 'nebula-cleanup',
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch(e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function cleanGitHub() {
    console.log(`[Cleanup] Querying GitHub releases for ${owner}/${repo}...`);
    const { status, data: releases } = await githubApi(`/repos/${owner}/${repo}/releases?per_page=100`);

    if (status !== 200 || !Array.isArray(releases)) {
        console.error('[Cleanup] Could not fetch releases:', status, releases);
        return;
    }

    console.log(`[Cleanup] Found ${releases.length} releases on GitHub.`);

    for (const rel of releases) {
        if (rel.tag_name === KEEP_TAG) {
            console.log(`  [KEEP RELEASE] ${rel.tag_name} (ID: ${rel.id})`);
            continue;
        }

        console.log(`  [DELETING RELEASE] ${rel.tag_name} (ID: ${rel.id})...`);
        const delRes = await githubApi(`/repos/${owner}/${repo}/releases/${rel.id}`, 'DELETE');
        console.log(`    Status: ${delRes.status}`);

        // Also delete git tag ref
        try {
            console.log(`  [DELETING TAG] ${rel.tag_name}...`);
            await githubApi(`/repos/${owner}/${repo}/git/refs/tags/${rel.tag_name}`, 'DELETE');
        } catch (e) {}
    }

    console.log('\n[Cleanup] All old releases and files cleaned! Only v1.4.1 remains.');
}

cleanGitHub().catch(err => {
    console.error('GitHub cleanup error:', err);
});
