import { mobileChatIcon as icon } from './mobile-chat-icons.js';
import { syncAttribute, syncBooleanProperty, syncText } from './mobile-chat-dom.js';
import { renderSettingsPage } from './mobile-settings-page.js';
import { isComposingKeyboardEvent } from './util/keyboard-event.js';

/**
 * Mobile navigation owns presentation only. Native drawers and chat history own
 * their contents; no character list, settings or chat data is copied here.
 */
export function installMobileChatShell({
    document, getChat, busy, closePanels, showCharacters, showHistory, showPanel,
    notify, subscribeChatChanged, requestBack, translate = text => text, settingsPages = {},
    preparePage = async () => {}, saveSettings,
}) {
    const body = document.body;
    const t = translate;
    const header = document.createElement('header');
    header.id = 'tt-chat-header';
    header.innerHTML = `<button type="button" id="tt-chat-menu" aria-controls="tt-chat-tabs" aria-expanded="false">${icon('menu')}</button>
        <button type="button" id="tt-chat-back">${icon('back')}</button>
        <div id="tt-chat-avatar" aria-hidden="true"></div><div class="tt-chat-heading"><h1 id="tt-chat-title"></h1><span id="tt-chat-subtitle"></span></div>
        <input type="search" id="tt-chat-search-input" autocomplete="off" enterkeyhint="search" hidden>
        <button type="button" id="tt-chat-search" aria-controls="form_character_search_form"></button>
        <button type="button" id="tt-chat-more" aria-haspopup="dialog" aria-controls="tt-chat-actions">${icon('more')}</button>
        <div id="tt-chat-feedback" role="status" hidden><span></span><button type="button"></button></div>`;
    const tabs = document.createElement('nav');
    tabs.id = 'tt-chat-tabs';
    tabs.tabIndex = -1;
    tabs.setAttribute('aria-label', t('Chat navigation'));
    const routes = [
        ['roles', 'Chats', 'chat'], ['chat', 'Current conversation', 'users'],
        ['history', 'History', 'history'], ['more', 'Settings', 'settings'],
    ];
    const routeList = document.createElement('div');
    routeList.className = 'tt-nav-routes';
    // Telegram's drawer lists app-level places. Chat-specific actions (history,
    // new chat) live in the conversation's own menu instead of greyed-out rows.
    const drawerItems = [
        ['route', 'roles', 'Chats', 'chat'],
        ['panel', 'PersonaManagement', 'Persona Management', 'user'],
        ['panel', 'WorldInfo', 'World Info', 'book'],
        ['panel', 'rm_extensions_block', 'Extensions', 'puzzle'],
        ['route', 'more', 'Settings', 'settings'],
    ];
    const shortcutPanels = drawerItems.filter(([kind]) => kind === 'panel').map(([, id]) => id);
    for (const [kind, target, label, glyph] of drawerItems) {
        const button = document.createElement('button');
        button.type = 'button';
        if (kind === 'route') button.dataset.ttRoute = target;
        else button.dataset.ttShortcut = target;
        button.innerHTML = `${icon(glyph)}<span></span>`;
        button.querySelector('span').textContent = t(label);
        button.addEventListener('click', () => void (kind === 'route' ? navigate(target) : openPanel(target, t(label))));
        routeList.append(button);
    }
    const drawerProfile = document.createElement('div');
    drawerProfile.id = 'tt-nav-profile';
    drawerProfile.innerHTML = `<div id="tt-nav-profile-avatar" aria-hidden="true">T</div><strong>TauriTavern</strong><small></small><button type="button" id="tt-nav-theme">${icon('moon')}</button>`;
    drawerProfile.querySelector('small').textContent = t('Your personal tavern');
    const currentChat = document.createElement('button');
    currentChat.type = 'button';
    currentChat.id = 'tt-nav-chat';
    currentChat.innerHTML = '<span class="tt-nav-chat-avatar" aria-hidden="true"></span><span><strong id="tt-nav-chat-name"></strong><small id="tt-nav-chat-status"></small></span>';
    currentChat.addEventListener('click', () => void navigate('chat'));
    const currentHeading = document.createElement('h2');
    currentHeading.className = 'tt-nav-section-title';
    currentHeading.textContent = t('Current conversation');
    tabs.append(drawerProfile, routeList, currentHeading, currentChat);
    const more = document.createElement('section');
    more.id = 'tt-more-panel';
    more.hidden = true;
    more.setAttribute('aria-label', t('Settings'));
    more.tabIndex = -1;
    const panels = [
        ['rm_api_block', 'API Connections', 'Choose your connection and model.', 'connection', 'Connection and model'],
        ['left-nav-panel', 'AI Response Configuration', 'Presets and generation parameters.', 'sliders', 'Connection and model'],
        ['AdvancedFormatting', 'Advanced Formatting', 'Context and prompt formatting.', 'format', 'Connection and model'],
        ['WorldInfo', 'World Info', 'Manage lorebooks and character knowledge.', 'book', 'Stories and characters'],
        ['PersonaManagement', 'Persona Management', 'Choose who you are in the chat.', 'user', 'Stories and characters'],
        ['right-nav-panel', 'Character Management', 'Import, export and edit character cards.', 'users', 'Stories and characters'],
        ['rm_extensions_block', 'Extensions', 'Regex, assistants and installed extensions.', 'puzzle', 'Stories and characters'],
        ['user-settings-block', 'User Settings', 'Theme, appearance and chat preferences.', 'settings', 'Appearance and app'],
        ['Backgrounds', 'Backgrounds', 'Choose a chat wallpaper.', 'image', 'Appearance and app'],
        ['app-settings', 'TauriTavern Settings', 'App performance, data migration and backups.', 'phone', 'Appearance and app'],
    ];
    const settingsIntro = document.createElement('div');
    settingsIntro.className = 'tt-settings-profile';
    settingsIntro.innerHTML = `<span class="tt-settings-avatar" aria-hidden="true">${icon('chat')}</span><div><strong>TauriTavern</strong><small></small></div>`;
    settingsIntro.querySelector('small').textContent = t('Make yourself at home');
    more.append(settingsIntro);
    const settingsSearch = document.createElement('label');
    settingsSearch.id = 'tt-settings-search';
    settingsSearch.innerHTML = `${icon('search')}<input type="search">`;
    settingsSearch.querySelector('input').placeholder = t('Search settings');
    settingsSearch.querySelector('input').setAttribute('aria-label', t('Search settings'));
    more.append(settingsSearch);
    let section;
    let previousGroup;
    for (const [id, label, description, glyph, group] of panels) {
        if (group !== previousGroup) {
            const heading = document.createElement('h2');
            heading.textContent = t(group);
            section = document.createElement('div');
            section.className = 'tt-settings-group';
            section.append(heading);
            more.append(section);
            previousGroup = group;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.ttPanel = id;
        button.innerHTML = `<span class="tt-settings-icon" data-icon="${glyph}">${icon(glyph)}</span><span class="tt-settings-copy"><strong></strong><small></small></span>${icon('chevron')}`;
        button.querySelector('strong').textContent = t(label);
        button.querySelector('small').textContent = t(description);
        button.addEventListener('click', () => void openPanel(id, t(label)));
        section.append(button);
    }
    const settingsEmpty = document.createElement('p');
    settingsEmpty.id = 'tt-settings-empty';
    settingsEmpty.setAttribute('role', 'status');
    settingsEmpty.textContent = t('No matching settings');
    settingsEmpty.hidden = true;
    more.append(settingsEmpty);
    settingsSearch.querySelector('input').addEventListener('input', event => {
        const query = event.target.value.trim().toLocaleLowerCase();
        let found = false;
        for (const group of more.querySelectorAll('.tt-settings-group')) {
            let groupFound = false;
            for (const button of group.querySelectorAll('button')) {
                button.hidden = !button.textContent.toLocaleLowerCase().includes(query);
                groupFound ||= !button.hidden;
            }
            group.hidden = !groupFound;
            found ||= groupFound;
        }
        settingsEmpty.hidden = found;
    });
    body.prepend(header);
    const scrim = document.createElement('button');
    scrim.id = 'tt-chat-nav-scrim';
    scrim.type = 'button';
    scrim.setAttribute('aria-label', t('Close navigation'));
    // Telegram-style pages that stand in for native settings panels on phones.
    const pageSection = document.createElement('section');
    pageSection.id = 'tt-settings-page';
    pageSection.hidden = true;
    pageSection.tabIndex = -1;
    let settingsPage;
    body.append(scrim, more, pageSection, tabs);
    const actions = document.createElement('section');
    actions.id = 'tt-chat-actions';
    actions.hidden = true;
    actions.setAttribute('role', 'dialog');
    actions.setAttribute('aria-modal', 'true');
    actions.setAttribute('aria-label', t('Chat actions'));
    const actionScrim = document.createElement('button');
    actionScrim.id = 'tt-chat-action-scrim';
    actionScrim.type = 'button';
    actionScrim.hidden = true;
    actionScrim.setAttribute('aria-label', t('Close'));
    // One floating "new" action, like Telegram's pencil. Its menu rows click the
    // native create/import buttons, which keep owning the actual logic.
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'tt-roles-fab';
    fab.hidden = true;
    fab.setAttribute('aria-label', t('Create'));
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.setAttribute('aria-controls', 'tt-chat-actions');
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = icon('pencil');
    body.append(actionScrim, actions, fab);
    const connectButton = document.createElement('button');
    connectButton.type = 'button';
    connectButton.id = 'tt-compose-connect';
    connectButton.setAttribute('aria-label', t('API Connections'));
    connectButton.innerHTML = icon('connection');
    connectButton.addEventListener('click', () => void openPanel('rm_api_block', t('API Connections')));
    document.getElementById('rightSendForm')?.append(connectButton);
    body.classList.add('tt-mobile-chat-shell');
    let view = 'roles';
    let actionsOrigin;
    // Telegram keeps list search in the app bar; the native field stays the
    // single owner of the query and this flag only controls its visibility.
    let searchingRoles = false;
    let panelTitle = '';
    let panelId = '';
    const trail = [];
    let operation = 0;
    let disposed = false;
    let retry;
    let controller;
    let theme = document.defaultView.localStorage.getItem('tt-chat-color-scheme') === 'night' ? 'night' : 'day';
    const previousTheme = body.dataset.ttColorScheme;
    const wideScreen = document.defaultView.matchMedia('(min-width: 960px)');
    const chatSurface = document.getElementById('sheld');
    const previousInert = chatSurface.inert;
    const title = header.querySelector('#tt-chat-title');
    title.tabIndex = -1;
    const subtitle = header.querySelector('#tt-chat-subtitle');
    const backButton = header.querySelector('#tt-chat-back');
    const menuButton = header.querySelector('#tt-chat-menu');
    const searchButton = header.querySelector('#tt-chat-search');
    const moreButton = header.querySelector('#tt-chat-more');
    const avatar = header.querySelector('#tt-chat-avatar');
    const feedback = header.querySelector('#tt-chat-feedback');
    const retryButton = feedback.querySelector('button');
    const heading = header.querySelector('.tt-chat-heading');
    const searchInput = header.querySelector('#tt-chat-search-input');
    searchInput.placeholder = t('Search');
    searchInput.setAttribute('aria-label', t('Search'));
    backButton.setAttribute('aria-label', t('Back'));
    menuButton.setAttribute('aria-label', t('Open navigation'));
    moreButton.setAttribute('aria-label', t('Chat actions'));
    const themeButton = tabs.querySelector('#tt-nav-theme');
    themeButton.setAttribute('aria-label', t('Night mode'));
    retryButton.textContent = t('Retry');

    function renderTheme() {
        body.dataset.ttColorScheme = theme;
        themeButton.setAttribute('aria-pressed', String(theme === 'night'));
        themeButton.setAttribute('aria-label', t(theme === 'night' ? 'Day mode' : 'Night mode'));
        themeButton.innerHTML = icon(theme === 'night' ? 'sun' : 'moon');
    }

    function setNavigation(open, { restoreFocus = false } = {}) {
        syncAttribute(body, 'data-tt-nav-open', String(open));
        syncAttribute(menuButton, 'aria-expanded', String(open));
        syncBooleanProperty(tabs, 'inert', !open && !wideScreen.matches);
        syncBooleanProperty(scrim, 'hidden', !open);
        syncBooleanProperty(chatSurface, 'inert', open && !wideScreen.matches || view !== 'chat' || !actions.hidden);
        if (restoreFocus && !wideScreen.matches) (menuButton.hidden ? backButton : menuButton).focus({ preventScroll: true });
    }

    function setActions(open, { restoreFocus = false } = {}) {
        actions.hidden = !open;
        actionScrim.hidden = !open;
        for (const origin of [moreButton, fab]) origin.setAttribute('aria-expanded', String(open && origin === actionsOrigin));
        chatSurface.inert = open || view !== 'chat';
        if (open) actions.querySelector('button')?.focus({ preventScroll: true });
        else if (restoreFocus) actionsOrigin?.focus({ preventScroll: true });
    }

    function openActions(items, origin) {
        actions.replaceChildren();
        for (const [label, glyph, action] of items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.innerHTML = `${icon(glyph)}<span></span>`;
            button.querySelector('span').textContent = t(label);
            button.addEventListener('click', () => { setActions(false); void action(); });
            actions.append(button);
        }
        actionsOrigin = origin;
        actions.dataset.ttAnchor = origin === fab ? 'fab' : 'bar';
        setActions(true);
    }

    function changeView(target, direction = 'forward') {
        body.dataset.ttMotion = direction;
        if (target.view !== 'roles') closeRoleSearch({ render: false });
        view = target.view;
        panelId = target.panelId || '';
        panelTitle = target.title || '';
        setActions(false);
    }

    function render() {
        if (disposed) return;
        const chat = getChat();
        syncBooleanProperty(connectButton, 'hidden', chat.connected !== false);
        syncAttribute(body, 'data-tt-connected', String(chat.connected !== false));
        syncAttribute(body, 'data-tt-chat-view', view);
        syncAttribute(body, 'data-tt-roles-search', String(view === 'roles' && searchingRoles));
        // Like Telegram, sender names only matter when several speakers share a chat.
        syncAttribute(body, 'data-tt-group-chat', String(Boolean(chat.group)));
        setNavigation(body.dataset.ttNavOpen === 'true');
        syncBooleanProperty(more, 'hidden', view !== 'more');
        syncBooleanProperty(pageSection, 'hidden', view !== 'page');
        // Connection status and other native state can change behind the page.
        if (view === 'page') settingsPage?.refresh();
        syncText(title, view === 'roles' ? t('Chats') : view === 'chat' ? chat.title || t('Choose a character')
            : view === 'panel' || view === 'page' ? panelTitle : t(routes.find(([route]) => route === view)[1]));
        syncText(subtitle, view === 'chat' ? chat.status : view === 'roles'
            ? t('Your characters, one conversation away') : view === 'history'
                ? chat.title : view === 'panel' ? t(panels.find(([id]) => id === panelId)?.[2] || '') : '');
        // Telegram turns the app bar itself into the search field.
        const searching = view === 'roles' && searchingRoles;
        syncBooleanProperty(backButton, 'hidden', view === 'roles' && !searching);
        syncBooleanProperty(menuButton, 'hidden', view !== 'roles' || searching);
        syncBooleanProperty(heading, 'hidden', searching);
        syncBooleanProperty(searchInput, 'hidden', !searching);
        syncBooleanProperty(avatar, 'hidden', view !== 'chat');
        syncBooleanProperty(searchButton, 'hidden', view !== 'roles');
        if (syncAttribute(searchButton, 'aria-expanded', String(searchingRoles))) {
            searchButton.innerHTML = icon(searchingRoles ? 'close' : 'search');
        }
        syncAttribute(searchButton, 'aria-label', t(searchingRoles ? 'Close search' : 'Search'));
        syncBooleanProperty(moreButton, 'hidden', view !== 'chat');
        syncBooleanProperty(fab, 'hidden', view !== 'roles' || searchingRoles);
        const image = chat.avatar ? `url(${JSON.stringify(chat.avatar)})` : '';
        const initial = chat.title ? [...chat.title][0].toUpperCase() : 'T';
        syncText(avatar, image ? '' : initial);
        avatar.style.backgroundImage = image;
        syncText(currentChat.querySelector('.tt-nav-chat-avatar'), image ? '' : initial);
        currentChat.querySelector('.tt-nav-chat-avatar').style.backgroundImage = image;
        syncText(currentChat.querySelector('strong'), chat.title || t('Choose a character'));
        syncText(currentChat.querySelector('small'), chat.status);
        syncBooleanProperty(currentChat, 'hidden', !chat.title);
        syncBooleanProperty(currentHeading, 'hidden', !chat.title);
        const currentPanel = panelId.replace(/^native:/, '');
        for (const button of routeList.querySelectorAll('button')) {
            const active = button.dataset.ttShortcut ? (view === 'panel' || view === 'page') && currentPanel === button.dataset.ttShortcut
                : button.dataset.ttRoute === ((view === 'panel' || view === 'page') && !shortcutPanels.includes(currentPanel) ? 'more' : view);
            syncAttribute(button, 'aria-current', active ? 'page' : null);
        }
    }

    function message(text, action) {
        feedback.hidden = !text;
        feedback.querySelector('span').textContent = text;
        retry = action;
        retryButton.hidden = !action;
    }

    /** Leave list search mode and clear the native filter it drove. */
    function closeRoleSearch({ render: rerender = true } = {}) {
        if (!searchingRoles) return false;
        searchingRoles = false;
        searchInput.value = '';
        const field = document.getElementById('character_search_bar');
        if (field && field.value) {
            field.value = '';
            field.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
        }
        if (rerender) render();
        return true;
    }

    function startNewChat() {
        const reason = busy();
        if (reason) { message(reason); notify(reason); return; }
        document.getElementById('option_start_new_chat')?.click();
    }

    /** Things you do to this conversation, as in Telegram's chat menu. */
    function chatActionItems() {
        return [
            ['Start new chat', 'newChat', startNewChat],
            ['History', 'history', () => navigate('history')],
            ...(getChat().group ? [] : [['Character profile', 'user', () => openPanel('character-card', t('Character profile'))]]),
            ['World Info', 'book', () => openPanel('WorldInfo', t('World Info'))],
            ['API Connections', 'connection', () => openPanel('rm_api_block', t('API Connections'))],
        ];
    }

    function createActionItems() {
        return [
            ['Create New Character', 'userPlus', () => openPanel('character-create', t('Create New Character'))],
            ['Import Character from File', 'import', () => document.getElementById('character_import_button')?.click()],
            ['Import content from external URL', 'globe', () => document.getElementById('external_import_button')?.click()],
        ];
    }

    // Some native lists (personas) render only when their drawer opens; let
    // the runtime fill them before the page mirrors them.
    async function showSettingsPage(id, signal) {
        await preparePage(id, signal);
        if (signal?.aborted) return;
        settingsPage = renderSettingsPage({
            document, schema: settingsPages[id], translate: t,
            save: saveSettings,
            openNative: () => openPanel(`native:${id}`, panelTitle),
        });
        pageSection.replaceChildren(settingsPage.element);
        pageSection.scrollTop = 0;
    }

    function currentRoute() {
        return { view, panelId, title: panelTitle };
    }

    function canOpen(target) {
        if (target !== 'roles' && target !== 'history') return true;
        const reason = busy();
        if (!reason) return true;
        message(reason);
        notify(reason);
        return false;
    }

    async function present(target, { direction = 'forward', history = 'push', recovering = false } = {}) {
        if (disposed) return;
        const previous = currentRoute();
        const previousTrail = [...trail];
        const changed = previous.view !== target.view || previous.panelId !== (target.panelId || '');
        if (changed && history === 'back') trail.pop();
        else if (changed && history === 'push') {
            if (target.view === 'roles') trail.length = 0;
            else if (target.view === 'chat') trail.splice(0, trail.length, { view: 'roles' });
            else trail.push(previous);
        }
        const ticket = ++operation;
        controller?.abort();
        const request = new document.defaultView.AbortController();
        controller = request;
        setNavigation(false);
        closePanels();
        settingsPage?.dispose();
        settingsPage = undefined;
        pageSection.replaceChildren();
        changeView(target, direction);
        const action = target.view === 'roles' ? showCharacters
            : target.view === 'history' ? showHistory
                : target.view === 'panel' ? signal => showPanel(target.panelId, signal)
                    : target.view === 'page' ? signal => showSettingsPage(target.panelId, signal) : null;
        message(action ? t('Loading…') : '');
        pageSection.setAttribute('aria-busy', String(target.view === 'page'));
        render();
        try {
            if (action) await action(request.signal);
            if (disposed || ticket !== operation) return;
            message('');
            pageSection.setAttribute('aria-busy', 'false');
            render();
            if (changed) title.focus({ preventScroll: true });
        } catch (error) {
            if (disposed || ticket !== operation || request.signal.aborted) return;
            pageSection.setAttribute('aria-busy', 'false');
            closePanels();
            if (changed && !recovering) {
                trail.splice(0, trail.length, ...previousTrail);
                await present(previous, { direction: 'back', history: 'replace', recovering: true });
            }
            message(`${t('Could not open this view.')} ${error.message}`,
                () => present(target, { direction, history }));
            render();
        }
    }

    async function navigate(target, { direction = 'forward' } = {}) {
        if (disposed) return;
        if (!routes.some(([route]) => route === target)) throw new Error(`Unknown chat view: ${target}`);
        if (!canOpen(target)) return;
        await present({ view: target }, { direction });
    }

    async function openPanel(id, label) {
        if (disposed) return;
        if (id === 'app-settings') {
            if (view !== 'more') await navigate('more');
            const signal = controller?.signal;
            try { await showPanel(id, signal); }
            catch (error) {
                if (!signal?.aborted) message(`${t('Could not open this view.')} ${error.message}`, () => openPanel(id, label));
            }
            return;
        }
        if (settingsPages[id]) {
            await present({ view: 'page', panelId: id, title: label });
            return;
        }
        await present({ view: 'panel', panelId: id, title: label });
    }

    function back() {
        if (!actions.hidden) {
            setActions(false, { restoreFocus: true });
            return true;
        }
        if (body.dataset.ttNavOpen === 'true') {
            setNavigation(false, { restoreFocus: true });
            return true;
        }
        if (view === 'page' && settingsPage?.closeSheet()) return true;
        if (view === 'roles' && closeRoleSearch()) {
            searchButton.focus({ preventScroll: true });
            return true;
        }
        if (disposed || view === 'roles') return false;
        const target = trail.at(-1) || { view: 'roles' };
        if (!canOpen(target.view)) return true;
        void present(target, { direction: 'back', history: 'back' });
        return true;
    }

    function chatChanged() {
        if (view === 'roles' || view === 'history') void present({ view: 'chat' });
        else render();
    }

    backButton.addEventListener('click', () => (requestBack || back)());
    const navigationControls = () => [...tabs.querySelectorAll('button, input')]
        .filter(node => !node.disabled && !node.closest('[hidden]'));
    menuButton.addEventListener('click', () => {
        setActions(false);
        setNavigation(true);
        document.defaultView.requestAnimationFrame(() => {
            if (disposed || body.dataset.ttNavOpen !== 'true') return;
            const current = routeList.querySelector('[aria-current="page"]:not([hidden])');
            (current || navigationControls()[0])?.focus({ preventScroll: true });
        });
    });
    scrim.addEventListener('click', () => setNavigation(false, { restoreFocus: true }));
    actionScrim.addEventListener('click', () => setActions(false, { restoreFocus: true }));
    themeButton.addEventListener('click', () => {
        theme = theme === 'night' ? 'day' : 'night';
        document.defaultView.localStorage.setItem('tt-chat-color-scheme', theme);
        renderTheme();
    });
    const resizeNavigation = () => setNavigation(false);
    wideScreen.addEventListener('change', resizeNavigation);
    const onKeyDown = event => {
        if (isComposingKeyboardEvent(event)) return;
        if (event.key === 'Escape' && !actions.hidden) {
            event.preventDefault();
            event.stopImmediatePropagation();
            back();
            return;
        }
        if (!actions.hidden) {
            const buttons = [...actions.querySelectorAll('button')];
            const index = buttons.indexOf(document.activeElement);
            if (event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopImmediatePropagation();
                const delta = event.key === 'ArrowUp' || event.key === 'Tab' && event.shiftKey ? -1 : 1;
                buttons[(index + delta + buttons.length) % buttons.length].focus();
            }
            return;
        }
        if (body.dataset.ttNavOpen !== 'true') return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            setNavigation(false, { restoreFocus: true });
        } else if (event.key === 'Tab' && !wideScreen.matches) {
            event.stopPropagation();
            const focusable = navigationControls();
            const first = focusable[0];
            const last = focusable.at(-1);
            if (!tabs.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
            else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    };
    // Own keys while our overlay is open, before upstream drawer shortcuts.
    document.addEventListener('keydown', onKeyDown, true);
    // These controls own navigation. Avoid the native outside-tap closer
    // consuming the same gesture first and taking two back steps.
    for (const surface of [header, tabs, actions, fab]) {
        for (const event of ['mousedown', 'touchstart']) {
            surface.addEventListener(event, event => event.stopPropagation());
        }
    }
    const toggleActions = (origin, items) => {
        if (!actions.hidden && actionsOrigin === origin) setActions(false, { restoreFocus: true });
        else openActions(items(), origin);
    };
    moreButton.addEventListener('click', () => toggleActions(moreButton, chatActionItems));
    fab.addEventListener('click', () => toggleActions(fab, createActionItems));
    const nativeSearch = () => document.getElementById('character_search_bar');
    /** Mirror the app-bar query into the native field, which owns filtering. */
    function syncSearch() {
        const field = nativeSearch();
        if (!field || field.value === searchInput.value) return;
        field.value = searchInput.value;
        field.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    }
    searchInput.addEventListener('input', syncSearch);
    searchInput.addEventListener('keydown', event => {
        if (isComposingKeyboardEvent(event)) return;
        if (event.key === 'Enter') searchInput.blur();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRoleSearch();
        searchButton.focus({ preventScroll: true });
    });
    searchButton.addEventListener('click', () => {
        // Like Telegram's clear button: empty the query first, close when already empty.
        if (searchingRoles && searchInput.value) {
            searchInput.value = '';
            syncSearch();
            searchInput.focus({ preventScroll: true });
            return;
        }
        if (searchingRoles) {
            closeRoleSearch();
            searchButton.focus({ preventScroll: true });
            return;
        }
        searchingRoles = true;
        searchInput.value = nativeSearch()?.value || '';
        render();
        searchInput.focus({ preventScroll: true });
    });
    retryButton.addEventListener('click', () => void retry?.());
    const unsubscribe = subscribeChatChanged(chatChanged);
    renderTheme();
    render();
    const ready = navigate('roles');
    return {
        ready, navigate, openPanel, back, refresh: render, chatChanged,
        panelClosed() {
            if (view === 'roles') void present({ view: 'roles' }, { history: 'replace' });
            else if (view === 'history' || view === 'panel') back();
        },
        dispose() {
            disposed = true;
            operation++;
            controller?.abort();
            unsubscribe();
            closePanels();
            wideScreen.removeEventListener('change', resizeNavigation);
            document.removeEventListener('keydown', onKeyDown, true);
            header.remove(); tabs.remove(); more.remove(); scrim.remove(); actions.remove(); actionScrim.remove(); fab.remove();
            settingsPage?.dispose();
            pageSection.remove();
            connectButton.remove();
            body.classList.remove('tt-mobile-chat-shell');
            delete body.dataset.ttChatView;
            delete body.dataset.ttNavOpen;
            delete body.dataset.ttConnected;
            delete body.dataset.ttMotion;
            delete body.dataset.ttRolesSearch;
            delete body.dataset.ttGroupChat;
            if (previousTheme === undefined) delete body.dataset.ttColorScheme;
            else body.dataset.ttColorScheme = previousTheme;
            chatSurface.inert = previousInert;
        },
    };
}
