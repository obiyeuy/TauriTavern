import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe } from 'node:test';
import {
    ORIGINAL_URL,
    ORIGINAL_TEXT,
    createAttachmentFixture,
    addReplyWithAttachment,
} from './data-bank-fixture.mjs';

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
