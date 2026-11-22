import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { installMobileChatShell } from '../src/scripts/mobile-chat-shell.js';

async function fixture() {
    const window = new Window({ width: 375, height: 812 });
    const document = window.document;
    document.body.innerHTML = '<div id="top-settings-holder"></div><main id="sheld"><div id="chat"></div><form id="send_form"><textarea id="send_textarea"></textarea></form></main>';
    const calls = [];
    let busy = '';
    let title = '角色甲';
    let chatChanged;
    let panelFailed = false;
    let legacyEscapes = 0;
    document.addEventListener('keydown', event => { if (event.key === 'Escape') legacyEscapes++; });
    const shell = installMobileChatShell({
        document,
        getChat: () => ({ title, status: '连接就绪' }),
        busy: () => busy,
        closePanels: () => calls.push('close'),
        showCharacters: async () => calls.push('roles'),
        showHistory: async () => calls.push('history'),
        showPanel: async (id) => {
            if (id === 'bad' || id === 'retry' && !panelFailed) {
                panelFailed = true;
                throw Error('panel unavailable');
            }
            calls.push(id);
        },
        notify: text => calls.push(text),
        subscribeChatChanged: listener => { chatChanged = listener; return () => { chatChanged = undefined; }; },
    });
    await shell.ready;
    return { window, document, calls, shell, getLegacyEscapes: () => legacyEscapes, setBusy: value => { busy = value; }, changeChat: value => { title = value; chatChanged(); } };
}

test('角色入口与返回共用原生面板，选卡成功后回到聊天', async () => {
    const f = await fixture();
    assert.equal(f.document.body.dataset.ttChatView, 'roles');
    assert.ok(f.calls.includes('roles'));
    assert.equal(f.document.querySelector('#tt-chat-menu').hidden, false);
    assert.equal(f.shell.back(), false, 'The conversation list is the navigation root');
    f.changeChat('角色乙');
    assert.equal(f.document.body.dataset.ttChatView, 'chat');
    assert.match(f.document.querySelector('#tt-chat-title').textContent, /角色乙/);
    assert.equal(f.document.querySelector('#tt-chat-back').hidden, false);
    assert.equal(f.document.querySelector('#tt-chat-menu').hidden, true);
    assert.equal(f.shell.back(), true);
    assert.equal(f.document.body.dataset.ttChatView, 'roles');
    f.shell.dispose();
});

test('生成或保存中拒绝角色和历史跳转，避免丢失当前聊天', async () => {
    const f = await fixture();
    await f.shell.navigate('chat');
    f.calls.length = 0;
    for (const busy of ['正在生成，请先停止生成。', '正在保存，请稍候。']) {
        f.setBusy(busy);
        await f.shell.navigate('roles');
        await f.shell.navigate('history');
    }
    assert.ok(!f.calls.includes('roles'));
    assert.ok(!f.calls.includes('history'));
    assert.equal(f.document.body.dataset.ttChatView, 'chat');
    f.shell.dispose();
});

test('更多保留世界书、导入和原生设置，并提供稳定返回路径', async () => {
    const f = await fixture();
    await f.shell.navigate('more');
    assert.equal(f.document.querySelector('#tt-more-panel').hidden, false);
    assert.ok(f.document.querySelector('[data-tt-panel="WorldInfo"]'));
    assert.ok(f.document.querySelector('[data-tt-panel="rm_extensions_block"]'));
    const search = f.document.querySelector('#tt-settings-search input');
    search.value = 'Regex';
    search.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(f.document.querySelector('[data-tt-panel="WorldInfo"]').hidden, true);
    assert.equal(f.document.querySelector('[data-tt-panel="rm_extensions_block"]').hidden, false);
    search.value = 'no such setting';
    search.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(f.document.querySelector('#tt-settings-empty').hidden, false);
    search.value = '';
    search.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    await f.shell.openPanel('WorldInfo', '世界书');
    assert.equal(f.document.body.dataset.ttChatView, 'panel');
    await f.shell.back();
    assert.equal(f.document.body.dataset.ttChatView, 'more');
    await f.shell.back();
    assert.equal(f.document.body.dataset.ttChatView, 'roles');
    f.shell.dispose();
});

test('Telegram 抽屉提供账户、搜索、当前会话和主题入口', async () => {
    const f = await fixture();
    const drawer = f.document.querySelector('#tt-chat-tabs');
    assert.ok(drawer.querySelector('#tt-nav-profile'));
    assert.ok(drawer.querySelector('#tt-nav-search'));
    assert.ok(drawer.querySelector('#tt-nav-chat'));
    assert.ok(drawer.querySelector('#tt-nav-theme'));

    const search = drawer.querySelector('#tt-nav-search input');
    search.value = 'Chats';
    search.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(drawer.querySelector('[data-tt-route="roles"]').hidden, false);
    assert.equal(drawer.querySelector('[data-tt-route="history"]').hidden, true);
    assert.equal(drawer.querySelector('#tt-nav-chat').hidden, true);
    drawer.querySelector('#tt-nav-theme').click();
    assert.equal(f.document.body.dataset.ttColorScheme, 'night');
    assert.equal(drawer.querySelector('#tt-nav-theme').getAttribute('aria-pressed'), 'true');
    drawer.querySelector('#tt-nav-theme').click();
    assert.equal(f.document.body.dataset.ttColorScheme, 'day');
    search.value = '';
    search.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(drawer.querySelector('[data-tt-route="history"]').hidden, false);
    assert.match(drawer.querySelector('#tt-nav-chat-name').textContent, /角色甲/);
    f.shell.dispose();
});

test('聊天菜单和设置返回到打开它们的页面，关闭菜单不改变聊天', async () => {
    const f = await fixture();
    f.changeChat('角色甲');
    f.document.querySelector('#tt-chat-more').click();
    const actions = f.document.querySelector('#tt-chat-actions');
    assert.equal(actions.hidden, false);
    const last = actions.querySelector('button:last-child');
    last.focus();
    last.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(f.document.activeElement === actions.querySelector('button'), true);
    actions.querySelector('button').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert.equal(f.document.activeElement === actions.querySelectorAll('button')[1], true);
    f.document.activeElement.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(f.getLegacyEscapes(), 0, 'Closing the menu consumes Escape before legacy drawer hotkeys');
    assert.equal(actions.hidden, true);
    f.document.querySelector('#tt-chat-more').click();
    assert.equal(f.shell.back(), true);
    assert.equal(f.document.querySelector('#tt-chat-actions').hidden, true);
    assert.equal(f.document.body.dataset.ttChatView, 'chat');
    await f.shell.navigate('more');
    f.shell.back();
    assert.equal(f.document.body.dataset.ttChatView, 'chat');
    await f.shell.navigate('history');
    f.shell.back();
    assert.equal(f.document.body.dataset.ttChatView, 'chat');
    f.shell.back();
    assert.equal(f.document.body.dataset.ttChatView, 'roles');
    f.shell.dispose();
});

test('原生面板失败时保留更多入口并显示可恢复的错误', async () => {
    const f = await fixture();
    await f.shell.navigate('more');
    await f.shell.openPanel('bad', '测试');
    assert.equal(f.document.body.dataset.ttChatView, 'more');
    assert.match(f.document.querySelector('#tt-chat-feedback').textContent, /panel unavailable/);
    const retryFixture = await fixture();
    await retryFixture.shell.navigate('more');
    await retryFixture.shell.openPanel('retry', 'Retry panel');
    retryFixture.document.querySelector('#tt-chat-feedback button').click();
    await retryFixture.window.happyDOM.waitUntilComplete();
    assert.equal(retryFixture.document.body.dataset.ttChatView, 'panel');
    retryFixture.shell.back();
    assert.equal(retryFixture.document.body.dataset.ttChatView, 'more', 'Successful retry preserves the settings return layer');
    retryFixture.shell.dispose();
    f.shell.dispose();
});

test('抽屉打开时 Tab 将外部焦点带入菜单，返回优先关闭抽屉', async () => {
    const f = await fixture();
    const menu = f.document.querySelector('#tt-chat-menu');
    const drawer = f.document.querySelector('#tt-chat-tabs');
    menu.click();
    menu.focus();
    const tab = new f.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    menu.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, true);
    assert.ok(drawer.contains(f.document.activeElement));
    assert.equal(f.shell.back(), true);
    assert.equal(f.document.body.dataset.ttNavOpen, 'false');
    assert.equal(drawer.inert, true);
    assert.equal(f.document.activeElement, menu);
    f.shell.dispose();
});

test('释放界面后恢复原生导航，不遗留订阅或重复节点', async () => {
    const f = await fixture();
    f.shell.dispose();
    assert.ok(!f.document.body.classList.contains('tt-mobile-chat-shell'));
    assert.equal(f.document.querySelector('#tt-chat-tabs'), null);
    assert.equal(f.document.querySelector('#tt-more-panel'), null);
});
