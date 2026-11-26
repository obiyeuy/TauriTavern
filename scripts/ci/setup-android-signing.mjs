#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const required = name => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
};

const runnerTemp = required('RUNNER_TEMP');
const keyAlias = required('ANDROID_KEY_ALIAS');
const password = required('ANDROID_KEY_PASSWORD');
const base64 = required('ANDROID_KEY_BASE64').replace(/\s/g, '');
if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('ANDROID_KEY_BASE64 is not a valid base64 keystore');
}
const keystore = Buffer.from(base64, 'base64');
if (!keystore.length) throw new Error('The Android keystore is empty');

const storeFile = path.join(runnerTemp, 'keystore.jks');
const propertiesFile = path.resolve(import.meta.dirname,
    '../../src-tauri/crates/tauritavern/gen/android/keystore.properties');
// Gradle loads an InputStream as Java Properties (ISO-8859-1), so write
// non-ASCII UTF-16 units as escapes instead of losing Unicode credentials.
const escapeProperty = value => value.replace(/[\\ =:#!\u0000-\u001f\u007f-\uffff]/g, character => {
    const control = { '\r': '\\r', '\n': '\\n', '\t': '\\t', '\f': '\\f' }[character];
    if (control) return control;
    const code = character.charCodeAt(0);
    if (code < 0x20 || code >= 0x7f) return `\\u${code.toString(16).padStart(4, '0')}`;
    return `\\${character}`;
});

await writeFile(storeFile, keystore, { mode: 0o600, flag: 'wx' });
await writeFile(propertiesFile, [
    `keyAlias=${escapeProperty(keyAlias)}`,
    `password=${escapeProperty(password)}`,
    `storeFile=${escapeProperty(storeFile)}`,
    '',
].join('\n'), { mode: 0o600, flag: 'wx' });
