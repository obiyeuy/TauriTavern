import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Android signing preserves Java property values and keystore bytes', {
    skip: !process.env.JAVA_HOME,
}, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'tt-signing-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const scripts = path.join(root, 'scripts/ci');
    const android = path.join(root, 'src-tauri/crates/tauritavern/gen/android');
    const runner = path.join(root, 'runner temp');
    await Promise.all([
        mkdir(scripts, { recursive: true }), mkdir(android, { recursive: true }), mkdir(runner),
    ]);
    const script = path.join(scripts, 'setup-android-signing.mjs');
    await copyFile('scripts/ci/setup-android-signing.mjs', script);
    const keystore = Buffer.from('synthetic signing fixture bytes');
    const env = {
        ...process.env, RUNNER_TEMP: runner,
        ANDROID_KEY_ALIAS: 'alias #:= 中文',
        ANDROID_KEY_PASSWORD: 'pass\\word =:\n中文😀',
        ANDROID_KEY_BASE64: keystore.toString('base64'),
        TT_EXPECTED_STORE: path.join(runner, 'keystore.jks'),
    };
    const setup = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    assert.equal(setup.status, 0, setup.stderr);
    assert.deepEqual(await readFile(path.join(runner, 'keystore.jks')), keystore);

    const javaSource = path.join(root, 'ReadSigningProperties.java');
    await writeFile(javaSource, `
import java.nio.file.*;
import java.util.*;
class ReadSigningProperties {
    public static void main(String[] args) throws Exception {
        Properties values = new Properties();
        try (var input = Files.newInputStream(Path.of(args[0]))) { values.load(input); }
        if (!values.getProperty("keyAlias").equals(System.getenv("ANDROID_KEY_ALIAS")))
            throw new IllegalStateException("keyAlias did not survive Java Properties.load");
        if (!values.getProperty("password").equals(System.getenv("ANDROID_KEY_PASSWORD")))
            throw new IllegalStateException("password did not survive Java Properties.load");
        if (!values.getProperty("storeFile").equals(System.getenv("TT_EXPECTED_STORE")))
            throw new IllegalStateException("storeFile did not survive Java Properties.load");
    }
}
`);
    const java = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const loaded = spawnSync(java, [javaSource, path.join(android, 'keystore.properties')], {
        env, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(loaded.status, 0, loaded.error?.message ?? loaded.stderr);
});
