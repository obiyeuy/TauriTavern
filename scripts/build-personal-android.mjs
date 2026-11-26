#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, [
    path.join(root, 'scripts/tauri-app.mjs'),
    '--prepare-frontend', 'android', 'build', '--target', 'aarch64', '--apk',
    '--config', path.join(root, 'src-tauri/crates/tauritavern/tauri.personal.conf.json'),
    ...process.argv.slice(2),
], {
    cwd: root,
    stdio: 'inherit',
    env: {
        ...process.env,
        TAURITAVERN_ANDROID_APPLICATION_ID: 'com.tauritavern.personal',
        TAURITAVERN_UPDATE_REPOSITORY: process.env.TAURITAVERN_UPDATE_REPOSITORY
            ?? process.env.GITHUB_REPOSITORY ?? 'obiyeuy/TauriTavern',
    },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
