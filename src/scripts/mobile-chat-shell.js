import { mobileChatIcon as icon } from './mobile-chat-icons.js';

/**
 * Mobile navigation owns presentation only. Native drawers and chat history own
 * their contents; no character list, settings or chat data is copied here.
 */
export function installMobileChatShell({
    document, getChat, busy, closePanels, showCharacters, showHistory, showPanel,
    notify, subscribeChatChanged, requestBack, translate = text => text,
}) {
    const body = document.body;
    const t = translate;
    const header = document.createElement('header');
    header.id = 'tt-chat-header';
    header.innerHTML = `<button type="button" id="tt-chat-menu" aria-controls="tt-chat-tabs" aria-expanded="false">${icon('menu')}</button>
        <button type="button" id="tt-chat-back">${icon('back')}</button>
        <div id="tt-chat-avatar" aria-hidden="true"></div><div class="tt-chat-heading"><h1 id="tt-chat-title"></h1><span id="tt-chat-subtitle"></span></div>
        <button type="button" id="tt-chat-search">${icon('search')}</button>
        <button type="button" id="tt-chat-more">${icon('more')}</button>
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
    for (const [route, label, glyph] of routes) {
        if (route === 'chat') continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.ttRoute = route;
        button.innerHTML = `${icon(glyph)}<span></span>`;
        button.querySelector('span').textContent = t(label);
        button.addEventListener('click', () => void navigate(route));
        routeList.append(button);
    }
    const drawerProfile = document.createElement('div');
    drawerProfile.id = 'tt-nav-profile';
    drawerProfile.innerHTML = `<div id="tt-nav-profile-avatar" aria-hidden="true">T</div><strong>TauriTavern</strong><small></small><button type="button" id="tt-nav-theme">${icon('moon')}</button>`;
    drawerProfile.querySelector('small').textContent = t('Your personal tavern');
    const drawerSearch = document.createElement('label');
    drawerSearch.id = 'tt-nav-search';
    drawerSearch.innerHTML = `${icon('search')}<input type="search"><span class="sr-only"></span>`;
    drawerSearch.querySelector('input').placeholder = t('Search');
    drawerSearch.querySelector('.sr-only').textContent = t('Search menu');
    const currentChat = document.createElement('button');
    currentChat.type = 'button';
    currentChat.id = 'tt-nav-chat';
    currentChat.innerHTML = '<span class="tt-nav-chat-avatar" aria-hidden="true"></span><span><strong id="tt-nav-chat-name"></strong><small id="tt-nav-chat-status"></small></span>';
    currentChat.addEventListener('click', () => void navigate('chat'));
    const currentHeading = document.createElement('h2');
    currentHeading.className = 'tt-nav-section-title';
    currentHeading.textContent = t('Current conversation');
    const drawerFooter = document.createElement('p');
    drawerFooter.className = 'tt-nav-footer';
    drawerFooter.textContent = t('A little space for your stories');
    tabs.append(drawerProfile, drawerSearch, routeList, currentHeading, currentChat, drawerFooter);
    const filterNavigation = () => {
        const query = drawerSearch.querySelector('input').value.trim().toLocaleLowerCase();
        for (const button of routeList.querySelectorAll('button')) {
            button.hidden = !button.textContent.toLocaleLowerCase().includes(query);
        }
        currentChat.hidden = !getChat().title || !currentChat.textContent.toLocaleLowerCase().includes(query);
        currentHeading.hidden = currentChat.hidden;
    };
    drawerSearch.querySelector('input').addEventListener('input', filterNavigation);
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
    body.append(scrim, more, tabs);
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
    for (const [label, glyph, action] of [
        ['History', 'history', () => navigate('history')],
        ['Character Management', 'user', () => openPanel('right-nav-panel', t('Character Management'))],
        ['World Info', 'book', () => openPanel('WorldInfo', t('World Info'))],
        ['API Connections', 'connection', () => openPanel('rm_api_block', t('API Connections'))],
        ['Extensions', 'puzzle', () => openPanel('rm_extensions_block', t('Extensions'))],
        ['Settings', 'settings', () => navigate('more')],
    ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.innerHTML = `${icon(glyph)}<span></span>`;
        button.querySelector('span').textContent = t(label);
        button.addEventListener('click', () => { setActions(false); void action(); });
        actions.append(button);
    }
    body.append(actionScrim, actions);
    const connectButton = document.createElement('button');
    connectButton.type = 'button';
    connectButton.id = 'tt-compose-connect';
    connectButton.setAttribute('aria-label', t('API Connections'));
    connectButton.innerHTML = icon('connection');
    connectButton.addEventListener('click', () => void openPanel('rm_api_block', t('API Connections')));
    document.getElementById('rightSendForm')?.append(connectButton);
    body.classList.add('tt-mobile-chat-shell');
    let view = 'roles';
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
    const avatar = header.querySelector('#tt-chat-avatar');
    const feedback = header.querySelector('#tt-chat-feedback');
    const retryButton = feedback.querySelector('button');
    backButton.setAttribute('aria-label', t('Back'));
    menuButton.setAttribute('aria-label', t('Open navigation'));
    header.querySelector('#tt-chat-more').setAttribute('aria-label', t('Settings'));
    header.querySelector('#tt-chat-search').setAttribute('aria-label', t('Search'));
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
        body.dataset.ttNavOpen = String(open);
        menuButton.setAttribute('aria-expanded', String(open));
        tabs.inert = !open && !wideScreen.matches;
        scrim.hidden = !open;
        chatSurface.inert = open && !wideScreen.matches || view !== 'chat' || !actions.hidden;
        if (restoreFocus && !wideScreen.matches) (menuButton.hidden ? backButton : menuButton).focus({ preventScroll: true });
    }

    function setActions(open, { restoreFocus = false } = {}) {
        actions.hidden = !open;
        actionScrim.hidden = !open;
        header.querySelector('#tt-chat-more').setAttribute('aria-expanded', String(open));
        chatSurface.inert = open || view !== 'chat';
        if (open) actions.querySelector('button').focus({ preventScroll: true });
        else if (restoreFocus) header.querySelector('#tt-chat-more').focus({ preventScroll: true });
    }

    function changeView(target, direction = 'forward') {
        body.dataset.ttMotion = direction;
        view = target.view;
        panelId = target.panelId || '';
        panelTitle = target.title || '';
        setActions(false);
    }

    function render() {
        if (disposed) return;
        const chat = getChat();
        connectButton.hidden = chat.connected !== false;
        body.dataset.ttConnected = String(chat.connected !== false);
        body.dataset.ttChatView = view;
        setNavigation(body.dataset.ttNavOpen === 'true');
        more.hidden = view !== 'more';
        title.textContent = view === 'roles' ? t('Chats') : view === 'chat' ? chat.title || t('Choose a character')
            : view === 'panel' ? panelTitle : t(routes.find(([route]) => route === view)[1]);
        subtitle.textContent = view === 'chat' ? chat.status : view === 'roles'
            ? t('Your characters, one conversation away') : view === 'history'
                ? chat.title : view === 'panel' ? t(panels.find(([id]) => id === panelId)?.[2] || '') : t('Make yourself at home');
        backButton.hidden = view === 'roles';
        menuButton.hidden = view !== 'roles';
        avatar.hidden = view !== 'chat';
        header.querySelector('#tt-chat-search').hidden = view !== 'roles';
        header.querySelector('#tt-chat-more').hidden = view !== 'chat' && view !== 'roles';
        header.querySelector('#tt-chat-more').setAttribute('aria-label', t(view === 'chat' ? 'Chat actions' : 'Settings'));
        header.querySelector('#tt-chat-more').innerHTML = icon(view === 'chat' ? 'more' : 'settings');
        if (view === 'chat') {
            header.querySelector('#tt-chat-more').setAttribute('aria-haspopup', 'dialog');
            header.querySelector('#tt-chat-more').setAttribute('aria-controls', actions.id);
        } else {
            header.querySelector('#tt-chat-more').removeAttribute('aria-haspopup');
            header.querySelector('#tt-chat-more').removeAttribute('aria-controls');
            header.querySelector('#tt-chat-more').removeAttribute('aria-expanded');
        }
        const image = chat.avatar ? `url(${JSON.stringify(chat.avatar)})` : '';
        const initial = chat.title ? [...chat.title][0].toUpperCase() : 'T';
        avatar.textContent = image ? '' : initial;
        avatar.style.backgroundImage = image;
        currentChat.querySelector('.tt-nav-chat-avatar').textContent = image ? '' : initial;
        currentChat.querySelector('.tt-nav-chat-avatar').style.backgroundImage = image;
        currentChat.querySelector('strong').textContent = chat.title || t('Choose a character');
        currentChat.querySelector('small').textContent = chat.status;
        filterNavigation();
        for (const button of routeList.querySelectorAll('button')) {
            button.disabled = button.dataset.ttRoute === 'history' && !chat.title;
            const active = button.dataset.ttRoute === (view === 'panel' ? 'more' : view);
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        }
    }

    function message(text, action) {
        feedback.hidden = !text;
        feedback.querySelector('span').textContent = text;
        retry = action;
        retryButton.hidden = !action;
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
        changeView(target, direction);
        const action = target.view === 'roles' ? showCharacters
            : target.view === 'history' ? showHistory
                : target.view === 'panel' ? signal => showPanel(target.panelId, signal) : null;
        message(action ? t('Loading…') : '');
        render();
        try {
            if (action) await action(request.signal);
            if (disposed || ticket !== operation) return;
            message('');
            render();
            if (changed) title.focus({ preventScroll: true });
        } catch (error) {
            if (disposed || ticket !== operation || request.signal.aborted) return;
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
    for (const surface of [header, tabs, actions]) {
        for (const event of ['mousedown', 'touchstart']) {
            surface.addEventListener(event, event => event.stopPropagation());
        }
    }
    header.querySelector('#tt-chat-more').addEventListener('click', () => {
        if (view === 'roles') void navigate('more');
        else setActions(actions.hidden);
    });
    header.querySelector('#tt-chat-search').addEventListener('click', () => {
        document.getElementById('character_search_bar')?.focus();
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
            header.remove(); tabs.remove(); more.remove(); scrim.remove(); actions.remove(); actionScrim.remove();
            connectButton.remove();
            body.classList.remove('tt-mobile-chat-shell');
            delete body.dataset.ttChatView;
            delete body.dataset.ttNavOpen;
            delete body.dataset.ttConnected;
            delete body.dataset.ttMotion;
            if (previousTheme === undefined) delete body.dataset.ttColorScheme;
            else body.dataset.ttColorScheme = previousTheme;
            chatSurface.inert = previousInert;
        },
    };
}
