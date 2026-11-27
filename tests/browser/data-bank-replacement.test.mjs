import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ORIGINAL_URL,
    OTHER_URL,
    ORIGINAL_TEXT,
    EDITED_TEXT,
    createAttachmentFixture,
} from './data-bank-fixture.mjs';

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
