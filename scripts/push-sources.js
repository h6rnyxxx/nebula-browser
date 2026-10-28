const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const token = (process.env.GH_TOKEN || '').trim();
const owner = 'h6rnyxxx';
const repo = 'nebula-browser';

if (!token) {
    console.log('[push-sources] GH_TOKEN not found. Skipping git push.');
    process.exit(0);
}

try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const version = pkg.version || '1.0.0';

    console.log(`[push-sources] Preparing git commit for v${version}...`);

    // Ensure git is configured
    try {
        execSync('git config user.name "h6rnyxxx"', { stdio: 'ignore' });
        execSync('git config user.email "nebula-browser@users.noreply.github.com"', { stdio: 'ignore' });
    } catch(e) {}

    // Add files according to .gitignore
    execSync('git add .', { stdio: 'inherit' });

    // Commit if there are changes
    try {
        execSync(`git commit -m "chore(release): v${version}"`, { stdio: 'inherit' });
        console.log(`[push-sources] Committed release v${version}`);
    } catch (e) {
        console.log('[push-sources] No changes to commit.');
    }

    // Set branch to main
    try {
        execSync('git branch -M main', { stdio: 'ignore' });
    } catch(e) {}

    // Push with token (masking in output)
    const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    console.log(`[push-sources] Pushing clean sources to GitHub (${owner}/${repo}:main)...`);
    execSync(`git push -u "${remoteUrl}" main`, { stdio: 'ignore' });
    console.log('[push-sources] Successfully pushed sources to GitHub!');
} catch (err) {
    console.error('[push-sources] Error updating git repository:', err.message);
}
