import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { captureBrowserErrors, createBrowserRuntime } from './runtime.mjs';
import { HOSTS } from '../helpers/host-identity.mjs';

test('Connection Manager reports the result of its own application', async context => {
    const runtime = await createBrowserRuntime({ identity: HOSTS.android });
    const { window, load, getModule } = runtime;
    context.after(() => window.happyDOM.close());
    const { errors, failed } = captureBrowserErrors(window);
    await runtime.startHost();
    await load('script.js');
    const { eventSource, event_types } = getModule('scripts/events.js').namespace;
    const ready = new Promise(resolve => eventSource.once(event_types.APP_READY, resolve));
    const extensionsLoaded = new Promise(resolve => eventSource.once(event_types.EXTENSION_SETTINGS_LOADED, resolve));
    window.jQuery.holdReady(false);
    await Promise.race([Promise.all([ready, extensionsLoaded]), failed]);
    if (!window.document.getElementById('connection_profiles')) {
        await (await load('scripts/extensions/connection-manager/index.js')).namespace.init();
    }
    assert.equal(window.document.querySelectorAll('#connection_profiles').length, 1);
    await getModule('scripts/reasoning.js').namespace.loadReasoningTemplates({
        reasoning: [JSON.parse(await readFile(new URL('../../default/content/presets/reasoning/Think XML.json', import.meta.url), 'utf8'))],
    });

    const { executeSlashCommandsWithOptions } = getModule('scripts/slash-commands.js').namespace;
    const { extension_settings } = getModule('scripts/extensions.js').namespace;
    const { power_user } = getModule('scripts/power-user.js').namespace;
    const secrets = getModule('scripts/secrets.js').namespace;
    const key = secrets.SECRET_KEYS.CUSTOM;
    const state = {
        [key]: [
            { id: 'original-key', value: 'masked', label: 'Original', active: true },
            { id: 'target-key', value: 'masked', label: 'Target', active: false },
        ],
    };
    const execute = command => executeSlashCommandsWithOptions(command, {
        handleExecutionErrors: false, showWarning: false,
    });
    const notices = { error: [], success: [], warning: [] };
    let outcome;
    window.toastr.error = (...args) => {
        notices.error.push(args.map(String).join(' '));
        outcome?.resolve();
    };
    window.toastr.success = (...args) => notices.success.push(args.map(String).join(' '));
    window.toastr.warning = (...args) => {
        notices.warning.push(args.map(String).join(' '));
        outcome?.resolve();
    };
    const loaded = [];
    const modelLoaded = [];
    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, name => { loaded.push(name); outcome?.resolve(); });
    eventSource.on(event_types.MODEL_TARGET_LOADED, name => { modelLoaded.push(name); outcome?.resolve(); });
    const statusRequests = [];
    let statusStarted = Promise.withResolvers();
    const resourceFetch = window.fetch;
    let rotate = async () => window.Response.json({ ok: true });
    window.fetch = async (input, init) => {
        const path = new URL(input, window.location.href).pathname;
        if (path === '/api/secrets/read') return window.Response.json(state);
        if (path === '/api/secrets/rotate') {
            const request = JSON.parse(init.body);
            const response = await rotate(request);
            if (response.ok) {
                for (const secret of state[request.key]) secret.active = secret.id === request.id;
            }
            return response;
        }
        if (path.endsWith('/status')) {
            statusRequests.push(init?.body ? JSON.parse(init.body) : { path });
            statusStarted.resolve();
            if (path === '/api/backends/chat-completions/status') {
                return window.Response.json({ data: [{ id: 'profile-model' }] });
            }
        }
        return resourceFetch(input, init);
    };
    const profiles = window.document.getElementById('connection_profiles');
    const spinner = window.document.getElementById('connection_profile_spinner');
    const reset = async name => {
        outcome = undefined;
        rotate = async () => new window.Response('Key activation failed', { status: 500 });
        state[key][0].active = true;
        state[key][1].active = false;
        await execute('/api custom');
        await execute('/api-url connect=false https://api.example.test/v1');
        await execute('/model quiet=true profile-model');
        await execute('/stop-strings ["preserve"]');
        await execute('/start-reply-with Preserve');
        await secrets.readSecretState();
        await execute(`/profile-create ${name}`);
        const profile = extension_settings.connectionManager.profiles.find(item => item.name === name);
        assert.equal(profiles.value, profile.id, 'The newly captured profile remains selected after rendering its catalog');
        profile['secret-id'] = 'target-key';
        notices.error.length = notices.success.length = notices.warning.length = loaded.length = modelLoaded.length = statusRequests.length = 0;
        statusStarted = Promise.withResolvers();
        return profile;
    };

    await context.test('a failed key activation rejects the command and allows a complete retry with empty fields', async () => {
        const profile = await reset('KeyFailure');
        profile['stop-strings'] = '';
        profile['start-reply-with'] = '';
        await assert.rejects(execute('/profile timeout=0 KeyFailure'), /secret-id/);
        assert.equal(secrets.secret_state[key].find(item => item.active)?.id, 'original-key');
        assert.equal(power_user.custom_stopping_strings, '[]');
        assert.equal(power_user.user_prompt_bias, '');
        assert.deepEqual(loaded, []);
        assert.equal(statusRequests.length, 0);
        assert.deepEqual(notices.error, [], 'The caller owns errors from an awaited command');
        assert.equal(spinner.classList.contains('hidden'), true);

        rotate = async () => window.Response.json({ ok: true });
        const result = await execute('/profile timeout=0 KeyFailure');
        await statusStarted.promise;
        assert.equal(result.pipe, 'KeyFailure');
        assert.equal(secrets.secret_state[key].find(item => item.active)?.id, 'target-key');
        assert.deepEqual(loaded, ['KeyFailure']);
        assert.equal(statusRequests.length, 1);
    });

    await context.test('a thrown field error stops replay before later settings and connection', async () => {
        const profile = await reset('FormatFailure');
        profile['stop-strings'] = 'invalid-list';
        profile['start-reply-with'] = 'Must not be applied';
        await assert.rejects(execute('/profile timeout=0 FormatFailure'), /list|array/i);
        assert.equal(power_user.user_prompt_bias, 'Preserve');
        assert.equal(secrets.secret_state[key].find(item => item.active)?.id, 'original-key');
        assert.deepEqual(loaded, []);
        assert.equal(statusRequests.length, 0);
        assert.equal(spinner.classList.contains('hidden'), true);
    });

    for (const action of ['selection', 'reload']) {
        await context.test(`native ${action} reports one failed application without a success event`, async () => {
            await reset(`Native-${action}`);
            outcome = Promise.withResolvers();
            if (action === 'selection') profiles.dispatchEvent(new window.Event('change', { bubbles: true }));
            else window.document.getElementById('reload_connection_profile').click();
            await outcome.promise;
            assert.equal(notices.error.length, 1);
            assert.match(notices.error[0], /secret-id/);
            assert.deepEqual(notices.success, []);
            assert.deepEqual(loaded, []);
            assert.equal(statusRequests.length, 0);
            assert.equal(secrets.secret_state[key].find(item => item.active)?.id, 'original-key');
            assert.equal(spinner.classList.contains('hidden'), true);
        });
    }

    await context.test('an unsupported API has one application error and preserves the public quiet convention', async () => {
        const profile = await reset('UnsupportedApi');
        profile.api = 'retired-api';
        outcome = Promise.withResolvers();
        profiles.dispatchEvent(new window.Event('change', { bubbles: true }));
        await outcome.promise;
        await setImmediate();
        assert.equal(notices.error.length, 1, 'The application initiator owns the error presentation');
        assert.match(notices.error[0], /API/);
        assert.deepEqual(notices.success, []);
        assert.deepEqual(loaded, []);
        assert.equal(statusRequests.length, 0);
        assert.equal(spinner.classList.contains('hidden'), true);

        notices.error.length = 0;
        assert.equal((await execute('/api retired-api')).pipe, '');
        assert.equal(notices.error.length, 1, 'A regular public command retains its error toast');
        notices.error.length = 0;
        assert.equal((await execute('/api quiet=true retired-api')).pipe, '');
        assert.deepEqual(notices.error, [], 'A quiet public command keeps the empty failure result without a toast');
    });

    await context.test('an unrelated loaded event cannot complete a pending profile command', async () => {
        await reset('OwnApplication');
        const started = Promise.withResolvers();
        const response = Promise.withResolvers();
        const completed = Promise.withResolvers();
        rotate = request => { started.resolve(request); return response.promise; };
        const onLoaded = name => { if (name === 'OwnApplication') completed.resolve(); };
        eventSource.on(event_types.CONNECTION_PROFILE_LOADED, onLoaded);
        let returned = false;
        const command = execute('/profile timeout=0 OwnApplication').then(result => { returned = true; return result; });
        try {
            await Promise.race([
                started.promise,
                command.then(() => { throw new Error('Profile completed before key activation started'); }),
            ]);
            await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, 'UnrelatedProfile');
            await setImmediate();
            assert.equal(returned, false, 'A different operation cannot acknowledge the pending key activation');
            response.resolve(window.Response.json({ ok: true }));
            const result = await command;
            assert.equal(result.pipe, 'OwnApplication');
            assert.equal(secrets.secret_state[key].find(item => item.active)?.id, 'target-key');
            assert.deepEqual(loaded, ['UnrelatedProfile', 'OwnApplication']);
        } finally {
            response.resolve(window.Response.json({ ok: true }));
            const result = await command.then(value => ({ value }), error => ({ error }));
            if (!result.error) await completed.promise;
            eventSource.removeListener(event_types.CONNECTION_PROFILE_LOADED, onLoaded);
            await setImmediate();
        }
    });

    for (const [status, activeId] of [[200, 'target-key'], [500, 'original-key']]) {
        await context.test(`None invalidates pending replay with key response ${status}`, async () => {
            const profileName = `CancelledApplication${status}`;
            await reset(profileName);
            const started = Promise.withResolvers();
            const response = Promise.withResolvers();
            const completed = Promise.withResolvers();
            const onLoaded = name => { if (name === profileName) completed.resolve(); };
            eventSource.on(event_types.CONNECTION_PROFILE_LOADED, onLoaded);
            rotate = request => { started.resolve(request); return response.promise; };
            const acknowledgement = () => status === 200
                ? window.Response.json({ ok: true }) : new window.Response('Key activation failed', { status });
            const command = execute(`/profile timeout=0 ${profileName}`);
            const commandResult = command.then(value => ({ value }), error => ({ error }));
            let none;
            try {
                await Promise.race([
                    started.promise,
                    command.then(() => { throw new Error('Profile completed before key activation started'); }),
                ]);
                let noneReturned = false;
                none = execute('/profile <None>').then(result => { noneReturned = true; return result; });
                await setImmediate();
                assert.equal(profiles.value, '');
                assert.equal(noneReturned, true, 'Clearing the selection does not wait for an independent key write');
                assert.deepEqual(loaded, ['<None>']);
                assert.equal(spinner.classList.contains('hidden'), true);
                response.resolve(acknowledgement());
                const [result, noneResult] = await Promise.all([commandResult, none]);
                if (!result.error) await completed.promise;
                assert.ok(result.error, 'Superseded replay must not report its name as a successful application');
                assert.match(result.error.message, /abort|cancel/i);
                assert.equal(noneResult.pipe, '<None>');
                assert.equal(profiles.value, '');
                assert.equal(extension_settings.connectionManager.selectedItem, null);
                assert.equal(secrets.secret_state[key].find(item => item.active)?.id, activeId);
                assert.deepEqual(loaded, ['<None>']);
                assert.equal(statusRequests.length, 0);
                assert.deepEqual(notices.error, []);
                assert.equal(spinner.classList.contains('hidden'), true);
            } finally {
                response.resolve(acknowledgement());
                const result = await commandResult;
                await none;
                if (!result.error) await completed.promise;
                eventSource.removeListener(event_types.CONNECTION_PROFILE_LOADED, onLoaded);
            }
        });
    }

    await context.test('a new application after None still waits for the pending independent key write', async () => {
        const profileName = 'QueuedAfterNone';
        await reset(profileName);
        const started = Promise.withResolvers();
        const response = Promise.withResolvers();
        const nextStarted = Promise.withResolvers();
        const nextResponse = Promise.withResolvers();
        let rotations = 0;
        rotate = request => {
            rotations++;
            if (rotations === 1) {
                started.resolve(request);
                return response.promise;
            }
            nextStarted.resolve(request);
            return nextResponse.promise;
        };
        const first = execute(`/profile timeout=0 ${profileName}`);
        const firstResult = first.then(value => ({ value }), error => ({ error }));
        let none;
        let nextResult;
        try {
            await started.promise;
            let noneReturned = false;
            none = execute('/profile <None>').then(result => { noneReturned = true; return result; });
            await setImmediate();
            assert.equal(noneReturned, true);
            assert.equal((await none).pipe, '<None>');

            const next = execute(`/profile timeout=0 ${profileName}`);
            nextResult = next.then(value => ({ value }), error => ({ error }));
            await setImmediate();
            assert.equal(rotations, 1, 'The next application cannot overlap a pending independent key write');
            response.resolve(window.Response.json({ ok: true }));
            const superseded = await firstResult;
            assert.ok(superseded.error);
            assert.match(superseded.error.message, /abort|cancel/i);
            await nextStarted.promise;
            nextResponse.resolve(window.Response.json({ ok: true }));
            const applied = await nextResult;
            assert.equal(applied.value?.pipe, profileName);
            assert.deepEqual(loaded, ['<None>', profileName]);
            assert.equal(statusRequests.length, 1);
        } finally {
            response.resolve(window.Response.json({ ok: true }));
            nextResponse.resolve(window.Response.json({ ok: true }));
            await firstResult;
            await none;
            await nextResult;
        }
    });

    await context.test('a pending Android details template cannot restore the profile cleared by None', async () => {
        await reset('PendingDetails');
        const details = window.document.getElementById('connection_profile_details_content');
        const viewButton = window.document.getElementById('view_connection_profile');
        const viewStarted = Promise.withResolvers();
        const viewResponse = Promise.withResolvers();
        const originalInvoke = window.__TAURI__.core.invoke;
        let viewRequest;
        let commandResult;
        window.__TAURI__.core.invoke = (command, args) => {
            if (command === 'read_frontend_extension_template'
                && args.extension === 'connection-manager' && args.name === 'view') {
                viewRequest = [command, args];
                viewStarted.resolve();
                return viewResponse.promise;
            }
            return originalInvoke(command, args);
        };
        try {
            viewButton.click();
            await viewStarted.promise;
            const command = execute('/profile timeout=0 PendingDetails');
            commandResult = command.then(value => ({ value }), error => ({ error }));
            await setImmediate();
            assert.equal((await execute('/profile <None>')).pipe, '<None>');
            const clearedDetails = details.textContent;
            assert.ok(clearedDetails.trim());
            viewResponse.resolve(await originalInvoke(...viewRequest));
            const result = await commandResult;
            assert.ok(result.error);
            assert.match(result.error.message, /abort|cancel/i);
            await setImmediate();
            assert.equal(details.textContent, clearedDetails, 'An older template cannot replace the current empty selection');
            assert.equal(extension_settings.connectionManager.selectedItem, null);
            assert.equal(secrets.secret_state[key].find(item => item.active)?.id, 'original-key');
            assert.equal(statusRequests.length, 0);
            assert.deepEqual(notices.error, []);
        } finally {
            window.__TAURI__.core.invoke = originalInvoke;
            if (viewRequest) viewResponse.resolve(await originalInvoke(...viewRequest));
            await commandResult;
            if (!details.classList.contains('hidden')) viewButton.click();
        }
    });

    await context.test('a non-awaited application returns promptly and reports its later failure once', async () => {
        await reset('BackgroundFailure');
        const started = Promise.withResolvers();
        const response = Promise.withResolvers();
        outcome = Promise.withResolvers();
        rotate = request => { started.resolve(request); return response.promise; };
        try {
            const result = await execute('/profile await=false BackgroundFailure');
            await Promise.race([
                started.promise,
                outcome.promise.then(() => { throw new Error('Background application finished before key activation started'); }),
            ]);
            assert.equal(result.pipe, 'BackgroundFailure');
            assert.deepEqual(loaded, []);
            response.resolve(new window.Response('Key activation failed', { status: 500 }));
            await outcome.promise;
            assert.equal(notices.error.length, 1);
            assert.match(notices.error[0], /secret-id/);
            assert.deepEqual(loaded, []);
            assert.equal(statusRequests.length, 0);
            assert.equal(secrets.secret_state[key].find(item => item.active)?.id, 'original-key');
        } finally {
            response.resolve(new window.Response('Key activation failed', { status: 500 }));
            await outcome.promise;
        }
    });

    await context.test('capturing a new selected profile invalidates pending replay through the same selection writer', async () => {
        await reset('PendingCapture');
        const started = Promise.withResolvers();
        const response = Promise.withResolvers();
        rotate = request => { started.resolve(request); return response.promise; };
        const command = execute('/profile timeout=0 PendingCapture');
        const commandResult = command.then(value => ({ value }), error => ({ error }));
        try {
            await Promise.race([
                started.promise,
                command.then(() => { throw new Error('Profile completed before key activation started'); }),
            ]);
            await execute('/profile-create SelectedCapture');
            assert.equal((await execute('/profile')).pipe, 'SelectedCapture');
            response.resolve(window.Response.json({ ok: true }));
            const result = await commandResult;
            assert.ok(result.error, 'An older application cannot acknowledge a different selected snapshot');
            assert.match(result.error.message, /abort|cancel/i);
            assert.equal((await execute('/profile')).pipe, 'SelectedCapture');
            assert.equal(secrets.secret_state[key].find(item => item.active)?.id, 'target-key');
            assert.deepEqual(loaded, []);
            assert.equal(statusRequests.length, 0);
            assert.deepEqual(notices.error, []);
        } finally {
            response.resolve(window.Response.json({ ok: true }));
            await commandResult;
        }
    });

    await context.test('a saved Model Target uses the same native failure presentation', async () => {
        extension_settings.connectionManager.modelTargets.push({
            id: 'saved-model-target', name: 'Saved Model', schemaVersion: 1, kind: 'tauritavern.modelTarget',
            mode: 'cc', api: 'custom', model: 'profile-model',
            'api-url': 'https://api.example.test/v1', 'custom-api-format': 'openai_compat',
            secretRef: { key, id: 'target-key', labelSnapshot: 'Target' }, adapterHints: {},
        });
        await reset('RenderSavedModel');
        profiles.value = 'modelTarget:saved-model-target';
        assert.equal(profiles.value, 'modelTarget:saved-model-target');
        outcome = Promise.withResolvers();
        profiles.dispatchEvent(new window.Event('change', { bubbles: true }));
        await outcome.promise;
        assert.equal(notices.error.length, 1);
        assert.match(notices.error[0], /secret-id/);
        assert.deepEqual(modelLoaded, []);
        assert.deepEqual(notices.success, []);
        assert.equal(statusRequests.length, 0);
        assert.equal(spinner.classList.contains('hidden'), true);
    });

    for (const setting of [
        { label: 'Custom format', field: 'custom-api-format', command: 'custom-api-format', invalid: 'invalid_protocol', notice: 'error' },
        { label: 'OpenCode format', field: 'custom-api-format', command: 'custom-api-format', invalid: 'invalid_protocol', notice: 'error', api: 'opencode' },
        { label: 'Proxy', field: 'proxy', command: 'proxy', invalid: '不存在的代理', notice: 'warning' },
        { label: 'Tokenizer', field: 'tokenizer', command: 'tokenizer', invalid: '不存在的分词器', notice: 'warning', api: 'kobold' },
    ]) {
        await context.test(`${setting.label} validation has one application notice and preserves ordinary command behavior`, async () => {
            const profile = await reset(`Quiet-${setting.label}`);
            let validValue = setting.command === 'proxy' ? profile.proxy : 'openai_compat';
            if (setting.command === 'tokenizer') {
                validValue = getModule('scripts/tokenizers.js').namespace.getAvailableTokenizers()[0].tokenizerKey;
                for (const key of Object.keys(profile)) {
                    if (!['id', 'name', 'mode', 'exclude'].includes(key)) delete profile[key];
                }
                profile.mode = 'tc';
            }
            if (setting.api) profile.api = setting.api;
            profile[setting.field] = setting.invalid;
            outcome = Promise.withResolvers();
            profiles.dispatchEvent(new window.Event('change', { bubbles: true }));
            await outcome.promise;
            await setImmediate();
            assert.equal(notices.error.length, 1, 'Only the application initiator presents the failed setting');
            assert.match(notices.error[0], new RegExp(`/${setting.command}`));
            assert.deepEqual(notices.warning.slice(), [], 'A managed command does not independently warn');
            assert.deepEqual(notices.success, []);
            assert.deepEqual(loaded, []);
            assert.equal(statusRequests.length, 0);
            assert.equal(secrets.secret_state[key].find(item => item.active)?.id, 'original-key');
            assert.equal(spinner.classList.contains('hidden'), true);

            notices.error.length = notices.warning.length = 0;
            assert.equal((await execute(`/${setting.command} ${setting.invalid}`)).pipe, '');
            assert.equal(notices[setting.notice].length, 1, 'An ordinary public command retains its original failure notice');
            assert.equal(notices[setting.notice === 'error' ? 'warning' : 'error'].length, 0);
            assert.ok(validValue);
            assert.equal((await execute(`/${setting.command} ${validValue}`)).pipe, validValue);
            if (setting.command !== 'proxy') {
                assert.equal((await execute(`/${setting.command}`)).pipe, validValue);
            }
        });
    }
    assert.deepEqual(errors, []);
});
