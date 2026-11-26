import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const publisher = path.resolve('scripts/ci/publish-personal-release.mjs');
const certificate = 'bf70926990809b5983eae24be032109ece7d7f5346945c5747a5ce9ba4be5383';

// Replace only the external GitHub boundary. The publisher still reads, hashes
// and validates real files, invokes its CLI, and performs its release sequence.
const preload = `
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.env.TT_TEST_GITHUB_STATE;
globalThis.fetch = async (url, options = {}) => {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    const endpoint = new URL(url).pathname.replace('/repos/test-owner/PersonalTavern/', '');
    const method = options.method || 'GET';
    state.events.push({ method, endpoint });
    let value;
    let status = 200;
    if (url === 'https://downloads.test/previous-manifest.json') value = state.previousManifest;
    else if (endpoint === '') value = { full_name: 'test-owner/PersonalTavern', private: false };
    else if (endpoint === 'releases/latest') value = null;
    else if (endpoint === 'releases/tags/Canary') value = state.canary?.draft ? null : state.canary;
    else if (endpoint.startsWith('releases/tags/')) value = state.createdRelease?.draft ? null : state.createdRelease;
    else if (endpoint === 'releases' && method === 'GET') {
        const page = Number(new URL(url).searchParams.get('page') || 1);
        value = [state.createdRelease, state.canary].filter(Boolean).slice((page - 1) * 100, page * 100);
    }
    else if (endpoint === 'git/ref/tags/Canary') value = state.tagRevision
        ? { ref: 'refs/tags/Canary', object: { type: 'commit', sha: state.tagRevision } } : null;
    else if (endpoint.startsWith('git/ref/tags/')) value = null;
    else if (endpoint === 'commits/Canary') value = { sha: state.tagRevision };
    else if (endpoint.startsWith('commits/')) value = { sha: state.createdRelease.target_commitish };
    else if (endpoint === 'releases' && method === 'POST') {
        const requested = JSON.parse(options.body);
        if (state.createdRelease?.draft && state.createdRelease.tag_name === requested.tag_name) {
            status = 422;
            value = { message: 'Validation Failed: a pending release already uses this tag' };
        } else {
            state.createdRelease = { id: 8, assets: [], ...requested };
            value = state.createdRelease;
        }
    } else if (endpoint === 'releases/8') {
        if (method === 'PATCH') Object.assign(state.createdRelease, JSON.parse(options.body));
        value = state.createdRelease;
    } else if (endpoint === 'releases/7') {
        if (method === 'PATCH') Object.assign(state.canary, JSON.parse(options.body));
        value = state.canary;
    } else if (endpoint === 'git/refs/tags/Canary' && method === 'PATCH') {
        state.tagRevision = JSON.parse(options.body).sha;
        value = { ref: 'refs/tags/Canary', object: { type: 'commit', sha: state.tagRevision } };
    } else if (endpoint.startsWith('releases/assets/') && method === 'DELETE') value = null;
    else throw new Error('Unexpected GitHub request: ' + method + ' ' + url);
    if (value === null && method === 'GET') status = 404;
    writeFileSync(file, JSON.stringify(state));
    return new Response(value === null ? '' : JSON.stringify(value), { status });
};
`;

const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] !== 'release' || args[1] !== 'upload' || args[3] !== '--repo'
    || args[4] !== 'test-owner/PersonalTavern') process.exit(2);
const file = process.env.TT_TEST_GITHUB_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const release = args[2] === 'Canary' ? state.canary || state.createdRelease : state.createdRelease;
state.events.push({ method: 'upload', endpoint: args[2] });
const files = state.failUpload ? args.slice(5, 6) : args.slice(5);
for (const [index, file] of files.entries()) release.assets.push({
    id: 100 + index, name: path.basename(file), state: 'uploaded', size: fs.statSync(file).size,
});
fs.writeFileSync(file, JSON.stringify(state));
if (state.failUpload) {
    console.error('Synthetic failure after uploading the first asset');
    process.exit(1);
}
`;

async function scenario(t, { channel, previousCode, failUpload = false }) {
    const directory = await mkdtemp(path.join(tmpdir(), 'tt-personal-release-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const assets = path.join(directory, 'assets');
    const bin = path.join(directory, 'bin');
    const source = path.join(directory, 'source');
    await Promise.all([mkdir(assets), mkdir(bin), mkdir(source)]);
    const git = args => {
        const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    git(['init', '--quiet']);
    const commit = message => git(['-c', 'user.name=Release Test',
        '-c', 'user.email=release@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', message]);
    commit('Prior release');
    const previousRevision = git(['rev-parse', 'HEAD']);
    git(['tag', 'Canary']);
    commit('Current release');
    const revision = git(['rev-parse', 'HEAD']);
    const version = JSON.parse(await readFile('package.json', 'utf8')).version;
    const [major, minor, patch] = version.split('.').map(Number);
    const code = major * 1_000_000 + minor * 1_000 + patch;
    const releaseId = channel === 'stable' ? version : `20261126-canary-${revision.slice(0, 12)}`;
    const name = `TauriTavern-${releaseId}-android-arm64-v8a.apk`;
    // The preceding APK verifier owns signature/ELF validation; this receipt
    // exercises the publisher's artifact and publication boundary.
    const apk = Buffer.from('APK already checked by the build verification stage');
    const sha256 = createHash('sha256').update(apk).digest('hex');
    await writeFile(path.join(assets, name), apk);
    await writeFile(path.join(assets, `${name}.sha256`), `${sha256}  ${name}\n`);
    await writeFile(path.join(assets, `${name}.manifest.json`), JSON.stringify({
        file: name, sha256, versionName: version, versionCode: code,
        sourceRevision: revision, updateRepository: 'test-owner/PersonalTavern',
        channel, applicationId: 'com.tauritavern.personal',
        signingCertificateSha256: certificate,
    }));
    const stateFile = path.join(directory, 'github-state.json');
    const prior = previousCode === undefined ? null : {
        id: 7, tag_name: 'Canary', name: 'Prior Canary', body: 'Prior verified release',
        html_url: 'https://github.com/test-owner/PersonalTavern/releases/tag/Canary',
        target_commitish: previousRevision,
        prerelease: true, draft: false, published_at: '2026-11-25T12:00:00Z',
        assets: [{
            id: 90, name: `TauriTavern-20261125-canary-${previousRevision.slice(0, 12)}-android-arm64-v8a.apk.manifest.json`,
            state: 'uploaded', size: 200,
            browser_download_url: 'https://downloads.test/previous-manifest.json',
        }],
    };
    await writeFile(stateFile, JSON.stringify({
        events: [], canary: prior, createdRelease: null,
        failUpload,
        tagRevision: prior?.target_commitish ?? null,
        previousManifest: {
            applicationId: 'com.tauritavern.personal', updateRepository: 'test-owner/PersonalTavern',
            versionCode: previousCode, versionName: previousCode === 1 ? '0.0.1' : '999.0.0',
        },
    }));
    const importFile = path.join(directory, 'github-boundary.mjs');
    await writeFile(importFile, preload);
    await writeFile(path.join(bin, 'gh'), fakeGh, { mode: 0o755 });
    return {
        code,
        revision,
        stateFile,
        execute() {
            return spawnSync(process.execPath, ['--import', importFile, publisher, assets], {
                cwd: source, encoding: 'utf8', timeout: 15000,
                env: {
                    ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
                    TT_TEST_GITHUB_STATE: stateFile, GITHUB_REPOSITORY: 'test-owner/PersonalTavern',
                    SOURCE_REVISION: revision, RELEASE_CHANNEL: channel,
                    RELEASE_ID: releaseId, GH_TOKEN: 'test-token',
                },
            });
        },
        async state() {
            return JSON.parse(await readFile(stateFile, 'utf8'));
        },
    };
}

test('personal releases reject an APK older than the published Canary', {
    skip: process.platform === 'win32',
}, async t => {
    const fixture = await scenario(t, { channel: 'stable', previousCode: 999000000 });
    assert.ok(fixture.code < 999000000);

    const result = fixture.execute();

    assert.notEqual(result.status, 0, 'the older APK must not become a published stable update');
    assert.match(result.stderr, /versionCode|older|downgrade/);
    const state = await fixture.state();
    assert.equal(state.events.filter(event => event.method === 'POST').length, 0);
    assert.equal(state.events.filter(event => event.method === 'upload').length, 0);
});

test('Canary publication uploads the complete artifact set before advancing the tag', {
    skip: process.platform === 'win32',
}, async t => {
    const fixture = await scenario(t, { channel: 'canary', previousCode: 1 });

    const result = fixture.execute();

    assert.equal(result.status, 0, result.stderr);
    const state = await fixture.state();
    assert.equal(state.tagRevision, fixture.revision);
    const upload = state.events.findIndex(event => event.method === 'upload');
    const advance = state.events.findIndex(event =>
        event.method === 'PATCH' && event.endpoint === 'git/refs/tags/Canary');
    assert.ok(upload >= 0 && advance > upload);
    const published = state.canary.assets.filter(asset => asset.id >= 100);
    assert.equal(published.length, 3);
    assert.equal(state.canary.draft, false);
});

test('a failed first upload retains its draft and a retry stops before another publication mutation', {
    skip: process.platform === 'win32',
}, async t => {
    const fixture = await scenario(t, { channel: 'stable', failUpload: true });

    const first = fixture.execute();

    assert.notEqual(first.status, 0);
    const retained = await fixture.state();
    assert.equal(retained.createdRelease.draft, true);
    assert.equal(retained.createdRelease.assets.length, 1);
    const creates = retained.events.filter(event => event.method === 'POST').length;
    const uploads = retained.events.filter(event => event.method === 'upload').length;
    retained.failUpload = false;
    await writeFile(fixture.stateFile, JSON.stringify(retained));

    const retry = fixture.execute();

    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /incomplete draft/i);
    const after = await fixture.state();
    assert.equal(after.events.filter(event => event.method === 'POST').length, creates);
    assert.equal(after.events.filter(event => event.method === 'upload').length, uploads);
    assert.equal(after.createdRelease.draft, true);
    assert.equal(after.createdRelease.assets.length, 1);
});
