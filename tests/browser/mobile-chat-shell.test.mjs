import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRuntime, captureBrowserErrors, createPaginationWaiter } from './runtime.mjs';
import { HOSTS } from '../helpers/host-identity.mjs';

function waitForPreview(window, text) {
    return new Promise(resolve => {
        const observer = new window.MutationObserver(check);
        function check() {
            const preview = [...window.document.querySelectorAll('.tt-chat-preview')].find(node => node.textContent === text);
            if (!preview) return;
            observer.disconnect();
            resolve(preview);
        }
        observer.observe(window.document.getElementById('rm_print_characters_block'), { childList: true, subtree: true });
        check();
    });
}

test('mobile navigation uses native drawers, protects saves and respects dialog back priority', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime({ identity: HOSTS.android });
    context.after(() => window.happyDOM.close());
    // The harness disables CSS and happy-dom reports rects even for hidden
    // nodes. Model only the native overlay roots' initial display here.
    for (const id of ['dialogue_popup', 'shadow_select_chat_popup', 'character_popup',
        'logprobsViewer', 'floatingPrompt', 'cfgConfig', 'dialogue_del_mes']) {
        window.document.getElementById(id).style.display = 'none';
    }
    const clientRects = window.HTMLElement.prototype.getClientRects;
    window.HTMLElement.prototype.getClientRects = function () {
        for (let element = this; element; element = element.parentElement) {
            if (element.hidden || element.style.display === 'none') return [];
        }
        return clientRects.call(this);
    };
    const { failed } = captureBrowserErrors(window);
    await startHost();
    const main = (await load('script.js')).namespace;
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const ready = new Promise(resolve => eventSource.once(event_types.APP_READY, resolve));
    window.jQuery.holdReady(false);
    await Promise.race([ready, failed]);
    const originalFetch = window.fetch;
    window.fetch = async (input, options) => input === '/api/chats/recent'
        ? new window.Response(JSON.stringify([{ avatar: 'Review.png', file_name: 'review-chat.jsonl',
            mes: 'A recent reply. <style>private CSS</style><script>window.BAD_PREVIEW = true</script>',
            last_mes: Date.now(), chat_items: 2 }]))
        : originalFetch(input, options);
    const runtime = (await load('scripts/mobile-chat-shell-runtime.js')).namespace;
    const shell = runtime.installMobileChatShellRuntime();
    const document = window.document;
    const previewReady = waitForPreview(window, 'A recent reply.');
    await shell.ready;
    await previewReady;
    assert.equal(main.this_chid, undefined, 'Mobile startup does not materialize the last character');
    const row = document.querySelector('#rm_print_characters_block .character_select');
    assert.equal(row.querySelector('.tt-chat-preview').textContent, 'A recent reply.');
    assert.ok(row.querySelector('time').dateTime);
    assert.equal(window.BAD_PREVIEW, undefined, 'Conversation previews never execute card markup');
    window.fetch = originalFetch;
    assert.equal(window.__TAURITAVERN_HANDLE_BACK__(), false, 'The list root delegates Back to Android');

    await shell.navigate('roles');
    assert.equal(document.body.dataset.ttChatView, 'roles');
    assert.ok(document.getElementById('right-nav-panel').classList.contains('openDrawer'));
    const selected = new Promise(resolve => eventSource.once(event_types.CHARACTER_SELECTED, resolve));
    document.querySelector('#rm_print_characters_block .character_select').click();
    await selected;
    assert.equal(document.body.dataset.ttChatView, 'chat', 'Choosing a character opens its conversation');
    assert.equal(document.getElementById('tt-chat-back').hidden, false);
    window.jQuery('#options').show();
    assert.equal(window.__TAURITAVERN_HANDLE_BACK__(), true);
    assert.equal(document.body.dataset.ttChatView, 'chat', 'Android Back dismisses composer menus before leaving chat');
    window.jQuery('#options').show();
    document.getElementById('tt-chat-back').click();
    assert.equal(document.body.dataset.ttChatView, 'chat', 'Toolbar Back shares the same overlay priority');
    assert.equal(window.__TAURITAVERN_HANDLE_BACK__(), true);
    assert.equal(document.body.dataset.ttChatView, 'roles');
    await shell.navigate('chat');

    // Panels with a mobile settings page open that page instead of the drawer.
    for (const [id, view] of [['rm_api_block', 'page'], ['right-nav-panel', 'panel']]) {
        const panel = document.getElementById(id);
        const toggle = panel.closest('.drawer').querySelector(':scope > .drawer-toggle');
        await main.doNavbarIconClick.call(toggle);
        assert.equal(document.body.dataset.ttChatView, view, 'Native welcome and drawer shortcuts use the same mobile navigation');
        assert.equal(document.getElementById('tt-chat-back').hidden, false);
        assert.equal(document.getElementById('sheld').inert, true);
        assert.equal(window.__TAURITAVERN_HANDLE_BACK__(), true);
        assert.ok(!panel.classList.contains('openDrawer'));
        await shell.navigate('chat');
    }
    main.setSendButtonState(true);
    await shell.navigate('roles');
    await shell.navigate('history');
    assert.equal(document.body.dataset.ttChatView, 'chat');
    main.setSendButtonState(false);

    for (let i = 0; i < 55; i++) main.characters.push({ ...main.characters[0], name: `Imported ${i}`, avatar: `imported-${i}.png` });
    window.fetch = async (input, options) => input === '/api/chats/recent'
        ? new window.Response(JSON.stringify([{ avatar: 'Review.png', file_name: 'review-chat.jsonl',
            mes: 'Recent content', last_mes: Date.now(), chat_items: 2 }]))
        : originalFetch(input, options);
    await shell.navigate('roles');
    assert.equal(document.querySelector('#rm_print_characters_block .ch_name').textContent, 'Imported 0',
        'Recent message previews respect the native A-Z sorting preference');
    window.fetch = originalFetch;
    await shell.navigate('chat');
    await shell.openPanel('right-nav-panel', 'Character Management');
    const beforePaging = document.querySelector('#rm_print_characters_block').textContent;
    window.jQuery('#rm_print_characters_pagination .paginationjs-size-changer select').val('10').trigger('change');
    window.jQuery('#rm_print_characters_pagination').pagination('go', 2);
    assert.notEqual(document.querySelector('#rm_print_characters_block').textContent, beforePaging,
        'Management pagination owns a live render even after leaving the conversation list');
    main.characters.splice(1);
    main.characters.push({ ...main.characters[0], name: 'Newly imported', avatar: 'new-card.png' });
    await shell.navigate('roles');
    const rendered = createPaginationWaiter(window);
    await rendered(() => main.printCharacters(true));
    assert.match(document.querySelector('#rm_print_characters_block').textContent, /Newly imported/);
    await shell.navigate('more');
    assert.ok(!document.getElementById('right-nav-panel').classList.contains('openDrawer'));
    await shell.openPanel('WorldInfo', 'World Info');
    assert.equal(document.body.dataset.ttChatView, 'page', 'World Info opens its mobile settings page');
    assert.ok(!document.getElementById('WorldInfo').classList.contains('openDrawer'));
    await shell.back();
    // The full native editor is still reachable from the page.
    await shell.openPanel('native:WorldInfo', 'World Info');
    assert.ok(document.getElementById('WorldInfo').classList.contains('openDrawer'));

    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const close = document.createElement('button');
    close.className = 'popup-button-close';
    close.addEventListener('click', () => dialog.remove());
    dialog.append(close);
    document.body.append(dialog);
    assert.equal(window.__TAURITAVERN_HANDLE_BACK__(), true);
    assert.equal(dialog.isConnected, false, 'Android back must close the dialog before its parent page');
    assert.equal(document.body.dataset.ttChatView, 'panel');
    assert.equal(window.__TAURITAVERN_HANDLE_BACK__(), true);
    assert.equal(document.body.dataset.ttChatView, 'more');
    await shell.navigate('chat');

    const pending = Promise.withResolvers();
    const saving = main.enqueueChatSave(() => pending.promise);
    await shell.navigate('roles');
    await shell.navigate('history');
    assert.equal(document.body.dataset.ttChatView, 'chat');
    pending.resolve();
    await saving;
    window.jQuery('#option_settings').trigger('click');
    assert.equal(document.body.dataset.ttChatView, 'more', '/panels opens the same mobile settings navigation');
    assert.notEqual(document.getElementById('top-settings-holder').style.display, 'none');
    await shell.navigate('chat');
    window.jQuery('#option_select_chat').trigger('click');
    assert.equal(document.body.dataset.ttChatView, 'history', 'The composer history shortcut uses the same mobile route');
    assert.equal(document.getElementById('shadow_select_chat_popup').style.display, 'block');
    document.getElementById('select_chat_cross').click();
    assert.equal(document.body.dataset.ttChatView, 'chat', 'Native history close must restore chat navigation');

    const fetch = window.fetch;
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let first = true;
    window.fetch = async (input, options) => {
        if (input === '/api/chats/search') {
            if (first) {
                first = false;
                entered.resolve();
                await release.promise;
                return new window.Response(JSON.stringify([{ file_name: 'stale', preview_message: 'old', message_count: 1, last_mes: '' }]));
            }
            return new window.Response(JSON.stringify([{ file_name: 'fresh', preview_message: 'new', message_count: 1, last_mes: '' }]));
        }
        return fetch(input, options);
    };
    const oldHistory = shell.navigate('history');
    await entered.promise;
    await shell.navigate('chat');
    await shell.navigate('history');
    release.resolve();
    await oldHistory;
    assert.match(document.getElementById('select_chat_div').textContent, /fresh/);
    assert.doesNotMatch(document.getElementById('select_chat_div').textContent, /stale/);
    window.fetch = fetch;
    runtime.disposeMobileChatShellRuntime();
    assert.equal(document.getElementById('tt-chat-tabs'), null);
});

test('mobile navigation renders before slow summaries and chat extension hooks finish', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime({ identity: HOSTS.android });
    context.after(() => window.happyDOM.close());
    for (const id of ['dialogue_popup', 'shadow_select_chat_popup', 'character_popup',
        'logprobsViewer', 'floatingPrompt', 'cfgConfig', 'dialogue_del_mes']) {
        window.document.getElementById(id).style.display = 'none';
    }
    const clientRects = window.HTMLElement.prototype.getClientRects;
    window.HTMLElement.prototype.getClientRects = function () {
        for (let element = this; element; element = element.parentElement) {
            if (element.hidden || element.style.display === 'none') return [];
        }
        return clientRects.call(this);
    };
    await startHost();
    const main = (await load('script.js')).namespace;
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const ready = new Promise(resolve => eventSource.once(event_types.APP_READY, resolve));
    window.jQuery.holdReady(false);
    await ready;

    const runtime = (await load('scripts/mobile-chat-shell-runtime.js')).namespace;
    runtime.disposeMobileChatShellRuntime();
    const shell = runtime.installMobileChatShellRuntime();
    await shell.ready;

    const originalFetch = window.fetch;
    const recentEntered = Promise.withResolvers();
    const recentFinished = Promise.withResolvers();
    const previewUpdated = waitForPreview(window, 'Updated preview');
    context.after(() => recentFinished.resolve());
    window.fetch = async (input, options) => {
        if (input === '/api/chats/recent') {
            recentEntered.resolve();
            await recentFinished.promise;
            return new window.Response(JSON.stringify([{ avatar: 'Review.png', file_name: 'review-chat.jsonl',
                mes: 'Updated preview', last_mes: Date.now(), chat_items: 2 }]));
        }
        return originalFetch(input, options);
    };
    main.characters.push({ ...main.characters[0], name: 'New import', avatar: 'new-import.png' });
    const opening = shell.navigate('roles');
    await recentEntered.promise;
    try {
        assert.match(window.document.getElementById('rm_print_characters_block').textContent, /New import/,
            'Slow history summaries must not hold back the character list');
    } finally {
        recentFinished.resolve();
        await opening;
    }
    await previewUpdated;
    assert.equal(window.document.querySelector('[data-avatar="Review.png"] .tt-chat-preview').textContent, 'Updated preview');
    window.fetch = originalFetch;

    runtime.disposeMobileChatShellRuntime();
    const extensionEntered = Promise.withResolvers();
    const extensionFinished = Promise.withResolvers();
    eventSource.on(event_types.CHARACTER_SELECTED, async () => {
        extensionEntered.resolve();
        await extensionFinished.promise;
    });
    const nextShell = runtime.installMobileChatShellRuntime();
    await nextShell.ready;
    const selectionEvent = eventSource.emit(event_types.CHARACTER_SELECTED, 0);
    await extensionEntered.promise;
    try {
        assert.equal(window.document.body.dataset.ttChatView, 'chat',
            'The chat is visible while extension initialization is still pending');
        await nextShell.navigate('more');
        assert.equal(window.document.body.dataset.ttChatView, 'more');
    } finally {
        extensionFinished.resolve();
        await selectionEvent;
    }
    runtime.disposeMobileChatShellRuntime();
});

test('explicit mobile saves include completed native preset and lorebook selections', async context => {
    const { window, fixture, load, getModule, startHost } = await createBrowserRuntime({ identity: HOSTS.android });
    let runtime;
    context.after(async () => {
        runtime?.disposeMobileChatShellRuntime();
        await window.happyDOM.close();
    });
    const stored = () => JSON.parse(JSON.parse(fixture.backend.handle({
        method: 'POST', url: '/api/settings/get', headers: {}, body: '{}',
    }).body).settings);
    const initialSettings = stored();
    Object.assign(initialSettings.power_user, {
        context_derived: true, instruct_derived: true, quick_continue: false, quick_impersonate: true,
    });
    fixture.backend.handle({
        method: 'POST', url: '/api/settings/save', headers: {}, body: JSON.stringify(initialSettings),
    });
    await startHost();
    const main = (await load('script.js')).namespace;
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const ready = new Promise(resolve => eventSource.once(event_types.APP_READY, resolve));
    window.jQuery.holdReady(false);
    await ready;
    const $ = window.jQuery;
    const openai = getModule('scripts/openai.js').namespace;
    await main.flushPendingSettingsSave(true);
    await main.withConnectionValidationSuspended('Preparing preset fixture', async () => {
        $('#main_api').val('openai');
        await main.changeMainAPI();
        openai.loadOpenAISettings({
            openai_setting_names: ['Before', 'After'],
            openai_settings: [0.7, 1.5].map(temperature => JSON.stringify(openai.getChatCompletionPreset({
                ...openai.oai_settings, temp_openai: temperature,
            }))),
        }, { ...openai.oai_settings, temp_openai: 0.7, preset_settings_openai: 'Before', bind_preset_to_connection: false });
    });
    runtime = (await load('scripts/mobile-chat-shell-runtime.js')).namespace;
    const shell = runtime.installMobileChatShellRuntime();
    await shell.ready;

    await context.test('template derivation switches restore saved values before the first edit', async () => {
        const powerUser = getModule('scripts/power-user.js').namespace.power_user;
        await shell.openPanel('AdvancedFormatting', 'Advanced Formatting');
        const cases = [
            { id: 'context_derived', label: /Choose context template from model metadata|从模型信息选择上下文模板/ },
            { id: 'instruct_derived', label: /Choose instruct template from model metadata|从模型信息选择指导模板/ },
        ];
        for (const { id, label } of cases) {
            const native = window.document.getElementById(id);
            const toggle = [...window.document.querySelectorAll('#tt-settings-page [role="switch"]')]
                .find(button => label.test(button.textContent));
            assert.equal(powerUser[id], true, 'The enabled setting was loaded from storage');
            assert.equal(native.checked, true, 'The native checkbox restores the saved setting before the first click');
            assert.ok(toggle, 'The mobile page exposes the restored template setting');
            assert.equal(toggle.getAttribute('aria-checked'), 'true');
            toggle.click();
            assert.equal(native.checked, false);
            assert.equal(powerUser[id], false, 'The first click disables an already enabled setting');
            assert.equal(toggle.getAttribute('aria-checked'), 'false');
            await main.flushPendingSettingsSave(true);
            assert.equal(stored().power_user[id], false);
        }
    });

    await context.test('quick action switches restore independently and disable on the first click', async () => {
        const powerUser = getModule('scripts/power-user.js').namespace.power_user;
        await shell.openPanel('user-settings-block', 'User Settings');
        assert.equal(powerUser.quick_continue, false);
        assert.equal(powerUser.quick_impersonate, true);
        assert.equal(window.document.getElementById('quick_continue').checked, false);
        const native = window.document.getElementById('quick_impersonate');
        assert.equal(native.checked, true, 'Impersonate restores its own setting rather than the Continue setting');
        const label = native.closest('label').textContent.replace(/\s+/g, ' ').trim();
        const toggle = [...window.document.querySelectorAll('#tt-settings-page [role="switch"]')]
            .find(button => button.textContent === label);
        assert.ok(toggle);
        assert.equal(toggle.getAttribute('aria-checked'), 'true');
        toggle.click();
        assert.equal(powerUser.quick_impersonate, false);
        assert.equal(toggle.getAttribute('aria-checked'), 'false');
        await main.flushPendingSettingsSave(true);
        assert.equal(stored().power_user.quick_impersonate, false);
        assert.equal(stored().power_user.quick_continue, false);
    });

    await context.test('input-method confirmation leaves the settings draft unapplied until normal confirmation', async () => {
        for (const flags of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
            await shell.openPanel('left-nav-panel', 'AI Response Configuration');
            const native = window.document.getElementById('openai_max_context');
            const before = Number(native.value);
            const row = [...window.document.querySelectorAll('#tt-settings-page .tt-sp-slider')]
                .find(row => /Context Size|上下文长度/.test(row.textContent));
            row.querySelector('button').click();
            const editor = window.document.querySelector('#tt-settings-page .tt-sp-field');
            const sheet = window.document.querySelector('#tt-settings-page .tt-sp-sheet');
            const draft = before === 1536 ? 2048 : 1536;
            editor.value = String(draft);
            const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...flags });
            editor.dispatchEvent(enter);
            await main.flushPendingSettingsSave(true);
            assert.equal(Number(native.value), before, 'IME confirmation must not apply the draft to the native control');
            assert.equal(Number(stored().oai_settings.openai_max_context), before, 'Unconfirmed text must not enter persisted settings');
            assert.equal(enter.defaultPrevented, false, 'The input method retains its confirmation keystroke');
            for (const key of ['Escape', 'Tab']) {
                editor.dispatchEvent(new window.KeyboardEvent('keydown', {
                    key, shiftKey: key === 'Tab', bubbles: true, cancelable: true, ...flags,
                }));
                assert.equal(sheet.hidden, false, 'IME navigation or cancellation must keep the draft editor open');
                assert.equal(window.document.activeElement === editor, true, 'The input method retains editor focus');
                assert.equal(editor.value, String(draft));
            }
            const acknowledged = new Promise(resolve => {
                const observer = new window.MutationObserver(() => {
                    if (sheet.hidden) { observer.disconnect(); resolve(); }
                });
                observer.observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
            });
            editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            await acknowledged;
            assert.equal(Number(native.value), draft);
            assert.equal(Number(stored().oai_settings.openai_max_context), draft, 'Normal Enter still reaches the native save boundary');
        }
    });

    await context.test('numeric editing uses native range constraints and persists the actual parameter', async () => {
        await shell.openPanel('left-nav-panel', 'AI Response Configuration');
        const native = window.document.getElementById('openai_max_context');
        const row = [...window.document.querySelectorAll('#tt-settings-page .tt-sp-slider')]
            .find(row => /Context Size|上下文长度/.test(row.textContent));
        assert.ok(row, 'The current API exposes its context limit');
        const value = row.querySelector('button');
        assert.ok(value, 'The slider retains the native form’s direct numeric editing capability');
        value.click();
        const editor = window.document.querySelector('#tt-settings-page .tt-sp-field');
        assert.equal(editor.type, 'number');
        assert.deepEqual([editor.min, editor.max, editor.step], [native.min, native.max, native.step]);
        editor.value = String(Number(native.max) + 1);
        window.document.querySelector('.tt-sp-actions button:last-child').click();
        assert.equal(editor.validity.rangeOverflow, true);
        assert.notEqual(Number(native.value), Number(editor.value));
        editor.value = String(Number(native.min) - 1);
        window.document.querySelector('.tt-sp-actions button:last-child').click();
        assert.equal(editor.validity.rangeUnderflow, true);
        assert.notEqual(Number(native.value), Number(editor.value));
        editor.value = '1536';
        const sheet = window.document.querySelector('.tt-sp-sheet');
        const acknowledged = new Promise(resolve => {
            const observer = new window.MutationObserver(() => {
                if (sheet.hidden) { observer.disconnect(); resolve(); }
            });
            observer.observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
        });
        window.document.querySelector('.tt-sp-actions button:last-child').click();
        await acknowledged;
        assert.equal(Number(native.value), 1536);
        assert.equal(Number(openai.oai_settings.openai_max_context), 1536);
        assert.equal(Number(stored().oai_settings.openai_max_context), 1536);
    });

    await context.test('visible native template toggles remain available and save their real enabled state', async () => {
        const powerUser = getModule('scripts/power-user.js').namespace.power_user;
        await shell.openPanel('AdvancedFormatting', 'Advanced Formatting');
        const native = window.document.getElementById('sysprompt_enabled');
        assert.equal(native.style.display, 'none', 'The native form draws the associated label icon instead of the checkbox');
        const title = native.closest('label').getAttribute('title');
        const toggle = [...window.document.querySelectorAll('#tt-settings-page [role="switch"]')]
            .find(button => button.textContent === title);
        assert.ok(toggle, 'The visible native system prompt toggle is also available on the mobile page');
        const enabled = !native.checked;
        toggle.click();
        assert.equal(native.checked, enabled);
        assert.equal(powerUser.sysprompt.enabled, enabled);
        assert.equal(toggle.getAttribute('aria-checked'), String(enabled));
        await main.flushPendingSettingsSave(true);
        assert.equal(stored().power_user.sysprompt.enabled, enabled);
    });

    await context.test('a preset acknowledgement persists its parameters with its name', async () => {
        await shell.openPanel('left-nav-panel', 'AI Response Configuration');
        window.document.querySelector('#tt-settings-page .tt-sp-select').click();
        const sheet = window.document.querySelector('#tt-settings-page .tt-sp-sheet');
        const entered = Promise.withResolvers();
        const release = Promise.withResolvers();
        const listener = async () => {
            entered.resolve();
            await release.promise;
        };
        eventSource.on(event_types.OAI_PRESET_CHANGED_BEFORE, listener);
        const acknowledged = Promise.withResolvers();
        const observer = new window.MutationObserver(() => {
            if (sheet.hidden) acknowledged.resolve();
        });
        observer.observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
        [...sheet.querySelectorAll('[role="radio"]')].find(option => option.textContent === 'After').click();
        await entered.promise;
        try {
            assert.equal(sheet.hidden, false, 'The editor stays open until the selection and save complete');
            assert.equal(openai.oai_settings.preset_settings_openai, 'Before');
            release.resolve();
            await acknowledged.promise;
            assert.equal(stored().oai_settings.preset_settings_openai, 'After');
            assert.equal(stored().oai_settings.temp_openai, 1.5);
        } finally {
            release.resolve();
            await openai.getPresetApplicationPromise();
            eventSource.removeListener(event_types.OAI_PRESET_CHANGED_BEFORE, listener);
            observer.disconnect();
        }
    });

    await context.test('a lorebook acknowledgement persists the current native selection', async () => {
        const world = getModule('scripts/world-info.js').namespace;
        world.setWorldInfoSettings(
            { ...world.getWorldInfoSettings(), world_info: { globalSelect: [] } },
            { world_names: ['Review lore'] },
        );
        world.flushPendingWorldInfoSettings();
        await main.flushPendingSettingsSave(true);
        window.document.getElementById('world_info').selectedIndex = 0;
        await world.onWorldInfoChange('__notSlashCommand__');
        assert.equal(await main.flushPendingSettingsSave(true), true);
        assert.deepEqual(stored().world_info_settings.world_info.globalSelect, ['Review lore']);
    });
});

test('preset callbacks can save consistent settings and selected preset extension fields', async context => {
    const { window, fixture, load, getModule, startHost } = await createBrowserRuntime({ identity: HOSTS.android });
    context.after(() => window.happyDOM.close());
    await startHost();
    const main = (await load('script.js')).namespace;
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const ready = new Promise(resolve => eventSource.once(event_types.APP_READY, resolve));
    window.jQuery.holdReady(false);
    await ready;
    const openai = getModule('scripts/openai.js').namespace;
    const manager = getModule('scripts/preset-manager.js').namespace.getPresetManager('openai');
    const stored = () => JSON.parse(JSON.parse(fixture.backend.handle({
        method: 'POST', url: '/api/settings/get', headers: {}, body: '{}',
    }).body).settings);
    const presetWrites = new Map();
    const fetch = window.fetch;
    window.fetch = async (url, init) => {
        if (url !== '/api/presets/save') return fetch(url, init);
        const { name, preset } = JSON.parse(init.body);
        presetWrites.set(name, preset);
        return window.Response.json({ name });
    };
    await main.withConnectionValidationSuspended('Preparing preset callback fixture', () => {
        openai.loadOpenAISettings({
            openai_setting_names: ['Before', 'After'],
            openai_settings: [0.7, 1.5].map(temperature => JSON.stringify(openai.getChatCompletionPreset({
                ...openai.oai_settings, temp_openai: temperature, extensions: {},
            }))),
        }, { ...openai.oai_settings, temp_openai: 0.7, preset_settings_openai: 'Before', bind_preset_to_connection: false });
    });

    for (const [phase, event] of [
        ['before', event_types.OAI_PRESET_CHANGED_BEFORE],
        ['after', event_types.OAI_PRESET_CHANGED_AFTER],
        ['changed', event_types.PRESET_CHANGED],
    ]) {
        await context.test(`${phase} callbacks finish their saves without waiting on themselves`, async () => {
            const previousName = openai.oai_settings.preset_settings_openai;
            const previousTemperature = openai.oai_settings.temp_openai;
            let callbackFinished = false;
            let callbackError;
            const listener = async event => {
                try {
                    if (phase === 'before') {
                        await event.savePreset(event.presetName, event.preset, false);
                        assert.equal(presetWrites.get('After').temperature, 1.5,
                            'The public BEFORE save callback accepts the serialized preset');
                    }
                    assert.equal(await main.saveSettings(), true);
                    if (phase === 'before') {
                        assert.equal(stored().oai_settings.preset_settings_openai, previousName);
                        assert.equal(stored().oai_settings.temp_openai, previousTemperature);
                    }
                    await manager.writePresetExtensionField({ path: `callback.${phase}`, value: true });
                    callbackFinished = true;
                } catch (error) {
                    callbackError = error;
                }
            };
            eventSource.on(event, listener);
            try {
                await manager.selectPreset('1');
                assert.ifError(callbackError);
                assert.equal(callbackFinished, true);
                assert.equal(await main.flushPendingSettingsSave(true), true);
                assert.equal(stored().oai_settings.preset_settings_openai, 'After');
                assert.equal(stored().oai_settings.temp_openai, 1.5);
                assert.equal(stored().oai_settings.extensions.callback[phase], true);
                assert.equal(presetWrites.get('After').extensions.callback[phase], true);
                openai.oai_settings.extensions.callback.unsaved = phase;
                assert.equal(manager.getCompletionPresetByName('After').extensions.callback.unsaved, undefined,
                    'Live extension edits do not silently edit the catalogue');
            } finally {
                eventSource.removeListener(event, listener);
            }
        });
    }

    await context.test('a superseded same-name selection cannot overwrite later native edits', async () => {
        const entered = Promise.withResolvers();
        const release = Promise.withResolvers();
        let blocked = false;
        const listener = async event => {
            if (blocked || event.presetName !== 'Before') return;
            blocked = true;
            entered.resolve();
            await release.promise;
        };
        eventSource.on(event_types.OAI_PRESET_CHANGED_BEFORE, listener);
        const earlier = manager.selectPreset('0');
        await entered.promise;
        try {
            await manager.selectPreset('1');
            await manager.selectPreset('0');
            window.jQuery('#temp_openai').val('1.2').trigger('input');
            release.resolve();
            await earlier;
            assert.equal(openai.oai_settings.preset_settings_openai, 'Before');
            assert.equal(openai.oai_settings.temp_openai, 1.2);
        } finally {
            release.resolve();
            await earlier;
            eventSource.removeListener(event_types.OAI_PRESET_CHANGED_BEFORE, listener);
        }
    });

    await context.test('legacy prompt migration saves before the native preset is applied', async () => {
        const catalogue = manager.getCompletionPresetByName('After');
        catalogue.main_prompt = 'Migrated instructions';
        const started = Promise.withResolvers();
        const release = Promise.withResolvers();
        const fetch = window.fetch;
        window.fetch = async (url, init) => {
            if (url === '/api/presets/save') {
                started.resolve();
                await release.promise;
            }
            return fetch(url, init);
        };
        const selecting = manager.selectPreset('1');
        await started.promise;
        try {
            // Drain runnable callbacks while the migration IO alone remains blocked.
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(openai.oai_settings.preset_settings_openai, 'Before');
            release.resolve();
            await selecting;
            assert.equal(openai.oai_settings.temp_openai, 1.5);
            assert.equal(openai.oai_settings.prompts.find(prompt => prompt.identifier === 'main').content,
                'Migrated instructions');
            assert.equal(presetWrites.get('After').temperature, 1.5);
        } finally {
            release.resolve();
            await selecting;
            window.fetch = fetch;
        }
    });
});
