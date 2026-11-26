import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRuntime, createPaginationWaiter } from './runtime.mjs';

test('world info import replaces the existing name atomically and preserves its bindings', async context => {
    const { window, getModule, load, startHost } = await createBrowserRuntime();
    context.after(() => window.happyDOM.close());
    await startHost();
    const main = (await load('script.js')).namespace;
    const worldInfo = getModule('scripts/world-info.js').namespace;
    const power = getModule('scripts/power-user.js').namespace.power_user;
    getModule('scripts/popup.js').namespace.Popup.show.confirm = async () => true;
    main.setAnimationDuration(0);

    const name = 'Existing É';
    const original = '{"entries":{"42":{"uid":42,"key":["init"],"content":"Original","disable":false,"order":100}}}';
    const worlds = new Map([[name, original]]);
    const fetch = window.fetch;
    let rejectImport = true;
    window.fetch = async (url, init) => {
        if (url === '/api/settings/get') return window.Response.json({ world_names: [...worlds.keys()] });
        if (url === '/api/worldinfo/sanitize-name') return window.Response.json({ name: 'existing e' });
        if (url === '/api/worldinfo/delete') {
            worlds.delete(JSON.parse(init.body).name);
            return window.Response.json({ ok: true });
        }
        if (url === '/api/worldinfo/import') {
            if (rejectImport) {
                return new window.Response('Character book contains duplicate entry id 42', { status: 400 });
            }
            const target = init.body.get('avatar').name.replace(/\.json$/, '');
            worlds.set(target, init.body.get('convertedData'));
            return window.Response.json({ name: target });
        }
        if (url === '/api/worldinfo/get') {
            return new window.Response(worlds.get(JSON.parse(init.body).name));
        }
        return fetch(url, init);
    };
    await worldInfo.updateWorldInfoList();
    worldInfo.selected_world_info.push(name);
    worldInfo.world_info.charLore = [{ name: 'Review', extraBooks: [name] }];
    power.persona_description_lorebook = name;
    worldInfo.worldInfoCache.set(name, JSON.parse(original));

    const invalidBook = { entries: [42, 42].map(id => ({
        id, keys: ['init'], content: 'Rejected', enabled: true, insertion_order: 100,
    })) };
    await worldInfo.importWorldInfo(new window.File([JSON.stringify(invalidBook)], 'existing e.json'));
    assert.equal(worlds.get(name), original, 'A rejected replacement keeps the original bytes');
    assert.deepEqual(Array.from(worldInfo.selected_world_info), [name]);
    assert.equal(power.persona_description_lorebook, name);
    assert.deepEqual(worldInfo.world_info.charLore, [{ name: 'Review', extraBooks: [name] }]);

    rejectImport = false;
    const replacement = { entries: { 42: { uid: 42, key: ['init'], content: 'Replacement', disable: false, order: 100 } } };
    await worldInfo.importWorldInfo(new window.File([JSON.stringify(replacement)], 'existing e.json'));
    assert.deepEqual([...worlds.keys()], [name], 'Case and accent matches replace the exact existing name');
    assert.deepEqual(structuredClone(await worldInfo.loadWorldInfo(name)), replacement, 'The editor cache sees the new document');
    assert.deepEqual(Array.from(worldInfo.selected_world_info), [name]);
    assert.equal(power.persona_description_lorebook, name);
});

test('deleting characters keeps a shared lorebook until its last user is deleted', async context => {
    const { window, getModule, startHost, initializeChatRendering } = await createBrowserRuntime();
    context.after(() => window.happyDOM.close());
    await startHost();
    const main = await initializeChatRendering();
    const worldInfo = getModule('scripts/world-info.js').namespace;
    main.setAnimationDuration(0);
    getModule('scripts/tauri/setting/settings-persistence.js').namespace
        .captureSettingsSaveState({}, { token: 'loaded' });

    let characters = ['Alice', 'Bob'].map(name => ({
        name, avatar: `${name}.png`, chat: 'chat', shallow: false,
        data: { extensions: { world: 'Shared' }, tags: [], creator_notes: '', creator: '' },
    }));
    const worlds = new Set(['Shared']);
    // An empty refresh must not make the surviving character's book appear unused.
    let listReads = 0;
    const notices = [];
    window.toastr.success = message => notices.push(message);
    window.fetch = async (url, options) => {
        const body = options?.body ? JSON.parse(options.body) : undefined;
        switch (url) {
            case '/api/characters/delete':
                characters = characters.filter(character => character.avatar !== body.avatar_url);
                return window.Response.json({ ok: true });
            case '/api/characters/all':
                return window.Response.json(++listReads === 1 ? [] : characters);
            case '/api/groups/all': return window.Response.json([]);
            case '/api/settings/get': return window.Response.json({ world_names: [...worlds] });
            case '/api/settings/save': return window.Response.json({ tauritavern_settings_revision: { token: 'saved' } });
            case '/api/worldinfo/delete':
                worlds.delete(body.name);
                return window.Response.json({ ok: true });
            default: throw new Error(`Unexpected request: ${url}`);
        }
    };
    await worldInfo.updateWorldInfoList();
    worldInfo.world_info.charLore = [{ name: 'Bob', extraBooks: ['Shared'] }];
    main.characters.push(...characters);
    main.setCharacterId(0);

    assert.equal(await main.deleteCharacter('Alice.png', { deleteChats: false }), true);
    assert.equal(worlds.has('Shared'), true);
    await main.getCharacters();
    main.setCharacterId(0);
    assert.equal(await main.deleteCharacter('Bob.png', { deleteChats: false }), true);
    assert.equal(worlds.has('Shared'), false);
    assert.deepEqual(notices, ['Also deleted lorebook "Shared"']);
});

test('editing after a backend lorebook update preserves the new document', async context => {
    const { window, getModule, load, startHost } = await createBrowserRuntime();
    context.after(() => window.happyDOM.close());
    await startHost();
    await load('script.js');
    const worldInfo = getModule('scripts/world-info.js').namespace;
    const $ = window.jQuery;
    const waitForPagination = createPaginationWaiter(window);

    const entry = (uid, content) => ({ ...structuredClone(worldInfo.newWorldInfoEntryTemplate), uid, content });
    const oldDocument = { entries: { 0: entry(0, 'old content') } };
    const newDocument = { entries: { 0: entry(0, 'new content'), 1: entry(1, 'new entry') } };
    let saved;
    window.fetch = async (url, init) => {
        if (url === '/api/settings/get') return new window.Response(JSON.stringify({ world_names: ['Book'] }));
        if (url === '/api/worldinfo/get') return new window.Response(JSON.stringify(newDocument));
        if (url === '/api/worldinfo/edit') {
            saved = JSON.parse(init.body).data;
            return new window.Response('{}');
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    await worldInfo.updateWorldInfoList();
    worldInfo.initWorldInfo();
    $('#world_editor_select').val('0');
    worldInfo.worldInfoCache.set('Book', oldDocument);
    await waitForPagination(() => worldInfo.showWorldEditor('Book'));

    await worldInfo.saveWorldInfo('Book', oldDocument);
    await waitForPagination(() => worldInfo.refreshWorldInfoAfterExternalWrite('Book'));
    await worldInfo.flushWorldInfoSaves();
    assert.equal(saved, undefined);
    const order = window.document.querySelector('#world_popup_entries_list input[name="order"]');
    order.value = '101';
    await $(order).triggerHandler('input');
    await worldInfo.flushWorldInfoSaves();
    assert.equal(saved.entries[0].content, 'new content');
    assert.equal(saved.entries[1].content, 'new entry');
    assert.equal(saved.entries[0].order, 101);
});

test('immediate and debounced world info saves keep their snapshots and later edits', async context => {
    const { window, getModule, load, startHost } = await createBrowserRuntime();
    context.after(() => window.happyDOM.close());
    await startHost();
    await load('script.js');
    const worldInfo = getModule('scripts/world-info.js').namespace;
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    const saved = [];
    const events = [];
    eventSource.on(event_types.WORLDINFO_UPDATED, async name => {
        events.push(name);
        if (name === 'Book' && events.length === 1) {
            await worldInfo.saveWorldInfo('Derived', { entries: {} }, true);
        }
    });
    window.fetch = async (url, init) => {
        assert.equal(url, '/api/worldinfo/edit');
        saved.push(JSON.parse(init.body));
        if (saved.length === 1) {
            started.resolve();
            await release.promise;
        }
        return new window.Response('{}');
    };

    const data = { entries: { 0: { content: 'first' } } };
    const immediate = worldInfo.saveWorldInfo('Book', data, true);
    await started.promise;
    assert.deepEqual(events, []);
    data.entries[0].content = 'later';
    await worldInfo.saveWorldInfo('Book', data);
    const flushed = worldInfo.flushWorldInfoSaves();
    release.resolve();
    await Promise.all([immediate, flushed]);
    assert.deepEqual(saved.filter(item => item.name === 'Book')
        .map(item => item.data.entries[0].content), ['first', 'later']);
    assert.ok(saved.some(item => item.name === 'Derived'));
    assert.equal(events.filter(name => name === 'Book').length, 2);
});

test('world info failures stop dependent reads and leave unrelated saves and retries usable', async context => {
    const { window, getModule, load, startHost } = await createBrowserRuntime();
    context.after(() => window.happyDOM.close());
    await startHost();
    await load('script.js');
    const worldInfo = getModule('scripts/world-info.js').namespace;
    const saved = new Map();
    let writable = false;
    let readable = false;
    window.fetch = async (url, init) => {
        const { name, data } = JSON.parse(init.body);
        if (url === '/api/worldinfo/edit') {
            if (name === 'Broken' && !writable) return new window.Response('disk error', { status: 500 });
            saved.set(name, data);
            return new window.Response('{}');
        }
        assert.equal(url, '/api/worldinfo/get');
        return readable
            ? new window.Response('{"entries":{"0":{"uid":0,"content":"recovered read"}}}')
            : new window.Response('invalid JSON', { status: 500 });
    };

    await worldInfo.saveWorldInfo('Broken', { entries: { 0: { uid: 0, content: 'pending save' } } });
    await worldInfo.saveWorldInfo('Good', { entries: { 0: { uid: 0, content: 'good' } } });
    await assert.rejects(worldInfo.flushWorldInfoSaves(), /Broken/);
    assert.equal(saved.get('Good').entries[0].content, 'good');
    assert.equal(saved.has('Broken'), false);

    worldInfo.selected_world_info.push('Good');
    const available = await worldInfo.getSortedEntries();
    assert.equal(available.find(entry => entry.world === 'Good').content, 'good');
    worldInfo.selected_world_info.push('Broken');
    await assert.rejects(worldInfo.getSortedEntries(), /Broken/);
    writable = true;
    const afterSaveRetry = await worldInfo.getSortedEntries();
    assert.equal(afterSaveRetry.find(entry => entry.world === 'Broken').content, 'pending save');
    assert.equal(saved.get('Broken').entries[0].content, 'pending save');

    worldInfo.selected_world_info.push('Unreadable');
    await assert.rejects(worldInfo.getSortedEntries(), /Unreadable/);
    readable = true;
    const afterReadRetry = await worldInfo.getSortedEntries();
    assert.equal(afterReadRetry.find(entry => entry.world === 'Unreadable').content, 'recovered read');
});

test('performance HUD keeps world info byte commits intact', async context => {
    const { window, load } = await createBrowserRuntime();
    let hud;
    context.after(async () => {
        hud?.disable();
        await window.happyDOM.close();
    });
    const { createInvokeService } = (await load('tauri/main/services/invokes/invoke-service.js')).namespace;
    const { createRouteRegistry } = (await load('tauri/main/router.js')).namespace;
    const { jsonResponse } = (await load('tauri/main/http-utils.js')).namespace;
    const { registerWorldInfoRoutes } = (await load('tauri/main/routes/worldinfo-routes.js')).namespace;
    const { installPerfHud } = (await load('tauri/main/perf/perf-hud.js')).namespace;
    const frames = [];
    let saved;
    const service = createInvokeService({
        policies: {},
        async invoke(command, args, options) {
            switch (command) {
                case 'begin_world_info_commit': return { sessionId: 'world', maxFrameBytes: 11 };
                case 'append_world_info_commit_chunk': {
                    frames.push(Buffer.from(args));
                    return Number(options?.headers?.offset) + args.byteLength;
                }
                case 'finish_world_info_commit': saved = Buffer.concat(frames).toString(); return;
                default: throw new Error(`Unexpected command ${command}`);
            }
        },
    });
    const router = createRouteRegistry();
    registerWorldInfoRoutes(router, service, { jsonResponse });
    hud = installPerfHud({ context: service });
    hud.enable();
    const body = '{"name":"Book","data":{"entries":{},"text":"你好 👋"}}';
    const response = await router.handle({ method: 'POST', path: '/api/worldinfo/edit', body });
    assert.equal(response.status, 200);
    assert.equal(saved, body);
});
