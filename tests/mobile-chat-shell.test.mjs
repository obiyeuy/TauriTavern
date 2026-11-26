import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { installMobileChatShell } from '../src/scripts/mobile-chat-shell.js';
import { renderSettingsPage } from '../src/scripts/mobile-settings-page.js';
import { connectionPage, formattingPage, generationPage, personaPage, worldInfoPage } from '../src/scripts/mobile-settings-schema.js';

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

test('Telegram 抽屉提供账户、当前会话和主题入口', async () => {
    const f = await fixture();
    const drawer = f.document.querySelector('#tt-chat-tabs');
    assert.ok(drawer.querySelector('#tt-nav-profile'));
    assert.ok(drawer.querySelector('#tt-nav-chat'));
    assert.ok(drawer.querySelector('#tt-nav-theme'));
    drawer.querySelector('#tt-nav-theme').click();
    assert.equal(f.document.body.dataset.ttColorScheme, 'night');
    assert.equal(drawer.querySelector('#tt-nav-theme').getAttribute('aria-pressed'), 'true');
    drawer.querySelector('#tt-nav-theme').click();
    assert.equal(f.document.body.dataset.ttColorScheme, 'day');
    assert.equal(drawer.querySelector('[data-tt-route="history"]'), null, 'History belongs to the chat menu, not the drawer');
    assert.ok(drawer.querySelector('[data-tt-shortcut="WorldInfo"]'));
    assert.match(drawer.querySelector('#tt-nav-chat-name').textContent, /角色甲/);
    f.shell.dispose();
});

test('列表搜索收在顶栏，返回先退出搜索并清空原生筛选', async context => {
    const f = await fixture();
    context.after(async () => {
        f.shell.dispose();
        await f.window.happyDOM.close();
    });
    const field = f.document.createElement('input');
    field.id = 'character_search_bar';
    f.document.body.append(field);
    let inputs = 0;
    field.addEventListener('input', () => inputs++);
    const searchButton = f.document.querySelector('#tt-chat-search');
    assert.equal(f.document.body.dataset.ttRolesSearch, 'false');
    searchButton.click();
    assert.equal(f.document.body.dataset.ttRolesSearch, 'true');
    assert.equal(searchButton.getAttribute('aria-expanded'), 'true');
    const box = f.document.querySelector('#tt-chat-search-input');
    assert.equal(box.hidden, false, 'The query is typed in the app bar');
    assert.equal(f.document.querySelector('#tt-chat-menu').hidden, true);
    box.value = '角色';
    box.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(field.value, '角色', 'The native field stays the query owner');
    for (const flags of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
        box.focus();
        box.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...flags }));
        assert.equal(f.document.activeElement === box, true, 'Confirming an IME candidate must retain search focus');
        box.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...flags }));
        assert.equal(f.document.body.dataset.ttRolesSearch, 'true', 'IME cancellation must not close role search');
        assert.equal(field.value, '角色', 'IME cancellation must retain the native query');
    }
    assert.equal(f.shell.back(), true, 'Back closes search before leaving the list root');
    assert.equal(f.document.body.dataset.ttRolesSearch, 'false');
    assert.equal(field.value, '');
    assert.equal(box.value, '');
    assert.equal(inputs, 2, 'Typing and clearing each re-run the native filter once');
    assert.equal(f.shell.back(), false);
});

test('聊天菜单和设置返回到打开它们的页面，关闭菜单不改变聊天', async context => {
    const f = await fixture();
    context.after(async () => {
        f.shell.dispose();
        await f.window.happyDOM.close();
    });
    f.changeChat('角色甲');
    f.document.querySelector('#tt-chat-more').click();
    const actions = f.document.querySelector('#tt-chat-actions');
    assert.equal(actions.hidden, false);
    const last = actions.querySelector('button:last-child');
    last.focus();
    for (const flags of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
        last.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, ...flags }));
        assert.equal(f.document.activeElement === last, true, 'IME candidate navigation must not move the menu selection');
        last.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...flags }));
        assert.equal(actions.hidden, false, 'IME cancellation must not close the menu');
    }
    const legacyEscapesBeforeClose = f.getLegacyEscapes();
    last.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(f.document.activeElement === actions.querySelector('button'), true);
    actions.querySelector('button').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert.equal(f.document.activeElement === actions.querySelectorAll('button')[1], true);
    f.document.activeElement.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(f.getLegacyEscapes(), legacyEscapesBeforeClose, 'Closing the menu consumes Escape before legacy drawer hotkeys');
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

test('手机设置页只读写原生控件，并用原生事件触发保存', () => {
    const window = new Window();
    const document = window.document;
    document.body.innerHTML = `<label><input type="checkbox" id="flag">原生开关</label>
        <select id="pick"><option value="a">甲</option><option value="b">乙</option></select>
        <input type="range" id="size" min="1" max="9" value="3"><input type="number" id="size_counter" value="3">`;
    const events = [];
    for (const id of ['flag', 'pick', 'size']) {
        document.getElementById(id).addEventListener('change', () => events.push(`${id}:change`));
        document.getElementById(id).addEventListener('input', () => events.push(`${id}:input`));
    }
    let nativeOpened = 0;
    const page = renderSettingsPage({
        document,
        schema: { sections: [{ title: '组', rows: [{ id: 'flag' }, { id: 'pick', label: '选择' }, { id: 'size', label: '大小' }, { id: 'missing' }] }] },
        openNative: () => { nativeOpened++; },
    });
    document.body.append(page.element);
    const rows = page.element.querySelectorAll('.tt-sp-group:first-child .tt-sp-row');
    assert.equal(rows.length, 3, 'Rows for absent native controls are skipped');
    assert.match(rows[0].textContent, /原生开关/, 'Checkbox rows reuse the native label');
    rows[0].click();
    assert.equal(document.getElementById('flag').checked, true);
    assert.equal(rows[0].getAttribute('aria-checked'), 'true');
    assert.match(rows[1].textContent, /甲/);
    rows[1].click();
    const options = page.element.querySelectorAll('.tt-sp-option');
    assert.equal(options.length, 2);
    options[1].click();
    assert.equal(document.getElementById('pick').value, 'b');
    assert.match(rows[1].textContent, /乙/);
    assert.equal(page.closeSheet(), false, 'Choosing an option closes the sheet');
    const range = rows[2].querySelector('input');
    Object.assign(document.getElementById('size'), { min: '2', max: '100', step: '0.5' });
    page.refresh();
    assert.deepEqual([range.min, range.max, range.step], ['2', '100', '0.5'],
        'A native model or setting update changes the mobile slider constraints too');
    range.value = '7';
    range.dispatchEvent(new window.Event('input'));
    range.dispatchEvent(new window.Event('change'));
    assert.equal(document.getElementById('size').value, '7');
    assert.deepEqual(events, ['flag:input', 'flag:change', 'pick:input', 'pick:change', 'size:input', 'size:change']);
    page.element.querySelector('.tt-sp-link').click();
    assert.equal(nativeOpened, 1, 'All settings still reaches the native panel');
    page.dispose();
});

test('设置弹窗保留键盘焦点，Escape 只关闭当前编辑器', async context => {
    const window = new Window();
    context.after(() => window.happyDOM.close());
    const document = window.document;
    document.body.innerHTML = '<button id="outside">外部按钮</button><input id="name" value="原文">';
    let escaped = 0;
    document.addEventListener('keydown', event => { if (event.key === 'Escape') escaped++; });
    const page = renderSettingsPage({
        document, schema: { sections: [{ title: '组', rows: [{ id: 'name', label: '名称' }] }] },
    });
    context.after(() => page.dispose());
    document.body.append(page.element);
    const row = page.element.querySelector('.tt-sp-row');
    row.click();
    const dialog = page.element.querySelector('[role="dialog"]');
    const field = page.element.querySelector('.tt-sp-field');
    const submit = page.element.querySelector('.tt-sp-actions button:last-child');
    submit.focus();
    submit.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.ok(document.activeElement === field, 'Tab from the last dialog control returns to its first field');
    assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, '名称');
    field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(page.element.querySelector('.tt-sp-sheet').hidden, true);
    assert.ok(document.activeElement === row, 'Closing restores the control that opened the editor');
    assert.equal(escaped, 0, 'The same Escape cannot also close the underlying native panel');
    assert.equal(document.getElementById('name').value, '原文');
});

test('设置页重新分组后焦点仍回到原生来源对应的行', context => {
    const window = new Window();
    context.after(() => window.happyDOM.close());
    const document = window.document;
    document.body.innerHTML = '<select id="source"><option value="a">API A</option><option value="b">API B</option></select><input id="a" value="地址A"><input id="b" value="地址B">';
    const page = renderSettingsPage({
        document, schema: { sections: () => [{ title: '连接', rows: [
            { id: 'source', label: '来源' }, { id: document.getElementById('source').value },
        ] }] },
    });
    context.after(() => page.dispose());
    document.body.append(page.element);
    page.element.querySelector('.tt-sp-select').click();
    [...page.element.querySelectorAll('.tt-sp-option')].find(option => option.textContent.includes('API B')).click();
    page.refresh();
    const sourceRow = page.element.querySelector('.tt-sp-select');
    assert.ok(document.activeElement === sourceRow, 'Native form regrouping keeps focus on its replacement source row');
    assert.match(sourceRow.textContent, /API B/);
});

test('原生编辑入口和手机概览使用同一个侧栏当前项', async context => {
    const window = new Window({ width: 1024, height: 768 });
    context.after(() => window.happyDOM.close());
    const document = window.document;
    document.body.innerHTML = '<main id="sheld"></main><input id="lore">';
    const shell = installMobileChatShell({
        document, getChat: () => ({ title: '', status: '' }), busy: () => '',
        closePanels: () => {}, showCharacters: async () => {}, showPanel: async () => {},
        subscribeChatChanged: () => () => {},
        settingsPages: { WorldInfo: { sections: [{ title: '世界书', rows: [{ id: 'lore' }] }] } },
    });
    context.after(() => shell.dispose());
    await shell.ready;
    await shell.openPanel('WorldInfo', '世界书');
    assert.equal(document.querySelector('[data-tt-shortcut="WorldInfo"]').getAttribute('aria-current'), 'page');
    await shell.openPanel('native:WorldInfo', '世界书');
    assert.equal(document.querySelector('[data-tt-shortcut="WorldInfo"]').getAttribute('aria-current'), 'page',
        'The full native editor remains the same sidebar destination');
    assert.equal(document.querySelector('[data-tt-route="more"]').hasAttribute('aria-current'), false);
});

test('数字编辑打开后原生范围改变时，保存按最新范围拒绝越界并保留草稿', async context => {
    const window = new Window();
    context.after(() => window.happyDOM.close());
    const document = window.document;
    document.body.innerHTML = '<input type="range" id="context" min="512" max="8192" step="1" value="4096">';
    const stored = [];
    const page = renderSettingsPage({
        document, schema: { sections: [{ title: '参数', rows: [{ id: 'context' }] }] },
        save: element => { stored.push(Number(element.value)); },
    });
    context.after(() => page.dispose());
    document.body.append(page.element);
    page.element.querySelector('.tt-sp-slider button').click();
    const native = document.getElementById('context');
    const editor = page.element.querySelector('.tt-sp-field');
    native.max = '2048';
    native.value = '1536';
    page.refresh();
    page.element.querySelector('.tt-sp-actions button:last-child').click();
    await window.happyDOM.waitUntilComplete();
    assert.deepEqual(stored, [], 'The editor cannot silently save the native range’s clamped value');
    assert.equal(native.value, '1536');
    assert.equal(editor.value, '4096', 'Invalid input remains visible for correction');
    assert.equal(editor.validity.rangeOverflow, true);
    assert.equal(page.element.querySelector('.tt-sp-sheet').hidden, false);
    editor.value = '1800';
    page.element.querySelector('.tt-sp-actions button:last-child').click();
    await window.happyDOM.waitUntilComplete();
    assert.deepEqual(stored, [1800]);
    assert.equal(page.element.querySelector('.tt-sp-sheet').hidden, true);
});

test('选项搜索无结果时明确提示并保留当前选择', context => {
    const window = new Window();
    context.after(() => window.happyDOM.close());
    const document = window.document;
    const select = document.createElement('select');
    select.id = 'model';
    for (let index = 0; index < 12; index++) {
        const option = document.createElement('option');
        option.textContent = `model-${index}`;
        option.value = String(index);
        select.append(option);
    }
    select.value = '4';
    document.body.append(select);
    const page = renderSettingsPage({
        document, schema: { sections: [{ title: '模型', rows: [{ id: 'model' }] }] },
    });
    context.after(() => page.dispose());
    document.body.append(page.element);
    page.element.querySelector('.tt-sp-row').click();
    const filter = page.element.querySelector('.tt-sp-filter');
    filter.value = 'missing-model';
    filter.dispatchEvent(new window.Event('input', { bubbles: true }));
    const result = page.element.querySelector('.tt-sp-options-empty');
    assert.ok(result && !result.hidden && result.textContent, 'An empty option list explains that the search found nothing');
    assert.equal(select.value, '4');
    filter.value = 'model-11';
    filter.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(result.hidden, true);
    assert.equal(page.element.querySelectorAll('.tt-sp-option:not([hidden])').length, 1);
    page.element.querySelector('.tt-sp-actions button').click();
    assert.equal(page.element.querySelector('.tt-sp-sheet').hidden, true, 'The picker has a visible close control');
    assert.equal(select.value, '4');
});

test('纯换行模板的摘要可见，编辑保存仍保留原始字符', context => {
    const window = new Window();
    context.after(() => window.happyDOM.close());
    const document = window.document;
    const suffix = document.createElement('textarea');
    suffix.id = 'suffix';
    suffix.value = '\n\n';
    document.body.append(suffix);
    const page = renderSettingsPage({
        document, schema: { sections: [{ title: '模板', rows: [{ id: 'suffix', label: '后缀' }] }] },
    });
    context.after(() => page.dispose());
    document.body.append(page.element);
    const row = page.element.querySelector('.tt-sp-row');
    assert.match(row.textContent, /\\n\\n/, 'Newline-only content has a readable escaped preview');
    row.click();
    const editor = page.element.querySelector('.tt-sp-field');
    assert.equal(editor.value, '\n\n', 'Escaped previews do not change the text being edited');
    editor.value = '\n\t\n';
    page.element.querySelector('.tt-sp-actions button:last-child').click();
    assert.equal(suffix.value, '\n\t\n');
    assert.match(row.textContent, /\\n\\t\\n/);
});

test('慢设置页准备和取消期间不呈现上一页的可编辑内容', async context => {
    const window = new Window();
    context.after(() => window.happyDOM.close());
    const document = window.document;
    document.body.innerHTML = '<main id="sheld"></main><input id="old" value="上一页"><input id="new" value="新页">';
    const entered = Promise.withResolvers();
    const pending = Promise.withResolvers();
    context.after(() => pending.resolve());
    const shell = installMobileChatShell({
        document, getChat: () => ({ title: '', status: '' }), busy: () => '',
        closePanels: () => {}, showCharacters: async () => {}, showPanel: async () => {},
        subscribeChatChanged: () => () => {},
        settingsPages: {
            old: { sections: [{ title: '旧页', rows: [{ id: 'old' }] }] },
            new: { sections: [{ title: '新页', rows: [{ id: 'new' }] }] },
        },
        preparePage: async id => {
            if (id === 'new') { entered.resolve(); await pending.promise; }
        },
    });
    context.after(() => shell.dispose());
    await shell.ready;
    await shell.openPanel('old', '旧页');
    const loading = shell.openPanel('new', '新页');
    await entered.promise;
    const page = document.getElementById('tt-settings-page');
    assert.equal(page.querySelectorAll('.tt-sp-row').length, 0, 'A new title cannot describe still-editable fields from the previous page');
    await shell.navigate('more');
    pending.resolve();
    await loading;
    assert.equal(document.body.dataset.ttChatView, 'more');
    assert.equal(page.querySelectorAll('.tt-sp-row').length, 0, 'Cancelled page preparation cannot publish a late editor');
});

test('连接页只列出当前来源显示的字段，密钥不回显，按钮点击原生连接', () => {
    const window = new Window();
    const document = window.document;
    document.body.innerHTML = `
        <select id="main_api"><option value="openai">Chat</option><option value="novel">Novel</option></select>
        <div id="openai_api">
            <select id="chat_completion_source"><option value="custom">Custom</option><option value="claude">Claude</option></select>
            <div data-source="custom"><h4 id="url_label">接口地址</h4><input id="custom_api_url_text" aria-labelledby="url_label" value="http://localhost:1234/v1"></div>
            <div data-source="claude" style="display: none"><input id="api_key_claude" aria-label="Claude 密钥"></div>
            <h4 id="key_label">自定义密钥</h4><input id="api_key_custom" aria-labelledby="key_label" value="sk-secret">
            <div id="api_button_openai">连接</div><div id="test_api_button">测试</div>
            <div class="online_status"><span class="online_status_text">未连接</span></div>
        </div>
        <div id="novel_api" style="display: none"><input id="api_key_novel"><div id="api_button_novel">连接</div></div>`;
    let connects = 0;
    document.getElementById('api_button_openai').addEventListener('click', () => {
        connects++;
        document.querySelector('#openai_api .online_status_text').textContent = '有效';
    });
    const page = renderSettingsPage({ document, schema: connectionPage });
    document.body.append(page.element);
    const text = () => page.element.textContent;
    assert.match(text(), /接口地址/);
    assert.match(text(), /localhost:1234/);
    assert.doesNotMatch(text(), /Claude 密钥/, 'Fields of other sources stay hidden');
    assert.doesNotMatch(text(), /sk-secret/, 'Keys are never echoed back');
    assert.match(text(), /未连接/);
    [...page.element.querySelectorAll('.tt-sp-action')].find(row => /Connect/.test(row.textContent)).click();
    assert.equal(connects, 1);
    assert.match(text(), /有效/, 'Status follows the native indicator');
    document.getElementById('main_api').value = 'novel';
    page.refresh();
    assert.ok(page.element.querySelector('.tt-sp-text'), 'Switching API rebuilds the rows');
    assert.doesNotMatch(text(), /接口地址/);
    page.dispose();
});

test('设置编辑保留输入约束和说明，等待保存确认，失败后可重试', async context => {
    const window = new Window();
    context.after(() => window.happyDOM.close());
    const document = window.document;
    document.body.innerHTML = `<input id="endpoint" type="url" required inputmode="url" aria-describedby="endpoint_help" value="https://example.com/v1">
        <p id="endpoint_help">填写服务商的 Base URL，保留 /v1。</p>
        <input id="key" type="text" data-tt-sensitive data-secret-saved="true" aria-label="API Key">`;
    const saved = Promise.withResolvers();
    let attempts = 0;
    const page = renderSettingsPage({ document, schema: { sections: [{ title: '连接', rows: [
        { id: 'endpoint', label: '地址' }, { id: 'key', label: 'API Key' },
    ] }] }, save: () => ++attempts === 1 ? saved.promise : Promise.resolve() });
    document.body.append(page.element);
    const key = page.element.querySelectorAll('.tt-sp-row')[1];
    assert.match(key.textContent, /Saved/, 'A stored key stays visibly saved when its plaintext field is empty');
    page.element.querySelector('.tt-sp-text').click();
    const field = page.element.querySelector('.tt-sp-field');
    assert.equal(field.tagName, 'TEXTAREA', 'Long service addresses wrap instead of hiding their beginning');
    assert.equal(field.required, true);
    assert.equal(field.inputMode, 'url');
    assert.match(document.getElementById(field.getAttribute('aria-describedby')).textContent, /Base URL/);
    assert.equal(field.selectionStart, 0, 'Long addresses open at their beginning');
    field.value = 'invalid address';
    const submit = [...page.element.querySelectorAll('.tt-sp-actions button')].find(button => button.textContent === 'Save');
    submit.click();
    assert.equal(attempts, 0, 'Invalid inputs never reach the native save');
    field.value = 'https://example.com/new/v1';
    submit.click();
    assert.equal(submit.disabled, true);
    assert.equal(page.element.querySelector('.tt-sp-sheet').hidden, false, 'The editor stays open until persistence acknowledges');
    saved.reject(new Error('Disk unavailable'));
    await window.happyDOM.waitUntilComplete();
    assert.match(page.element.querySelector('[role="alert"]').textContent, /Disk unavailable/);
    assert.equal(field.value, 'https://example.com/new/v1', 'A failed save keeps the draft');
    assert.equal(submit.disabled, false);
    submit.click();
    await window.happyDOM.waitUntilComplete();
    assert.equal(page.element.querySelector('.tt-sp-sheet').hidden, true);
    key.click();
    assert.equal(page.element.querySelector('.tt-sp-field').type, 'password', 'Credential editors mask new input');
    page.dispose();
});

test('设置选择等待保存确认，失败后保留选择并允许重试', async context => {
    const window = new Window();
    context.after(() => window.happyDOM.close());
    const document = window.document;
    document.body.innerHTML = `<select id="source">
        <option value="custom">OpenAI-compatible</option>
        <option value="custom_openai_responses" selected>OpenAI Responses</option>
    </select>`;
    const pending = Promise.withResolvers();
    context.after(() => pending.resolve());
    const saved = [];
    const page = renderSettingsPage({
        document,
        schema: { sections: [{ title: 'Connection', rows: [{ id: 'source' }] }] },
        save: element => {
            saved.push(element.value);
            return saved.length === 1 ? pending.promise : Promise.resolve();
        },
    });
    document.body.append(page.element);
    page.element.querySelector('.tt-sp-row').click();
    const compatible = page.element.querySelector('.tt-sp-option');
    compatible.click();
    assert.deepEqual(saved, ['custom'], 'Selecting a protocol must reach the shared save boundary');
    assert.equal(document.getElementById('source').value, 'custom');
    assert.equal(page.element.querySelector('.tt-sp-sheet').hidden, false,
        'The choice stays open while its save is unconfirmed');
    assert.equal(compatible.disabled, true);
    pending.reject(new Error('Storage unavailable'));
    await window.happyDOM.waitUntilComplete();
    assert.match(page.element.querySelector('[role="alert"]').textContent, /Storage unavailable/);
    assert.equal(page.element.querySelector('.tt-sp-sheet').hidden, false);
    assert.equal(compatible.disabled, false);
    compatible.click();
    await window.happyDOM.waitUntilComplete();
    assert.deepEqual(saved, ['custom', 'custom'], 'Retry saves the selected value without another edit');
    assert.equal(page.element.querySelector('.tt-sp-sheet').hidden, true);
    page.dispose();
});

test('选项保留允许的空值与原生说明，高级字段按组折叠', context => {
    const window = new Window();
    context.after(() => window.happyDOM.close());
    const document = window.document;
    document.body.innerHTML = '<select id="option"><option value="">自动</option><option value="manual" selected>手动</option></select>';
    const page = renderSettingsPage({ document, schema: { sections: [{ title: '高级选项', collapsed: true, rows: [
        { id: 'option', help: '自动使用服务商默认行为。' },
    ] }] } });
    document.body.append(page.element);
    const details = page.element.querySelector('details');
    assert.ok(details);
    assert.equal(details.open, false);
    page.element.querySelector('.tt-sp-row').click();
    const options = page.element.querySelectorAll('.tt-sp-option');
    assert.equal(options.length, 2, 'Empty value may be a real automatic choice');
    options[0].click();
    assert.equal(document.getElementById('option').value, '');
    assert.match(page.element.querySelector('.tt-sp-row').textContent, /自动/);
    page.dispose();
});

test('生成参数页跟随当前 API，只列出显示的参数，不重复滑块数字框', () => {
    const window = new Window();
    const document = window.document;
    document.body.innerHTML = `
        <select id="main_api"><option value="openai">Chat</option><option value="textgenerationwebui">Text</option></select>
        <div id="left-nav-panel">
            <div id="openai_api-presets"><select id="settings_preset_openai" data-preset-manager-for="openai"><option>默认</option></select>
                <div id="update_oai_preset">更新</div><div id="new_oai_preset">另存</div></div>
            <div id="textgenerationwebui_api-presets" style="display: none"><select id="settings_preset_textgenerationwebui" data-preset-manager-for="textgenerationwebui"></select></div>
            <div id="common-gen-settings-block"><span id="ctx_label">上下文长度</span>
                <input type="range" id="max_context" aria-labelledby="ctx_label" min="512" max="8192" value="4096">
                <input type="number" id="max_context_counter" data-for="max_context" value="4096"></div>
            <div id="range_block_openai"><span id="temp_label">温度</span>
                <input type="range" id="temp_openai" aria-labelledby="temp_label" min="0" max="2" step="0.01" value="1">
                <input type="number" id="temp_counter_openai" data-for="temp_openai" value="1">
                <div data-source="claude" style="display: none"><input type="range" id="top_k_openai" aria-label="Top K"></div></div>
            <div id="range_block_textgenerationwebui" style="display: none"><input type="range" id="temp_textgenerationwebui" aria-label="文本温度"></div>
            <div id="openai_settings"><label><input type="checkbox" id="stream_toggle">流式</label></div>
        </div>`;
    const page = renderSettingsPage({ document, schema: generationPage });
    document.body.append(page.element);
    const text = page.element.textContent;
    for (const shown of ['Preset', 'Update current preset', 'Save preset as', '上下文长度', '温度', '流式']) assert.match(text, new RegExp(shown));
    assert.doesNotMatch(text, /Top K/, 'Samplers of other sources stay hidden');
    assert.doesNotMatch(text, /文本温度/, 'Blocks of other APIs stay hidden');
    assert.equal(page.element.querySelectorAll('.tt-sp-slider').length, 2, 'Number boxes mirroring sliders are not separate rows');
    assert.match(page.element.querySelector('.tt-sp-slider .tt-sp-value').textContent, /4096/);
    page.dispose();
});

test('高级格式页按原生分组列出模板，隐藏原生藏起的字段，模板按钮点击原生按钮', () => {
    const window = new Window();
    const document = window.document;
    document.body.innerHTML = `<div id="AdvancedFormatting">
        <select id="context_presets"><option>Default</option><option>ChatML</option></select>
        <i data-preset-manager-update="context">保存</i>
        <textarea id="context_story_string">{{description}}</textarea>
        <label><input type="checkbox" id="trim_spaces">修剪空格</label>
        <div style="display: none"><label><input type="checkbox" id="instruct_wrap">换行包裹</label></div>
    </div>`;
    let saved = 0;
    document.querySelector('[data-preset-manager-update="context"]').addEventListener('click', () => { saved++; });
    const page = renderSettingsPage({ document, schema: formattingPage });
    document.body.append(page.element);
    const text = page.element.textContent;
    assert.match(text, /Context Template/);
    assert.match(text, /Template.*Default/);
    assert.match(text, /\{\{description\}\}/, 'Template text is previewed');
    assert.match(text, /修剪空格/);
    assert.doesNotMatch(text, /换行包裹/, 'Fields the native panel hides stay hidden');
    [...page.element.querySelectorAll('.tt-sp-action')].find(row => /Update current template/.test(row.textContent)).click();
    assert.equal(saved, 1);
    const editor = [...page.element.querySelectorAll('.tt-sp-text')].find(row => /Story String/.test(row.textContent));
    editor.click();
    const field = page.element.querySelector('textarea.tt-sp-field');
    field.value = '{{persona}}';
    [...page.element.querySelectorAll('.tt-sp-actions button')].find(b => /Save/.test(b.textContent)).click();
    assert.equal(document.getElementById('context_story_string').value, '{{persona}}');
    page.dispose();
});

test('用户设定页把原生卡片列成会话式行，点击即选择，当前设定带勾', () => {
    const window = new Window();
    const document = window.document;
    document.body.innerHTML = `<div id="PersonaManagement">
        <div id="user_avatar_block">
            <div class="avatar-container selected" data-avatar-id="a.png"><img src="/a.png"><span class="ch_name">旅人</span><div class="ch_description">走过很多地方</div></div>
            <div class="avatar-container" data-avatar-id="b.png"><img src=""><span class="ch_name">夜读</span><div class="ch_description"></div></div>
        </div>
        <button id="create_dummy_persona">新建</button>
        <h5 id="your_name">旅人</h5><button id="persona_rename_button"></button>
        <textarea id="persona_description">走过很多地方</textarea>
    </div>`;
    const picked = [];
    for (const card of document.querySelectorAll('.avatar-container')) {
        card.addEventListener('click', () => {
            picked.push(card.dataset.avatarId);
            for (const other of document.querySelectorAll('.avatar-container')) other.classList.toggle('selected', other === card);
        });
    }
    const page = renderSettingsPage({ document, schema: personaPage });
    document.body.append(page.element);
    const rows = page.element.querySelectorAll('.tt-sp-pick');
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent, /旅人/);
    assert.match(rows[0].textContent, /走过很多地方/);
    assert.equal(rows[0].getAttribute('aria-current'), 'true');
    assert.equal(rows[1].querySelector('.tt-sp-avatar').textContent, '夜', 'Personas without an image show an initial');
    rows[1].click();
    assert.deepEqual(picked, ['b.png']);
    assert.equal(rows[1].getAttribute('aria-current'), 'true');
    assert.equal(rows[0].getAttribute('aria-current'), 'false');
    assert.match(page.element.textContent, /Create a dummy persona/);
    assert.match(page.element.textContent, /Rename Persona/);
    page.dispose();
});

test('世界信息页的多选框逐项切换启用的世界书，选择框保持打开', () => {
    const window = new Window();
    const document = window.document;
    document.body.innerHTML = `<div id="WorldInfo">
        <select id="world_info" multiple><option value="">-- 无 --</option><option value="0" selected>森林</option><option value="1">海岸</option></select>
        <select id="world_editor_select"><option value="0">森林</option></select>
        <div id="world_popup_new">新条目</div>
    </div>`;
    let changes = 0;
    document.getElementById('world_info').addEventListener('change', () => { changes++; });
    const page = renderSettingsPage({ document, schema: worldInfoPage, openNative() {} });
    document.body.append(page.element);
    const row = [...page.element.querySelectorAll('.tt-sp-row')].find(node => /Active lorebooks/.test(node.textContent));
    assert.match(row.textContent, /森林/);
    row.click();
    const options = page.element.querySelectorAll('.tt-sp-option');
    assert.equal(options.length, 2, 'The empty placeholder option is not offered');
    assert.equal(options[0].getAttribute('role'), 'checkbox');
    options[1].click();
    assert.equal(document.querySelector('#world_info option[value="1"]').selected, true);
    assert.equal(document.querySelector('#world_info option[value="0"]').selected, true, 'Other lorebooks stay active');
    assert.equal(changes, 1);
    assert.equal(page.closeSheet(), true, 'The sheet stays open for more choices');
    assert.match(row.textContent, /森林, 海岸/);
    assert.match(page.element.querySelector('.tt-sp-link').textContent, /Edit entries/);
    page.dispose();
});

test('设置入口打开手机设置页，返回先关闭选项框', async () => {
    const f = await fixture();
    f.shell.dispose();
    const document = f.document;
    document.body.insertAdjacentHTML('beforeend', '<label><input type="checkbox" id="flag">开关</label><select id="pick"><option>甲</option><option>乙</option></select>');
    const calls = [];
    const shell = installMobileChatShell({
        document, getChat: () => ({ title: '', status: '' }), busy: () => '', closePanels() {},
        showCharacters: async () => {}, showHistory: async () => {}, showPanel: async id => calls.push(id),
        notify() {}, subscribeChatChanged: () => () => {},
        settingsPages: { 'user-settings-block': { sections: [{ title: '组', rows: [{ id: 'flag' }, { id: 'pick' }] }] } },
    });
    await shell.ready;
    await shell.navigate('more');
    await shell.openPanel('user-settings-block', '用户设置');
    assert.equal(document.body.dataset.ttChatView, 'page');
    assert.equal(document.querySelector('#tt-settings-page').hidden, false);
    assert.deepEqual(calls, [], 'The native panel is not opened');
    document.querySelectorAll('#tt-settings-page .tt-sp-row')[1].click();
    assert.equal(shell.back(), true);
    assert.equal(document.body.dataset.ttChatView, 'page', 'Back first closes the option sheet');
    document.querySelector('#tt-settings-page .tt-sp-link').click();
    await f.window.happyDOM.waitUntilComplete();
    assert.deepEqual(calls, ['native:user-settings-block']);
    assert.equal(document.body.dataset.ttChatView, 'panel');
    shell.back();
    assert.equal(document.body.dataset.ttChatView, 'page');
    shell.back();
    assert.equal(document.body.dataset.ttChatView, 'more');
    shell.dispose();
    assert.equal(document.querySelector('#tt-settings-page'), null);
});

test('释放界面后恢复原生导航，不遗留订阅或重复节点', async () => {
    const f = await fixture();
    f.shell.dispose();
    assert.ok(!f.document.body.classList.contains('tt-mobile-chat-shell'));
    assert.equal(f.document.querySelector('#tt-chat-tabs'), null);
    assert.equal(f.document.querySelector('#tt-more-panel'), null);
});
