#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const required = name => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
};
const repository = required('GITHUB_REPOSITORY');
const revision = required('SOURCE_REVISION');
const channel = required('RELEASE_CHANNEL');
const releaseId = required('RELEASE_ID');
const token = required('GH_TOKEN');
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || !/^[0-9a-f]{40}$/.test(revision)
    || !/^[A-Za-z0-9_.-]+$/.test(releaseId)
    || !['stable', 'canary'].includes(channel)) {
    throw new Error('Invalid personal release identity');
}
const directory = path.resolve(process.argv[2]);
const name = `TauriTavern-${releaseId}-android-arm64-v8a.apk`;
const assetNames = [name, `${name}.manifest.json`, `${name}.sha256`];
const files = assetNames.map(file => path.join(directory, file));
const manifest = JSON.parse(await readFile(files[1], 'utf8'));
const sha256 = createHash('sha256').update(await readFile(files[0])).digest('hex');
const projectVersion = JSON.parse(await readFile(
    path.resolve(import.meta.dirname, '../../package.json'), 'utf8',
)).version;
if (manifest.file !== name || manifest.sha256 !== sha256
    || manifest.sourceRevision !== revision || manifest.updateRepository !== repository
    || manifest.channel !== channel
    || manifest.versionName !== projectVersion || !Number.isSafeInteger(manifest.versionCode)
    || manifest.applicationId !== 'com.tauritavern.personal'
    || manifest.signingCertificateSha256 !== 'bf70926990809b5983eae24be032109ece7d7f5346945c5747a5ce9ba4be5383'
    || (await readFile(files[2], 'utf8')).trim() !== `${sha256}  ${name}`) {
    throw new Error('Release assets do not match the verified source and APK identity');
}

async function api(endpoint, method = 'GET', body, missingIsExpected = false) {
    const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'TauriTavern-release',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 404 && missingIsExpected) return null;
    const text = await response.text();
    if (!response.ok) throw new Error(`GitHub ${method} ${endpoint}: HTTP ${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
}

async function findRelease(tag) {
    // The authenticated list includes pending drafts; the REST tag endpoint
    // cannot find the draft retained by a failed first upload.
    for (let page = 1; ; page++) {
        const releases = await api(`releases?per_page=100&page=${page}`);
        const release = releases.find(item => item.tag_name === tag);
        if (release) return release;
        if (releases.length < 100) return null;
    }
}

function gh(args) {
    const result = spawnSync('gh', args, { stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`GitHub release command failed (${result.status})`);
}

const info = await api('');
if (info.private !== false) {
    throw new Error('Public visibility must be approved before publishing app updates');
}
const stable = channel === 'stable';
const tag = stable ? `v${manifest.versionName}` : 'Canary';
if (stable && releaseId !== manifest.versionName) {
    throw new Error('Stable tag and asset version do not match');
}
const current = await findRelease(tag);
const currentTag = await api(`git/ref/tags/${tag}`, 'GET', undefined, true);
if (current?.draft) throw new Error('An incomplete draft exists; inspect its assets before rerunning publication');
if (stable && current) throw new Error(`${tag} is already published; stable releases are immutable`);
if (!stable && current && current.prerelease !== true) throw new Error('The Canary release must be a prerelease');
if (currentTag && stable) {
    const commit = await api(`commits/${tag}`);
    if (commit.sha !== revision) throw new Error('The existing stable tag points to another commit');
}
if (currentTag && !stable) {
    const commit = await api(`commits/${tag}`);
    if (commit.sha === revision) throw new Error('This source commit is already the published Canary');
    if (!current) throw new Error('Canary tag exists without a release; reconcile it before publishing');
}
const [latestStable, previousCanary] = await Promise.all([
    api('releases/latest', 'GET', undefined, true),
    stable ? api('releases/tags/Canary', 'GET', undefined, true) : current,
]);
for (const previous of [latestStable, previousCanary]) {
    if (!previous || previous.draft) continue;
    const receipts = previous.assets.filter(asset =>
        /^TauriTavern-.+-android-arm64-v8a\.apk\.manifest\.json$/.test(asset.name));
    if (!receipts.length) throw new Error('The existing personal release has no verified APK manifest');
    for (const receipt of receipts) {
        const response = await fetch(receipt.browser_download_url);
        if (!response.ok) throw new Error(`Unable to read the published APK manifest: HTTP ${response.status}`);
        const prior = await response.json();
        if (prior.applicationId !== 'com.tauritavern.personal'
            || prior.updateRepository !== repository || !Number.isSafeInteger(prior.versionCode)) {
            throw new Error('The published APK manifest has an invalid installation identity');
        }
        if (manifest.versionCode < prior.versionCode) {
            throw new Error(`APK versionCode ${manifest.versionCode} would downgrade the published ${prior.versionCode}`);
        }
    }
}
if (!stable && !new RegExp(`^\\d{8}-canary-${revision.slice(0, 12)}$`).test(releaseId)) {
    throw new Error('Canary asset identity must include the verified source revision');
}
const title = stable ? `TauriTavern Personal ${manifest.versionName}`
    : `Canary Release ${releaseId.slice(0, 8).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3')} · Personal`;
let notes;
if (stable) {
    notes = await readFile(path.resolve(import.meta.dirname,
        `../../docs/releases/${manifest.versionName}.md`), 'utf8');
} else {
    const range = currentTag ? [`Canary..${revision}`] : [revision, '--max-count=30'];
    const history = spawnSync('git', ['log', '--no-merges', '--format=- %h %s', ...range], {
        encoding: 'utf8',
    });
    if (history.error || history.status !== 0) throw new Error('Unable to read the release Git history');
    notes = `## 更新日志\n\n${history.stdout.trim()}\n`;
}
notes += `\n\n源码：[\`${revision.slice(0, 12)}\`](https://github.com/${repository}/commit/${revision})\n`
    + `\nAndroid ARM64 · ${manifest.versionName} · versionCode ${manifest.versionCode}\n`
    + `\n请使用同包名的覆盖安装；安装前可核对附件中的 SHA256 与签名指纹。\n`;
const notesFile = path.join(directory, 'release-notes.md');
await writeFile(notesFile, notes);

let release = current;
if (!release) {
    release = await api('releases', 'POST', {
        tag_name: tag, target_commitish: revision,
        name: title, body: notes, draft: true, prerelease: !stable,
    });
}
const existingNames = new Set(release.assets.map(asset => asset.name));
if (assetNames.some(asset => existingNames.has(asset))) {
    throw new Error('This artifact set already exists; do not overwrite a published APK');
}
gh(['release', 'upload', tag, '--repo', repository, ...files]);
release = await api(`releases/${release.id}`);
for (const [index, assetName] of assetNames.entries()) {
    const uploaded = release.assets.find(asset => asset.name === assetName);
    if (!uploaded || uploaded.state !== 'uploaded'
        || uploaded.size !== (await stat(files[index])).size) {
        throw new Error(`Release asset upload is incomplete: ${assetName}`);
    }
}
await api(`releases/${release.id}`, 'PATCH', { name: title, body: notes, draft: false, prerelease: !stable });
if (!stable && currentTag) {
    // The fixed channel tag advances only after the complete artifact set is uploaded.
    await api('git/refs/tags/Canary', 'PATCH', { sha: revision, force: true });
}
const publishedCommit = await api(`commits/${tag}`);
if (publishedCommit.sha !== revision) throw new Error('Published tag does not match the verified build');
console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);

if (!stable) {
    const ownedAsset = /^TauriTavern-\d{8}-canary-[0-9a-f]{12}-android-arm64-v8a\.apk(?:\.manifest\.json|\.sha256)?$/;
    for (const asset of release.assets) {
        if (ownedAsset.test(asset.name) && !assetNames.includes(asset.name)) {
            try {
                await api(`releases/assets/${asset.id}`, 'DELETE');
            } catch (error) {
                console.warn(`Release published; retained superseded asset ${asset.name}: ${error.message}`);
            }
        }
    }
}
