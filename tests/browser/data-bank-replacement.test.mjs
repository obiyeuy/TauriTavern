import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe } from 'node:test';
import { captureBrowserErrors, createBrowserRuntime } from './runtime.mjs';

const ORIGINAL_URL = '/user/files/original.txt';
const OTHER_URL = '/user/files/other.txt';
const ORIGINAL_TEXT = 'ORIGINAL FILE CONTENT';
const EDITED_TEXT = 'EDITED FILE CONTENT';

async function createAttachmentFixture({ readyApp = false, initialSource = 'global', scraperInput } = {}) {
    const runtime = await createBrowserRuntime();
    const { window, load, getModule, startHost } = runtime;
    const { errors, failed } = captureBrowserErrors(window);
    const notices = [];
    const warnings = [];
    const successes = [];
    window.toastr.error = (...args) => notices.push(args.map(String));
    window.toastr.warning = (...args) => warnings.push(args.map(String));
    window.toastr.success = (...args) => successes.push(args.map(String));
    let manager;
    let heldUpload;
    let heldRead;
    let heldSettingsSave;
    let heldMetadataSave;
    let heldVectorInsert;
    const referenceGates = new Set();
    const deleteGates = new Set();
    let heldDelete;
    try {
        await startHost();
        const main = (await load('script.js')).namespace;
        if (readyApp) {
            const { eventSource, event_types } = getModule('scripts/events.js').namespace;
            const ready = new Promise(resolve => eventSource.once(event_types.APP_READY, resolve));
            window.jQuery.holdReady(false);
            await Promise.race([ready, failed]);
            await main.selectCharacterById(0);
        } else {
            await main.getSettings();
            const characters = runtime.fixture.backend.handle({
                method: 'POST', url: '/api/characters/all', body: '{}',
            });
            main.characters.push(...JSON.parse(characters.body));
            main.setCharacterId(0);
        }
        const avatar = main.characters[0].avatar;
        const chats = getModule('scripts/chats.js').namespace;
        const { extension_settings } = getModule('scripts/extensions.js').namespace;
        const { Popup, POPUP_TYPE } = getModule('scripts/popup.js').namespace;
        const { eventSource, event_types } = getModule('scripts/events.js').namespace;
        const files = new Map([[ORIGINAL_URL, ORIGINAL_TEXT], [OTHER_URL, 'OTHER FILE CONTENT']]);
        const operations = [];
        const reads = [];
        const downloads = [];
        const vectorRequests = [];
        const modelRequests = [];
        const referenceSaves = [];
        const sentMessages = [];
        const embeddedMessages = [];
        let savedHashes = [];
        let vectorChunks = [{ text: 'SELECTED FILE CHUNK', index: 0 }];
        const deleted = [];
        eventSource.on(event_types.FILE_ATTACHMENT_DELETED, url => deleted.push(url));
        eventSource.on(event_types.MESSAGE_SENT, index => sentMessages.push(index));
        eventSource.on(event_types.MESSAGE_FILE_EMBEDDED, index => embeddedMessages.push(index));
        extension_settings.attachments = [
            { url: ORIGINAL_URL, size: 21, name: 'original.txt', created: 1 },
            { url: OTHER_URL, size: 18, name: 'other.txt', created: 2 },
        ];
        extension_settings.character_attachments = { [avatar]: [] };
        extension_settings.disabled_attachments = [ORIGINAL_URL];
        if (initialSource === 'character') {
            extension_settings.character_attachments[avatar] = [extension_settings.attachments.shift()];
        }
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
            const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
            if (url.pathname === '/api/files/verify') {
                const { urls } = JSON.parse(init.body);
                return new window.Response(JSON.stringify(Object.fromEntries(
                    urls.map(url => [url, files.has(url)]),
                )), { headers: { 'Content-Type': 'application/json' } });
            }
            if (files.has(url.pathname)) {
                reads.push(url.pathname);
                if (url.pathname === ORIGINAL_URL && heldRead) {
                    const pending = heldRead;
                    heldRead = undefined;
                    pending.started.resolve();
                    return pending.reply.promise;
                }
                const content = files.get(url.pathname);
                return new window.Response(content, { headers: { 'Content-Type': Buffer.isBuffer(content) ? 'image/png' : 'text/plain' } });
            }
            if (url.pathname === '/api/files/delete') {
                const { path } = JSON.parse(init.body);
                operations.push({ operation: 'delete', path });
                const pending = heldDelete && (heldDelete.path === undefined || heldDelete.path === path) ? heldDelete : undefined;
                if (pending) {
                    heldDelete = undefined;
                    pending.started.resolve(path);
                    try {
                        const response = await pending.reply.promise;
                        if (response.ok) files.delete(path);
                        return response;
                    } finally {
                        deleteGates.delete(pending);
                    }
                }
                if (!files.has(path)) return new window.Response('File not found', { status: 404 });
                files.delete(path);
                return new window.Response('{}', { headers: { 'Content-Type': 'application/json' } });
            }
            if (url.pathname === '/api/files/upload' || url.pathname === '/api/images/upload') {
                const body = JSON.parse(init.body);
                operations.push({ operation: 'upload', body });
                const media = url.pathname === '/api/images/upload';
                const pending = heldUpload;
                heldUpload = undefined;
                if (pending) {
                    pending.started.resolve(body);
                    const response = await pending.reply.promise;
                    if (response.ok) {
                        const receipt = await response.clone().json().catch(() => null);
                        if (typeof receipt?.path === 'string' && receipt.path.trim()) {
                            const content = Buffer.from(media ? body.image : body.data, 'base64');
                            files.set(receipt.path, media ? content : content.toString('utf8'));
                        }
                    }
                    return response;
                }
                const path = media ? '/user/images/prepared.png' : '/user/files/replacement.txt';
                const content = Buffer.from(media ? body.image : body.data, 'base64');
                files.set(path, media ? content : content.toString('utf8'));
                return window.Response.json({ path });
            }
            if (url.pathname === '/api/settings/save') {
                const body = JSON.parse(init.body);
                const record = { kind: 'settings', attachments: body.extension_settings.attachments,
                    characterAttachments: body.extension_settings.character_attachments };
                referenceSaves.push(record);
                const pending = heldSettingsSave;
                heldSettingsSave = undefined;
                if (pending) {
                    pending.started.resolve(record);
                    try {
                        const response = await pending.reply.promise;
                        if (response) return response;
                    } finally {
                        referenceGates.delete(pending);
                    }
                }
            }
            if (url.pathname.startsWith('/api/vector/')) {
                const body = JSON.parse(init.body);
                vectorRequests.push({ url: url.pathname, body });
                if (url.pathname === '/api/vector/list') return window.Response.json(savedHashes);
                if (url.pathname === '/api/vector/insert' && heldVectorInsert) {
                    const pending = heldVectorInsert;
                    heldVectorInsert = undefined;
                    pending.started.resolve(body);
                    return pending.reply.promise;
                }
                if (url.pathname === '/api/vector/query') return window.Response.json({
                    hashes: vectorChunks.map((_, index) => index + 1), metadata: vectorChunks,
                });
                if (url.pathname === '/api/vector/query-multi') return window.Response.json(Object.fromEntries(
                    body.collectionIds.map(id => [id, {
                        hashes: vectorChunks.map((_, index) => index + 1), metadata: vectorChunks,
                    }]),
                ));
                return window.Response.json({});
            }
            if (url.pathname === '/api/backends/chat-completions/generate') {
                modelRequests.push(JSON.parse(init.body));
                return window.Response.json({ choices: [{ message: { role: 'assistant', content: 'OK' } }] });
            }
            return originalFetch(input, init);
        };
        const originalInvoke = window.__TAURI__.core.invoke;
        const metadataCommits = new Map();
        window.__TAURI__.core.invoke = async (command, args, options) => {
            if (command === 'begin_chat_commit') {
                const opened = await originalInvoke(command, args, options);
                if (args.operation.kind === 'metadata') metadataCommits.set(opened.sessionId, args.target);
                return opened;
            }
            if (command === 'finish_chat_commit' && metadataCommits.has(args.sessionId)) {
                const record = { kind: 'metadata', target: metadataCommits.get(args.sessionId) };
                referenceSaves.push(record);
                metadataCommits.delete(args.sessionId);
                const pending = heldMetadataSave;
                heldMetadataSave = undefined;
                if (pending) {
                    pending.started.resolve(record);
                    try {
                        await pending.reply.promise;
                    } finally {
                        referenceGates.delete(pending);
                    }
                }
            }
            return originalInvoke(command, args, options);
        };
        window.URL.createObjectURL = blob => {
            downloads.push(blob);
            return 'blob:synthetic-file-download';
        };
        window.URL.revokeObjectURL = () => {};
        const anchorClick = window.HTMLAnchorElement.prototype.click;
        window.HTMLAnchorElement.prototype.click = function () {
            if (!this.download) return anchorClick.call(this);
        };
        if (!readyApp) {
            chats.initChatUtilities();
            await (await load('scripts/extensions/attachments/index.js')).namespace.init();
        }
        const { executeSlashCommandsWithOptions } = getModule('scripts/slash-commands.js').namespace;
        if (scraperInput) {
            await getModule('scripts/scrapers.js').namespace.ScraperManager.registerDataBankScraper({
                id: 'fixture-scraper', name: 'Fixture scraper', description: 'Synthetic file acquisition',
                iconClass: 'fa-solid fa-file', iconAvailable: true,
                isAvailable: async () => true,
                scrape: async () => {
                    scraperInput.started.resolve();
                    return scraperInput.reply.promise;
                },
            });
        }
        let opener = window.document.getElementById('manageAttachments');
        if (!opener) {
            opener = window.document.createElement('button');
            opener.id = 'manageAttachments'; // The extension normally provides this delegated control.
            window.document.body.append(opener);
        }
        window.jQuery(opener).trigger('click');

        function waitForElement(selector) {
            const present = window.document.querySelector(selector);
            if (present) return Promise.resolve(present);
            const waiting = new Promise(resolve => {
                const observer = new window.MutationObserver(() => {
                    const found = window.document.querySelector(selector);
                    if (found) {
                        observer.disconnect();
                        resolve(found);
                    }
                });
                observer.observe(window.document.body, { childList: true, subtree: true });
            });
            return Promise.race([waiting, failed]);
        }

        await waitForElement(`${initialSource === 'character' ? '.characterAttachmentsList' : '.globalAttachmentsList'} [data-attachment-url="${ORIGINAL_URL}"]`);
        manager = Popup.util.popups.at(-1);
        function waitForPopup(type) {
            const find = () => Popup.util.popups.find(popup => popup !== manager && popup.type === type && popup.dlg.isConnected);
            const present = find();
            if (present) return Promise.resolve(present);
            return Promise.race([new Promise(resolve => {
                const observer = new window.MutationObserver(() => {
                    const popup = find();
                    if (popup) { observer.disconnect(); resolve(popup); }
                });
                observer.observe(window.document.body, { childList: true, subtree: true });
            }), failed]);
        }
        return {
            runtime, main, chats, Popup, executeSlashCommandsWithOptions, waitForElement,
            files, operations, deleted, notices, warnings, successes, errors, avatar, extension_settings,
            reads, downloads, vectorRequests, modelRequests,
            referenceSaves, sentMessages, embeddedMessages,
            configureModel() {
                main.changeMainAPI('openai');
                main.setOnlineStatus('synthetic-model');
                Object.assign(getModule('scripts/openai.js').namespace.oai_settings, {
                    chat_completion_source: 'custom', custom_model: 'synthetic-model',
                    custom_url: 'https://api.example.test/v1', custom_api_format: 'openai_compat',
                    stream_openai: false, inline_image_quality: 'low',
                });
                const ajax = window.jQuery.ajax;
                window.jQuery.ajax = options => options.url?.startsWith('/api/tokenizers/openai/count-batch')
                    ? Promise.resolve({ token_counts: JSON.parse(options.data).map(() => 4) })
                    : ajax(options);
            },
            async openMutedGroup() {
                const groupChats = getModule('scripts/group-chats.js').namespace;
                const fetch = window.fetch.bind(window);
                window.fetch = (input, init) => ['/api/chats/search', '/api/groups/edit'].includes(String(input))
                    ? Promise.resolve(window.Response.json(String(input) === '/api/chats/search' ? [] : { ok: true }))
                    : fetch(input, init);
                runtime.fixture.chatFiles.set('preparation-group-chat', [
                    { user_name: 'User', character_name: 'Preparation Group', chat_metadata: { integrity: 'preparation-group-integrity' } },
                    { name: 'Review', is_user: false, is_system: false, mes: 'Group greeting', send_date: '2026-11-26T00:00:00Z', extra: {} },
                ].map(record => JSON.stringify(record)).join('\n'));
                const invoke = window.__TAURI__.core.invoke;
                // Adapt this synthetic group to the Web Host's existing character storage protocol.
                window.__TAURI__.core.invoke = (command, args, options) => {
                    if (command === 'get_group_chat_path') {
                        return invoke('get_chat_payload_path', { characterName: 'Review', fileName: args.id, allowNotFound: args.allowNotFound }, options);
                    }
                    if (command === 'begin_chat_commit' && args.target.kind === 'group') {
                        return invoke(command, { ...args, target: { kind: 'character', characterId: 'Review', fileName: args.target.chatId } }, options);
                    }
                    return invoke(command, args, options);
                };
                groupChats.applyGroupsSnapshot([{
                    id: 'preparation-group', name: 'Preparation Group', chat_id: 'preparation-group-chat',
                    chats: ['preparation-group-chat'], members: [avatar], disabled_members: [avatar],
                    activation_strategy: 1, generation_mode: 0,
                }]);
                await groupChats.openGroupById('preparation-group', { chatId: 'preparation-group-chat' });
                return groupChats;
            },
            selectDraftFiles(files) {
                if (!window.document.getElementById('attachFile')) {
                    const button = window.document.createElement('button');
                    button.id = 'attachFile';
                    window.document.body.append(button);
                }
                window.jQuery('#attachFile').trigger('click');
                const input = window.document.getElementById('file_form_input');
                const transfer = new window.DataTransfer();
                for (const file of files) transfer.items.add(file);
                input.files = transfer.files;
                const event = window.jQuery.Event('change');
                window.jQuery(input).trigger(event);
                return event.result;
            },
            startEmbedSelection(messageIndex, files) {
                const button = window.document.querySelector(`.mes[mesid="${messageIndex}"] .mes_embed`);
                assert.ok(button, 'The actual embed control must be available');
                window.jQuery(button).trigger('click');
                return this.submitEmbedSelection(files);
            },
            submitEmbedSelection(files) {
                const input = window.document.getElementById('embed_file_input');
                const transfer = new window.DataTransfer();
                for (const file of files) transfer.items.add(file);
                input.files = transfer.files;
                const event = window.jQuery.Event('change');
                window.jQuery(input).trigger(event);
                return event.result;
            },
            sendFromButton(text) {
                if (text !== undefined) window.jQuery('#send_textarea').val(text);
                const event = window.jQuery.Event('click');
                window.jQuery('#send_but').trigger(event);
                return event.result;
            },
            holdUpload() {
                const started = Promise.withResolvers();
                const reply = Promise.withResolvers();
                heldUpload = { started, reply };
                return heldUpload;
            },
            holdDelete(path) {
                const pending = { path, started: Promise.withResolvers(), reply: Promise.withResolvers() };
                deleteGates.add(pending);
                heldDelete = pending;
                return pending;
            },
            async startDeleteAction({ source = 'global', messageIndex, bulk = false } = {}) {
                let button;
                if (bulk) {
                    for (const checkbox of window.document.querySelectorAll('[data-attachment-url] .attachmentListItemCheckbox')) checkbox.checked = true;
                    button = window.document.querySelector('.bulkActionDelete');
                } else if (messageIndex !== undefined) {
                    button = window.document.querySelector(`.mes[mesid="${messageIndex}"] .mes_file_delete`);
                } else {
                    const list = source === 'character' ? '.characterAttachmentsList' : '.globalAttachmentsList';
                    button = window.document.querySelector(`${list} [data-attachment-url="${ORIGINAL_URL}"] .deleteAttachmentButton`);
                }
                assert.ok(button, 'The actual deletion control must be available');
                const event = window.jQuery.Event('click');
                window.jQuery(button).trigger(event);
                const operation = event.result;
                const outcome = operation.then(value => ({ value }), error => ({ error }));
                const confirmation = await waitForPopup(POPUP_TYPE.CONFIRM);
                return { operation, outcome, confirmation };
            },
            async reopenManager() {
                await manager.completeAffirmative();
                window.jQuery(opener).trigger('click');
                await waitForElement(`.globalAttachmentsList [data-attachment-url="${OTHER_URL}"]`);
                manager = Popup.util.popups.at(-1);
            },
            startScraper() {
                window.jQuery('.characterAttachmentsTitle .openActionModalButton').trigger('click');
                const button = [...window.document.querySelectorAll('.actionButtonText')]
                    .find(element => element.textContent === 'Fixture scraper').closest('.actionButton');
                const event = window.jQuery.Event('click');
                window.jQuery(button).trigger(event);
                return event.result;
            },
            async dropFiles(files) {
                const native = new window.Event('drop', { bubbles: true, cancelable: true });
                Object.defineProperty(native, 'dataTransfer', { value: { files } });
                const event = window.jQuery.Event('drop');
                event.originalEvent = native;
                window.jQuery(manager.dlg).trigger(event);
                const chooser = await waitForElement('.droppedFilesTarget');
                chooser.value = 'character';
                chooser.dispatchEvent(new window.Event('input', { bubbles: true }));
                await Popup.util.popups.at(-1).completeAffirmative();
            },
            holdReferenceSave(kind) {
                const started = Promise.withResolvers();
                const reply = Promise.withResolvers();
                const pending = { started, reply };
                referenceGates.add(pending);
                if (kind === 'settings') heldSettingsSave = pending;
                else heldMetadataSave = pending;
                return pending;
            },
            persistedAttachments(source, owner = avatar) {
                if (source === 'chat') {
                    return JSON.parse(runtime.fixture.chatFiles.get('review-chat').split('\n')[0]).chat_metadata.attachments ?? [];
                }
                const settings = JSON.parse(JSON.parse(runtime.fixture.backend.handle({
                    method: 'POST', url: '/api/settings/get', body: '{}',
                }).body).settings).extension_settings;
                return source === 'global' ? settings.attachments : settings.character_attachments[owner] ?? [];
            },
            async waitForInputPopup() {
                return waitForPopup(POPUP_TYPE.INPUT);
            },
            setSavedHashes: hashes => { savedHashes = hashes; },
            setVectorChunks: chunks => { vectorChunks = chunks; },
            holdVectorInsert() {
                heldVectorInsert = { started: Promise.withResolvers(), reply: Promise.withResolvers() };
                return heldVectorInsert;
            },
            holdRead() {
                const started = Promise.withResolvers();
                const reply = Promise.withResolvers();
                heldRead = { started, reply };
                return heldRead;
            },
            snapshot() {
                return JSON.parse(JSON.stringify({
                    original: files.get(ORIGINAL_URL),
                    global: extension_settings.attachments,
                    character: extension_settings.character_attachments[avatar],
                    disabled: extension_settings.disabled_attachments,
                    deleted,
                }));
            },
            async startReadAction(action, { source = 'global' } = {}) {
                let button;
                if (action === 'message') {
                    main.chat.push({
                        name: 'User', is_user: true, mes: 'Read this file.',
                        extra: { files: [{ url: ORIGINAL_URL, name: 'original.txt', size: 21 }] },
                    });
                    const message = window.document.createElement('div');
                    message.className = 'mes';
                    message.setAttribute('mesid', String(main.chat.length - 1));
                    message.innerHTML = '<div class="mes_file_container" data-index="0"><button class="mes_file_open"></button></div>';
                    window.document.body.append(message);
                    button = message.querySelector('.mes_file_open');
                } else {
                    const selector = {
                        view: '.viewAttachmentButton', edit: '.editAttachmentButton',
                        download: '.downloadAttachmentButton', move: '.moveAttachmentButton',
                    }[action];
                    button = window.document.querySelector(
                        `${source === 'character' ? '.characterAttachmentsList' : '.globalAttachmentsList'} [data-attachment-url="${ORIGINAL_URL}"] ${selector}`,
                    );
                }
                const clicking = window.jQuery.Event('click');
                window.jQuery(button).trigger(clicking);
                const operation = clicking.result;
                const outcome = operation.then(value => ({ value }), error => ({ error }));
                if (action === 'move') {
                    const control = await Promise.race([
                        waitForElement('.moveAttachmentTarget'),
                        outcome.then(() => { throw new Error('Move ended before its target chooser opened'); }),
                    ]);
                    control.value = 'character';
                    control.dispatchEvent(new window.Event('input', { bubbles: true }));
                    await Popup.util.popups.at(-1).completeAffirmative();
                }
                return { operation, outcome };
            },
            async closeFilePopups() {
                for (const popup of [...Popup.util.popups].reverse()) {
                    if (popup !== manager && popup.dlg.isConnected) await popup.completeNegative();
                }
            },
            async replace(action, { source = 'global' } = {}) {
                const { started, reply } = this.holdUpload();
                if (action === 'command') {
                    const operation = executeSlashCommandsWithOptions(
                        `/db-update source=${source} name=original.txt EDITED FILE CONTENT`,
                        { handleParserErrors: false, handleExecutionErrors: false },
                    );
                    const body = await Promise.race([
                        started.promise,
                        operation.then(() => { throw new Error('Attachment command ended before its upload'); }),
                    ]);
                    return { body, reply, operation };
                }
                const selector = action === 'edit' ? '.editAttachmentButton' : '.moveAttachmentButton';
                const button = window.document.querySelector(
                    `.globalAttachmentsList [data-attachment-url="${ORIGINAL_URL}"] ${selector}`,
                );
                const clicking = window.jQuery.Event('click');
                window.jQuery(button).trigger(clicking);
                const operation = clicking.result;
                const control = await Promise.race([
                    waitForElement(action === 'edit' ? '[name="notepadFileContent"]' : '.moveAttachmentTarget'),
                    operation.then(() => { throw new Error('Attachment action ended before its editor opened'); }),
                ]);
                const popup = Popup.util.popups.at(-1);
                control.value = action === 'edit' ? EDITED_TEXT : 'character';
                control.dispatchEvent(new window.Event('input', { bubbles: true }));
                await popup.completeAffirmative();
                const body = await Promise.race([
                    started.promise,
                    operation.then(() => { throw new Error('Attachment action ended before its upload'); }),
                ]);
                return { body, reply, operation };
            },
            async close() {
                for (const gate of referenceGates) gate.reply.resolve(new window.Response('Fixture closing', { status: 500 }));
                for (const gate of deleteGates) gate.reply.resolve(new window.Response('Fixture closing', { status: 500 }));
                heldRead?.reply.resolve(new window.Response('Fixture closing', { status: 500 }));
                heldUpload?.reply.resolve(new window.Response('Fixture closing', { status: 500 }));
                heldVectorInsert?.reply.resolve(new window.Response('Fixture closing', { status: 500 }));
                for (const popup of [...Popup.util.popups].reverse()) {
                    if (popup !== manager && popup.dlg.isConnected) await popup.completeNegative();
                }
                if (manager?.dlg?.isConnected) await manager.completeAffirmative();
                await window.happyDOM.close();
            },
            response: (body, status = 200) => new window.Response(body, {
                status, headers: { 'Content-Type': 'application/json' },
            }),
        };
    } catch (error) {
        for (const gate of deleteGates) gate.reply.resolve(new window.Response('Fixture closing', { status: 500 }));
        heldRead?.reply.resolve(new window.Response('Fixture closing', { status: 500 }));
        heldUpload?.reply.resolve(new window.Response('Fixture closing', { status: 500 }));
        if (manager?.dlg?.isConnected) await manager.completeAffirmative();
        await window.happyDOM.close();
        throw error;
    }
}

/** Hold the first real file read; subsequent validation/preparation reads remain independent. */
function holdFileText(file) {
    const started = Promise.withResolvers();
    const reply = Promise.withResolvers();
    const text = file.text.bind(file);
    let firstRead = true;
    file.text = () => {
        if (!firstRead) return text();
        firstRead = false;
        started.resolve();
        return reply.promise;
    };
    return { started, reply, text };
}

function draftFileState(window) {
    const form = window.document.getElementById('file_form');
    const label = form.querySelector('.file_name');
    return {
        names: [...window.document.getElementById('file_form_input').files].map(file => file.name),
        caption: label.textContent,
        title: label.getAttribute('title'),
        visible: !form.classList.contains('displayNone'),
    };
}

/** Observe real emitter resource lifetimes while preserving its subscription behavior. */
function trackChatSubscriptions(runtime) {
    const { eventSource, event_types } = runtime.getModule('scripts/events.js').namespace;
    const subscriptions = new Set();
    const on = eventSource.on;
    const removeListener = eventSource.removeListener;
    eventSource.on = function (event, listener) {
        if (event === event_types.CHAT_CHANGED) subscriptions.add(listener);
        return on.call(this, event, listener);
    };
    eventSource.removeListener = function (event, listener) {
        if (event === event_types.CHAT_CHANGED) subscriptions.delete(listener);
        return removeListener.call(this, event, listener);
    };
    return {
        subscriptions,
        restore() {
            eventSource.on = on;
            eventSource.removeListener = removeListener;
            subscriptions.clear();
        },
    };
}

/** Count actual text/Data URL reads, preserving the underlying File and FileReader IO. */
function observeAttachmentReads(window, file) {
    const reads = { text: 0, dataUrl: 0 };
    const text = file.text;
    const dataUrl = window.FileReader.prototype.readAsDataURL;
    file.text = function () {
        reads.text++;
        return text.call(this);
    };
    window.FileReader.prototype.readAsDataURL = function (blob) {
        if (blob === file) reads.dataUrl++;
        return dataUrl.call(this, blob);
    };
    return {
        reads,
        restore() {
            file.text = text;
            window.FileReader.prototype.readAsDataURL = dataUrl;
        },
    };
}

for (const action of ['edit', 'move', 'command']) {
    test(`Data Bank ${action} keeps its original until the replacement upload succeeds`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        let pending;
        try {
            const before = fixture.snapshot();
            pending = await fixture.replace(action);
            const whileUploading = fixture.snapshot();
            const failed = action === 'command'
                ? assert.rejects(pending.operation, /Synthetic replacement write failed/)
                : pending.operation;
            if (action !== 'move') {
                pending.reply.resolve(fixture.response('Synthetic replacement write failed', 500));
            } else {
                pending.reply.reject(new TypeError('Synthetic connection interrupted'));
            }
            await failed;
            pending = undefined;
            assert.deepEqual(whileUploading, before, 'An unconfirmed upload must not retire the source');
            assert.deepEqual(fixture.snapshot(), before, 'A failed upload must preserve the source and disabled state');
            assert.deepEqual(fixture.operations.map(operation => operation.operation), ['upload']);
            assert.equal(fixture.notices.length, action === 'command' ? 0 : 1);
            if (action !== 'command') {
                assert.ok(fixture.notices[0].join(' ').includes(
                    action !== 'move' ? 'Synthetic replacement write failed' : 'Synthetic connection interrupted',
                ));
            }

            pending = await fixture.replace(action);
            assert.deepEqual(fixture.snapshot(), before);
            const replacementUrl = '/user/files/replacement.txt';
            const uploadedText = Buffer.from(pending.body.data, 'base64').toString('utf8');
            fixture.files.set(replacementUrl, uploadedText);
            pending.reply.resolve(fixture.response(JSON.stringify({ path: replacementUrl })));
            const result = await pending.operation;
            pending = undefined;
            assert.equal(fixture.files.get(replacementUrl), action !== 'move' ? EDITED_TEXT : ORIGINAL_TEXT);
            if (action === 'command') assert.equal(result.pipe, replacementUrl);
            assert.equal(fixture.files.has(ORIGINAL_URL), false);
            assert.equal(fixture.files.get(OTHER_URL), 'OTHER FILE CONTENT');
            assert.deepEqual(fixture.operations.map(operation => operation.operation), ['upload', 'upload', 'delete']);
            assert.equal(fixture.operations[2].path, ORIGINAL_URL);
            assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
            const { global, character, disabled } = fixture.snapshot();
            const target = action !== 'move' ? global : character;
            assert.equal(target.filter(attachment => attachment.url === replacementUrl).length, 1);
            assert.equal(target.find(attachment => attachment.url === replacementUrl).name, 'original.txt');
            assert.equal(global.some(attachment => attachment.url === ORIGINAL_URL), false);
            assert.equal(global.some(attachment => attachment.url === OTHER_URL), true);
            assert.deepEqual(disabled, []);
            assert.equal(fixture.notices.length, action === 'command' ? 0 : 1);
            assert.deepEqual(fixture.errors, []);
        } finally {
            pending?.reply.resolve(fixture.response('Fixture closing', 500));
            if (pending) await Promise.allSettled([pending.operation]);
            await fixture.close();
        }
    });
}

for (const action of ['move', 'edit', 'view', 'download', 'message']) {
    test(`file ${action} stops after a failed read and can retry the original`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        const { window } = fixture.runtime;
        const read = fixture.holdRead();
        try {
            const before = fixture.snapshot();
            const pending = await fixture.startReadAction(action);
            await read.started.promise;
            assert.deepEqual(fixture.snapshot(), before, 'An unconfirmed read must preserve the source');
            const failure = 'Synthetic original read failed';
            if (action === 'edit') {
                read.reply.reject(new TypeError(failure));
            } else if (action === 'view') {
                const response = fixture.response('');
                response.text = async () => { throw new TypeError(failure); };
                read.reply.resolve(response);
            } else {
                read.reply.resolve(fixture.response(failure, action === 'message' ? 404 : 500));
            }
            let openedEditor = false;
            if (action === 'edit') {
                const result = await Promise.race([
                    pending.outcome,
                    fixture.waitForElement('[name="notepadFileContent"]').then(() => ({ editor: true })),
                ]);
                openedEditor = Boolean(result.editor);
                if (openedEditor) await fixture.closeFilePopups();
            }
            const outcome = await pending.outcome;
            assert.equal(outcome.error, undefined, 'The UI must own the read error');
            assert.deepEqual(fixture.snapshot(), before, 'A failed read must not retire the source');
            assert.deepEqual(fixture.operations, [], 'A failed read must not upload or delete content');
            assert.equal(fixture.downloads.length, 0, 'A failed read must not create a download');
            assert.equal(openedEditor, false, 'A failed read must not open an empty editor');
            assert.equal(fixture.Popup.util.popups.length, 1, 'A failed read must not open a blank viewer');
            assert.equal(fixture.notices.length, 1);
            assert.ok(fixture.notices[0].join(' ').includes(failure));

            const retry = await fixture.startReadAction(action);
            if (action === 'edit') {
                const input = await fixture.waitForElement('[name="notepadFileContent"]');
                assert.equal(input.value, ORIGINAL_TEXT);
                await fixture.closeFilePopups();
            } else if (action === 'view' || action === 'message') {
                const code = await fixture.waitForElement('.file_modal code');
                assert.equal(code.textContent, ORIGINAL_TEXT);
                await fixture.closeFilePopups();
            }
            assert.equal((await retry.outcome).error, undefined);
            if (action === 'download') assert.equal(await fixture.downloads[0].text(), ORIGINAL_TEXT);
            if (action === 'move') {
                assert.equal(fixture.files.get('/user/files/replacement.txt'), ORIGINAL_TEXT);
                assert.deepEqual(fixture.operations.map(item => item.operation), ['upload', 'delete']);
            }
            assert.equal(fixture.notices.length, 1);
            assert.deepEqual(fixture.errors, []);
        } finally {
            read.reply.resolve(new window.Response('Fixture closing', { status: 500 }));
            await fixture.close();
        }
    });
}

test('/db-get rejects a failed read and retains successful empty file text', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const read = fixture.holdRead();
    try {
        const before = fixture.snapshot();
        const reading = fixture.executeSlashCommandsWithOptions('/db-get source=global original.txt', {
            handleParserErrors: false, handleExecutionErrors: false,
        });
        const rejected = assert.rejects(reading, /Synthetic original read failed/);
        await read.started.promise;
        read.reply.resolve(fixture.response('Synthetic original read failed', 500));
        await rejected;
        assert.deepEqual(fixture.snapshot(), before);
        assert.deepEqual(fixture.notices, [], 'The command executor owns read-error presentation');
        fixture.files.set(ORIGINAL_URL, '');
        const result = await fixture.executeSlashCommandsWithOptions('/db-get source=global original.txt', {
            handleParserErrors: false, handleExecutionErrors: false,
        });
        assert.equal(result.pipe, '');
        assert.deepEqual(fixture.errors, []);
    } finally {
        read.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('chat prompt assembly rejects missing attachment text without sending a partial request', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const read = fixture.holdRead();
    const { runtime } = fixture;
    try {
        const app = await runtime.initializeChatRendering();
        runtime.getModule('scripts/macros.js').namespace.initMacros();
        app.changeMainAPI('openai');
        app.setOnlineStatus('synthetic-model');
        app.setCharacterName(app.characters[0].name);
        Object.assign(runtime.getModule('scripts/openai.js').namespace.oai_settings, {
            chat_completion_source: 'custom', custom_model: 'synthetic-model',
            custom_url: 'https://api.example.test/v1', custom_api_format: 'openai_compat',
        });
        const ajax = runtime.window.jQuery.ajax;
        runtime.window.jQuery.ajax = options => options.url?.startsWith('/api/tokenizers/openai/count-batch')
            ? Promise.resolve({ token_counts: JSON.parse(options.data).map(() => 4) })
            : ajax(options);
        const message = {
            name: 'User', is_user: true, is_system: false, mes: 'Read this file.',
            extra: { fileLength: 7, files: [{ url: ORIGINAL_URL, name: 'original.txt', size: 21 }] },
        };
        app.chat.push(message);
        const generation = app.generateQuietPrompt({ quietPrompt: 'Reply briefly.', responseLength: 32 });
        const rejected = assert.rejects(generation, /Synthetic original read failed/);
        await read.started.promise;
        const whileReading = message.extra.fileLength;
        read.reply.resolve(fixture.response('Synthetic original read failed', 500));
        await rejected;
        assert.equal(whileReading, 7, 'Unconfirmed reads must not remove the existing length');
        assert.equal(message.extra.fileLength, 7, 'Failed assembly must preserve the message metadata');
        assert.equal(message.mes, 'Read this file.');
        assert.deepEqual(fixture.modelRequests, []);
        assert.deepEqual(fixture.notices, [], 'Quiet generation delegates error presentation');
        assert.equal(await app.generateQuietPrompt({ quietPrompt: 'Reply briefly.', responseLength: 32 }), 'OK');
        assert.equal(fixture.modelRequests.length, 1);
        assert.ok(fixture.modelRequests[0].messages.some(item => item.content?.includes(ORIGINAL_TEXT)),
            JSON.stringify(fixture.modelRequests[0].messages));
        assert.deepEqual(fixture.errors, []);
    } finally {
        read.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('the normal send button reports an attachment read failure once and permits retry', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    const read = fixture.holdRead();
    const { window, getModule } = fixture.runtime;
    const app = fixture.main;
    try {
        app.changeMainAPI('openai');
        app.setOnlineStatus('synthetic-model');
        Object.assign(getModule('scripts/openai.js').namespace.oai_settings, {
            chat_completion_source: 'custom', custom_model: 'synthetic-model',
            custom_url: 'https://api.example.test/v1', custom_api_format: 'openai_compat',
            stream_openai: false,
        });
        const ajax = window.jQuery.ajax;
        window.jQuery.ajax = options => options.url?.startsWith('/api/tokenizers/openai/count-batch')
            ? Promise.resolve({ token_counts: JSON.parse(options.data).map(() => 4) })
            : ajax(options);
        const message = {
            name: 'User', is_user: true, is_system: false, mes: 'Read this file.',
            extra: { fileLength: 7, files: [{ url: ORIGINAL_URL, name: 'original.txt', size: 21 }] },
        };
        app.chat.push(message);
        const send = () => {
            const clicking = window.jQuery.Event('click');
            window.jQuery('#send_but').trigger(clicking);
            return clicking.result;
        };
        window.jQuery('#send_textarea').val('Explain the file.');
        const generation = send();
        const rejected = assert.rejects(generation, /Synthetic original read failed/);
        await read.started.promise;
        read.reply.resolve(fixture.response('Synthetic original read failed', 500));
        await rejected;
        assert.equal(message.mes, 'Read this file.');
        assert.equal(message.extra.fileLength, 7);
        assert.equal(app.is_send_press, false);
        assert.notEqual(window.document.body.dataset.generating, 'true');
        assert.deepEqual(fixture.modelRequests, []);
        assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT);
        assert.deepEqual(fixture.operations, []);
        assert.equal(fixture.notices.length, 1, 'The ordinary generation UI must own the read failure');
        assert.ok(fixture.notices[0].join(' ').includes('Synthetic original read failed'));

        await send();
        assert.equal(fixture.modelRequests.length, 1);
        assert.ok(fixture.modelRequests[0].messages.some(item => item.content?.includes(ORIGINAL_TEXT)));
        assert.equal(fixture.notices.length, 1);
        assert.equal(app.is_send_press, false);
        assert.deepEqual(fixture.errors, []);
    } finally {
        read.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('vector file retrieval preserves full message text when reading fails', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const read = fixture.holdRead();
    try {
        fixture.extension_settings.attachments = [];
        fixture.extension_settings.vectors = { enabled_files: true, enabled_chats: false, size_threshold: 0 };
        await (await fixture.runtime.load('scripts/extensions/vectors/index.js')).namespace.init();
        const prefix = ORIGINAL_TEXT + '\n\n';
        const message = {
            name: 'User', is_user: true, mes: prefix + 'Explain the file.',
            extra: { fileLength: prefix.length, files: [{ url: ORIGINAL_URL, name: 'original.txt', size: 21 }] },
        };
        const before = JSON.stringify(message);
        const retrieval = fixture.runtime.window.vectors_rearrangeChat([message], 4096, () => {}, 'normal');
        await read.started.promise;
        const whileReading = JSON.stringify(message);
        read.reply.resolve(fixture.response('Synthetic original read failed', 500));
        await retrieval;
        assert.equal(whileReading, before, 'Pending vector reads must not strip the attachment');
        assert.equal(JSON.stringify(message), before, 'Failed vector retrieval must leave full input available');
        assert.deepEqual(fixture.vectorRequests.map(request => request.url), ['/api/vector/list']);
        assert.deepEqual(fixture.notices, []);
        assert.equal(fixture.warnings.length, 1, 'The existing recovery boundary must report the skipped retrieval');
        await fixture.runtime.window.vectors_rearrangeChat([message], 4096, () => {}, 'normal');
        assert.equal(message.mes, 'SELECTED FILE CHUNK\n\nExplain the file.');
        assert.equal(fixture.warnings.length, 1);
        assert.deepEqual(fixture.errors, []);
    } finally {
        read.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('vectorize-all reports a failed file read once and skips reads for saved indexes', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const read = fixture.holdRead();
    try {
        fixture.extension_settings.disabled_attachments = [];
        fixture.extension_settings.attachments = fixture.extension_settings.attachments.slice(0, 1);
        fixture.extension_settings.vectors = { enabled_files: true, enabled_chats: false };
        await (await fixture.runtime.load('scripts/extensions/vectors/index.js')).namespace.init();
        const { window } = fixture.runtime;
        const click = () => {
            const event = window.jQuery.Event('click');
            window.jQuery('#vectors_files_vectorize_all').trigger(event);
            return event.result;
        };
        const vectorizing = click();
        await read.started.promise;
        read.reply.resolve(fixture.response('Synthetic original read failed', 500));
        await vectorizing;
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Synthetic original read failed'));
        assert.deepEqual(fixture.successes, []);
        assert.deepEqual(fixture.warnings, []);
        assert.equal(fixture.vectorRequests.some(request => request.url === '/api/vector/insert'), false);

        fixture.setSavedHashes([1]);
        const readsBefore = fixture.reads.length;
        await click();
        assert.equal(fixture.reads.length, readsBefore, 'A saved file index must not depend on another download');
        assert.equal(fixture.notices.length, 1);
        assert.equal(fixture.successes.length, 1);
        assert.deepEqual(fixture.errors, []);
    } finally {
        read.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('vector file ingestion failure keeps full prompt content and can retry', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const insertion = fixture.holdVectorInsert();
    const { window } = fixture.runtime;
    // The fixture caps repeated timers; check toast completion without its fade animation.
    window.jQuery.fx.off = true;
    try {
        fixture.extension_settings.attachments = [];
        fixture.extension_settings.vectors = { enabled_files: true, enabled_chats: false, size_threshold: 0 };
        await (await fixture.runtime.load('scripts/extensions/vectors/index.js')).namespace.init();
        const original = {
            name: 'User', is_user: true, mes: 'Explain the file.',
            extra: { files: [{ url: ORIGINAL_URL, name: 'original.txt', size: 21 }] },
        };
        const message = { ...original, mes: await fixture.chats.appendFileContent(original, original.mes) };
        const before = JSON.stringify(message);
        const canonicalBefore = JSON.stringify(original);
        const retrieval = window.vectors_rearrangeChat([message], 4096, () => {}, 'normal');
        await insertion.started.promise;
        const toast = await fixture.waitForElement('#toast-container .toast-info');
        assert.notEqual(window.getComputedStyle(toast).display, 'none');
        assert.equal(JSON.stringify(message), before, 'Pending embedding must retain the full prompt');
        insertion.reply.resolve(window.Response.json({
            message: 'Synthetic file embedding failed', cause: 'synthetic_file_embedding_failure',
        }, { status: 500 }));
        await retrieval;
        assert.equal(window.getComputedStyle(toast).display, 'none', 'Completed ingestion must stop showing its progress');
        assert.equal(JSON.stringify(message), before, 'Unconfirmed embedding must not replace attachment text');
        assert.equal(JSON.stringify(original), canonicalBefore);
        assert.deepEqual(fixture.vectorRequests.map(request => request.url), ['/api/vector/list', '/api/vector/insert']);
        assert.deepEqual(fixture.notices, [], 'The generation recovery boundary owns this failure');
        assert.equal(fixture.warnings.length, 1);

        await window.vectors_rearrangeChat([message], 4096, () => {}, 'normal');
        assert.equal(message.mes, 'SELECTED FILE CHUNK\n\nExplain the file.');
        assert.equal(message.extra.fileLength, 'SELECTED FILE CHUNK\n\n'.length);
        assert.equal(JSON.stringify(original), canonicalBefore, 'A prompt projection must preserve canonical metadata');
        assert.equal(fixture.warnings.length, 1);
        assert.deepEqual(fixture.errors, []);
    } finally {
        insertion.reply.resolve(window.Response.json({ message: 'Fixture closing' }, { status: 500 }));
        await fixture.close();
    }
});

for (const emptyHits of [false, true]) {
    test(`vector file queries preserve both user questions after ${emptyHits ? 'empty' : 'shorter'} retrieved content`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        try {
            fixture.extension_settings.attachments = [];
            fixture.extension_settings.vectors = { enabled_files: true, enabled_chats: false, size_threshold: 0, query: 2 };
            await (await fixture.runtime.load('scripts/extensions/vectors/index.js')).namespace.init();
            if (emptyHits) fixture.setVectorChunks([]);
            fixture.files.set(ORIGINAL_URL, ORIGINAL_TEXT.repeat(12));
            fixture.files.set(OTHER_URL, 'SECOND FULL ATTACHMENT CONTENT'.repeat(12));
            const originals = [
                { name: 'User', is_user: true, mes: 'FIRST FILE QUESTION', extra: { files: [{ url: ORIGINAL_URL, name: 'original.txt', size: 252 }] } },
                { name: 'User', is_user: true, mes: 'SECOND FILE QUESTION', extra: { files: [{ url: OTHER_URL, name: 'other.txt', size: 348 }] } },
            ];
            const prepared = [];
            for (const original of originals) {
                prepared.push({ ...original, mes: await fixture.chats.appendFileContent(original, original.mes) });
            }
            const canonicalBefore = JSON.stringify(originals);
            await fixture.runtime.window.vectors_rearrangeChat(prepared, 4096, () => {}, 'normal');
            assert.deepEqual(fixture.vectorRequests.filter(request => request.url === '/api/vector/query').map(request => request.body.searchText), [
                'SECOND FILE QUESTION\nFIRST FILE QUESTION',
                'SECOND FILE QUESTION\nFIRST FILE QUESTION',
            ]);
            const prefix = (emptyHits ? '' : 'SELECTED FILE CHUNK') + '\n\n';
            for (let index = 0; index < prepared.length; index++) {
                assert.equal(prepared[index].mes, prefix + originals[index].mes);
                assert.equal(prepared[index].extra.fileLength, prefix.length);
            }
            assert.equal(JSON.stringify(originals), canonicalBefore, 'Canonical messages keep the original attachment lengths');
            assert.deepEqual(fixture.notices, []);
            assert.deepEqual(fixture.warnings, []);
            assert.deepEqual(fixture.errors, []);
        } finally {
            await fixture.close();
        }
    });
}

for (const command of ['/db-ingest', '/db-search source=global return=chunks Explain the file.']) {
    test(`Data Bank vector command ${command.split(' ')[0]} propagates ingestion failure and retains its cause`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        const insertion = fixture.holdVectorInsert();
        const { window } = fixture.runtime;
        try {
            fixture.extension_settings.disabled_attachments = [];
            fixture.extension_settings.attachments = fixture.extension_settings.attachments.slice(0, 1);
            fixture.extension_settings.vectors = { enabled_files: true, enabled_chats: false };
            await (await fixture.runtime.load('scripts/extensions/vectors/index.js')).namespace.init();
            const before = fixture.snapshot();
            const options = { handleParserErrors: false, handleExecutionErrors: false };
            const ingesting = fixture.executeSlashCommandsWithOptions(command, options);
            const rejection = assert.rejects(ingesting, error => {
                assert.equal(error.message, 'Synthetic Data Bank embedding failed');
                assert.equal(error.cause?.message, 'Synthetic Data Bank embedding failed');
                assert.equal(error.cause?.cause, 'synthetic_file_embedding_failure');
                return true;
            });
            await insertion.started.promise;
            insertion.reply.resolve(window.Response.json({
                message: 'Synthetic Data Bank embedding failed', cause: 'synthetic_file_embedding_failure',
            }, { status: 500 }));
            await rejection;
            assert.deepEqual(fixture.snapshot(), before);
            assert.deepEqual(fixture.vectorRequests.map(request => request.url), ['/api/vector/list', '/api/vector/insert']);
            assert.deepEqual(fixture.notices, [], 'Pure commands delegate failure presentation to their executor');
            assert.deepEqual(fixture.warnings, []);

            const retry = await fixture.executeSlashCommandsWithOptions(command, options);
            assert.equal(retry.pipe, command === '/db-ingest' ? '' : 'SELECTED FILE CHUNK\n\n');
            if (command !== '/db-ingest') {
                fixture.setSavedHashes([1]);
                const reads = fixture.reads.length;
                const indexed = await fixture.executeSlashCommandsWithOptions(command, options);
                assert.equal(indexed.pipe, 'SELECTED FILE CHUNK\n\n');
                assert.equal(fixture.reads.length, reads, 'A confirmed collection must remain queryable without another file read');
            }
            assert.deepEqual(fixture.notices, []);
            assert.deepEqual(fixture.errors, []);
        } finally {
            insertion.reply.resolve(window.Response.json({ message: 'Fixture closing' }, { status: 500 }));
            await fixture.close();
        }
    });
}

for (const sourceAbort of [false, true]) {
    test(`vectorize-all preserves ${sourceAbort ? 'source abort' : 'partial success'} behavior after file ingestion fails`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        const insertion = fixture.holdVectorInsert();
        const { window } = fixture.runtime;
        try {
            fixture.extension_settings.disabled_attachments = [];
            fixture.extension_settings.vectors = { enabled_files: true, enabled_chats: false };
            await (await fixture.runtime.load('scripts/extensions/vectors/index.js')).namespace.init();
            const before = fixture.snapshot();
            const clicking = window.jQuery.Event('click');
            window.jQuery('#vectors_files_vectorize_all').trigger(clicking);
            const vectorizing = clicking.result;
            await insertion.started.promise;
            insertion.reply.resolve(window.Response.json({
                message: 'Synthetic file embedding failed',
                cause: sourceAbort ? 'embedding_auth_failed' : 'synthetic_file_embedding_failure',
            }, { status: 500 }));
            await vectorizing;
            assert.deepEqual(fixture.snapshot(), before);
            assert.equal(fixture.notices.length, 1);
            assert.ok(fixture.notices[0].join(' ').includes('Synthetic file embedding failed'));
            assert.equal(fixture.warnings.length, sourceAbort ? 0 : 1);
            assert.deepEqual(fixture.successes, []);
            assert.equal(fixture.vectorRequests.filter(request => request.url === '/api/vector/insert').length, sourceAbort ? 1 : 2);
            assert.equal(fixture.reads.includes(OTHER_URL), !sourceAbort, 'Only an ordinary per-file failure permits the remaining batch');
            assert.deepEqual(fixture.errors, []);
        } finally {
            insertion.reply.resolve(window.Response.json({ message: 'Fixture closing' }, { status: 500 }));
            await fixture.close();
        }
    });
}

function assertOriginalReachable(fixture, source) {
    const live = source === 'global' ? fixture.extension_settings.attachments
        : source === 'character' ? fixture.extension_settings.character_attachments[fixture.avatar]
            : fixture.main.chat_metadata.attachments;
    assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT);
    assert.ok(live.some(file => file.url === ORIGINAL_URL), 'The unretired source must remain in its owner');
    assert.ok(fixture.persistedAttachments(source).some(file => file.url === ORIGINAL_URL),
        'The saved source reference must still point to an existing file');
    assert.ok(fixture.extension_settings.disabled_attachments.includes(ORIGINAL_URL));
    assert.deepEqual(fixture.deleted, []);
}

for (const action of ['edit', 'move']) {
    test(`Data Bank ${action} waits for the replacement settings acknowledgement before retirement`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        let pending;
        let save;
        try {
            assert.equal(await fixture.main.flushPendingSettingsSave(true), true);
            save = fixture.holdReferenceSave('settings');
            pending = await fixture.replace(action);
            const pendingUrl = '/user/files/pending-replacement.txt';
            pending.reply.resolve(fixture.response(JSON.stringify({ path: pendingUrl })));
            const reachedSave = await Promise.race([
                save.started.promise.then(() => true), pending.operation.then(() => false),
            ]);
            assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT,
                'A replacement upload alone must not retire the saved original');
            assert.equal(reachedSave, true, 'The action must wait for the existing writer');
            assertOriginalReachable(fixture, 'global');
            if (action === 'edit') save.reply.resolve(fixture.response('Synthetic reference save failed', 500));
            else save.reply.reject(new TypeError('Synthetic settings transport failed'));
            await pending.operation;
            pending = undefined;
            save = undefined;
            assertOriginalReachable(fixture, 'global');
            assert.equal(fixture.files.get(pendingUrl), action === 'edit' ? EDITED_TEXT : ORIGINAL_TEXT);
            assert.equal(fixture.notices.length, 1, 'The existing settings writer owns the failure notice');
            assert.equal(fixture.operations.some(operation => operation.operation === 'delete'), false);

            save = fixture.holdReferenceSave('settings');
            pending = await fixture.replace(action);
            const replacementUrl = '/user/files/replacement.txt';
            pending.reply.resolve(fixture.response(JSON.stringify({ path: replacementUrl })));
            await save.started.promise;
            assertOriginalReachable(fixture, 'global');
            save.reply.resolve();
            await pending.operation;
            pending = undefined;
            save = undefined;
            const target = action === 'edit' ? 'global' : 'character';
            const saved = fixture.persistedAttachments(target);
            assert.ok(saved.some(file => file.url === replacementUrl));
            assert.equal(fixture.files.get(replacementUrl), action === 'edit' ? EDITED_TEXT : ORIGINAL_TEXT);
            assert.equal(fixture.files.has(ORIGINAL_URL), false);
            assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
            assert.equal(fixture.files.get(OTHER_URL), 'OTHER FILE CONTENT');
            assert.equal(fixture.notices.length, 1);
            assert.deepEqual(fixture.errors, []);
        } finally {
            save?.reply.resolve(fixture.response('Fixture closing', 500));
            pending?.reply.resolve(fixture.response('Fixture closing', 500));
            if (pending) await Promise.allSettled([pending.operation]);
            await fixture.close();
        }
    });
}

test('/db-update waits for chat metadata acknowledgement and preserves the original after failure', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    let pending;
    let save;
    try {
        const original = fixture.extension_settings.attachments.find(file => file.url === ORIGINAL_URL);
        fixture.extension_settings.attachments = fixture.extension_settings.attachments.filter(file => file !== original);
        fixture.main.chat_metadata.attachments = [original];
        await fixture.main.saveMetadata();
        assert.equal(await fixture.main.flushPendingSettingsSave(true), true);
        save = fixture.holdReferenceSave('metadata');
        pending = await fixture.replace('command', { source: 'chat' });
        pending.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/pending-replacement.txt' })));
        const reachedSave = await Promise.race([
            save.started.promise.then(() => true), pending.operation.then(() => false),
        ]);
        assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT,
            'Chat attachment retirement must wait for its metadata commit');
        assert.equal(reachedSave, true);
        assertOriginalReachable(fixture, 'chat');
        save.reply.reject(new Error('Synthetic metadata commit failed'));
        const failed = await pending.operation;
        pending = undefined;
        save = undefined;
        assert.equal(failed.pipe, '', 'An unconfirmed reference must not be returned as a replacement URL');
        assertOriginalReachable(fixture, 'chat');
        assert.equal(fixture.notices.length, 1, 'The existing chat writer owns the failure notice');

        save = fixture.holdReferenceSave('metadata');
        pending = await fixture.replace('command', { source: 'chat' });
        const replacementUrl = '/user/files/replacement.txt';
        pending.reply.resolve(fixture.response(JSON.stringify({ path: replacementUrl })));
        await save.started.promise;
        assertOriginalReachable(fixture, 'chat');
        save.reply.resolve();
        const result = await pending.operation;
        pending = undefined;
        save = undefined;
        assert.equal(result.pipe, replacementUrl);
        assert.ok(fixture.persistedAttachments('chat').some(file => file.url === replacementUrl));
        assert.equal(fixture.files.get(replacementUrl), EDITED_TEXT);
        assert.equal(fixture.files.has(ORIGINAL_URL), false);
        assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
        assert.equal(fixture.notices.length, 1);
        assert.deepEqual(fixture.errors, []);
    } finally {
        save?.reply.resolve();
        pending?.reply.resolve(fixture.response('Fixture closing', 500));
        if (pending) await Promise.allSettled([pending.operation]);
        await fixture.close();
    }
});

for (const phase of ['upload', 'settings']) {
    test(`switching characters during attachment ${phase} stops publication or retirement`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        let pending;
        let save;
        try {
            const original = fixture.extension_settings.attachments.find(file => file.url === ORIGINAL_URL);
            fixture.extension_settings.attachments = fixture.extension_settings.attachments.filter(file => file !== original);
            fixture.extension_settings.character_attachments[fixture.avatar] = [original];
            fixture.main.characters.push({ ...structuredClone(fixture.main.characters[0]), avatar: 'Other.png', name: 'Other' });
            fixture.extension_settings.character_attachments['Other.png'] = [];
            assert.equal(await fixture.main.flushPendingSettingsSave(true), true);
            if (phase === 'settings') save = fixture.holdReferenceSave('settings');
            pending = await fixture.replace('command', { source: 'character' });
            const replacementUrl = '/user/files/replacement.txt';
            if (phase === 'upload') fixture.main.setCharacterId(1);
            pending.reply.resolve(fixture.response(JSON.stringify({ path: replacementUrl })));
            if (phase === 'settings') {
                const reachedSave = await Promise.race([
                    save.started.promise.then(() => true), pending.operation.then(() => false),
                ]);
                assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT);
                assert.equal(reachedSave, true);
                fixture.main.setCharacterId(1);
                save.reply.resolve();
            }
            await assert.rejects(pending.operation, /attachment location changed/i);
            pending = undefined;
            save = undefined;
            assertOriginalReachable(fixture, 'character');
            assert.deepEqual(fixture.extension_settings.character_attachments['Other.png'], [],
                'The replacement must not be published to another character');
            assert.equal(fixture.files.get(replacementUrl), EDITED_TEXT,
                'The uploaded content remains available when a later location check stops the operation');
            assert.deepEqual(fixture.errors, []);
        } finally {
            save?.reply.resolve(fixture.response('Fixture closing', 500));
            pending?.reply.resolve(fixture.response('Fixture closing', 500));
            if (pending) await Promise.allSettled([pending.operation]);
            await fixture.close();
        }
    });
}

test('declining a chat integrity overwrite cannot acknowledge an attachment replacement', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    let pending;
    let reloads = 0;
    fixture.runtime.window.location.reload = () => { reloads += 1; };
    try {
        const original = fixture.extension_settings.attachments.find(file => file.url === ORIGINAL_URL);
        fixture.extension_settings.attachments = fixture.extension_settings.attachments.filter(file => file !== original);
        fixture.main.chat_metadata.attachments = [original];
        await fixture.main.saveMetadata();
        assert.equal(await fixture.main.flushPendingSettingsSave(true), true);
        const records = fixture.runtime.fixture.chatFiles.get('review-chat').split('\n');
        const header = JSON.parse(records[0]);
        header.chat_metadata.integrity = 'changed-outside-page';
        records[0] = JSON.stringify(header);
        fixture.runtime.fixture.chatFiles.set('review-chat', records.join('\n'));
        pending = await fixture.replace('command', { source: 'chat' });
        pending.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/replacement.txt' })));
        const popup = await Promise.race([
            fixture.waitForInputPopup(), pending.operation.then(() => undefined),
        ]);
        assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT,
            'An integrity conflict must not retire the source before consent');
        assert.ok(popup, 'The actual metadata writer must ask before overwriting');
        popup.mainInput.value = '';
        await popup.completeAffirmative();
        const result = await pending.operation;
        pending = undefined;
        assert.equal(result.pipe, '');
        assert.equal(reloads, 1);
        assertOriginalReachable(fixture, 'chat');
        assert.equal(JSON.parse(fixture.runtime.fixture.chatFiles.get('review-chat').split('\n')[0]).chat_metadata.integrity,
            'changed-outside-page');
        assert.deepEqual(fixture.notices, [], 'The integrity prompt already owns the user-visible result');
        assert.deepEqual(fixture.errors, []);
    } finally {
        pending?.reply.resolve(fixture.response('Fixture closing', 500));
        if (pending) await Promise.allSettled([pending.operation]);
        await fixture.close();
    }
});

test('neutral attachment replacement retains its existing session-only metadata behavior', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    let pending;
    try {
        const original = fixture.extension_settings.attachments.find(file => file.url === ORIGINAL_URL);
        fixture.extension_settings.attachments = fixture.extension_settings.attachments.filter(file => file !== original);
        fixture.main.setCharacterId(undefined);
        fixture.main.setCharacterName(fixture.main.neutralCharacterName);
        fixture.main.updateChatMetadata({ attachments: [original] }, true);
        assert.equal(await fixture.main.flushPendingSettingsSave(true), true);
        fixture.referenceSaves.length = 0;
        pending = await fixture.replace('command', { source: 'chat' });
        const replacementUrl = '/user/files/replacement.txt';
        pending.reply.resolve(fixture.response(JSON.stringify({ path: replacementUrl })));
        const result = await pending.operation;
        pending = undefined;
        assert.equal(result.pipe, replacementUrl);
        assert.equal(fixture.files.get(replacementUrl), EDITED_TEXT);
        assert.equal(fixture.referenceSaves.some(save => save.kind === 'metadata'), false);
        assert.deepEqual(fixture.main.chat_metadata.attachments.map(file => file.url), [replacementUrl]);
        const before = fixture.referenceSaves.length;
        await fixture.main.saveMetadata();
        assert.equal(fixture.referenceSaves.length, before);
        assert.deepEqual(fixture.errors, []);
    } finally {
        pending?.reply.resolve(fixture.response('Fixture closing', 500));
        if (pending) await Promise.allSettled([pending.operation]);
        await fixture.close();
    }
});

for (const action of ['move', 'edit']) {
    test(`a character switch during the ${action} source read stops the original action before upload`, { timeout: 30000 }, async () => {
        const source = action === 'edit' ? 'character' : 'global';
        const fixture = await createAttachmentFixture({ initialSource: source });
        const read = fixture.holdRead();
        try {
            fixture.main.characters.push({ ...structuredClone(fixture.main.characters[0]), avatar: 'Other.png', name: 'Other' });
            fixture.extension_settings.character_attachments['Other.png'] = [];
            assert.equal(await fixture.main.flushPendingSettingsSave(true), true);
            const pending = await fixture.startReadAction(action, { source });
            await read.started.promise;
            fixture.main.setCharacterId(1);
            read.reply.resolve(fixture.response(ORIGINAL_TEXT));
            if (action === 'edit') {
                const result = await Promise.race([
                    pending.outcome,
                    fixture.waitForElement('[name="notepadFileContent"]').then(input => ({ input })),
                ]);
                if (result.input) {
                    result.input.value = EDITED_TEXT;
                    result.input.dispatchEvent(new fixture.runtime.window.Event('input', { bubbles: true }));
                    await fixture.Popup.util.popups.at(-1).completeAffirmative();
                }
            }
            assert.equal((await pending.outcome).error, undefined);
            assertOriginalReachable(fixture, source);
            assert.deepEqual(fixture.operations, [], 'The original operation must not upload into the new character');
            assert.deepEqual(fixture.extension_settings.character_attachments['Other.png'], []);
            assert.equal(fixture.notices.length, 1);
            assert.ok(fixture.notices[0].join(' ').includes('attachment location changed'));
            assert.deepEqual(fixture.errors, []);
        } finally {
            read.reply.resolve(fixture.response('Fixture closing', 500));
            await fixture.close();
        }
    });
}

for (const phase of ['acquisition', 'upload']) {
    test(`the scraper control retains its target and presents a location failure during ${phase}`, { timeout: 30000 }, async () => {
        const input = { started: Promise.withResolvers(), reply: Promise.withResolvers() };
        const fixture = await createAttachmentFixture({ scraperInput: input });
        let upload;
        let operation;
        try {
            fixture.main.characters.push({ ...structuredClone(fixture.main.characters[0]), avatar: 'Other.png', name: 'Other' });
            fixture.extension_settings.character_attachments['Other.png'] = [];
            if (phase === 'upload') upload = fixture.holdUpload();
            operation = fixture.startScraper();
            await input.started.promise;
            if (phase === 'acquisition') fixture.main.setCharacterId(1);
            input.reply.resolve([new fixture.runtime.window.File([EDITED_TEXT], 'scraped.txt', { type: 'text/plain' })]);
            if (phase === 'upload') {
                await upload.started.promise;
                fixture.main.setCharacterId(1);
                upload.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/replacement.txt' })));
            }
            if (operation) await operation;
            await fixture.runtime.window.happyDOM.waitUntilComplete();
            assert.equal(fixture.notices.length, 1);
            assert.ok(fixture.notices[0].join(' ').includes('attachment location changed'),
                'The scraper control must preserve the original location failure cause');
            assert.deepEqual(fixture.successes, []);
            assert.deepEqual(fixture.extension_settings.character_attachments['Other.png'], []);
            if (phase === 'acquisition') assert.deepEqual(fixture.operations, []);
            else {
                assert.ok(fixture.notices[0].join(' ').includes('/user/files/replacement.txt'));
                assert.equal(fixture.files.get('/user/files/replacement.txt'), EDITED_TEXT);
            }
            assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT);
            assert.deepEqual(fixture.errors, []);
        } finally {
            input.reply.resolve([]);
            upload?.reply.resolve(fixture.response('Fixture closing', 500));
            if (operation) await Promise.allSettled([operation]);
            await fixture.close();
        }
    });
}

test('the Data Bank drop control owns a location failure and shows its uploaded file path', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const upload = fixture.holdUpload();
    try {
        fixture.main.characters.push({ ...structuredClone(fixture.main.characters[0]), avatar: 'Other.png', name: 'Other' });
        fixture.extension_settings.character_attachments['Other.png'] = [];
        await fixture.dropFiles([new fixture.runtime.window.File([EDITED_TEXT], 'dropped.txt', { type: 'text/plain' })]);
        await upload.started.promise;
        fixture.main.setCharacterId(1);
        upload.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/replacement.txt' })));
        await fixture.runtime.window.happyDOM.waitUntilComplete();
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('attachment location changed'));
        assert.ok(fixture.notices[0].join(' ').includes('/user/files/replacement.txt'));
        assert.equal(fixture.files.get('/user/files/replacement.txt'), EDITED_TEXT);
        assert.deepEqual(fixture.extension_settings.character_attachments['Other.png'], []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        upload.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('the Data Bank delete control keeps references and disabled state until deletion succeeds', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const deletion = fixture.holdDelete();
    try {
        await fixture.main.flushPendingSettingsSave(true);
        const before = fixture.snapshot();
        const pending = await fixture.startDeleteAction();
        await pending.confirmation.completeAffirmative();
        await deletion.started.promise;
        const during = fixture.snapshot();
        deletion.reply.resolve(fixture.response('Synthetic original deletion failed', 500));
        const outcome = await pending.outcome;
        assert.equal(outcome.error, undefined, 'The UI must own the deletion error');
        assert.deepEqual(during, before, 'Unconfirmed deletion must not remove the reference');
        assert.deepEqual(fixture.snapshot(), before, 'Failed deletion must remain retryable');
        assert.ok(fixture.persistedAttachments('global').some(file => file.url === ORIGINAL_URL));
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Synthetic original deletion failed'));
        assert.ok(fixture.runtime.window.document.querySelector(`[data-attachment-url="${ORIGINAL_URL}"]`));

        const retry = await fixture.startDeleteAction();
        await retry.confirmation.completeAffirmative();
        await retry.outcome;
        await fixture.main.flushPendingSettingsSave();
        assert.equal(fixture.files.has(ORIGINAL_URL), false);
        assert.equal(fixture.persistedAttachments('global').some(file => file.url === ORIGINAL_URL), false);
        assert.equal(fixture.extension_settings.disabled_attachments.includes(ORIGINAL_URL), false);
        assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
        assert.equal(fixture.notices.length, 1);
        assert.deepEqual(fixture.errors, []);
    } finally {
        deletion.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('/db-delete rejects the actual deletion failure and preserves its source', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const deletion = fixture.holdDelete();
    try {
        await fixture.main.flushPendingSettingsSave(true);
        const before = fixture.snapshot();
        const command = fixture.executeSlashCommandsWithOptions('/db-delete source=global original.txt', {
            handleParserErrors: false, handleExecutionErrors: false,
        });
        const rejected = assert.rejects(command, /Synthetic original deletion failed/);
        await deletion.started.promise;
        deletion.reply.resolve(fixture.response('Synthetic original deletion failed', 500));
        await rejected;
        await fixture.main.flushPendingSettingsSave();
        assert.deepEqual(fixture.snapshot(), before);
        assert.ok(fixture.persistedAttachments('global').some(file => file.url === ORIGINAL_URL));
        assert.deepEqual(fixture.notices, [], 'The command executor owns the error');
        const retry = await fixture.executeSlashCommandsWithOptions('/db-delete source=global original.txt', {
            handleParserErrors: false, handleExecutionErrors: false,
        });
        assert.equal(retry.pipe, '');
        await fixture.main.flushPendingSettingsSave();
        assert.equal(fixture.persistedAttachments('global').some(file => file.url === ORIGINAL_URL), false);
        assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
        assert.deepEqual(fixture.errors, []);
    } finally {
        deletion.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('an enabled character attachment deletion is saved through the original settings writer', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ initialSource: 'character' });
    try {
        fixture.extension_settings.disabled_attachments = [];
        await fixture.main.flushPendingSettingsSave(true);
        await fixture.executeSlashCommandsWithOptions('/db-delete source=character original.txt', {
            handleParserErrors: false, handleExecutionErrors: false,
        });
        await fixture.main.flushPendingSettingsSave();
        assert.equal(fixture.files.has(ORIGINAL_URL), false);
        assert.equal(fixture.persistedAttachments('character').some(file => file.url === ORIGINAL_URL), false);
        assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
        assert.deepEqual(fixture.notices, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        await fixture.close();
    }
});

test('the message file delete control consumes a failed deletion without removing the file', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const deletion = fixture.holdDelete();
    try {
        await fixture.main.getChat();
        const message = {
            name: 'User', is_user: true, mes: 'MESSAGE FILE TO DELETE',
            extra: { files: [{ url: ORIGINAL_URL, name: 'original.txt', size: 21 }] },
        };
        const messageIndex = fixture.main.chat.push(message) - 1;
        const block = fixture.runtime.window.document.createElement('div');
        block.className = 'mes';
        block.setAttribute('mesid', String(messageIndex));
        block.innerHTML = '<div class="mes_file_container" data-index="0"><button class="mes_file_delete"></button></div>';
        fixture.runtime.window.document.body.append(block);
        await fixture.main.saveChatConditional();
        const originalPayload = fixture.runtime.fixture.chatFiles.get('review-chat');
        const pending = await fixture.startDeleteAction({ messageIndex });
        await pending.confirmation.completeAffirmative();
        await deletion.started.promise;
        const duringFiles = message.extra.files.slice();
        deletion.reply.resolve(fixture.response('Synthetic message deletion failed', 500));
        await pending.outcome;
        assert.equal(duringFiles[0]?.url, ORIGINAL_URL);
        assert.equal(message.extra.files[0]?.url, ORIGINAL_URL);
        assert.equal(fixture.runtime.fixture.chatFiles.get('review-chat'), originalPayload);
        assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT);
        assert.deepEqual(fixture.deleted, []);
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Synthetic message deletion failed'));

        const retry = await fixture.startDeleteAction({ messageIndex });
        await retry.confirmation.completeAffirmative();
        await retry.outcome;
        assert.deepEqual(message.extra.files, []);
        const persisted = fixture.runtime.fixture.chatFiles.get('review-chat').split('\n')
            .map(line => JSON.parse(line)).find(item => item.mes === message.mes);
        assert.deepEqual(persisted.extra.files, []);
        assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
        assert.equal(fixture.notices.length, 1);
        assert.deepEqual(fixture.errors, []);
    } finally {
        deletion.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('/db-update deletion failure retains both confirmed replacement and retryable original', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const deletion = fixture.holdDelete();
    let upload;
    try {
        await fixture.main.flushPendingSettingsSave(true);
        upload = await fixture.replace('command');
        const rejected = assert.rejects(upload.operation, /Synthetic retirement deletion failed/);
        upload.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/replacement.txt' })));
        await deletion.started.promise;
        deletion.reply.resolve(fixture.response('Synthetic retirement deletion failed', 500));
        await rejected;
        assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT);
        assert.equal(fixture.files.get('/user/files/replacement.txt'), EDITED_TEXT);
        assert.deepEqual(fixture.persistedAttachments('global').map(file => file.url), [ORIGINAL_URL, OTHER_URL, '/user/files/replacement.txt']);
        assert.ok(fixture.extension_settings.disabled_attachments.includes(ORIGINAL_URL));
        assert.deepEqual(fixture.deleted, []);
        assert.deepEqual(fixture.notices, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        upload?.reply.resolve(fixture.response('Fixture closing', 500));
        deletion.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('the bulk delete control awaits deletion and preserves a failed selection for retry', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const deletion = fixture.holdDelete();
    try {
        await fixture.main.flushPendingSettingsSave(true);
        const before = fixture.snapshot();
        const pending = await fixture.startDeleteAction({ bulk: true });
        await pending.confirmation.completeAffirmative();
        await deletion.started.promise;
        const during = fixture.snapshot();
        const otherStillPresent = fixture.files.has(OTHER_URL);
        deletion.reply.resolve(fixture.response('Synthetic bulk deletion failed', 500));
        const outcome = await pending.outcome;
        assert.equal(outcome.error, undefined, 'The bulk control must own the error');
        assert.deepEqual(during, before);
        assert.equal(otherStillPresent, true);
        assert.deepEqual(fixture.snapshot(), before);
        assert.equal(fixture.runtime.window.document.querySelectorAll('.attachmentListItemCheckbox:checked').length, 2);
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Synthetic bulk deletion failed'));

        const retry = await fixture.startDeleteAction({ bulk: true });
        await retry.confirmation.completeAffirmative();
        await retry.outcome;
        await fixture.main.flushPendingSettingsSave();
        assert.deepEqual(fixture.extension_settings.attachments, []);
        assert.deepEqual(fixture.persistedAttachments('global'), []);
        assert.equal(fixture.files.size, 0);
        assert.equal(fixture.runtime.window.document.querySelectorAll('.attachmentListItemCheckbox:checked').length, 0);
        assert.deepEqual([...fixture.deleted].sort(), [ORIGINAL_URL, OTHER_URL].sort());
        assert.equal(fixture.notices.length, 1);
        assert.deepEqual(fixture.errors, []);
    } finally {
        deletion.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('the bulk delete control shows confirmed partial deletion and keeps only the failed file selected', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const [completedUrl, failedUrl] = [...fixture.runtime.window.document.querySelectorAll('.globalAttachmentsList [data-attachment-url]')]
        .map(item => item.dataset.attachmentUrl);
    const deletion = fixture.holdDelete(failedUrl);
    try {
        await fixture.main.flushPendingSettingsSave(true);
        const pending = await fixture.startDeleteAction({ bulk: true });
        await pending.confirmation.completeAffirmative();
        assert.equal(await deletion.started.promise, failedUrl);
        deletion.reply.resolve(fixture.response('Synthetic second deletion failed', 500));
        assert.equal((await pending.outcome).error, undefined);
        await fixture.main.flushPendingSettingsSave();
        assert.equal(fixture.files.has(completedUrl), false);
        assert.equal(fixture.files.has(failedUrl), true);
        assert.deepEqual(fixture.extension_settings.attachments.map(file => file.url), [failedUrl]);
        assert.deepEqual(fixture.persistedAttachments('global').map(file => file.url), [failedUrl]);
        const selected = fixture.runtime.window.document.querySelectorAll('.attachmentListItemCheckbox:checked');
        assert.equal(selected.length, 1);
        assert.equal(selected[0].closest('.attachmentListItem').dataset.attachmentUrl, failedUrl);
        assert.deepEqual(fixture.deleted, [completedUrl]);
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Synthetic second deletion failed'));

        const retry = await fixture.startDeleteAction({ bulk: true });
        await retry.confirmation.completeAffirmative();
        await retry.outcome;
        await fixture.main.flushPendingSettingsSave();
        assert.deepEqual(fixture.persistedAttachments('global'), []);
        assert.deepEqual(fixture.deleted, [completedUrl, failedUrl]);
        assert.equal(fixture.files.size, 0);
        assert.equal(fixture.notices.length, 1);
        assert.deepEqual(fixture.errors, []);
    } finally {
        deletion.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

test('verified orphan references are pruned without another deletion request or event', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    try {
        await fixture.main.flushPendingSettingsSave(true);
        fixture.files.delete(ORIGINAL_URL);
        await fixture.reopenManager();
        await fixture.main.flushPendingSettingsSave();
        assert.deepEqual(fixture.operations, []);
        assert.deepEqual(fixture.deleted, []);
        assert.deepEqual(fixture.extension_settings.attachments.map(file => file.url), [OTHER_URL]);
        assert.equal(fixture.extension_settings.disabled_attachments.includes(ORIGINAL_URL), false);
        assert.equal(fixture.persistedAttachments('global').some(file => file.url === ORIGINAL_URL), false);
        assert.deepEqual(fixture.notices, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        await fixture.close();
    }
});

for (const phase of ['confirmation', 'request']) {
    test(`a character switch during deletion ${phase} cannot remove another location's references`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture({ initialSource: 'character' });
        let deletion;
        try {
            const other = { ...fixture.main.characters[0], name: 'Other', avatar: 'Other.png' };
            fixture.main.characters.push(other);
            fixture.extension_settings.character_attachments[other.avatar] = [
                { url: OTHER_URL, name: 'other.txt', size: 18, created: 2 },
            ];
            const otherReferences = fixture.extension_settings.character_attachments[other.avatar].slice();
            if (phase === 'request') deletion = fixture.holdDelete();
            const pending = await fixture.startDeleteAction({ source: 'character' });
            if (phase === 'confirmation') fixture.main.setCharacterId(1);
            await pending.confirmation.completeAffirmative();
            if (deletion) {
                await deletion.started.promise;
                fixture.main.setCharacterId(1);
                deletion.reply.resolve(fixture.response('{}'));
            }
            const outcome = await pending.outcome;
            assert.equal(outcome.error, undefined, 'The original UI control must own the location error');
            assert.deepEqual(fixture.extension_settings.character_attachments[other.avatar], otherReferences);
            assert.ok(fixture.extension_settings.character_attachments[fixture.avatar].some(file => file.url === ORIGINAL_URL));
            assert.equal(fixture.notices.length, 1);
            assert.ok(fixture.notices[0].join(' ').includes('location changed'));
            if (phase === 'confirmation') {
                assert.deepEqual(fixture.operations, []);
                assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT);
                assert.deepEqual(fixture.deleted, []);
            } else {
                assert.equal(fixture.files.has(ORIGINAL_URL), false);
                assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
                assert.ok(fixture.notices[0].join(' ').includes(ORIGINAL_URL));
                assert.ok(fixture.notices[0].join(' ').includes('deleted'));
            }
            assert.deepEqual(fixture.errors, []);
        } finally {
            deletion?.reply.resolve(fixture.response('Fixture closing', 500));
            await fixture.close();
        }
    });
}

test('the public file deletion bool retains silent failures and its success event', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    try {
        for (const transport of [false, true]) {
            const deletion = fixture.holdDelete();
            const pending = fixture.chats.deleteFileFromServer(ORIGINAL_URL, true);
            await deletion.started.promise;
            if (transport) deletion.reply.reject(new TypeError('Synthetic deletion transport failed'));
            else deletion.reply.resolve(fixture.response('Synthetic public deletion failed', 500));
            assert.equal(await pending, false);
            assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT);
            assert.deepEqual(fixture.notices, [], 'silent applies to HTTP and transport failures');
            assert.deepEqual(fixture.deleted, []);
        }
        assert.equal(await fixture.chats.deleteFileFromServer(ORIGINAL_URL, true), true);
        assert.equal(fixture.files.has(ORIGINAL_URL), false);
        assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
        assert.deepEqual(fixture.errors, []);
    } finally {
        await fixture.close();
    }
});

test('the message deletion control reports a confirmed deletion after a real swipe replaces its file metadata', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    const deletion = fixture.holdDelete();
    const prototype = fixture.runtime.window.Element.prototype;
    const getAnimations = Object.getOwnPropertyDescriptor(prototype, 'getAnimations');
    // happy-dom lacks the browser animation inventory used by the actual swipe renderer.
    Object.defineProperty(prototype, 'getAnimations', { configurable: true, value: () => [] });
    try {
        await fixture.Popup.util.popups.at(-1).completeAffirmative();
        const attachment = { url: ORIGINAL_URL, name: 'original.txt', size: 21 };
        const message = {
            name: fixture.main.characters[0].name, is_user: false, is_system: false,
            mes: 'Candidate with a file', send_date: '2026-11-26T00:00:00Z',
            swipe_id: 0, swipes: ['Candidate with a file', 'Candidate without a file'],
            swipe_info: [
                { send_date: '2026-11-26T00:00:00Z', extra: { files: [attachment] } },
                { send_date: '2026-11-26T00:00:00Z', extra: {} },
            ],
            extra: { files: [attachment] },
        };
        const messageIndex = fixture.main.chat.push(message) - 1;
        fixture.main.addOneMessage(message);
        await fixture.main.saveChatConditional();
        const pending = await fixture.startDeleteAction({ messageIndex });
        await pending.confirmation.completeAffirmative();
        await deletion.started.promise;
        await fixture.main.swipe(null, 'right');
        assert.equal(message.swipe_id, 1);
        assert.equal(message.mes, 'Candidate without a file');
        assert.equal(message.extra.files, undefined, 'The actual swipe replaces attachment metadata');
        deletion.reply.resolve(fixture.response('{}'));
        const outcome = await pending.outcome;
        assert.equal(outcome.error, undefined, 'The UI must own the changed attachment location');
        assert.equal(fixture.files.has(ORIGINAL_URL), false);
        assert.deepEqual(fixture.deleted, [ORIGINAL_URL]);
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('deleted'));
        assert.ok(fixture.notices[0].join(' ').includes('location changed'));
        assert.ok(fixture.notices[0].join(' ').includes(ORIGINAL_URL));
        assert.equal(message.mes, 'Candidate without a file');
        assert.equal(message.extra.files, undefined);
        assert.deepEqual(fixture.errors, []);
    } finally {
        if (getAnimations) Object.defineProperty(prototype, 'getAnimations', getAnimations);
        else delete prototype.getAnimations;
        deletion.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

describe('live chat user attachment preparation', { concurrency: false }, () => {
    let fixture;

    beforeEach(async () => {
        fixture = await createAttachmentFixture({ readyApp: true });
    });

    afterEach(async () => {
        try {
            await fixture?.close();
        } finally {
            fixture = undefined;
        }
    });

    for (const failure of ['conversion', 'HTTP', 'transport', 'upload receipt', 'media upload receipt', 'response body']) {
        test(`normal attachment preparation preserves the draft after ${failure} failure`, { timeout: 30000 }, async () => {
            const { window } = fixture.runtime;
            let upload;
            try {
                fixture.configureModel();
                let convertible = false;
                fixture.chats.registerFileConverter('text/x-preparation', async () => {
                    if (!convertible) throw new Error('Synthetic document extraction failed');
                    return 'EXTRACTED DOCUMENT';
                });
                if (failure === 'conversion') {
                    fixture.extension_settings.regex = [{
                        id: 'preparation-draft', scriptName: 'Rewrite sent text',
                        findRegex: 'Explain', replaceString: 'Rewritten', trimStrings: [],
                        placement: [1], disabled: false, markdownOnly: false, promptOnly: false,
                        runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
                    }];
                }
                const media = failure === 'media upload receipt';
                const file = new window.File(
                    [media ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') : 'RAW DOCUMENT'],
                    media ? 'selected.png' : 'selected.txt',
                    { type: media ? 'image/png' : failure === 'conversion' ? 'text/x-preparation' : 'text/plain' },
                );
                await fixture.selectDraftFiles([file]);
                const input = window.document.getElementById('file_form_input');
                const before = fixture.main.chat.length;
                const persisted = fixture.runtime.fixture.chatFiles.get(fixture.main.getCurrentChatId());
                let resets = 0;
                window.jQuery('#file_form').on('reset.preparation', () => resets++);
                if (failure !== 'conversion') upload = fixture.holdUpload();
                const sending = fixture.sendFromButton('Explain the selected document.');
                const rejected = assert.rejects(sending, error => failure.includes('receipt')
                    ? /file path/i.test(String(error))
                    : failure === 'response body' ? /JSON|Unexpected/i.test(String(error))
                        : String(error).includes(failure === 'conversion'
                            ? 'Synthetic document extraction failed' : 'Synthetic upload failed'));
                if (upload) {
                    await upload.started.promise;
                    if (failure === 'HTTP') upload.reply.resolve(fixture.response('Synthetic upload failed', 500));
                    else if (failure === 'transport') upload.reply.reject(new TypeError('Synthetic upload failed'));
                    else if (failure.includes('receipt')) upload.reply.resolve(fixture.response('{}'));
                    else upload.reply.resolve(fixture.response('not valid JSON'));
                }
                await rejected;
                assert.equal(fixture.main.chat.length, before, 'Preparation failure must not publish a user message');
                assert.equal(fixture.runtime.fixture.chatFiles.get(fixture.main.getCurrentChatId()), persisted);
                assert.deepEqual(fixture.sentMessages, []);
                assert.deepEqual(fixture.modelRequests, []);
                assert.equal(window.document.getElementById('send_textarea').value, 'Explain the selected document.');
                assert.deepEqual([...input.files].map(file => file.name), [file.name]);
                assert.equal(window.document.getElementById('file_form').classList.contains('displayNone'), false);
                assert.equal(resets, 0, 'A failed preparation must not reset the selected file');
                assert.equal(fixture.main.is_send_press, false);
                assert.notEqual(window.document.body.dataset.generating, 'true');
                assert.equal(fixture.notices.length, 1, 'The normal input owns the preparation failure once');
                if (failure === 'conversion') assert.deepEqual(fixture.operations, [], 'Failed conversion must not upload raw bytes');

                convertible = true;
                await fixture.sendFromButton();
                const sent = fixture.main.chat[before];
                assert.equal(sent.mes, failure === 'conversion' ? 'Rewritten the selected document.' : 'Explain the selected document.');
                if (media) {
                    assert.equal(sent.extra.media[0].type, 'image');
                    assert.equal(sent.extra.media[0].source, 'upload');
                    assert.equal(sent.extra.media[0].title, file.name);
                    assert.equal(sent.extra.inline_image, true);
                    const image = fixture.modelRequests[0].messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
                        .find(content => content.type === 'image_url');
                    assert.equal(image.image_url.url, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=');
                } else {
                    assert.equal(sent.extra.files[0].name, file.name);
                    assert.equal(sent.extra.files[0].size, file.size);
                    assert.equal(fixture.files.get(sent.extra.files[0].url), failure === 'conversion' ? 'EXTRACTED DOCUMENT' : 'RAW DOCUMENT');
                }
                assert.equal(fixture.modelRequests.length, 1);
                assert.equal(fixture.notices.length, 1);
                assert.equal(input.files.length, 0);
                assert.equal(resets, 1);
                assert.equal(window.document.getElementById('file_form').classList.contains('displayNone'), true);
                assert.deepEqual(fixture.errors, []);
            } finally {
                upload?.reply.resolve(fixture.response('Fixture closing', 500));
            }
        });
    }

    test('the user-message API rejects attachment conversion without owning a UI notice', { timeout: 30000 }, async () => {
        const { window } = fixture.runtime;
        fixture.chats.registerFileConverter('text/x-api-preparation', async () => {
            throw new Error('Synthetic API conversion failed');
        });
        await fixture.selectDraftFiles([new window.File(['RAW API DOCUMENT'], 'api.txt', { type: 'text/x-api-preparation' })]);
        const before = fixture.main.chat.length;
        await assert.rejects(fixture.main.sendMessageAsUser('Original API message'), /Synthetic API conversion failed/);
        assert.equal(fixture.main.chat.length, before);
        assert.deepEqual(fixture.sentMessages, []);
        assert.deepEqual(fixture.operations, []);
        assert.deepEqual(fixture.notices, []);
        assert.equal(window.document.getElementById('send_textarea').value, 'Original API message');
        assert.deepEqual(fixture.errors, []);
    });

    for (const phase of ['token count', 'upload']) {
        test(`user attachment preparation retains its original conversation during ${phase}`, { timeout: 30000 }, async () => {
            const { window, getModule } = fixture.runtime;
            const token = { started: Promise.withResolvers(), reply: Promise.withResolvers() };
            let upload;
            try {
                fixture.configureModel();
                await fixture.selectDraftFiles([new window.File(['ORIGINAL TARGET FILE'], 'target.txt', { type: 'text/plain' })]);
                const originalCount = fixture.main.chat.length;
                const intended = 'Message intended for the original conversation';
                if (phase === 'token count') {
                    getModule('scripts/power-user.js').namespace.power_user.message_token_count_enabled = true;
                    const ajax = window.jQuery.ajax;
                    window.jQuery.ajax = options => {
                        if (options.url?.startsWith('/api/tokenizers/openai/count-batch')
                            && JSON.parse(options.data).some(item => item.content === intended)) {
                            token.started.resolve();
                            return token.reply.promise;
                        }
                        return ajax(options);
                    };
                } else upload = fixture.holdUpload();
                const sending = fixture.main.sendMessageAsUser(intended);
                const rejected = assert.rejects(sending, error => {
                    assert.match(String(error), /attachment location changed/);
                    if (phase === 'upload') assert.ok(String(error).includes('/user/files/original-target.txt'));
                    return true;
                });
                await (upload ? upload.started.promise : token.started.promise);
                fixture.main.characters.push({ ...structuredClone(fixture.main.characters[0]),
                    name: 'Other', avatar: 'Other.png', chat: 'other-chat' });
                fixture.main.setCharacterId(fixture.main.characters.length - 1);
                fixture.main.setCharacterName('Other');
                window.jQuery('#send_textarea').val('New conversation draft');
                if (upload) upload.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/original-target.txt' })));
                else token.reply.resolve({ token_counts: [4] });
                await rejected;
                assert.equal(fixture.main.chat.length, originalCount);
                assert.equal(fixture.runtime.fixture.chatFiles.has('other-chat'), false);
                assert.equal(window.document.getElementById('send_textarea').value, 'New conversation draft');
                assert.deepEqual(fixture.sentMessages, []);
                assert.deepEqual(fixture.notices, []);
                if (phase === 'token count') assert.deepEqual(fixture.operations, []);
                else assert.equal(fixture.files.get('/user/files/original-target.txt'), 'ORIGINAL TARGET FILE');
                assert.deepEqual(fixture.errors, []);
            } finally {
                token.reply.resolve({ token_counts: [4] });
                upload?.reply.resolve(fixture.response('Fixture closing', 500));
            }
        });
    }

    for (const phase of ['upload', 'token count']) {
        test(`a new file selection and text draft survive completion of an older preparation during ${phase}`, { timeout: 30000 }, async () => {
            const { window, getModule } = fixture.runtime;
            const upload = fixture.holdUpload();
            const token = { started: Promise.withResolvers(), reply: Promise.withResolvers() };
            try {
                fixture.configureModel();
                const oldFile = new window.File(['OLD SELECTION CONTENT'], 'old.txt', { type: 'text/plain' });
                const newFile = new window.File(['NEW SELECTION CONTENT'], 'new.txt', { type: 'text/plain' });
                await fixture.selectDraftFiles([oldFile]);
                const before = fixture.main.chat.length;
                if (phase === 'token count') {
                    getModule('scripts/power-user.js').namespace.power_user.message_token_count_enabled = true;
                    const ajax = window.jQuery.ajax;
                    window.jQuery.ajax = options => {
                        if (options.url?.startsWith('/api/tokenizers/openai/count-batch')
                            && JSON.parse(options.data).some(item => item.content === 'Send the first file.')) {
                            token.started.resolve();
                            return token.reply.promise;
                        }
                        return ajax(options);
                    };
                }
                const sending = fixture.sendFromButton('Send the first file.');
                await (phase === 'upload' ? upload.started.promise : token.started.promise);
                await fixture.selectDraftFiles([newFile]);
                window.jQuery('#send_textarea').val('My next message');
                token.reply.resolve({ token_counts: [4] });
                await upload.started.promise;
                upload.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/old-selection.txt' })));
                await sending;
                const sent = fixture.main.chat[before];
                assert.equal(sent.mes, 'Send the first file.');
                assert.equal(sent.extra.files.length, 1);
                assert.equal(sent.extra.files[0].url, '/user/files/old-selection.txt');
                assert.equal(fixture.modelRequests.length, 1);
                assert.ok(fixture.modelRequests[0].messages.some(message => message.content?.includes('OLD SELECTION CONTENT')));
                assert.equal(window.document.getElementById('send_textarea').value, 'My next message');
                assert.deepEqual([...window.document.getElementById('file_form_input').files].map(file => file.name), ['old.txt', 'new.txt']);
                assert.equal(window.document.getElementById('file_form').classList.contains('displayNone'), false);
                assert.deepEqual(fixture.notices, []);
                assert.deepEqual(fixture.errors, []);
            } finally {
                token.reply.resolve({ token_counts: [4] });
                upload.reply.resolve(fixture.response('Fixture closing', 500));
            }
        });
    }
});

function addReplyWithAttachment(fixture) {
    const message = {
        name: fixture.main.characters[0].name, is_user: false, is_system: false,
        mes: 'Candidate with a file', send_date: '2026-11-26T00:00:00Z',
        swipe_id: 0, swipes: ['Candidate with a file', 'Candidate without a file'],
        swipe_info: [
            { send_date: '2026-11-26T00:00:00Z', extra: { files: [{ url: ORIGINAL_URL, name: 'original.txt', size: 21 }] } },
            { send_date: '2026-11-26T00:00:00Z', extra: {} },
        ],
        extra: { files: [{ url: ORIGINAL_URL, name: 'original.txt', size: 21 }], note: 'Keep the original metadata' },
    };
    const index = fixture.main.chat.push(message) - 1;
    fixture.main.addOneMessage(message);
    return { message, index };
}

test('embed preparation preserves the message and independent draft after a partial conversion failure', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    const { window } = fixture.runtime;
    const upload = fixture.holdUpload();
    try {
        let convertible = false;
        fixture.chats.registerFileConverter('text/x-partial-preparation', async () => {
            if (!convertible) throw new Error('Synthetic partial conversion failed');
            return 'CONVERTED EMBED TEXT';
        });
        await fixture.selectDraftFiles([new window.File(['INDEPENDENT DRAFT'], 'draft.txt', { type: 'text/plain' })]);
        const { message, index } = addReplyWithAttachment(fixture);
        const before = JSON.stringify(message);
        let resets = 0;
        window.jQuery('#file_form').on('reset.embedPreparation', () => resets++);
        const files = [
            new window.File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')],
                'embed.png', { type: 'image/png' }),
            new window.File(['RAW EMBED TEXT'], 'embed.txt', { type: 'text/x-partial-preparation' }),
        ];
        const pending = fixture.startEmbedSelection(index, files);
        const outcome = pending.then(value => ({ value }), error => ({ error }));
        await upload.started.promise;
        upload.reply.resolve(fixture.response(JSON.stringify({ path: '/user/images/partial-embed.png' })));
        const completed = await outcome;
        assert.equal(completed.error, undefined, 'The actual embed control owns preparation failure');
        assert.equal(JSON.stringify(message), before, 'Partial new results must not mutate canonical message state');
        assert.deepEqual(fixture.embeddedMessages, []);
        assert.equal(fixture.operations.length, 1, 'Failed conversion must not upload its raw content');
        assert.equal(fixture.files.has('/user/images/partial-embed.png'), true);
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Synthetic partial conversion failed'));
        assert.ok(fixture.notices[0].join(' ').includes('/user/images/partial-embed.png'));
        assert.equal(resets, 0);
        assert.equal(window.document.getElementById('file_form').classList.contains('displayNone'), false);
        assert.deepEqual([...window.document.getElementById('file_form_input').files].map(file => file.name), ['draft.txt']);
        assert.deepEqual([...window.document.getElementById('embed_file_input').files].map(file => file.name), ['embed.png', 'embed.txt']);

        convertible = true;
        await fixture.startEmbedSelection(index, files);
        assert.equal(message.extra.note, 'Keep the original metadata');
        assert.equal(message.extra.files[0].url, ORIGINAL_URL);
        assert.equal(message.extra.files.length, 2);
        assert.equal(fixture.files.get(message.extra.files[1].url), 'CONVERTED EMBED TEXT');
        assert.equal(message.extra.media[0].type, 'image');
        assert.equal(message.extra.media[0].source, 'upload');
        assert.equal(message.extra.media[0].title, 'embed.png');
        assert.equal(message.extra.inline_image, true);
        assert.deepEqual(fixture.embeddedMessages, [index]);
        assert.equal(window.document.getElementById('embed_file_input').files.length, 0);
        assert.equal(resets, 0, 'Embed success must not reset the independent main draft');
        assert.equal(window.document.getElementById('file_form').classList.contains('displayNone'), false);
        assert.equal(fixture.notices.length, 1);
        assert.deepEqual(fixture.errors, []);
    } finally {
        upload.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

for (const phase of ['selection', 'upload', 'message removal']) {
    test(`embed preparation refuses a changed canonical target during ${phase}`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture({ readyApp: true });
        const { window } = fixture.runtime;
        const prototype = window.Element.prototype;
        const getAnimations = Object.getOwnPropertyDescriptor(prototype, 'getAnimations');
        Object.defineProperty(prototype, 'getAnimations', { configurable: true, value: () => [] });
        let upload;
        try {
            await fixture.Popup.util.popups.at(-1).completeAffirmative();
            await fixture.selectDraftFiles([new window.File(['MAIN DRAFT'], 'draft.txt', { type: 'text/plain' })]);
            const { message, index } = addReplyWithAttachment(fixture);
            const files = [new window.File(['NEW EMBED CONTENT'], 'new-embed.txt', { type: 'text/plain' })];
            let pending;
            if (phase === 'selection') {
                window.jQuery(`.mes[mesid="${index}"] .mes_embed`).trigger('click');
                await fixture.main.swipe(null, 'right');
                pending = fixture.submitEmbedSelection(files);
            } else {
                upload = fixture.holdUpload();
                pending = fixture.startEmbedSelection(index, files);
                await upload.started.promise;
            }
            const outcome = pending.then(value => ({ value }), error => ({ error }));
            if (phase === 'upload') await fixture.main.swipe(null, 'right');
            else if (phase === 'message removal') await fixture.main.deleteMessage(index);
            upload?.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/changed-embed.txt' })));
            assert.equal((await outcome).error, undefined);
            assert.deepEqual(fixture.embeddedMessages, []);
            assert.equal(fixture.notices.length, 1);
            assert.ok(fixture.notices[0].join(' ').includes('attachment location changed'));
            if (phase === 'selection') assert.deepEqual(fixture.operations, []);
            else assert.ok(fixture.notices[0].join(' ').includes('/user/files/changed-embed.txt'));
            if (phase !== 'message removal') {
                assert.equal(message.swipe_id, 1);
                assert.equal(message.mes, 'Candidate without a file');
                assert.equal(message.extra.files, undefined);
            } else assert.equal(fixture.main.chat.includes(message), false);
            assert.equal(fixture.main.chat.some(message => message.extra?.files?.some(file => file.url === '/user/files/changed-embed.txt')), false);
            assert.equal(window.document.getElementById('file_form').classList.contains('displayNone'), false);
            assert.deepEqual([...window.document.getElementById('file_form_input').files].map(file => file.name), ['draft.txt']);
            assert.deepEqual(fixture.errors, []);
        } finally {
            if (getAnimations) Object.defineProperty(prototype, 'getAnimations', getAnimations);
            else delete prototype.getAnimations;
            upload?.reply.resolve(fixture.response('Fixture closing', 500));
            await fixture.close();
        }
    });
}

test('embed preparation follows canonical reindexing and retains a valid metadata edit', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    const upload = fixture.holdUpload();
    const { window } = fixture.runtime;
    try {
        const { message, index } = addReplyWithAttachment(fixture);
        const pending = fixture.startEmbedSelection(index,
            [new window.File(['CANONICAL EMBED CONTENT'], 'canonical.txt', { type: 'text/plain' })]);
        await upload.started.promise;
        message.extra = { ...message.extra, note: 'Edited while uploading' };
        fixture.main.chat.unshift({
            name: 'System', is_user: false, is_system: true, mes: 'Inserted before the target',
            send_date: '2026-11-26T00:00:00Z', extra: {},
        });
        await fixture.main.printMessages();
        upload.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/canonical.txt' })));
        await pending;
        assert.equal(message.extra.note, 'Edited while uploading');
        assert.equal(message.extra.files.length, 2);
        assert.equal(message.extra.files[1].url, '/user/files/canonical.txt');
        assert.deepEqual(fixture.embeddedMessages, [index + 1], 'Event identity comes from the current canonical message index');
        // The bounded, zero-height fixture may not mount the target row. Check the real writer's canonical position.
        const persisted = JSON.parse(fixture.runtime.fixture.chatFiles.get(fixture.main.getCurrentChatId()).split('\n')[index + 2]);
        assert.equal(persisted.extra.note, 'Edited while uploading');
        assert.equal(persisted.extra.files[1].url, '/user/files/canonical.txt');
        assert.deepEqual(fixture.notices, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        upload.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

for (const [action, failure] of [['scraper', 'conversion'], ['drop', 'conversion'], ['scraper', 'validation']]) {
    test(`Data Bank ${action} preparation refreshes confirmed partial results after ${failure} failure`, { timeout: 30000 }, async () => {
        const input = { started: Promise.withResolvers(), reply: Promise.withResolvers() };
        const fixture = await createAttachmentFixture({ scraperInput: input });
        const { window } = fixture.runtime;
        try {
            fixture.chats.registerFileConverter('text/x-data-bank-preparation', async () => {
                throw new Error('Synthetic Data Bank conversion failed');
            });
            const files = [
                new window.File(['CONFIRMED FIRST DOCUMENT'], 'confirmed.txt', { type: 'text/plain' }),
                new window.File([failure === 'validation' ? '\0\0\0' : 'RAW REJECTED DOCUMENT'],
                    'rejected.bin', { type: failure === 'validation' ? 'application/octet-stream' : 'text/x-data-bank-preparation' }),
            ];
            if (action === 'scraper') {
                const operation = fixture.startScraper();
                await input.started.promise;
                input.reply.resolve(files);
                await operation;
            } else await fixture.dropFiles(files);
            await window.happyDOM.waitUntilComplete();
            const attachments = fixture.extension_settings.character_attachments[fixture.avatar];
            assert.equal(attachments.length, 1);
            assert.equal(attachments[0].name, 'confirmed.txt');
            assert.equal(fixture.files.get(attachments[0].url), 'CONFIRMED FIRST DOCUMENT');
            assert.equal(fixture.operations.length, 1);
            assert.ok(window.document.querySelector(`.characterAttachmentsList [data-attachment-url="${attachments[0].url}"]`),
                'The actual control must show independently confirmed results after a later failure');
            assert.equal(fixture.notices.length, 1);
            assert.ok(fixture.notices[0].join(' ').includes(failure === 'conversion' ? 'Synthetic Data Bank conversion failed' : 'Binary files'));
            assert.deepEqual(fixture.successes, [], 'A rejected file is not a successful scrape');
            assert.equal(fixture.files.get(ORIGINAL_URL), ORIGINAL_TEXT);
            assert.deepEqual(fixture.errors, []);
        } finally {
            input.reply.resolve([]);
            await fixture.close();
        }
    });
}

test('group attachment preparation reports its failure without clearing the original draft', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    const { window } = fixture.runtime;
    try {
        fixture.configureModel();
        const groupChats = await fixture.openMutedGroup();
        fixture.chats.registerFileConverter('text/x-group-preparation', async () => {
            throw new Error('Synthetic group conversion failed');
        });
        await fixture.selectDraftFiles([new window.File(['RAW GROUP DOCUMENT'], 'group.txt', { type: 'text/x-group-preparation' })]);
        const before = fixture.main.chat.length;
        await assert.rejects(fixture.sendFromButton('Keep my group draft'), /Synthetic group conversion failed/);
        assert.equal(fixture.main.chat.length, before);
        assert.deepEqual(fixture.modelRequests, []);
        assert.deepEqual(fixture.sentMessages, []);
        assert.deepEqual(fixture.operations, []);
        assert.equal(window.document.getElementById('send_textarea').value, 'Keep my group draft');
        assert.equal(window.document.getElementById('file_form').classList.contains('displayNone'), false);
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Synthetic group conversion failed'));
        assert.equal(groupChats.is_group_generating, false);
        assert.deepEqual(fixture.errors, []);
    } finally {
        await fixture.close();
    }
});

test('group attachment preparation preserves the next text draft after a successful upload', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    const { window } = fixture.runtime;
    const upload = fixture.holdUpload();
    try {
        fixture.configureModel();
        const groupChats = await fixture.openMutedGroup();
        await fixture.selectDraftFiles([new window.File(['GROUP ATTACHMENT CONTENT'], 'group.txt', { type: 'text/plain' })]);
        const before = fixture.main.chat.length;
        const sending = fixture.sendFromButton('Send the group file');
        await upload.started.promise;
        window.jQuery('#send_textarea').val('My next group draft')[0].dispatchEvent(new window.Event('input', { bubbles: true }));
        upload.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/group-draft.txt' })));
        await sending;
        assert.equal(fixture.main.chat[before].mes, 'Send the group file');
        assert.equal(fixture.main.chat[before].extra.files[0].url, '/user/files/group-draft.txt');
        assert.equal(window.document.getElementById('send_textarea').value, 'My next group draft');
        assert.deepEqual(fixture.sentMessages, [before]);
        assert.deepEqual(fixture.modelRequests, []);
        assert.deepEqual(fixture.notices, []);
        assert.equal(groupChats.is_group_generating, false);
        const persisted = JSON.parse(fixture.runtime.fixture.chatFiles.get('preparation-group-chat').split('\n')[before + 1]);
        assert.equal(persisted.mes, 'Send the group file');
        assert.equal(persisted.extra.files[0].url, '/user/files/group-draft.txt');
        assert.deepEqual(fixture.errors, []);
    } finally {
        upload.reply.resolve(fixture.response('Fixture closing', 500));
        await fixture.close();
    }
});

for (const validation of ['valid', 'unsupported', 'read failure']) {
    test(`attachment validation retains the new embed selection after an older ${validation} result`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture({ readyApp: true });
        const { window } = fixture.runtime;
        const upload = fixture.holdUpload();
        let read;
        let oldOperation;
        let newOperation;
        try {
            const oldTarget = addReplyWithAttachment(fixture);
            const newTarget = addReplyWithAttachment(fixture);
            const oldBefore = JSON.stringify(oldTarget.message);
            const oldFile = new window.File([validation === 'unsupported' ? '\x01\x02' : 'OLD EMBED CONTENT'],
                'old-embed.txt', { type: 'text/plain' });
            read = holdFileText(oldFile);
            oldOperation = fixture.startEmbedSelection(oldTarget.index, [oldFile]);
            const oldOutcome = oldOperation.then(value => ({ value }), error => ({ error }));
            await read.started.promise;
            newOperation = fixture.startEmbedSelection(newTarget.index,
                [new window.File(['CURRENT EMBED CONTENT'], 'current-embed.txt', { type: 'text/plain' })]);
            const newOutcome = newOperation.then(value => ({ value }), error => ({ error }));
            await upload.started.promise;
            if (validation === 'read failure') read.reply.reject(new Error('Synthetic obsolete embed read failed'));
            else read.reply.resolve(await read.text());
            assert.equal((await oldOutcome).error, undefined);
            assert.equal(JSON.stringify(oldTarget.message), oldBefore, 'Older validation must not publish another message selection');
            assert.deepEqual(fixture.embeddedMessages, []);
            assert.equal(fixture.notices.length, 1);
            assert.ok(fixture.notices[0].join(' ').includes('file selection changed'));
            assert.deepEqual(fixture.warnings, [], 'An obsolete unsupported result must not warn about the current selection');
            assert.equal(fixture.operations.length, 1, 'Only the current selection owns an upload');
            assert.deepEqual([...window.document.getElementById('embed_file_input').files].map(file => file.name), ['current-embed.txt']);
            upload.reply.resolve(fixture.response(JSON.stringify({ path: '/user/files/current-selection.txt' })));
            assert.equal((await newOutcome).error, undefined);
            assert.equal(newTarget.message.extra.files.length, 2);
            assert.equal(newTarget.message.extra.files[1].name, 'current-embed.txt');
            assert.equal(newTarget.message.extra.files[1].url, '/user/files/current-selection.txt');
            assert.deepEqual(fixture.embeddedMessages, [newTarget.index]);
            assert.equal(window.document.getElementById('embed_file_input').files.length, 0);
            assert.deepEqual(fixture.errors, []);
        } finally {
            read?.reply.resolve('OLD EMBED CONTENT');
            upload.reply.resolve(fixture.response('Fixture closing', 500));
            await Promise.allSettled([oldOperation, newOperation]);
            await fixture.close();
        }
    });
}

for (const validation of ['valid', 'unsupported', 'read failure']) {
    test(`file picker preserves the new draft after cancelling an older ${validation} result`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        const { window } = fixture.runtime;
        let read;
        let oldOperation;
        try {
            await fixture.selectDraftFiles([new window.File(['APPROVED FILE'], 'approved.txt', { type: 'text/plain' })]);
            const oldFile = new window.File([validation === 'unsupported' ? '\x01\x02' : 'OLDER FILE'],
                'older.bin', { type: 'text/plain' });
            read = holdFileText(oldFile);
            oldOperation = fixture.selectDraftFiles([oldFile]);
            const oldOutcome = oldOperation.then(value => ({ value }), error => ({ error }));
            await read.started.promise;
            window.document.getElementById('file_form_reset').click();
            assert.equal(window.document.getElementById('file_form_input').files.length, 0);
            await fixture.selectDraftFiles([new window.File(['LATEST VALID FILE'], 'latest.txt', { type: 'text/plain' })]);
            const latest = draftFileState(window);
            if (validation === 'read failure') read.reply.reject(new Error('Synthetic obsolete picker read failed'));
            else read.reply.resolve(await read.text());
            assert.equal((await oldOutcome).error, undefined, 'The obsolete UI operation must finish without an unowned rejection');
            assert.deepEqual(draftFileState(window), latest);
            assert.deepEqual(latest, { names: ['latest.txt'], caption: 'latest.txt', title: 'latest.txt', visible: true });
            assert.deepEqual(fixture.notices, []);
            assert.deepEqual(fixture.warnings, []);
            assert.deepEqual(fixture.errors, []);
        } finally {
            read?.reply.resolve('Fixture closing');
            await Promise.allSettled([oldOperation]);
            await fixture.close();
        }
    });
}

test('file picker follows its actual chat location during validation and same-chat reload', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    const { window } = fixture.runtime;
    const file = new window.File(['\x01\x02'], 'original-location.bin', { type: 'text/plain' });
    const read = holdFileText(file);
    let oldOperation;
    try {
        oldOperation = fixture.selectDraftFiles([file]);
        const oldOutcome = oldOperation.then(value => ({ value }), error => ({ error }));
        await read.started.promise;
        const originalLocation = fixture.main.getCurrentChatLocationIdentity();
        await fixture.main.reloadCurrentChat();
        assert.equal(fixture.main.getCurrentChatLocationIdentity(), originalLocation);
        assert.deepEqual(draftFileState(window),
            { names: ['original-location.bin'], caption: 'original-location.bin', title: 'original-location.bin', visible: true });
        fixture.main.characters.push({ ...structuredClone(fixture.main.characters[0]),
            name: 'Other', avatar: 'Other.png', chat: 'other-chat' });
        fixture.runtime.fixture.chatFiles.set('other-chat', [
            { user_name: 'User', character_name: 'Other', chat_metadata: { integrity: 'other-picker-integrity' } },
            { name: 'Other', is_user: false, mes: 'Other greeting', send_date: '2026-11-26T00:00:00Z', extra: {} },
        ].map(record => JSON.stringify(record)).join('\n'));
        await fixture.main.selectCharacterById(fixture.main.characters.length - 1);
        assert.notEqual(fixture.main.getCurrentChatLocationIdentity(), originalLocation);
        assert.equal(window.document.getElementById('file_form_input').files.length, 0,
            'An active-chat draft must reset while validation is still awaiting IO');
        assert.equal(draftFileState(window).visible, false);
        await fixture.selectDraftFiles([new window.File(['OTHER CHAT DRAFT'], 'other-draft.txt', { type: 'text/plain' })]);
        const current = draftFileState(window);
        read.reply.resolve(await read.text());
        assert.equal((await oldOutcome).error, undefined);
        assert.deepEqual(draftFileState(window), current);
        assert.deepEqual(current.names, ['other-draft.txt']);
        assert.deepEqual(fixture.notices, []);
        assert.deepEqual(fixture.warnings, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        read.reply.resolve('Fixture closing');
        await Promise.allSettled([oldOperation]);
        await fixture.close();
    }
});

test('file picker keeps the welcome draft when its first conversation opens during validation', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture({ readyApp: true });
    const { window } = fixture.runtime;
    const file = new window.File(['WELCOME FILE'], 'welcome.txt', { type: 'text/plain' });
    const read = holdFileText(file);
    let choosing;
    try {
        fixture.main.setCharacterId(undefined);
        assert.equal(fixture.main.getCurrentChatId(), undefined);
        choosing = fixture.selectDraftFiles([file]);
        await read.started.promise;
        await fixture.main.selectCharacterById(0);
        assert.deepEqual([...window.document.getElementById('file_form_input').files], [file]);
        read.reply.resolve(await read.text());
        await choosing;
        assert.deepEqual(draftFileState(window),
            { names: ['welcome.txt'], caption: 'welcome.txt', title: 'welcome.txt', visible: true });
        const message = { name: 'User', is_user: true, mes: 'Use the welcome file.', extra: {} };
        await fixture.chats.populateFileAttachment(message);
        assert.equal(fixture.files.get(message.extra.files[0].url), 'WELCOME FILE');
        assert.equal(window.document.getElementById('file_form_input').files.length, 0);
        assert.deepEqual(fixture.notices, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        read.reply.resolve('Fixture closing');
        await Promise.allSettled([choosing]);
        await fixture.close();
    }
});

test('file picker presents its current read failure once and keeps matching metadata for retry', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const { window } = fixture.runtime;
    const tracker = trackChatSubscriptions(fixture.runtime);
    try {
        await fixture.selectDraftFiles([new window.File(['APPROVED FILE'], 'approved.txt', { type: 'text/plain' })]);
        const unreadable = new window.File(['RETRIED FILE'], 'unreadable.txt', { type: 'text/plain' });
        const text = unreadable.text.bind(unreadable);
        let readable = false;
        unreadable.text = () => readable ? text() : Promise.reject(new Error('Synthetic picker read failed'));
        const outcome = await fixture.selectDraftFiles([unreadable]).then(value => ({ value }), error => ({ error }));
        assert.equal(outcome.error, undefined, 'The current picker owns and presents its read rejection');
        const state = {
            names: ['approved.txt', 'unreadable.txt'], caption: '2 files selected',
            title: 'approved.txt\nunreadable.txt', visible: true,
        };
        assert.deepEqual(draftFileState(window), state);
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Synthetic picker read failed'));
        assert.deepEqual(fixture.warnings, []);
        assert.equal(tracker.subscriptions.size, 1, 'A retryable selected file keeps only its current subscription');
        readable = true;
        await fixture.selectDraftFiles([unreadable]);
        assert.deepEqual(draftFileState(window), state);
        assert.equal(fixture.notices.length, 1, 'The successful retry adds no failure notification');
        const form = window.document.getElementById('file_form');
        form.addEventListener('reset', event => event.preventDefault(), { once: true });
        form.reset();
        await Promise.resolve();
        assert.deepEqual([...window.document.getElementById('file_form_input').files].map(file => file.name), state.names,
            'A cancelled native reset must preserve the file list');
        assert.equal(draftFileState(window).visible, true);
        assert.equal(tracker.subscriptions.size, 1, 'A cancelled reset preserves the selected file ownership');
        window.document.getElementById('file_form_reset').click();
        await Promise.resolve();
        assert.equal(window.document.getElementById('file_form_input').files.length, 0);
        assert.equal(draftFileState(window).visible, false);
        assert.equal(tracker.subscriptions.size, 0);
        assert.deepEqual(fixture.errors, []);
    } finally {
        tracker.restore();
        await fixture.close();
    }
});

test('attachment validation rejects API preparation while an illegal picker selection is pending', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const { window } = fixture.runtime;
    const file = new window.File(['\x01\x02'], 'pending.bin', { type: 'application/octet-stream' });
    const read = holdFileText(file);
    let choosing;
    try {
        choosing = fixture.selectDraftFiles([file]);
        await read.started.promise;
        const message = { name: 'User', is_user: true, mes: 'Use this file.', extra: { note: 'Keep my metadata' } };
        const before = JSON.stringify(message);
        await assert.rejects(fixture.chats.populateFileAttachment(message), /Binary files are not supported/);
        assert.equal(JSON.stringify(message), before);
        assert.deepEqual(fixture.operations, [], 'A pending UI validation cannot authorize an upload');
        assert.deepEqual([...window.document.getElementById('file_form_input').files], [file]);
        assert.deepEqual(fixture.notices, [], 'The API caller owns its rejected preparation');
        read.reply.resolve(await read.text());
        await choosing;
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Binary files are not supported'));
        assert.equal(fixture.warnings.length, 1);
        assert.equal(window.document.getElementById('file_form_input').files.length, 0);
        assert.deepEqual(fixture.errors, []);
    } finally {
        read.reply.resolve('Fixture closing');
        await Promise.allSettled([choosing]);
        await fixture.close();
    }
});

for (const [type, name] of [['image/png', 'image.png'], ['video/mp4', 'video.mp4'], ['audio/mpeg', 'audio.mp3']]) {
    test(`attachment validation selects and prepares ${type} without reading it as text`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        const { window } = fixture.runtime;
        try {
            const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0xff]);
            const file = new window.File([bytes], name, { type });
            let textReads = 0;
            file.text = () => {
                textReads++;
                return Promise.reject(new Error('Media must not be read as text'));
            };
            await fixture.selectDraftFiles([file]);
            assert.deepEqual(draftFileState(window), { names: [name], caption: name, title: name, visible: true });
            const message = { name: 'User', is_user: true, mes: 'Use this media.', extra: {} };
            await fixture.chats.populateFileAttachment(message);
            assert.equal(textReads, 0);
            assert.equal(message.extra.media.length, 1);
            assert.equal(message.extra.media[0].title, name);
            assert.deepEqual([...fixture.files.get(message.extra.media[0].url)], [...bytes]);
            assert.equal(window.document.getElementById('file_form_input').files.length, 0);
            assert.deepEqual(fixture.notices, []);
            assert.deepEqual(fixture.errors, []);
        } finally {
            await fixture.close();
        }
    });
}

test('attachment validation rejects oversized non-media from metadata with the original Data Bank result', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const { window } = fixture.runtime;
    try {
        const file = new window.File(['LARGE FILE'], 'large.txt', { type: 'text/plain' });
        Object.defineProperty(file, 'size', { value: 351 * 1024 * 1024 });
        let textReads = 0;
        file.text = () => {
            textReads++;
            return Promise.reject(new Error('Oversized file must not be read'));
        };
        const before = fixture.snapshot();
        assert.equal(await fixture.chats.uploadFileAttachmentToServer(file, 'character'), undefined);
        assert.equal(textReads, 0);
        assert.deepEqual(fixture.snapshot(), before);
        assert.deepEqual(fixture.operations, []);
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Maximum size is 350.0 MiB'));
        assert.deepEqual(fixture.warnings, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        await fixture.close();
    }
});

test('attachment validation preserves the Data Bank unsupported no-path result and single notice', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const { window } = fixture.runtime;
    try {
        const before = fixture.snapshot();
        const file = new window.File(['\x01\x02'], 'unsupported.bin', { type: 'application/octet-stream' });
        assert.equal(await fixture.chats.uploadFileAttachmentToServer(file, 'character'), undefined);
        assert.deepEqual(fixture.snapshot(), before);
        assert.deepEqual(fixture.operations, []);
        assert.equal(fixture.notices.length, 1);
        assert.ok(fixture.notices[0].join(' ').includes('Binary files are not supported'));
        assert.deepEqual(fixture.warnings, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        await fixture.close();
    }
});

test('attachment validation confirms the Data Bank source before presenting an obsolete unsupported result', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const { window } = fixture.runtime;
    const file = new window.File(['\x01\x02'], 'obsolete-character.bin', { type: 'application/octet-stream' });
    const read = holdFileText(file);
    let operation;
    try {
        const before = fixture.snapshot();
        operation = fixture.chats.uploadFileAttachmentToServer(file, 'character');
        const rejected = assert.rejects(operation, /attachment location changed/);
        await read.started.promise;
        fixture.main.characters.push({ ...structuredClone(fixture.main.characters[0]), name: 'Other', avatar: 'Other.png' });
        fixture.main.setCharacterId(fixture.main.characters.length - 1);
        read.reply.resolve(await read.text());
        await rejected;
        assert.deepEqual(fixture.snapshot(), before);
        assert.deepEqual(fixture.operations, []);
        assert.deepEqual(fixture.notices, []);
        assert.deepEqual(fixture.warnings, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        read.reply.resolve('Fixture closing');
        await Promise.allSettled([operation]);
        await fixture.close();
    }
});

for (const completion of ['reset', 'cancelled reset', 'preparation', 'known rejection', 'picker replacement', 'paste replacement']) {
    test(`file picker releases completed chat subscriptions after ${completion}`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        const { window } = fixture.runtime;
        await fixture.Popup.util.popups.at(-1).completeAffirmative();
        const tracker = trackChatSubscriptions(fixture.runtime);
        try {
            const file = completion === 'known rejection'
                ? new window.File(['\x01\x02'], 'rejected.bin', { type: 'application/octet-stream' })
                : new window.File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'selected.png', { type: 'image/png' });
            await fixture.selectDraftFiles([file]);
            if (completion !== 'known rejection') assert.equal(tracker.subscriptions.size, 1);
            if (completion === 'reset') {
                window.document.getElementById('file_form_reset').click();
                await Promise.resolve();
            } else if (completion === 'cancelled reset') {
                const form = window.document.getElementById('file_form');
                form.addEventListener('reset', event => event.preventDefault(), { once: true });
                form.reset();
                await Promise.resolve();
                assert.deepEqual([...window.document.getElementById('file_form_input').files], [file]);
                assert.equal(draftFileState(window).visible, true, 'A cancelled reset keeps the actual selected file visible');
                assert.equal(tracker.subscriptions.size, 1);
                window.document.getElementById('file_form_reset').click();
                await Promise.resolve();
            } else if (completion === 'preparation') {
                const message = { name: 'User', is_user: true, mes: 'Send this file.', extra: {} };
                await fixture.chats.populateFileAttachment(message);
                assert.equal(message.extra.media[0].title, 'selected.png');
            } else if (completion.endsWith('replacement')) {
                const next = new window.File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'next.png', { type: 'image/png' });
                if (completion === 'picker replacement') await fixture.selectDraftFiles([next]);
                else {
                    const paste = new window.Event('paste', { bubbles: true, cancelable: true });
                    Object.defineProperty(paste, 'clipboardData', { value: { files: [next] } });
                    window.document.getElementById('send_textarea').dispatchEvent(paste);
                    await Promise.resolve();
                }
                assert.deepEqual(draftFileState(window).names, ['selected.png', 'next.png']);
                assert.equal(tracker.subscriptions.size, 1, 'Replacing a selection must retire its previous subscription');
                window.document.getElementById('file_form_reset').click();
                await Promise.resolve();
            }
            assert.equal(window.document.getElementById('file_form_input').files.length, 0);
            assert.equal(tracker.subscriptions.size, 0, 'Completed selections must release their captured File references');
            assert.equal(fixture.notices.length, completion === 'known rejection' ? 1 : 0);
            assert.deepEqual(fixture.errors, []);
        } finally {
            tracker.restore();
            await fixture.close();
        }
    });
}

test('file picker ignores a retired callback already queued for chat change', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const { window, getModule } = fixture.runtime;
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const delivery = { started: Promise.withResolvers(), reply: Promise.withResolvers() };
    const blockDelivery = async () => {
        delivery.started.resolve();
        await delivery.reply.promise;
    };
    eventSource.on(event_types.CHAT_CHANGED, blockDelivery);
    const tracker = trackChatSubscriptions(fixture.runtime);
    let changing;
    try {
        const file = new window.File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'current.png', { type: 'image/png' });
        await fixture.selectDraftFiles([file]);
        fixture.main.characters[0].chat = 'queued-picker-chat';
        changing = eventSource.emit(event_types.CHAT_CHANGED, fixture.main.getCurrentChatId());
        await delivery.started.promise;
        await fixture.selectDraftFiles([file]);
        delivery.reply.resolve();
        await changing;
        assert.deepEqual([...window.document.getElementById('file_form_input').files], [file],
            'Removing a listener must also prevent its already-queued callback from clearing a new owner');
        assert.equal(draftFileState(window).visible, true);
        assert.equal(tracker.subscriptions.size, 1);
        window.document.getElementById('file_form_reset').click();
        await Promise.resolve();
        assert.equal(tracker.subscriptions.size, 0);
        assert.deepEqual(fixture.notices, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        delivery.reply.resolve();
        await Promise.allSettled([changing]);
        eventSource.removeListener(event_types.CHAT_CHANGED, blockDelivery);
        tracker.restore();
        await fixture.close();
    }
});

for (const destination of ['message', 'Data Bank']) {
    test(`convertible attachment reads use only the converter for ${destination} output`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        const { window } = fixture.runtime;
        const file = new window.File([new Uint8Array([0, 1, 2, 3])], 'converted.bin', { type: 'application/x-attachment-read-fixture' });
        const observer = observeAttachmentReads(window, file);
        let conversions = 0;
        try {
            fixture.chats.registerFileConverter(file.type, async input => {
                conversions++;
                const bytes = new Uint8Array(await input.arrayBuffer());
                return `Converted: ${[...bytes].join(', ')} — 文件内容`;
            });
            let url;
            if (destination === 'message') {
                await fixture.selectDraftFiles([file]);
                const message = { name: 'User', is_user: true, mes: 'Use the converted file.', extra: {} };
                await fixture.chats.populateFileAttachment(message);
                assert.equal(message.extra.files.length, 1);
                assert.equal(message.extra.files[0].name, 'converted.bin');
                url = message.extra.files[0].url;
                assert.equal(window.document.getElementById('file_form_input').files.length, 0);
            } else {
                url = await fixture.chats.uploadFileAttachmentToServer(file, 'character');
                const attachment = fixture.extension_settings.character_attachments[fixture.avatar][0];
                assert.equal(attachment.url, url);
                assert.equal(attachment.name, 'converted.bin');
            }
            assert.equal(fixture.files.get(url), 'Converted: 0, 1, 2, 3 — 文件内容');
            assert.equal(conversions, 1);
            assert.deepEqual(observer.reads, { text: 0, dataUrl: 0 },
                'Known converter formats must not decode text or Base64 that the output never uses');
            assert.deepEqual(fixture.notices, []);
            assert.deepEqual(fixture.errors, []);
        } finally {
            observer.restore();
            await fixture.close();
        }
    });
}

test('convertible attachment reads preserve an actual converter IO rejection and the selected draft', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const { window } = fixture.runtime;
    const file = new window.File([new Uint8Array([0, 1, 2, 3])], 'unreadable-document.bin', { type: 'application/x-converter-io-failure' });
    const observer = observeAttachmentReads(window, file);
    const failure = new Error('Synthetic converter array-buffer read failed');
    let conversions = 0;
    try {
        file.arrayBuffer = () => Promise.reject(failure);
        fixture.chats.registerFileConverter(file.type, async input => {
            conversions++;
            const buffer = await input.arrayBuffer();
            return new TextDecoder().decode(buffer);
        });
        await fixture.selectDraftFiles([file]);
        const message = { name: 'User', is_user: true, mes: 'Keep this draft.', extra: { note: 'Keep metadata' } };
        const before = JSON.stringify(message);
        await assert.rejects(fixture.chats.populateFileAttachment(message), error => error === failure);
        assert.equal(conversions, 1);
        assert.equal(JSON.stringify(message), before);
        assert.deepEqual(fixture.operations, []);
        assert.deepEqual([...window.document.getElementById('file_form_input').files], [file]);
        assert.equal(draftFileState(window).visible, true);
        assert.deepEqual(fixture.notices, [], 'The direct API caller owns its original IO rejection');
        assert.deepEqual(observer.reads, { text: 0, dataUrl: 0 });
        assert.deepEqual(fixture.errors, []);
    } finally {
        observer.restore();
        await fixture.close();
    }
});

test('convertible attachment reads retain a converter registered while raw IO is pending', { timeout: 30000 }, async () => {
    const fixture = await createAttachmentFixture();
    const { window } = fixture.runtime;
    const file = new window.File(['RAW DOCUMENT'], 'late-converter.txt', { type: 'text/x-late-attachment-converter' });
    const originalRead = window.FileReader.prototype.readAsDataURL;
    const reading = { started: Promise.withResolvers(), reply: Promise.withResolvers() };
    let operation;
    let conversions = 0;
    try {
        await fixture.selectDraftFiles([file]);
        window.FileReader.prototype.readAsDataURL = function (input) {
            if (input !== file) return originalRead.call(this, input);
            reading.started.resolve(this);
            reading.reply.promise.then(() => originalRead.call(this, input));
        };
        const message = { name: 'User', is_user: true, mes: 'Use the late converter.', extra: {} };
        operation = fixture.chats.populateFileAttachment(message);
        await reading.started.promise;
        fixture.chats.registerFileConverter(file.type, async input => {
            conversions++;
            return `Converted after registration: ${await input.text()}`;
        });
        reading.reply.resolve();
        await operation;
        assert.equal(conversions, 1);
        assert.equal(fixture.files.get(message.extra.files[0].url), 'Converted after registration: RAW DOCUMENT');
        assert.equal(window.document.getElementById('file_form_input').files.length, 0);
        assert.deepEqual(fixture.notices, []);
        assert.deepEqual(fixture.errors, []);
    } finally {
        reading.reply.resolve();
        await Promise.allSettled([operation]);
        window.FileReader.prototype.readAsDataURL = originalRead;
        await fixture.close();
    }
});

for (const { command, name, disabled } of [
    { command: 'db-enable', name: 'original.txt', disabled: [] },
    { command: 'db-disable', name: 'other.txt', disabled: [ORIGINAL_URL, OTHER_URL] },
]) {
    test(`Data Bank ${command} persists its attachment state through the original settings writer`, { timeout: 30000 }, async () => {
        const fixture = await createAttachmentFixture();
        try {
            await fixture.main.flushPendingSettingsSave(true);
            const originalAttachments = fixture.persistedAttachments('global');
            const options = { showWarning: false, handleExecutionErrors: false };
            const result = await fixture.executeSlashCommandsWithOptions(`/${command} source=global ${name}`, options);
            assert.equal(result.pipe, '');
            assert.deepEqual(fixture.extension_settings.disabled_attachments, disabled);
            await fixture.main.flushPendingSettingsSave();
            const settings = JSON.parse(JSON.parse(fixture.runtime.fixture.backend.handle({
                method: 'POST', url: '/api/settings/get', body: '{}',
            }).body).settings).extension_settings;
            assert.deepEqual(settings.disabled_attachments, disabled, 'The original settings readback must retain the command state');
            assert.deepEqual(fixture.persistedAttachments('global'), originalAttachments);
            assert.deepEqual(fixture.operations, []);
            const saved = fixture.referenceSaves.length;
            const repeated = await fixture.executeSlashCommandsWithOptions(`/${command} source=global ${name}`, options);
            assert.equal(repeated.pipe, '');
            await fixture.main.flushPendingSettingsSave();
            assert.equal(fixture.referenceSaves.length, saved, 'An unchanged command must remain a no-op');
            assert.deepEqual(fixture.extension_settings.disabled_attachments, disabled);
            assert.deepEqual(fixture.notices, []);
            assert.deepEqual(fixture.warnings, []);
            assert.deepEqual(fixture.errors, []);
        } finally {
            await fixture.close();
        }
    });
}
