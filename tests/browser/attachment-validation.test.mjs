import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createAttachmentFixture,
    holdFileText,
    draftFileState,
    trackChatSubscriptions,
    observeAttachmentReads,
    addReplyWithAttachment,
} from './data-bank-fixture.mjs';

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
