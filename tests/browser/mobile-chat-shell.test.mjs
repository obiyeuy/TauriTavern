import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRuntime, captureBrowserErrors, createPaginationWaiter } from './runtime.mjs';
import { HOSTS } from '../helpers/host-identity.mjs';

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
    await shell.ready;
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
