import assert from 'node:assert/strict';
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

export {
    ORIGINAL_URL,
    OTHER_URL,
    ORIGINAL_TEXT,
    EDITED_TEXT,
    createAttachmentFixture,
    holdFileText,
    draftFileState,
    trackChatSubscriptions,
    observeAttachmentReads,
    addReplyWithAttachment,
};
