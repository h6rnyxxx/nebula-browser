const https = require('https');

const token = process.env.GH_TOKEN;
const owner = 'h6rnyxxx';
const repo = 'nebula-browser';

if (!token) {
    console.log('[publish-releases] GH_TOKEN is not set. Skipping release publishing.');
    process.exit(0);
}

function requestGitHub(path, method, data) {
    return new Promise((resolve, reject) => {
        const payload = data ? JSON.stringify(data) : null;
        const req = https.request({
            hostname: 'api.github.com',
            path,
            method,
            headers: {
                'User-Agent': 'nebula-deployer',
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                ...(payload ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                } : {})
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: body });
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function main() {
    console.log(`[publish-releases] Checking GitHub releases for ${owner}/${repo}...`);
    const { status, data } = await requestGitHub(`/repos/${owner}/${repo}/releases`, 'GET');
    if (status !== 200 || !Array.isArray(data)) {
        console.error('[publish-releases] Failed to query releases:', status, data);
        return;
    }

    let publishedCount = 0;
    for (const r of data) {
        if (r.draft) {
            console.log(`[publish-releases] Publishing draft release: ${r.tag_name || r.name} (ID: ${r.id})...`);
            const updateRes = await requestGitHub(`/repos/${owner}/${repo}/releases/${r.id}`, 'PATCH', {
                draft: false
            });
            if (updateRes.status === 200) {
                console.log(`[publish-releases] Release ${r.tag_name || r.name} published successfully!`);
                publishedCount++;
            } else {
                console.error(`[publish-releases] Failed to publish ${r.tag_name}:`, updateRes.status);
            }
        }
    }

    if (publishedCount === 0) {
        console.log('[publish-releases] All releases are already published (no drafts).');
    }
}

main().catch(console.error);
