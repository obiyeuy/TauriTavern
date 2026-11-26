import assert from 'node:assert/strict';
import test from 'node:test';
import { captureBrowserErrors, createBrowserRuntime } from './runtime.mjs';
import { HOSTS } from '../helpers/host-identity.mjs';

test('APP_READY startup hooks can open a chat before deferred activation is scheduled', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime({ identity: HOSTS.android });
    context.after(() => window.happyDOM.close());
    const { failed } = captureBrowserErrors(window);
    await startHost();
    const main = (await load('script.js')).namespace;
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    let openedInStartupHook = false;
    eventSource.on(event_types.APP_READY, async () => {
        await main.selectCharacterById(0);
        openedInStartupHook = main.chat.length === 1;
    });
    const initialized = new Promise(resolve => eventSource.once(event_types.EXTENSION_SETTINGS_LOADED, resolve));
    window.jQuery.holdReady(false);
    await Promise.race([initialized, failed]);
    assert.equal(openedInStartupHook, true, 'Awaited startup hooks must not wait on their own APP_READY completion');
    assert.equal(window.webHostFixtureActivated, true);
});

test('extensions with unmet requirements remain warned without blocking unrelated chats', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime({ identity: HOSTS.android });
    context.after(() => window.happyDOM.close());
    const { failed } = captureBrowserErrors(window);
    await startHost();
    const main = (await load('script.js')).namespace;
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const skipped = new Map([
        ['third-party/extras-required', { requires: ['unavailable-extras-module'] }],
        ['third-party/newer-client-required', { minimum_client_version: '99.0.0' }],
        ['third-party/dependency-required', { dependencies: ['third-party/unavailable-dependency'] }],
    ]);
    const fetch = window.fetch;
    window.fetch = async (input, options) => {
        const url = String(input);
        for (const [name, requirements] of skipped) {
            if (url.endsWith(`/scripts/extensions/${name}/manifest.json`)) {
                return new window.Response(JSON.stringify({ display_name: name, js: 'index.js', ...requirements }));
            }
        }
        const response = await fetch(input, options);
        if (url === '/api/extensions/discover') {
            return new window.Response(JSON.stringify([
                ...await response.json(),
                ...Array.from(skipped.keys(), name => ({ name, type: 'local' })),
            ]));
        }
        return response;
    };
    const initialized = new Promise(resolve => eventSource.once(event_types.EXTENSION_SETTINGS_LOADED, resolve));
    window.jQuery.holdReady(false);
    await Promise.race([initialized, failed]);
    await Promise.race([main.selectCharacterById(0), failed]);
    assert.equal(main.chat[0].mes, 'A chat loaded through Web Host.');
    assert.equal(window.webHostFixtureActivated, true);
    assert.equal(window.document.getElementById('extensions_details').classList.contains('warning'), true);
});

test('failed deferred activation rejects chat and generation without blocking settings', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime({ identity: HOSTS.android });
    context.after(() => window.happyDOM.close());
    const extensionSettingsLoaded = Promise.withResolvers();
    const notified = Promise.withResolvers();
    const notifications = [];
    window.toastr.error = (...args) => { notifications.push(args); notified.resolve(); };
    await startHost();
    const main = (await load('script.js')).namespace;
    const groups = getModule('scripts/group-chats.js').namespace;
    const extensions = getModule('scripts/extensions.js').namespace;
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const fetch = window.fetch;
    window.fetch = async (input, options) => {
        const response = await fetch(input, options);
        if (String(input).endsWith('/third-party/web-host-fixture/manifest.json')) {
            const manifest = await response.json();
            return new window.Response(JSON.stringify({ ...manifest, hooks: { activate: 'missingActivationHook' } }));
        }
        return response;
    };
    eventSource.once(event_types.EXTENSION_SETTINGS_LOADED, extensionSettingsLoaded.resolve);
    window.jQuery.holdReady(false);
    const startupOutcome = await Promise.race([
        notified.promise.then(() => 'failed'),
        extensionSettingsLoaded.promise.then(() => 'loaded'),
    ]);
    assert.equal(startupOutcome, 'failed', 'A failed enabled extension must not be reported as ready');
    const failure = await extensions.waitForStartupExtensions().then(() => null, error => error);
    assert.ok(failure, 'Startup readiness must retain its activation failure');
    assert.match(failure.message, /missingActivationHook/);
    const initialChat = JSON.stringify(main.chat);
    await assert.rejects(main.selectCharacterById(0), error => error === failure);
    main.setCharacterId('0');
    await assert.rejects(main.getChat(), error => error === failure);
    main.setSendButtonState(true);
    await assert.rejects(main.Generate('normal'), error => error === failure);
    assert.equal(main.isGenerating(), false, 'A failed generation must release its send state so navigation remains usable');
    await assert.rejects(groups.openGroupById('unavailable'), error => error === failure);
    await assert.rejects(groups.getGroupChat('unavailable'), error => error === failure);
    await assert.rejects(groups.generateGroupWrapper(false), error => error === failure);
    assert.equal(JSON.stringify(main.chat), initialChat, 'An unconfirmed renderer must not receive a partially opened chat');
    assert.equal(notifications.length, 1, 'The startup failure is presented once');
    await assert.doesNotReject(main.saveSettings());
});
