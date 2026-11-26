import assert from 'node:assert/strict';
import test from 'node:test';
import { captureBrowserErrors, createBrowserRuntime } from './runtime.mjs';
import { HOSTS } from '../helpers/host-identity.mjs';

async function openSession(options) {
    const runtime = await createBrowserRuntime(options);
    const { window, load, getModule, startHost } = runtime;
    const { errors, failed } = captureBrowserErrors(window);
    try {
        await startHost();
        const main = (await load('script.js')).namespace;
        const { eventSource, event_types } = getModule('scripts/events.js').namespace;
        const ready = new Promise(resolve => eventSource.once(event_types.APP_READY, resolve));
        const extensionsLoaded = new Promise(resolve => eventSource.once(event_types.EXTENSION_SETTINGS_LOADED, resolve));
        const saved = new Promise(resolve => eventSource.once(event_types.SETTINGS_UPDATED, resolve));
        const chatLoaded = new Promise(resolve => eventSource.once(event_types.CHAT_LOADED, resolve));
        window.jQuery.holdReady(false);
        await Promise.race([Promise.all([ready, saved, extensionsLoaded]), failed]);
        assert.equal(window.document.getElementById('extensions_details').classList.contains('warning'), false);
        assert.equal(window.webHostFixtureActivated, true);
        if (options?.identity?.kind === 'mobile') await main.selectCharacterById(0);
        else await Promise.race([chatLoaded, failed]);
        return { ...runtime, main, errors, failed };
    } catch (error) {
        await window.happyDOM.close();
        throw error;
    }
}

for (const identity of [HOSTS.windows, HOSTS.android]) {
    test(`Web Host preserves ${identity.kind} session edits and replayed replies across reload`, async () => {
        const first = await openSession({ identity });
        const { window, fixture, main, getModule } = first;
        const invoke = window.__TAURI__.core.invoke;
        try {
            getModule('scripts/extensions.js').namespace.extension_settings.webHostSession = { enabled: true };
            assert.equal(await main.saveSettings(), true);
            await invoke('update_tauritavern_settings', { dto: { dynamic_theme: { day_theme: 'Dark Lite' } } });
            await invoke('update_tauritavern_settings', { dto: { dynamic_theme: { night_theme: 'Dark Lite' } } });
            await window.fetch('/api/themes/save', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'Session theme', blur_strength: 17 }),
            });
            main.chat_metadata.variables = { score: 7 };
            await main.saveMetadata();
            const transport = getModule('scripts/tauri/chat/transport.js').namespace;
            await assert.rejects(transport.saveCharacterChatMetadata({
                avatarUrl: 'Review.png', fileName: 'review-chat', chatMetadata: { integrity: 'stale' },
            }), error => error.code === 'integrity');
            const card = JSON.parse(JSON.parse(fixture.backend.handle({ method: 'POST', url: '/api/characters/get', headers: {}, body: '{}' }).body).json_data);
            card.data.extensions.tavern_helper = { scripts: [{ id: 'script', content: 'console.log(1)' }], variables: { rank: 2 } };
            window.jQuery('#character_json_data').val(JSON.stringify(card));
            await Promise.race([main.createOrEditCharacter(), first.failed]);
            await getModule('scripts/extensions.js').namespace.writeExtensionField(0, 'merged', true);
            const quickReply = window.quickReplyApi.getSetByName('Review QR');
            quickReply.qrList[0].message = 'A saved quick reply';
            await quickReply.save();
            await Promise.race([window.jQuery('#api_button_openai').triggerHandler('click'), first.failed]);
            assert.notEqual(main.online_status, 'no_connection');
            window.jQuery('#send_textarea').val('Continue the story');
            await Promise.race([main.sendTextareaMessage(), first.failed]);
            await main.waitForGenerationIdle();
            assert.ok(main.chat.some(message => message.is_user && message.mes === 'Continue the story'));
            assert.equal(main.chat.at(-1).mes, 'A replayed reply.');

            const saved = fixture.chatFiles.get('review-chat');
            const corrupted = '{truncated header\n' + saved.split('\n').slice(1).join('\n');
            fixture.chatFiles.set('review-chat', corrupted);
            const repair = { avatarUrl: 'Review.png', fileName: 'review-chat', payload: saved.split('\n').map(line => JSON.parse(line)) };
            await assert.rejects(transport.saveCharacterChatPayload(repair), /400.*integrity/);
            assert.equal(fixture.chatFiles.get('review-chat'), corrupted);
            await transport.saveCharacterChatPayload({ ...repair, force: true });
            await Promise.race([first.host.exit(), first.failed]);
            assert.deepEqual(first.errors, []);
        } finally { await window.happyDOM.close(); }

        const second = await openSession({ identity, fixture });
        try {
            assert.equal(second.main.chat.at(-1).mes, 'A replayed reply.');
            assert.equal(second.main.chat_metadata.variables.score, 7);
            const settings = JSON.parse(JSON.parse(fixture.backend.handle({ method: 'POST', url: '/api/settings/get', headers: {}, body: '{}' }).body).settings);
            assert.deepEqual(settings.extension_settings.webHostSession, { enabled: true });
            const stored = await second.window.__TAURI__.core.invoke('get_tauritavern_settings');
            assert.equal(stored.dynamic_theme.day_theme, 'Dark Lite');
            assert.equal(stored.dynamic_theme.night_theme, 'Dark Lite');
            const response = JSON.parse(fixture.backend.handle({ method: 'POST', url: '/api/settings/get', headers: {}, body: '{}' }).body);
            assert.equal(response.themes.find(theme => theme.name === 'Session theme').blur_strength, 17);
            const card = JSON.parse(fixture.backend.handle({ method: 'POST', url: '/api/characters/get', headers: {}, body: '{}' }).body);
            assert.deepEqual(card.data.extensions.tavern_helper, { scripts: [{ id: 'script', content: 'console.log(1)' }], variables: { rank: 2 } });
            assert.equal(card.data.extensions.merged, true);
            assert.equal(second.window.quickReplyApi.getSetByName('Review QR').qrList[0].message, 'A saved quick reply');
            assert.deepEqual(second.errors, []);
        } finally { await second.window.happyDOM.close(); }
    });
}

test('returned operation failures keep Quick Reply data and distinguish API and UI saves', async context => {
    const session = await openSession({ identity: HOSTS.android });
    context.after(() => session.window.happyDOM.close());
    const { window, fixture } = session;
    const api = window.quickReplyApi;
    const set = api.getSetByName('Review QR');
    const original = fixture.backend.handle.bind(fixture.backend);
    const notifications = [];
    window.toastr.error = (...args) => notifications.push(args);
    let saveAttempts = 0;
    fixture.backend.handle = request => {
        if (request.url === '/api/quick-replies/save') {
            saveAttempts++;
            return { status: 500, headers: {}, body: 'Review store is read-only' };
        }
        return original(request);
    };

    await assert.rejects(api.updateSet(set.name, { disableSend: true }), /Review store is read-only/);
    assert.equal(notifications.length, 0, 'The awaited API lets its caller present the error');
    const previousAttempts = saveAttempts;
    assert.deepEqual(await Promise.all([set.save(), set.save()]), [false, false]);
    assert.equal(saveAttempts - previousAttempts, 1, 'Repeated UI edits share one actual save');
    assert.equal(notifications.length, 1, 'The delayed UI save presents one failure');
    const stored = JSON.parse(original({ method: 'POST', url: '/api/settings/get', body: '{}' }).body);
    assert.notEqual(stored.quickReplyPresets[0].disableSend, true);

    notifications.length = 0;
    await assert.rejects(api.deleteSet(set.name), /delete_quick_reply_set/);
    assert.equal(api.getSetByName(set.name), set);
    assert.equal(set.isDeleted, false);
    assert.equal(notifications.length, 0);
    api.settingsUi.currentSet.value = set.name;
    api.settingsUi.currentSet.dispatchEvent(new window.Event('change'));
    session.getModule('scripts/popup.js').namespace.Popup.show.confirm = async () => true;
    await api.settingsUi.deleteQrSet();
    assert.equal(api.getSetByName(set.name), set);
    assert.equal(notifications.length, 1, 'A UI deletion failure has its own operation context');

    const beforeNames = Array.from(api.listSets());
    const beforeOptions = api.settingsUi.currentSet.innerHTML;
    notifications.length = 0;
    await api.settingsUi.importSingleQrSet(new window.File([
        JSON.stringify({ version: 2, name: 'Unsaved import', qrList: [] }),
    ], 'unsaved.json'));
    assert.equal(api.getSetByName('Unsaved import'), undefined);
    assert.deepEqual(Array.from(api.listSets()), beforeNames);
    assert.equal(api.settingsUi.currentSet.innerHTML, beforeOptions);
    assert.equal(notifications.length, 1);

    const fetch = window.fetch;
    let deletions = 0;
    window.fetch = (url, init) => {
        if (url === '/api/quick-replies/delete') {
            deletions++;
            return Promise.resolve(window.Response.json({ ok: true }));
        }
        return fetch(url, init);
    };
    notifications.length = 0;
    await api.settingsUi.importSingleQrSet(new window.File([
        JSON.stringify({ version: 2, name: set.name, qrList: [] }),
    ], 'replacement.json'));
    assert.equal(deletions, 0, 'A replacement must not delete the saved set before writing');
    assert.equal(api.getSetByName(set.name), set);
    assert.equal(set.isDeleted, false);
    assert.equal(notifications.length, 1);
});

test('returned operation failures do not delete group state or publish deletion events', async context => {
    const session = await openSession({ identity: HOSTS.android });
    context.after(() => session.window.happyDOM.close());
    const { window, main, getModule } = session;
    const groups = getModule('scripts/group-chats.js').namespace;
    const group = { id: 'failed-group', name: 'Review group', members: ['Review.png'],
        chats: ['saved-group-chat'], chat_id: 'saved-group-chat', disabled_members: [] };
    groups.applyGroupsSnapshot([group]);
    const deleted = [];
    main.eventSource.on(main.event_types.GROUP_CHAT_DELETED, chatId => deleted.push(chatId));
    const before = JSON.stringify(main.chat);
    const original = window.fetch;
    window.fetch = (url, init) => url === '/api/groups/delete'
        ? Promise.resolve(new window.Response('Review group could not be deleted', { status: 500 }))
        : original(url, init);
    const notifications = [];
    window.toastr.error = (...args) => notifications.push(args);
    await assert.rejects(groups.deleteGroup(group.id), /Review group could not be deleted/);
    assert.deepEqual(deleted, []);
    assert.equal(JSON.stringify(main.chat), before);
    assert.equal(groups.groups[0], group);
    getModule('scripts/popup.js').namespace.Popup.show.confirm = async () => true;
    groups.select_group_chats(group.id, true);
    await window.jQuery('#rm_group_delete').triggerHandler('click');
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].join(' '), /Review group could not be deleted/);
    assert.deepEqual(deleted, []);
    assert.equal(groups.openGroupId, group.id);

    const beforeChat = JSON.stringify(session.main.chat);
    notifications.length = 0;
    window.fetch = (url, init) => url === '/api/groups/create'
        ? Promise.resolve(new window.Response('Review group could not be created', { status: 500 }))
        : original(url, init);
    await window.jQuery('#option_convert_to_group').triggerHandler('click');
    assert.equal(notifications.length, 1, 'Converting a solo chat presents a rejected group creation');
    assert.match(notifications[0].join(' '), /Review group could not be created/);
    assert.equal(JSON.stringify(session.main.chat), beforeChat);
});

test('returned operation failures leave the background selection intact and explain upload failure', async context => {
    const session = await openSession({ identity: HOSTS.android });
    context.after(() => session.window.happyDOM.close());
    const { window, getModule } = session;
    const backgrounds = getModule('scripts/backgrounds.js').namespace;
    const before = JSON.stringify(backgrounds.background_settings);
    const original = window.fetch;
    window.fetch = (url, init) => url === '/api/backgrounds/upload'
        ? Promise.resolve(new window.Response('Review background could not be written', { status: 500 }))
        : original(url, init);
    const notifications = [];
    window.toastr.error = (...args) => notifications.push(args);
    const input = window.document.getElementById('add_bg_button');
    Object.defineProperty(input, 'files', {
        value: [new window.File(['review image'], 'review.png', { type: 'image/png' })],
    });
    await window.jQuery(input).triggerHandler({ type: 'change', originalEvent: { currentTarget: input } });
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].join(' '), /Review background could not be written/);
    assert.equal(JSON.stringify(backgrounds.background_settings), before);

    getModule('scripts/power-user.js').namespace.power_user.never_resize_avatars = true;
    const avatar = session.main.user_avatar;
    const avatarInput = window.document.getElementById('avatar_upload_file');
    Object.defineProperty(avatarInput, 'files', {
        value: [new window.File(['review image'], 'review.png', { type: 'image/png' })],
        configurable: true,
    });
    window.fetch = (url, init) => ['/api/avatars/upload', '/api/avatars/delete'].includes(url)
        ? Promise.resolve(new window.Response('Review avatar store is read-only', { status: 500 }))
        : original(url, init);
    notifications.length = 0;
    await window.jQuery(avatarInput).triggerHandler('change');
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].join(' '), /Review avatar store is read-only/);
    assert.equal(session.main.user_avatar, avatar);
    notifications.length = 0;
    getModule('scripts/popup.js').namespace.Popup.show.confirm = async () => true;
    await window.jQuery('#persona_delete_button').triggerHandler('click');
    assert.equal(notifications.length, 1);
    assert.equal(session.main.user_avatar, avatar);
});

test('returned operation failures keep expression images and present a rejected HTTP deletion', async context => {
    const session = await openSession({ identity: HOSTS.android });
    context.after(() => session.window.happyDOM.close());
    const { window, getModule, load } = session;
    const original = window.fetch;
    window.fetch = (url, init) => String(url).startsWith('/api/sprites/get')
        ? Promise.resolve(window.Response.json([]))
        : original(url, init);
    const expressions = (await load('scripts/extensions/expressions/index.js')).namespace;
    await expressions.init();
    getModule('scripts/popup.js').namespace.Popup.show.confirm = async () => true;
    const $ = window.jQuery;
    const list = $('#image_list').data('name', 'Review');
    assert.equal(list.length, 1, 'The expression settings are mounted');
    const item = $('<div class="expression_list_item" data-expression="joy" data-expression-type="success" data-filename="joy.png"><button class="expression_list_delete">Delete</button></div>');
    list.empty().append(item);
    const completed = Promise.withResolvers();
    let refreshes = 0;
    window.fetch = (url, init) => {
        if (url === '/api/sprites/delete') {
            return Promise.resolve(new window.Response('Review expression could not be deleted', { status: 500 }));
        }
        if (String(url).startsWith('/api/sprites/get')) {
            refreshes++;
            completed.resolve();
            return Promise.resolve(window.Response.json([]));
        }
        return original(url, init);
    };
    const notifications = [];
    window.toastr.error = (...args) => { notifications.push(args); completed.resolve(); };
    item.find('button').trigger('click');
    await completed.promise;
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].join(' '), /Review expression could not be deleted/);
    assert.equal(refreshes, 0, 'A rejected deletion does not refresh as if it succeeded');
    assert.equal(list[0].contains(item[0]), true);

    notifications.length = 0;
    let spriteReads = 0;
    let failSprites = true;
    window.fetch = (url, init) => {
        if (String(url).startsWith('/api/sprites/get')) {
            spriteReads++;
            return Promise.resolve(failSprites
                ? new window.Response('Review expressions are unavailable', { status: 500 })
                : window.Response.json([]));
        }
        return original(url, init);
    };
    await assert.rejects(
        expressions.sendExpressionCall('Review retry', 'joy', { vnMode: false }),
        /Review expressions are unavailable/,
    );
    assert.equal(notifications.length, 0, 'The awaited expression API propagates a rejected list read');
    failSprites = false;
    await expressions.sendExpressionCall('Review retry', 'joy', { vnMode: false });
    assert.equal(spriteReads, 2, 'A failed list read is not cached as an empty list');

    failSprites = true;
    window.jQuery('#expression-image')
        .attr('data-sprite-folder-name', 'Review fallback')
        .attr('data-expression', 'joy');
    window.jQuery('#expression_fallback').val('joy');
    await assert.doesNotReject(window.jQuery('#expression_fallback').triggerHandler('change'));
    assert.equal(notifications.length, 1, 'The fallback UI owns its failed refresh');
    assert.match(notifications[0].join(' '), /Review expressions are unavailable/);
});

test('returned operation failures preserve character extension data and reject bulk writes', async context => {
    const session = await openSession({ identity: HOSTS.android });
    context.after(() => session.window.happyDOM.close());
    const { window, main, getModule } = session;
    const extensions = getModule('scripts/extensions.js').namespace;
    const before = JSON.stringify(main.characters[0]);
    const original = window.fetch;
    window.fetch = (url, init) => url === '/api/characters/merge-attributes'
        ? Promise.resolve(new window.Response('Review card could not be written', { status: 500 }))
        : original(url, init);
    await assert.rejects(extensions.writeExtensionField(0, 'reviewFailure', 'unsaved'), /Review card could not be written/);
    assert.equal(JSON.stringify(main.characters[0]), before, 'A rejected field update does not alter the live card');
    await assert.rejects(extensions.writeExtensionFieldBulk(['Review.png'], 'reviewFailure', 'unsaved'), /Review card could not be written/);
    assert.equal(JSON.stringify(main.characters[0]), before);
});

test('a failed composite character refresh preserves the published characters and selection', async context => {
    const session = await openSession({ identity: HOSTS.android });
    context.after(() => session.window.happyDOM.close());
    const { window, main } = session;
    const before = Array.from(main.characters, character => character.avatar);
    const selected = main.characters[main.this_chid].avatar;
    const original = window.fetch;
    const incoming = [
        { ...structuredClone(main.characters[0]), name: 'Another', avatar: 'Another.png' },
        structuredClone(main.characters[0]),
    ];
    let failGroups = true;
    window.fetch = (url, init) => {
        if (url === '/api/characters/all') return Promise.resolve(window.Response.json(incoming));
        if (url === '/api/groups/all') return Promise.resolve(failGroups
            ? new window.Response('Review group list is unavailable', { status: 500 })
            : window.Response.json([]));
        return original(url, init);
    };
    await assert.rejects(main.getCharacters(), /Review group list is unavailable/);
    assert.deepEqual(Array.from(main.characters, character => character.avatar), before);
    assert.equal(main.characters[main.this_chid].avatar, selected);
    failGroups = false;
    await main.getCharacters();
    assert.deepEqual(Array.from(main.characters, character => character.avatar), incoming.map(character => character.avatar));
    assert.equal(main.characters[main.this_chid].avatar, selected);

    const warnings = [];
    window.toastr.warning = (...args) => warnings.push(args);
    let duplicateRequests = 0;
    failGroups = true;
    const withListResponses = window.fetch;
    window.fetch = (url, init) => {
        if (url === '/api/characters/duplicate') {
            duplicateRequests++;
            return Promise.resolve(window.Response.json({ path: 'Review-copy.png' }));
        }
        return withListResponses(url, init);
    };
    const copy = await main.duplicateCharacter({ avatar: selected, silent: true });
    assert.equal(copy, 'Review-copy.png', 'A confirmed copy still returns its saved identity if only refresh fails');
    assert.equal(duplicateRequests, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].join(' '), /Review group list is unavailable/);
    assert.equal(main.characters[main.this_chid].avatar, selected);
});

test('preset save failures reject for API callers and are presented once by the update button', async context => {
    const session = await openSession({ identity: HOSTS.android });
    context.after(() => session.window.happyDOM.close());
    const { window, getModule } = session;
    const manager = getModule('scripts/preset-manager.js').namespace.getPresetManager('openai');
    manager.updateList('Review preset', { extensions: { reviewValue: 'saved' } });
    await getModule('scripts/openai.js').namespace.getPresetApplicationPromise();
    const original = window.fetch;
    window.fetch = (url, init) => url === '/api/presets/save'
        ? Promise.resolve(new window.Response('Review preset store is read-only', { status: 500 }))
        : original(url, init);
    const notifications = [];
    const notified = Promise.withResolvers();
    window.toastr.error = (...args) => { notifications.push(args); notified.resolve(); };
    await assert.rejects(manager.savePreset('Review preset', {}), /Review preset store is read-only/);
    assert.equal(notifications.length, 0, 'A returned API error is not presented by the writer');
    const beforeExtensions = JSON.stringify(manager.readPresetExtensionField({ path: '' }));
    const beforePreset = JSON.stringify(manager.getCompletionPresetByName(manager.getSelectedPresetName()));
    await assert.rejects(
        manager.writePresetExtensionField({ path: 'reviewFailure', value: 'unsaved' }),
        /Review preset store is read-only/,
    );
    assert.equal(JSON.stringify(manager.readPresetExtensionField({ path: '' })), beforeExtensions);
    assert.equal(JSON.stringify(manager.getCompletionPresetByName(manager.getSelectedPresetName())), beforePreset);
    assert.equal(notifications.length, 0);
    const button = window.jQuery('[data-preset-manager-update="instruct"]');
    assert.equal(button.length, 1);
    button.trigger('click');
    await notified.promise;
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].join(' '), /Review preset store is read-only/);

    notifications.length = 0;
    const masterInput = window.document.getElementById('af_master_import_file');
    Object.defineProperty(masterInput, 'files', {
        value: [new window.File([JSON.stringify({ name: 'Review format', story_string: '{{description}}' })], 'review-format.json')],
    });
    await assert.doesNotReject(window.jQuery(masterInput).triggerHandler('change'));
    assert.equal(notifications.length, 1, 'Master formatting imports own the same writer failure');
    assert.match(notifications[0].join(' '), /Review preset store is read-only/);
});

test('a rejected regex preset leaves its selection unchanged and remains retryable', async context => {
    const session = await openSession({ identity: HOSTS.android });
    context.after(() => session.window.happyDOM.close());
    const { window, main, getModule, load, fixture } = session;
    const { extension_settings } = getModule('scripts/extensions.js').namespace;
    const script = {
        id: 'review-scoped', scriptName: 'Review scoped', findRegex: '/review/g',
        replaceString: '', trimStrings: [], placement: [1, 2], disabled: false,
    };
    main.characters[0].data.extensions.regex_scripts = [script];
    extension_settings.regex_presets = [
        { id: 'review-current', name: 'Current', isSelected: true, global: [], preset: [], scoped: [{ id: script.id }] },
        { id: 'review-next', name: 'Next', isSelected: false, global: [], preset: [], scoped: [] },
    ];
    extension_settings.disabledExtensions = extension_settings.disabledExtensions.filter(name => name !== 'regex');
    const regex = (await load('scripts/extensions/regex/index.js')).namespace;
    if (!window.document.getElementById('regex_presets')) await regex.init();
    const select = window.document.getElementById('regex_presets');
    select.replaceChildren(...extension_settings.regex_presets.map(preset =>
        new window.Option(preset.name, preset.id, preset.isSelected, preset.isSelected)));
    const { executeSlashCommandsWithOptions } = getModule('scripts/slash-commands.js').namespace;
    await executeSlashCommandsWithOptions('/regex-preset Current');
    getModule('scripts/popup.js').namespace.Popup.show.confirm = async () => false;
    const original = window.fetch;
    window.fetch = (url, init) => url === '/api/characters/merge-attributes'
        ? Promise.resolve(new window.Response('Review scoped scripts could not be saved', { status: 500 }))
        : original(url, init);
    const notifications = [];
    const notified = Promise.withResolvers();
    window.toastr.error = (...args) => { notifications.push(args); notified.resolve(); };
    await assert.rejects(executeSlashCommandsWithOptions('/regex-preset Next'), /Review scoped scripts could not be saved/);
    assert.equal(notifications.length, 0, 'A script receives the failure without a UI notification');
    select.value = 'review-next';
    select.dispatchEvent(new window.Event('change'));
    await notified.promise;
    assert.equal(notifications.length, 1, JSON.stringify(notifications));
    assert.match(notifications[0].join(' '), /Review scoped scripts could not be saved/);
    assert.equal(select.value, 'review-current');
    assert.deepEqual(Array.from(extension_settings.regex_presets, preset => preset.isSelected), [true, false]);
    assert.equal(main.characters[0].data.extensions.regex_scripts[0].disabled, false);

    window.fetch = original;
    const result = await executeSlashCommandsWithOptions('/regex-preset Next');
    assert.equal(result.pipe, 'review-next');
    assert.equal(select.value, 'review-next');
    assert.deepEqual(Array.from(extension_settings.regex_presets, preset => preset.isSelected), [false, true]);
    assert.equal(main.characters[0].data.extensions.regex_scripts[0].disabled, true);

    const manager = getModule('scripts/preset-manager.js').namespace.getPresetManager('openai');
    manager.updateList('Review generation preset', { extensions: {} });
    await getModule('scripts/openai.js').namespace.getPresetApplicationPromise();
    window.fetch = (url, init) => url === '/api/presets/save'
        ? Promise.resolve(window.Response.json({ name: 'Review generation preset' }))
        : original(url, init);
    await executeSlashCommandsWithOptions('/regex-preset Next');
    await manager.writePresetExtensionField({
        path: 'regex_scripts',
        value: [{ ...script, id: 'review-preset-extra', scriptName: 'Review preset extra', disabled: false }],
    });

    let confirmations = 0;
    getModule('scripts/popup.js').namespace.Popup.show.confirm = async () => {
        confirmations++;
        return false;
    };
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const selectedSaved = new Promise(resolve => {
        const listener = () => {
            const payload = JSON.parse(fixture.backend.handle({ method: 'POST', url: '/api/settings/get', body: '{}' }).body);
            const saved = JSON.parse(payload.settings);
            if (saved.extension_settings.regex_presets.find(preset => preset.id === 'review-current')?.isSelected) {
                eventSource.removeListener(event_types.SETTINGS_UPDATED, listener);
                resolve();
            }
        };
        eventSource.on(event_types.SETTINGS_UPDATED, listener);
    });
    select.value = 'review-current';
    select.dispatchEvent(new window.Event('change'));
    await selectedSaved;
    assert.equal(confirmations, 1, 'A newly enabled preset script is an unsaved regex-preset change before switching');
});

test('Web Host stream reads replay an unacknowledged cursor and cancellation releases a blocked read', async context => {
    const { window, fixture } = await createBrowserRuntime();
    context.after(() => window.happyDOM.close());
    const handle = fixture.backend.handle.bind(fixture.backend);
    const cancelled = Promise.withResolvers();
    let producer;
    fixture.backend.handle = request => request.url === '/api/backends/chat-completions/generate'
        ? { status: 200, headers: { 'content-type': 'text/event-stream' }, body: new ReadableStream({
            start(controller) { producer = controller; },
            cancel() { cancelled.resolve(); },
        }) }
        : handle(request);
    const invoke = window.__TAURI__.core.invoke;
    await invoke('start_chat_completion_stream', { streamId: 'replay', dto: {} });
    const first = invoke('read_chat_completion_stream', { streamId: 'replay', afterSeq: 0 });
    producer.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
    const batch = await first;
    assert.equal(batch.events[0].seq, 1);
    assert.equal(batch.events[0].data, '{"choices":[]}');
    assert.deepEqual(await invoke('read_chat_completion_stream', { streamId: 'replay', afterSeq: 0 }), batch);
    const blocked = invoke('read_chat_completion_stream', { streamId: 'replay', afterSeq: 1 });
    await invoke('close_chat_completion_stream', { streamId: 'replay' });
    assert.equal((await blocked).status, 'cancelled');
    await cancelled.promise;
});
