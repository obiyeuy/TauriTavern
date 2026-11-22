import { eventSource, event_types } from './events.js';
import { isMobileHost } from './util/host-identity.js';
import {
    getCurrentChatDetails,
    isChatSaving,
    isGenerating,
    online_status,
    setChatHistoryOpen,
    select_rm_characters,
} from '../script.js';
import { setNavbarDrawerOpen } from '../script.js';
import { isTopLevelDrawerOpen, setTopLevelDrawerOpen, subscribeDrawerState } from './drawers.js';
import { installMobileChatShell } from './mobile-chat-shell.js';
import { translate } from './i18n.js';
import { pushBackNavigationHandler } from '../tauri/main/services/back-navigation/back-handler-stack.js';
import { handleBackNavigation } from '../tauri/main/back-navigation.js';

let installedShell;
let closingPanels = false;

function panelToggle(panelId) {
    const panel = document.getElementById(panelId);
    if (!(panel instanceof HTMLElement)) {
        throw new Error(`Mobile navigation panel not found: #${panelId}`);
    }
    const toggle = panel.closest('.drawer')?.querySelector(':scope > .drawer-toggle');
    if (!(toggle instanceof HTMLElement)) {
        throw new Error(`Mobile navigation toggle not found for #${panelId}`);
    }
    return { panel, toggle };
}

async function openDrawer(panelId, signal) {
    const { panel } = panelToggle(panelId);
    if (!isTopLevelDrawerOpen(panel)) {
        await setNavbarDrawerOpen(panel, true);
    }
    if (signal?.aborted) return;
}

function closeNativePanels() {
    closingPanels = true;
    try {
        for (const panel of document.querySelectorAll('#top-settings-holder .drawer-content.openDrawer')) {
            setTopLevelDrawerOpen(panel, false);
        }
        void setChatHistoryOpen(false);
    } finally {
        closingPanels = false;
    }
}

async function showCharacters(signal) {
    await openDrawer('right-nav-panel', signal);
    if (signal?.aborted) return;
    await select_rm_characters({ signal, preservePage: true });
}

async function showHistory(signal) {
    const details = getCurrentChatDetails();
    if (!details.characterName) throw new Error(translate('Choose a character first.'));
    await setChatHistoryOpen(true, { signal });
}

async function showPanel(panelId, signal) {
    if (panelId === 'app-settings') {
        const { openTauriTavernSettingsPopup } = await import('./tauri/setting/setting-panel/settings-popup.js');
        await openTauriTavernSettingsPopup({ signal });
        return;
    }
    if (panelId === 'right-nav-panel') {
        await showCharacters(signal);
        return;
    }
    await openDrawer(panelId, signal);
}

function currentChat() {
    const details = getCurrentChatDetails();
    return {
        title: details.characterName || details.sessionName || '',
        avatar: details.avatarImgURL || '',
        connected: online_status !== 'no_connection',
        status: isGenerating() ? translate('Generating reply…') : online_status === 'no_connection'
            ? translate('Connect to start chatting') : translate('Ready to chat'),
    };
}

function busyReason() {
    if (isGenerating()) return translate('A reply is being generated. Stop generation before switching.');
    if (isChatSaving) return translate('Your chat is still saving. Please wait a moment.');
    return '';
}

/** Install once after APP_READY; no-op on desktop and web fixtures. */
export function installMobileChatShellRuntime() {
    if (!isMobileHost() || installedShell) return installedShell;
    installedShell = installMobileChatShell({
        document,
        getChat: currentChat,
        busy: busyReason,
        closePanels: closeNativePanels,
        showCharacters,
        showHistory,
        showPanel,
        notify: text => toastr.info(text),
        requestBack: handleBackNavigation,
        subscribeChatChanged: listener => {
            const events = [event_types.CHAT_CHANGED, event_types.CHARACTER_SELECTED];
            for (const event of events) eventSource.on(event, listener);
            return () => { for (const event of events) eventSource.removeListener(event, listener); };
        },
        translate,
    });
    const shell = installedShell;
    const openMobileMore = event => {
        event.preventDefault();
        void shell.navigate('more');
    };
    document.addEventListener('tt-mobile-chat-more-request', openMobileMore);
    const openMobilePanel = event => {
        event.preventDefault();
        const { toggle } = panelToggle(event.detail.panelId);
        const label = toggle.getAttribute('aria-label')
            || toggle.querySelector('.drawer-icon')?.getAttribute('title')
            || translate('Settings');
        void shell.openPanel(event.detail.panelId, label);
    };
    document.addEventListener('tt-mobile-chat-panel-request', openMobilePanel);
    const openMobileHistory = event => {
        if (!installedShell || event.defaultPrevented) return;
        event.preventDefault();
        void installedShell.navigate('history');
    };
    document.addEventListener('tt-mobile-chat-history-request', openMobileHistory);
    const removeBackHandler = pushBackNavigationHandler(() => shell.back(), { layer: 'navigation' });
    const refreshEvents = [event_types.ONLINE_STATUS_CHANGED, event_types.GENERATION_STARTED,
        event_types.GENERATION_ENDED, event_types.GENERATION_STOPPED, event_types.CHARACTER_EDITED];
    for (const event of refreshEvents) eventSource.on(event, shell.refresh);
    const subscriptions = Array.from(document.querySelectorAll('#top-settings-holder > .drawer > .drawer-content'),
        panel => subscribeDrawerState(panel, () => {
            if (!closingPanels && !isTopLevelDrawerOpen(panel)) shell.panelClosed();
        }));
    const historyChanged = event => {
        if (!closingPanels && !event.detail.open) shell.panelClosed();
    };
    document.addEventListener('tt-chat-history-state-change', historyChanged);
    const disposeShell = installedShell.dispose;
    installedShell.dispose = () => {
        removeBackHandler();
        for (const unsubscribe of subscriptions) unsubscribe();
        document.removeEventListener('tt-chat-history-state-change', historyChanged);
        for (const event of refreshEvents) eventSource.removeListener(event, shell.refresh);
        document.removeEventListener('tt-mobile-chat-more-request', openMobileMore);
        document.removeEventListener('tt-mobile-chat-panel-request', openMobilePanel);
        document.removeEventListener('tt-mobile-chat-history-request', openMobileHistory);
        disposeShell();
        installedShell = undefined;
    };
    return installedShell;
}

export function disposeMobileChatShellRuntime() {
    installedShell?.dispose();
}
