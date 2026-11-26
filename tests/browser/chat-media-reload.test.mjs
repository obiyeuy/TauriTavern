import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRuntime, captureBrowserErrors } from './runtime.mjs';
import { HOSTS } from '../helpers/host-identity.mjs';

const IMAGE_URLS = [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=',
    'https://media.example.invalid/picture.png',
    '/user/images/Synthetic/picture.png',
];

async function openGallery(fixture, source) {
    const runtime = await createBrowserRuntime({ identity: HOSTS.android, fixture });
    const { window, load, getModule, startHost } = runtime;
    const { errors, failed } = captureBrowserErrors(window);
    let release = () => {};
    try {
        if (source !== undefined) {
            const records = runtime.fixture.chatFiles.get('review-chat').split('\n').map(record => JSON.parse(record));
            records[1].mes = source;
            runtime.fixture.chatFiles.set('review-chat', records.map(record => JSON.stringify(record)).join('\n'));
        }
        await startHost();
        const main = (await load('script.js')).namespace;
        const { eventSource, event_types } = getModule('scripts/events.js').namespace;
        const held = Promise.withResolvers();
        const raf = window.requestAnimationFrame.bind(window);
        let holdNext = false;
        window.requestAnimationFrame = callback => {
            if (!holdNext) return raf(callback);
            holdNext = false;
            held.resolve(() => raf(callback));
            return 1000000;
        };
        eventSource.on(event_types.APP_READY, () => { holdNext = true; });
        const ready = new Promise(resolve => eventSource.once(event_types.APP_READY, resolve));
        const extensionsLoaded = new Promise(resolve => eventSource.once(event_types.EXTENSION_SETTINGS_LOADED, resolve));
        window.jQuery.holdReady(false);
        await Promise.race([ready, failed]);
        release = await Promise.race([held.promise, failed]);
        let loaded = false;
        eventSource.once(event_types.CHAT_LOADED, () => { loaded = true; });
        const selecting = main.selectCharacterById(0);
        await new Promise(resolve => raf(resolve));
        // Before the gate existed, host selection reached CHAT_LOADED while the
        // renderer remained uninitialized. Do not wait on the held animation frame.
        if (loaded) await selecting;
        assert.equal(window.webHostFixtureActivated, undefined);
        assert.equal(loaded, false, 'Chat selection must wait until the deferred renderer is ready');
        release();
        release = () => {};
        await Promise.race([Promise.all([selecting, extensionsLoaded]), failed]);
        return { ...runtime, main, errors };
    } catch (error) {
        release();
        await window.happyDOM.close();
        throw error;
    }
}

function gallerySources(window) {
    const frame = window.document.querySelector('#chat .TH-render iframe');
    assert.ok(frame, 'The selected chat must initialize its third-party gallery after cold startup');
    const content = window.document.createElement('template');
    content.innerHTML = frame.srcdoc;
    return [...content.content.querySelectorAll('img')].map(image => image.getAttribute('src'));
}

test('mobile cold startup and reload initialize the persisted card image gallery', async () => {
    const gallery = '<!doctype html><html><body><main data-chat-media-fixture>'
        + IMAGE_URLS.map(url => `<img src="${url}">`).join('') + '</main></body></html>';
    const source = `\`\`\`html\n${gallery}\n\`\`\``;

    const first = await openGallery(undefined, source);
    const { fixture } = first;
    try {
        assert.deepEqual(gallerySources(first.window), IMAGE_URLS);
        await first.main.saveChatConditional();
        assert.equal(JSON.parse(fixture.chatFiles.get('review-chat').split('\n')[1]).mes, source);
        assert.deepEqual(first.errors, []);
    } finally {
        await first.window.happyDOM.close();
    }

    const reloaded = await openGallery(fixture);
    try {
        assert.deepEqual(gallerySources(reloaded.window), IMAGE_URLS);
        assert.equal(reloaded.main.chat[0].mes, source);
        assert.deepEqual(reloaded.errors, []);
    } finally {
        await reloaded.window.happyDOM.close();
    }
});
