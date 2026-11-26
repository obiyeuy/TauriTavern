import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAccessibleName } from 'dom-accessibility-api';
import { createBrowserRuntime } from './runtime.mjs';
import { HOSTS } from '../helpers/host-identity.mjs';

test('API presets, Select2 activation and key failures preserve their public behavior', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime();
    const resourceFetch = window.fetch;
    try {
        await startHost();
        await load('script.js');
        await load('scripts/select2-accessibility.js');
        const $ = window.jQuery;
        const script = getModule('script.js').namespace;
        const kai = getModule('scripts/kai-settings.js').namespace;
        const textgen = getModule('scripts/textgen-settings.js').namespace;
        const power = getModule('scripts/power-user.js').namespace;
        kai.initKoboldSettings();
        textgen.initTextGenSettings();

        await context.test('preset selection preserves legal context ranges and reports adjusted values once', async () => {
            power.prepareGenerationControls({ enableLabMode: false, max_context_unlocked: false });
            await power.loadPowerUserSettings({ power_user: { ...power.power_user } }, { themes: [], movingUIPresets: [], context: [] });
            const koboldPreset = { ...kai.kai_settings, temp: 1, genamt: 512, max_length: 65536, rep_pen_range: 32768 };
            const textgenPreset = { ...textgen.textgenerationwebui_settings, temp: 1, genamt: 512, max_length: 65536, rep_pen_range: 32768, dry_penalty_last_n: 32768 };
            kai.loadKoboldSettings({ koboldai_setting_names: ['Long'], koboldai_settings: [JSON.stringify(koboldPreset)] },
                { ...kai.kai_settings, preset_settings: 'Long' }, {});
            await textgen.loadTextGenSettings({ textgenerationwebui_preset_names: ['Long', 'Adjusted'], textgenerationwebui_presets: [
                JSON.stringify(textgenPreset), JSON.stringify({ ...textgenPreset, temp: 6, top_p: 2 }),
            ] }, { textgenerationwebui_settings: { ...textgen.textgenerationwebui_settings } });
            $('#settings_preset_textgenerationwebui').val('Long').trigger('change');
            assert.equal(textgen.textgenerationwebui_settings.rep_pen_range, 32768);
            assert.equal(textgen.textgenerationwebui_settings.dry_penalty_last_n, 32768);
            $('#max_context_unlocked').prop('checked', false).trigger('change');
            $('#settings_preset').val('0').trigger('change');
            assert.equal(kai.kai_settings.rep_pen_range, 32768);
            assert.equal(script.max_context, 65536);
            assert.equal($('.toast-warning').length, 0);

            $('#settings_preset_textgenerationwebui').val('Adjusted').trigger('change');
            assert.equal(textgen.textgenerationwebui_settings.temp, 5);
            assert.equal(textgen.textgenerationwebui_settings.top_p, 1);
            assert.equal($('.toast-warning').length, 1);
            assert.match($('.toast-warning').text(), /Text Completion/);
            assert.match($('.toast-warning').text(), /6 → 5/);
            assert.match($('.toast-warning').text(), /2 → 1/);
        });

        await context.test('NovelAI settings saved before SillyTavern 1.13.2 restore their numeric strings as numbers', () => {
            const nai = getModule('scripts/nai-settings.js').namespace;
            nai.loadNovelSettings({ novelai_setting_names: [], novelai_settings: [] },
                { ...nai.nai_settings, top_k: '25', banned_tokens: '123' });
            assert.equal(nai.nai_settings.top_k, 25);
            assert.equal(nai.nai_settings.banned_tokens, '123');
        });

        await context.test('Select2 keeps the field name and accepts native, generic and jQuery activation', () => {
            const source = $('#model_openrouter_select').empty().append('<option value="a">A</option><option value="b">B</option>');
            const name = computeAccessibleName(source[0], { hidden: true });
            source.select2();
            const trigger = source.next().find('.select2-selection')[0];
            assert.ok(name && computeAccessibleName(trigger, { hidden: true }).includes(name));
            for (const click of [element => element.click(), element => element.dispatchEvent(new window.Event('click', { bubbles: true })), element => $(element).trigger('click')]) {
                source.val('a').trigger('change');
                click(trigger);
                assert.equal(source.data('select2').isOpen(), true);
                click($('.select2-results__option').filter((_, item) => item.textContent === 'B')[0]);
                assert.equal(source.val(), 'b');
            }
            source.select2('destroy');
        });

        await context.test('committing a native API key saves it without connecting and exposes only saved metadata', async () => {
            const secrets = getModule('scripts/secrets.js').namespace;
            await secrets.initSecrets();
            const writes = [];
            const state = { api_key_openai: [] };
            window.fetch = async (url, init) => {
                if (url === '/api/secrets/write') {
                    const request = JSON.parse(init.body);
                    writes.push({ key: request.key, value: request.value });
                    state[request.key] = [{ id: request.key, value: 'masked', label: 'Test key', active: true }];
                    return window.Response.json({ id: request.key });
                }
                assert.equal(url, '/api/secrets/read');
                return window.Response.json(state);
            };
            await secrets.readSecretState();
            for (const [selector, key] of [['#api_key_openai', 'api_key_openai'], ['#api_key_custom', 'api_key_custom']]) {
                const change = $.Event('change');
                $(selector).val('TEST-ONLY').trigger('input').trigger(change);
                await change.result;
                assert.deepEqual(writes.at(-1), { key, value: 'TEST-ONLY' });
                assert.equal($(selector).val(), '');
                assert.equal($(selector).attr('data-secret-saved'), 'true');
            }
            assert.equal(writes.length, 2);
            state.api_key_openai = [];
            await secrets.readSecretState();
            assert.equal($('#api_key_openai').attr('data-secret-saved'), 'false');
        });

        await context.test('a pending key save is shared with Connect and preserves a newer draft', async () => {
            const secrets = getModule('scripts/secrets.js').namespace;
            const started = Promise.withResolvers();
            const acknowledgement = Promise.withResolvers();
            const writes = [];
            window.fetch = async (url, init) => {
                if (url === '/api/secrets/write') {
                    writes.push(JSON.parse(init.body).value);
                    if (writes.length === 1) {
                        started.resolve();
                        return acknowledgement.promise;
                    }
                    return window.Response.json({ id: 'second' });
                }
                assert.equal(url, '/api/secrets/read');
                return window.Response.json({ api_key_openai: [{ id: 'saved', value: 'masked', label: 'Test key', active: true }] });
            };
            const change = $.Event('change');
            $('#api_key_openai').val('FIRST-TEST-ONLY').trigger('input').trigger(change);
            await started.promise;
            const connecting = secrets.writeSecret('api_key_openai', 'FIRST-TEST-ONLY');
            $('#api_key_openai').val('SECOND-TEST-ONLY').trigger('input');
            acknowledgement.resolve(window.Response.json({ id: 'first' }));
            await Promise.all([change.result, connecting]);
            assert.equal($('#api_key_openai').val(), 'SECOND-TEST-ONLY');
            await secrets.flushPendingSecretWrites();
            assert.deepEqual(writes, ['FIRST-TEST-ONLY', 'SECOND-TEST-ONLY']);
            assert.equal($('#api_key_openai').val(), '');
        });

        await context.test('flush waits for every queued mutation of the shared secrets document', async () => {
            const secrets = getModule('scripts/secrets.js').namespace;
            const started = new Map();
            const releases = new Map();
            const calls = [];
            let active = 0;
            let maxActive = 0;
            window.fetch = async (url, init) => {
                const action = url.split('/').at(-1);
                if (action === 'read') return window.Response.json({ api_key_openai: [] });
                calls.push(action);
                active++;
                maxActive = Math.max(maxActive, active);
                started.get(action)?.resolve();
                const release = releases.get(action);
                await release.promise;
                active--;
                return window.Response.json({ ok: true });
            };
            const mutation = action => {
                started.set(action, Promise.withResolvers());
                releases.set(action, Promise.withResolvers());
            };
            for (const action of ['rotate', 'delete', 'rename']) mutation(action);
            let tasks;
            let flushSettled = false;
            try {
                tasks = [
                    secrets.rotateSecret('api_key_openai', 'stored-id'),
                    secrets.deleteSecret('api_key_openai', 'stored-id'),
                    secrets.renameSecret('api_key_openai', 'stored-id', 'New label'),
                ];
                await started.get('rotate').promise;
                const flush = secrets.flushPendingSecretWrites().then(() => { flushSettled = true; });
                await Promise.resolve();
                assert.equal(flushSettled, false);
                assert.deepEqual(calls, ['rotate']);

                releases.get('rotate').resolve();
                await started.get('delete').promise;
                releases.get('delete').resolve();
                await started.get('rename').promise;
                releases.get('rename').resolve();
                await Promise.all([...tasks, flush]);
                assert.deepEqual(calls, ['rotate', 'delete', 'rename']);
                assert.equal(maxActive, 1);
            } finally {
                for (const release of releases.values()) release.resolve();
                if (tasks) await Promise.allSettled(tasks);
            }
        });

        await context.test('editing either OpenRouter key field keeps one shared draft through flush', async () => {
            const secrets = getModule('scripts/secrets.js').namespace;
            const inputs = [...window.document.querySelectorAll('.api_key_openrouter')];
            assert.equal(inputs.length, 2);
            const firstWrite = Promise.withResolvers();
            const acknowledgeFirstWrite = Promise.withResolvers();
            const writes = [];
            window.fetch = async (url, init) => {
                if (url === '/api/secrets/write') {
                    const value = JSON.parse(init.body).value;
                    writes.push(value);
                    if (writes.length === 1) {
                        firstWrite.resolve();
                        return acknowledgeFirstWrite.promise;
                    }
                    return window.Response.json({ id: 'saved' });
                }
                assert.equal(url, '/api/secrets/read');
                return window.Response.json({ api_key_openrouter: [{ id: 'saved', value: 'masked', label: 'Test', active: true }] });
            };
            const oldChange = $.Event('change');
            $(inputs[0]).val('OLD-TEST-ONLY').trigger('input').trigger(oldChange);
            await firstWrite.promise;
            const newChange = $.Event('change');
            $(inputs[1]).val('NEW-TEST-ONLY').trigger('input').trigger(newChange);
            let flush;
            try {
                flush = secrets.flushPendingSecretWrites();
                acknowledgeFirstWrite.resolve(window.Response.json({ id: 'old' }));
                await Promise.all([oldChange.result, newChange.result, flush]);
                assert.deepEqual(writes, ['OLD-TEST-ONLY', 'NEW-TEST-ONLY']);
                assert.deepEqual(inputs.map(input => input.value), ['', '']);
            } finally {
                acknowledgeFirstWrite.resolve(window.Response.json({ id: 'old' }));
                await Promise.allSettled([oldChange.result, newChange.result, flush]);
            }
        });

        await context.test('an explicit save reports a failed key write and keeps the draft for retry', async () => {
            const secrets = getModule('scripts/secrets.js').namespace;
            window.fetch = async url => {
                assert.equal(url, '/api/secrets/write');
                return new window.Response('Test write failure', { status: 500 });
            };
            $('#api_key_openai').val('RETRY-TEST-ONLY').trigger('input').trigger('change');
            await assert.rejects(secrets.flushPendingSecretWrites(), /save API key/);
            assert.equal($('#api_key_openai').val(), 'RETRY-TEST-ONLY');
        });

        await context.test('a saved key rejects on refresh failure and clears the input to avoid a duplicate write', async () => {
            const secrets = getModule('scripts/secrets.js').namespace;
            $('#api_key_openai').val('TEST-ONLY');
            let writes = 0;
            let refreshFails = true;
            window.fetch = async url => {
                if (url === '/api/secrets/write') {
                    writes++;
                    return window.Response.json({ id: 'saved' });
                }
                assert.equal(url, '/api/secrets/read');
                return refreshFails ? new window.Response('Test refresh failure', { status: 500 })
                    : window.Response.json({ api_key_openai: [{ id: 'saved', value: 'masked', label: 'Test key', active: true }] });
            };
            await assert.rejects(secrets.writeSecret('api_key_openai', 'TEST-ONLY', 'Test key'), /refresh API key state/);
            assert.equal($('#api_key_openai').val(), '');
            refreshFails = false;
            await secrets.flushPendingSecretWrites();
            assert.equal(writes, 1);
            assert.equal($('#api_key_openai').attr('data-secret-saved'), 'true');
        });

        await context.test('an earlier metadata read cannot erase a later acknowledged key save', async () => {
            const secrets = getModule('scripts/secrets.js').namespace;
            const earlier = Promise.withResolvers();
            let reads = 0;
            window.fetch = async url => {
                if (url === '/api/secrets/write') return window.Response.json({ id: 'saved' });
                assert.equal(url, '/api/secrets/read');
                if (++reads === 1) return earlier.promise;
                return window.Response.json({
                    api_key_openai: [{ id: 'saved', value: 'masked', label: 'Test', active: true }],
                });
            };
            const earlierRead = secrets.readSecretState();
            try {
                $('#api_key_openai').val('TEST-ONLY');
                await secrets.writeSecret('api_key_openai', 'TEST-ONLY');
                earlier.resolve(window.Response.json({}));
                await earlierRead;
                await secrets.flushPendingSecretWrites();
                assert.equal($('#api_key_openai').attr('data-secret-saved'), 'true');
                assert.equal($('#api_key_openai').val(), '');
            } finally {
                earlier.resolve(window.Response.json({}));
                await earlierRead;
            }
        });

        await context.test('Vertex service-account validation rejects invalid drafts before writing and leaves error presentation to its caller', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            let writes = 0;
            const errors = $('.toast-error').length;
            window.fetch = async () => { writes++; throw new Error('Invalid credentials must not be written'); };
            for (const [draft, message] of [['{', /Invalid JSON format/], ['null', /Missing required fields/],
                [JSON.stringify({ type: 'service_account' }), /Missing required fields/]]) {
                $('#vertexai_service_account_json').val(draft);
                await assert.rejects(openai.validateVertexAIServiceAccount(), message);
                assert.equal($('#vertexai_service_account_json').val(), draft);
            }
            assert.equal(writes, 0);
            assert.equal($('.toast-error').length, errors);
        });

        await context.test('Vertex service-account saves share validation between the awaited save and native button', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            openai.initOpenAI();
            const credential = { type: 'service_account', project_id: 'test-project', private_key: 'TEST-ONLY',
                client_email: 'test@example.invalid', client_id: 'test-client' };
            const value = JSON.stringify(credential);
            const writes = [];
            window.fetch = async (url, init) => {
                if (url === '/api/secrets/write') {
                    writes.push(JSON.parse(init.body));
                    return window.Response.json({ id: 'service-account' });
                }
                assert.equal(url, '/api/secrets/read');
                return window.Response.json({ vertexai_service_account_json: [{ id: 'service-account', value: 'masked',
                    label: 'test@example.invalid', active: true }] });
            };
            $('#vertexai_service_account_json').val(value);
            await openai.validateVertexAIServiceAccount();
            assert.equal($('#vertexai_service_account_json').val(), '');
            assert.equal($('#vertexai_service_account_json').attr('data-secret-saved'), 'true');
            assert.match($('#vertexai_service_account_info').text(), /test-project/);
            $('#vertexai_service_account_json').val(value);
            const click = $.Event('click');
            $('#vertexai_validate_service_account').trigger(click);
            await click.result;
            assert.equal($('#vertexai_service_account_json').val(), '');
            assert.equal(writes.length, 2);
            for (const request of writes) {
                assert.equal(request.key, 'vertexai_service_account_json');
                assert.equal(request.value, value);
                assert.equal(request.label, 'test@example.invalid');
            }
            assert.match($('.toast-success').text(), /valid and saved securely/);
        });

        await context.test('request JSON and its parameter picker leave composing shortcuts to the input method', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, {
                ...openai.oai_settings, chat_completion_source: 'openai', temp_openai: 0.8,
            });
            await load('scripts/tauri/generation-params/panel.js');
            getModule('scripts/tauri/generation-params/panel.js').namespace.installGenerationParamsPanel();
            const bar = window.document.querySelector('.tt-gp-bar');
            const mode = bar.querySelector('.tt-gp-mode');
            mode.click();
            const editor = bar.querySelector('.tt-gp-json-text');
            editor.value = '{"temperature":0.37}';
            for (const flags of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
                editor.dispatchEvent(new window.KeyboardEvent('keydown', {
                    key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true, ...flags,
                }));
                assert.equal(openai.oai_settings.temp_openai, 0.8);
                assert.equal(editor.value, '{"temperature":0.37}');
            }
            editor.dispatchEvent(new window.KeyboardEvent('keydown', {
                key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
            }));
            assert.equal(openai.oai_settings.temp_openai, 0.37);
            mode.click();
            const add = bar.querySelector('.tt-gp-add');
            add.click();
            const picker = bar.querySelector('.tt-gp-picker');
            assert.equal(picker.hidden, false);
            for (const flags of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
                picker.dispatchEvent(new window.KeyboardEvent('keydown', {
                    key: 'Escape', bubbles: true, cancelable: true, ...flags,
                }));
                assert.equal(picker.hidden, false);
            }
            picker.dispatchEvent(new window.KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true, cancelable: true,
            }));
            assert.equal(picker.hidden, true);
            assert.equal(window.document.activeElement === add, true);
        });

        await context.test('a custom model draft is added only after an ordinary Enter confirmation', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            const { Popup } = getModule('scripts/popup.js').namespace;
            openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, {
                ...openai.oai_settings, chat_completion_source: 'openai', custom_models_by_source: { openai: [] },
            });
            const select = window.document.querySelector(openai.getChatCompletionModelControl('openai').selector);
            const action = Array.from(select.options).find(option => openai.isCustomModelActionValue(option.value));
            assert.ok(action, 'the native model list exposes its custom model manager');
            const change = $.Event('change');
            $(select).val(action.value).trigger(change);
            const popup = Popup.util.popups.at(-1);
            try {
                const input = popup.content.querySelector('.custom-model-manager input');
                const before = popup.content.textContent;
                input.value = '自定义模型-测试';
                for (const flags of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
                    input.dispatchEvent(new window.KeyboardEvent('keydown', {
                        key: 'Enter', bubbles: true, cancelable: true, ...flags,
                    }));
                    assert.equal(input.value, '自定义模型-测试');
                    assert.equal(popup.content.textContent, before);
                }
                input.dispatchEvent(new window.KeyboardEvent('keydown', {
                    key: 'Enter', bubbles: true, cancelable: true,
                }));
                assert.equal(input.value, '');
                assert.ok(popup.content.textContent.includes('自定义模型-测试'));
                await popup.completeAffirmative();
                await change.result;
                assert.deepEqual(Array.from(openai.oai_settings.custom_models_by_source.openai), ['自定义模型-测试']);
            } finally {
                if (popup?.dlg.open) await popup.completeCancelled();
                await change.result;
            }
        });

        await context.test('endpoint feedback explains invalid bases without exposing misplaced keys', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            const data = { openai_setting_names: [], openai_settings: [] };
            const base = 'https://preview-user:preview-secret@api.example.test/v1';
            openai.loadOpenAISettings(data, {
                ...openai.oai_settings, chat_completion_source: 'custom', custom_api_format: 'openai_responses',
                custom_url: base,
            });
            const preview = $('#custom_endpoint_preview').text();
            assert.match(preview, /Invalid Base URL/);
            const { username, password } = new URL(base);
            assert.ok(!preview.includes(username) && !preview.includes(password));
            openai.loadOpenAISettings(data, {
                ...openai.oai_settings, custom_url: 'https://api.example.test/v1/',
            });
            assert.equal($('#custom_endpoint_preview').text(), 'https://api.example.test/v1/responses');

            const secrets = getModule('scripts/secrets.js').namespace;
            const marker = 'misplaced-key-endpoint-fixture';
            const trace = [];
            const requests = [];
            const debug = window.console.debug;
            const fetch = window.fetch;
            window.console.debug = (...args) => trace.push(args);
            window.fetch = async url => {
                requests.push(url);
                assert.equal(url, '/api/secrets/read', 'invalid bases must not reach an upstream status request');
                const key = { id: 'endpoint-test-key', value: 'masked', label: 'Test', active: true };
                return window.Response.json({
                    [secrets.SECRET_KEYS.CUSTOM]: [key], [secrets.SECRET_KEYS.AZURE_OPENAI]: [key],
                });
            };
            try {
                for (const source of ['custom', 'azure_openai']) {
                    openai.loadOpenAISettings(data, {
                        ...openai.oai_settings, chat_completion_source: source,
                        custom_url: marker, azure_base_url: marker,
                    });
                    $('#api_key_custom, #api_key_azure_openai').val('');
                    const click = $.Event('click');
                    $('#api_button_openai').trigger(click);
                    await click.result;
                    assert.match(script.online_status, source === 'custom'
                        ? /Invalid endpoint URL/ : /Invalid Azure endpoint URL/);
                }
                assert.equal(requests.includes('/api/backends/chat-completions/status'), false);
                assert.equal(trace.flat().some(value => typeof value === 'string' && value.includes(marker)), false,
                    'invalid endpoint diagnostics must not contain a mistakenly entered key');
            } finally {
                window.console.debug = debug;
                window.fetch = fetch;
            }
        });

        await context.test('cancelled connection checks preserve the newer status and immediately release loading controls', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            getModule('scripts/nai-settings.js').namespace.initNovelAISettings();
            const { createInterceptors } = getModule('tauri/main/interceptors.js').namespace;
            const fetch = window.fetch;
            const outcomes = [];
            try {
                for (const [source, button, path] of [
                    ['openai', '#api_button_openai', '/api/backends/chat-completions/status'],
                    ['textgen', '#api_button_textgenerationwebui', '/api/backends/text-completions/status'],
                    ['novel', '#api_button_novel', '/api/novelai/status'],
                    ['horde', null, '/api/horde/status'],
                ]) {
                    openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, {
                        ...openai.oai_settings, chat_completion_source: 'openai', reverse_proxy: '', bypass_status_check: false,
                    });
                    textgen.textgenerationwebui_settings.type = textgen.textgen_types.GENERIC;
                    textgen.textgenerationwebui_settings.bypass_status_check = false;
                    textgen.textgenerationwebui_settings.server_urls.generic = 'https://textgen.example.test/v1';
                    $('#generic_api_url_text').val('https://textgen.example.test/v1');
                    $('#api_key_openai, #api_key_novel').val('');
                    const started = Promise.withResolvers();
                    const response = Promise.withResolvers();
                    const nextStarted = Promise.withResolvers();
                    const nextResponse = Promise.withResolvers();
                    window.fetch = async url => {
                        assert.equal(url, '/api/secrets/read');
                        const key = { id: 'saved', value: 'masked', label: 'Test', active: true };
                        return window.Response.json({ api_key_openai: [key], api_key_novel: [key] });
                    };
                    createInterceptors({
                        originalFetch: window.fetch,
                        canHandleRequest: url => [path, '/api/backends/chat-completions/status'].includes(url.pathname),
                        toUrl: (input, base) => new window.URL(String(input), base),
                        routeRequest: async (url, _input, init) => {
                            if (url.pathname.endsWith('/chat-completions/status') && JSON.parse(init.body).chat_completion_source === 'custom') {
                                nextStarted.resolve();
                                return nextResponse.promise;
                            }
                            started.resolve();
                            return response.promise;
                        },
                    }).patchFetch(window);
                    const click = $.Event('click');
                    let query;
                    let nextClick;
                    if (button) {
                        $(button).trigger(click);
                        query = click.result;
                    } else {
                        query = getModule('scripts/horde.js').namespace.getStatusHorde();
                    }
                    try {
                        await started.promise;
                        script.cancelStatusCheck('Connection changed');
                        const controlsReleased = $('.api_button[aria-busy="true"]').length === 0;
                        openai.oai_settings.custom_url = 'https://next.example.test/v1';
                        $('#chat_completion_source').val('custom').trigger('change');
                        nextClick = $.Event('click');
                        $('#api_button_openai').trigger(nextClick);
                        await nextStarted.promise;
                        const currentStatus = script.online_status;
                        assert.notEqual(currentStatus, 'no_connection');
                        response.resolve(window.Response.json(source === 'horde' ? { ok: true } : { data: [{ id: 'obsolete-model' }] }));
                        await query;
                        outcomes.push({
                            source, controlsReleased, newerStatusPreserved: script.online_status === currentStatus,
                            newerLoadingPreserved: $('#api_button_openai').attr('aria-busy') === 'true',
                        });
                        nextResponse.resolve(window.Response.json({ data: [{ id: 'current-model' }] }));
                        await nextClick.result;
                        assert.equal($('#api_button_openai').attr('aria-busy'), undefined);
                    } finally {
                        response.resolve(new window.Response(null, { status: 204 }));
                        nextResponse.resolve(window.Response.json({ data: [] }));
                        script.cancelStatusCheck('Connection fixture finished');
                        await Promise.allSettled([query, nextClick?.result]);
                    }
                }
                assert.deepEqual(outcomes, [
                    { source: 'openai', controlsReleased: true, newerStatusPreserved: true, newerLoadingPreserved: true },
                    { source: 'textgen', controlsReleased: true, newerStatusPreserved: true, newerLoadingPreserved: true },
                    { source: 'novel', controlsReleased: true, newerStatusPreserved: true, newerLoadingPreserved: true },
                    { source: 'horde', controlsReleased: true, newerStatusPreserved: true, newerLoadingPreserved: true },
                ]);
            } finally {
                window.fetch = fetch;
            }
        });

        await context.test('cancelled key preparation cannot restart checks or release a newer query while key failures remain visible', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            const { createInterceptors } = getModule('tauri/main/interceptors.js').namespace;
            const fetch = window.fetch;
            const savedTimeout = window.toastr.options.timeOut;
            window.toastr.options.timeOut = 0;
            const outcomes = [];
            try {
                for (const [source, button, keyInput] of [
                    ['openai', '#api_button_openai', '#api_key_openai'],
                    ['textgen', '#api_button_textgenerationwebui', '#api_key_generic'],
                    ['novel', '#api_button_novel', '#api_key_novel'],
                ]) {
                    for (const [action, fails] of [['read', false], ['read', true], ['write', false], ['write', true]]) {
                        window.toastr.remove();
                        openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, {
                            ...openai.oai_settings, chat_completion_source: 'openai', reverse_proxy: '',
                            custom_url: 'https://next.example.test/v1',
                        });
                        $('#api_key_openai, #api_key_generic, #api_key_novel, #api_key_custom').val('');
                        if (action === 'write') $(keyInput).val('KEY-PREPARATION-TEST-ONLY');
                        const key = { id: 'saved', value: 'masked', label: 'Test', active: true };
                        const keys = { api_key_openai: [key], api_key_novel: [key] };
                        const preparationStarted = Promise.withResolvers();
                        const preparation = Promise.withResolvers();
                        const nextStarted = Promise.withResolvers();
                        const nextResponse = Promise.withResolvers();
                        let reads = 0;
                        let requests = 0;
                        window.fetch = async url => {
                            if (url === '/api/secrets/write') {
                                assert.equal(action, 'write');
                                preparationStarted.resolve();
                                return preparation.promise;
                            }
                            assert.equal(url, '/api/secrets/read');
                            if (++reads === 1 && action === 'read') {
                                preparationStarted.resolve();
                                return preparation.promise;
                            }
                            return window.Response.json(keys);
                        };
                        createInterceptors({
                            originalFetch: window.fetch,
                            canHandleRequest: url => [
                                '/api/backends/chat-completions/status', '/api/backends/text-completions/status', '/api/novelai/status',
                            ].includes(url.pathname),
                            toUrl: (input, base) => new window.URL(String(input), base),
                            routeRequest: async () => {
                                if (++requests === 1) {
                                    nextStarted.resolve();
                                    return nextResponse.promise;
                                }
                                return window.Response.json({ data: [], tier: 3 });
                            },
                        }).patchFetch(window);
                        const click = $.Event('click');
                        let nextClick;
                        $(button).trigger(click);
                        try {
                            await preparationStarted.promise;
                            script.cancelStatusCheck('Connection changed while reading keys');
                            $('#chat_completion_source').val('custom').trigger('change');
                            nextClick = $.Event('click');
                            $('#api_button_openai').trigger(nextClick);
                            await nextStarted.promise;
                            const currentStatus = script.online_status;
                            preparation.resolve(fails ? new window.Response('Key operation failed', { status: 500 })
                                : window.Response.json(action === 'read' ? keys : { id: 'saved' }));
                            await click.result;
                            outcomes.push({
                                source, action, fails, restarted: requests !== 1, statusPreserved: script.online_status === currentStatus,
                                loadingPreserved: $('#api_button_openai').attr('aria-busy') === 'true',
                                keyFailureVisible: $('.toast-error').length === (fails ? 1 : 0),
                            });
                            if (fails) assert.match($('.toast-error').text(), action === 'read' ? /refresh API key state/ : /save API key/);
                        } finally {
                            preparation.resolve(window.Response.json(keys));
                            nextResponse.resolve(window.Response.json({ data: [] }));
                            await Promise.allSettled([click.result, nextClick?.result]);
                            $(keyInput).val('').trigger('input');
                            script.cancelStatusCheck('Key preparation fixture finished');
                        }
                    }
                }
                assert.deepEqual(outcomes, ['openai', 'textgen', 'novel'].flatMap(source =>
                    ['read', 'write'].flatMap(action => [false, true].map(fails => ({
                        source, action, fails, restarted: false, statusPreserved: true, loadingPreserved: true, keyFailureVisible: true,
                    })))));
            } finally {
                window.fetch = fetch;
                window.toastr.remove();
                window.toastr.options.timeOut = savedTimeout;
            }
        });

        await context.test('rejecting an obsolete proxy confirmation preserves the newer connection while generation still rejects it', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            const { Popup } = getModule('scripts/popup.js').namespace;
            const { createInterceptors } = getModule('tauri/main/interceptors.js').namespace;
            const fetch = window.fetch;
            const opened = Promise.withResolvers();
            const observer = new window.MutationObserver(() => {
                const popup = Popup.util.popups.at(-1);
                if (popup?.dlg.open) opened.resolve(popup);
            });
            const nextStarted = Promise.withResolvers();
            const nextResponse = Promise.withResolvers();
            let click;
            let nextClick;
            try {
                openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, {
                    ...openai.oai_settings, chat_completion_source: 'openai', reverse_proxy: 'https://proxy-confirmation.example.test/v1',
                    custom_url: 'https://next.example.test/v1',
                });
                $('#api_key_openai').val('');
                window.fetch = async (url, init) => {
                    if (url === '/api/secrets/read') {
                        return window.Response.json({ api_key_openai: [{ id: 'saved', value: 'masked', label: 'Test', active: true }] });
                    }
                    return resourceFetch(url, init);
                };
                createInterceptors({
                    originalFetch: window.fetch,
                    canHandleRequest: url => url.pathname === '/api/backends/chat-completions/status',
                    toUrl: (input, base) => new window.URL(String(input), base),
                    routeRequest: async () => { nextStarted.resolve(); return nextResponse.promise; },
                }).patchFetch(window);
                observer.observe(window.document.body, { childList: true, subtree: true });
                click = $.Event('click');
                $('#api_button_openai').trigger(click);
                const popup = await opened.promise;
                script.cancelStatusCheck('Connection changed during proxy confirmation');
                $('#chat_completion_source').val('custom').trigger('change');
                nextClick = $.Event('click');
                $('#api_button_openai').trigger(nextClick);
                await nextStarted.promise;
                const currentStatus = script.online_status;
                await popup.completeNegative();
                await click.result;
                assert.deepEqual(
                    { status: script.online_status, loading: $('#api_button_openai').attr('aria-busy') },
                    { status: currentStatus, loading: 'true' },
                );
                nextResponse.resolve(window.Response.json({ data: [] }));
                await nextClick.result;
                observer.disconnect();

                const generationPopup = Promise.withResolvers();
                const generationObserver = new window.MutationObserver(() => {
                    const current = Popup.util.popups.at(-1);
                    if (current?.dlg.open) generationPopup.resolve(current);
                });
                openai.oai_settings.reverse_proxy = 'https://proxy-confirmation.example.test/v1';
                generationObserver.observe(window.document.body, { childList: true, subtree: true });
                const generation = openai.createGenerationParameters({
                    ...openai.oai_settings, chat_completion_source: 'openai',
                }, 'gpt-4o-mini', 'quiet', [{ role: 'user', content: 'Connection fixture' }], { allowToolCalls: false });
                try {
                    const rejected = assert.rejects(generation, /Proxy connection denied/);
                    await (await generationPopup.promise).completeNegative();
                    await rejected;
                } finally {
                    generationObserver.disconnect();
                }
            } finally {
                observer.disconnect();
                for (const popup of Popup.util.popups.toReversed()) await popup.completeCancelled();
                nextResponse.resolve(window.Response.json({ data: [] }));
                await Promise.allSettled([click?.result, nextClick?.result]);
                script.cancelStatusCheck('Proxy confirmation fixture finished');
                openai.oai_settings.reverse_proxy = '';
                window.fetch = fetch;
            }
        });

        await context.test('cancelled Text Completion props cannot apply an obsolete template or context size', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            const { createInterceptors } = getModule('tauri/main/interceptors.js').namespace;
            const fetch = window.fetch;
            const saved = {
                context_size_derived: power.power_user.context_size_derived,
                context_derived: power.power_user.context_derived,
                instruct_derived: power.power_user.instruct_derived,
                chat_template_hash: power.power_user.chat_template_hash,
            };
            const maxContext = script.max_context;
            const started = Promise.withResolvers();
            const response = Promise.withResolvers();
            let click;
            try {
                Object.assign(power.power_user, { context_size_derived: true, context_derived: false, instruct_derived: false });
                textgen.textgenerationwebui_settings.type = textgen.textgen_types.LLAMACPP;
                textgen.textgenerationwebui_settings.llamacpp_model = 'context-fixture-model';
                textgen.textgenerationwebui_settings.server_urls.llamacpp = 'https://textgen.example.test/v1';
                $('#llamacpp_api_url_text').val('https://textgen.example.test/v1');
                window.fetch = async url => {
                    assert.equal(url, '/api/secrets/read');
                    return window.Response.json({});
                };
                createInterceptors({
                    originalFetch: window.fetch,
                    canHandleRequest: url => ['/api/backends/text-completions/status', '/api/backends/text-completions/props'].includes(url.pathname),
                    toUrl: (input, base) => new window.URL(String(input), base),
                    routeRequest: async url => {
                        if (url.pathname.endsWith('/status')) {
                            return window.Response.json({ result: 'context-fixture-model', data: [{ id: 'context-fixture-model' }] });
                        }
                        started.resolve();
                        return response.promise;
                    },
                }).patchFetch(window);
                click = $.Event('click');
                $('#api_button_textgenerationwebui').trigger(click);
                await started.promise;
                script.cancelStatusCheck('Connection changed while loading model props');
                $('#chat_completion_source').val('claude').trigger('change');
                $('#openai_bypass_status_check').trigger('input');
                const currentContext = script.max_context;
                const currentTemplate = power.power_user.chat_template_hash;
                response.resolve(window.Response.json({
                    chat_template: '<|im_start|>user<|im_start|>assistant<|im_end|>',
                    chat_template_hash: 'obsolete-model-template',
                    default_generation_settings: { n_ctx: 4096 },
                }));
                await click.result;
                assert.deepEqual(
                    { template: power.power_user.chat_template_hash, context: script.max_context },
                    { template: currentTemplate, context: currentContext },
                );
            } finally {
                response.resolve(new window.Response(null, { status: 204 }));
                script.cancelStatusCheck('Model props fixture finished');
                await click?.result;
                Object.assign(power.power_user, saved);
                script.setGenerationParamsFromPreset({ max_length: maxContext });
                window.fetch = fetch;
                openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, { ...openai.oai_settings });
            }
        });

        await context.test('loading Custom models works without optional AbortSignal methods and keeps the chosen protocol', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, {
                ...openai.oai_settings, chat_completion_source: 'custom', custom_api_format: 'openai_responses',
                custom_url: 'https://api.example.test/v1', custom_model: 'gemini-模型', openai_max_tokens: 65535,
            });
            window.fetch = async (url, init) => {
                if (url === '/api/secrets/read') return window.Response.json({
                    api_key_custom: [{ id: 'custom-key', value: 'masked', label: 'Test', active: true }],
                });
                assert.equal(url, '/api/backends/chat-completions/status');
                const request = JSON.parse(init.body);
                assert.equal(request.custom_api_format, 'openai_responses');
                return window.Response.json({ data: [{ id: 'gemini-模型' }] });
            };
            const click = $.Event('click');
            const signal = script.abortStatusCheck.signal;
            const method = Object.getOwnPropertyDescriptor(signal, 'throwIfAborted');
            Object.defineProperty(signal, 'throwIfAborted', { value: undefined, configurable: true });
            try {
                $('#api_button_openai').trigger(click);
                await click.result;
            } finally {
                if (method) Object.defineProperty(signal, 'throwIfAborted', method);
                else delete signal.throwIfAborted;
            }
            assert.deepEqual(Array.from(openai.model_list, model => model.id), ['gemini-模型']);
            assert.equal(openai.oai_settings.custom_api_format, 'openai_responses');
            assert.equal($('#custom_endpoint_preview').text(), 'https://api.example.test/v1/responses');
            assert.match(script.online_status, /models/i);
            assert.match(script.online_status, /Test Message/);
        });

        await context.test('the native API test bounds its response without changing the saved generation length', async () => {
            const openai = getModule('scripts/openai.js').namespace;
            let generated;
            window.fetch = async (url, init) => {
                assert.equal(url, '/api/backends/chat-completions/generate');
                generated = JSON.parse(init.body);
                return window.Response.json({ choices: [{ message: { role: 'assistant', content: 'OK' } }] });
            };
            const savedLength = openai.oai_settings.openai_max_tokens;
            const click = $.Event('click');
            $('#test_api_button').trigger(click);
            await click.result;
            assert.ok(generated.max_tokens > 0 && generated.max_tokens < savedLength,
                'a short connection probe must not request the full generation budget');
            assert.equal(openai.oai_settings.openai_max_tokens, savedLength);
            assert.equal(generated.custom_api_format, 'openai_responses');
        });

        await context.test('failed native API tests present one error at the initiating button', async () => {
            const savedTimeout = window.toastr.options.timeOut;
            window.toastr.options.timeOut = 0;
            try {
                for (const [status, message] of [
                    [502, 'Secure connection failed. Endpoint: https://api.example.test/v1/chat/completions'],
                    [200, 'Invalid generation parameters'],
                ]) {
                    window.toastr.remove();
                    window.fetch = async (url, init) => {
                        assert.equal(url, '/api/backends/chat-completions/generate');
                        assert.equal(JSON.parse(init.body).type, 'quiet');
                        return window.Response.json({ error: { message } }, { status });
                    };
                    const click = $.Event('click');
                    $('#test_api_button').trigger(click);
                    await click.result;
                    assert.equal($('.toast-error').length, 1, `HTTP ${status} must produce one error notification`);
                    assert.equal($('.toast-error .toast-message').text(), message);
                }
            } finally {
                window.toastr.remove();
                window.toastr.options.timeOut = savedTimeout;
            }
        });
    } finally {
        getModule('script.js').namespace.cancelPendingSettingsSave();
        await window.happyDOM.close();
    }
});

test('API test controls share waiting state until the actual request settles', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime({ identity: HOSTS.android });
    const resourceFetch = window.fetch;
    try {
        await startHost();
        await load('script.js');
        const main = getModule('script.js').namespace;
        const openai = getModule('scripts/openai.js').namespace;
        const { createInterceptors } = getModule('tauri/main/interceptors.js').namespace;
        openai.initOpenAI();
        openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, {
            ...openai.oai_settings, chat_completion_source: 'custom',
            custom_url: 'https://api.example.test/v1', custom_model: 'test-model', reverse_proxy: '',
        });
        main.changeMainAPI('openai');
        await load('scripts/mobile-settings-page.js');
        await load('scripts/mobile-settings-schema.js');
        const { renderSettingsPage } = getModule('scripts/mobile-settings-page.js').namespace;
        const schema = getModule('scripts/mobile-settings-schema.js').namespace.connectionPage;
        const native = window.document.getElementById('test_api_button');
        const label = native.textContent;
        window.toastr.options.timeOut = 0;

        for (const outcome of ['success', 'failure', 'stopped']) {
            await context.test(`a slow API test ${outcome} restores the current mobile action without a second request`, async () => {
                window.toastr.remove();
                const hookStarted = Promise.withResolvers();
                const hookRelease = Promise.withResolvers();
                const requestStarted = Promise.withResolvers();
                const response = Promise.withResolvers();
                const prepare = async () => { hookStarted.resolve(); await hookRelease.promise; };
                main.eventSource.on(main.event_types.CHAT_COMPLETION_PROMPT_READY, prepare);
                const notified = Promise.withResolvers();
                const observer = new window.MutationObserver(() => {
                    if (window.document.querySelector('.toast')) notified.resolve();
                });
                observer.observe(window.document.body, { childList: true, subtree: true });
                let requests = 0;
                window.fetch = resourceFetch;
                createInterceptors({
                    originalFetch: resourceFetch,
                    canHandleRequest: url => url.pathname === '/api/backends/chat-completions/generate',
                    toUrl: (input, base) => new window.URL(String(input), base),
                    routeRequest: async () => {
                        requests++;
                        requestStarted.resolve();
                        return response.promise;
                    },
                }).patchFetch(window);
                let page = renderSettingsPage({ document: window.document, schema });
                window.document.body.append(page.element);
                let row = [...page.element.querySelectorAll('.tt-sp-action')].find(element => element.textContent === label);
                assert.ok(row);
                const timeout = window.setTimeout;
                const scheduled = [];
                // Drain the page's scheduled refresh window deterministically.
                // The request remains held independently until its real outcome.
                window.setTimeout = (callback, _delay, ...args) => {
                    scheduled.push(() => callback(...args));
                    return 2000000 + scheduled.length;
                };
                try {
                    row.click();
                } finally {
                    window.setTimeout = timeout;
                }
                try {
                    await hookStarted.promise;
                    assert.equal(native.disabled, true, 'Waiting starts before asynchronous extension preparation');
                    assert.equal(native.getAttribute('aria-busy'), 'true');
                    assert.equal(row.disabled, true);
                    assert.equal(row.getAttribute('aria-busy'), 'true');
                    assert.notEqual(row.textContent, label);
                    assert.equal(row.textContent, native.textContent);
                    row.click();
                    native.click();
                    hookRelease.resolve();
                    await requestStarted.promise;
                    for (const callback of scheduled) callback();
                    assert.equal(row.disabled, true, 'The waiting state outlives the scheduled refresh window');
                    assert.equal(row.getAttribute('aria-busy'), 'true');
                    assert.equal(requests, 1);

                    const previousRow = row;
                    page.dispose();
                    page.element.remove();
                    page = renderSettingsPage({ document: window.document, schema });
                    window.document.body.append(page.element);
                    row = [...page.element.querySelectorAll('.tt-sp-action')]
                        .find(element => element.getAttribute('aria-busy') === 'true');
                    assert.ok(row, 'A reopened page reads the same pending native action');
                    assert.equal(row.disabled, true);
                    assert.equal(row.textContent, native.textContent);

                    if (outcome === 'stopped') {
                        await main.eventSource.emit(main.event_types.GENERATION_STOPPED);
                    } else {
                        response.resolve(outcome === 'failure'
                            ? window.Response.json({ error: { message: 'API test failed' } }, { status: 500 })
                            : window.Response.json({ choices: [{ message: { content: 'OK' } }] }));
                    }
                    await notified.promise;
                    assert.equal(native.disabled, false);
                    assert.equal(native.hasAttribute('aria-busy'), false);
                    assert.equal(native.textContent, label);
                    assert.equal(row.disabled, false, 'Completion updates the current page immediately');
                    assert.equal(row.hasAttribute('aria-busy'), false);
                    assert.equal(row.textContent, label);
                    assert.equal(previousRow.disabled, true, 'A disposed page does not react to later source changes');
                    assert.equal(requests, 1);
                    assert.equal(window.document.querySelectorAll('.toast').length, 1);
                    assert.equal(window.document.querySelectorAll('.toast-success').length, outcome === 'success' ? 1 : 0);
                } finally {
                    hookRelease.resolve();
                    response.resolve(window.Response.json({ choices: [{ message: { content: 'OK' } }] }));
                    await notified.promise;
                    observer.disconnect();
                    page.dispose();
                    page.element.remove();
                    main.eventSource.removeListener(main.event_types.CHAT_COMPLETION_PROMPT_READY, prepare);
                    window.fetch = resourceFetch;
                }
            });
        }
    } finally {
        getModule('script.js').namespace.cancelPendingSettingsSave();
        await window.happyDOM.close();
    }
});

test('secret value readers preserve failure reasons and saved key metadata', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime();
    const resourceFetch = window.fetch;
    let manager;
    try {
        await startHost();
        await load('script.js');
        const secrets = getModule('scripts/secrets.js').namespace;
        const { Popup } = getModule('scripts/popup.js').namespace;
        const { executeSlashCommandsWithOptions } = getModule('scripts/slash-commands.js').namespace;
        const $ = window.jQuery;
        window.toastr.options.timeOut = 0;
        const state = { api_key_custom: [{ id: 'test-id', value: 'masked', label: 'Test key', active: true }] };
        let reads = 0;
        let findResponse;
        window.fetch = async (url, init) => {
            if (url === '/api/secrets/read') {
                reads++;
                return window.Response.json(state);
            }
            if (url === '/api/secrets/find') {
                assert.deepEqual(JSON.parse(init.body), { key: 'api_key_custom', id: 'test-id' });
                return findResponse();
            }
            return resourceFetch(url, init);
        };
        await secrets.initSecrets();
        await secrets.readSecretState();

        const appeared = new Promise(resolve => {
            const observer = new window.MutationObserver(() => {
                const button = window.document.querySelector('.secretKeyManager button[data-action="copy-secret"]');
                if (button) { observer.disconnect(); resolve(button); }
            });
            observer.observe(window.document.body, { childList: true, subtree: true });
        });
        const opening = $.Event('click');
        $('[data-key="api_key_custom"].manage-api-keys').trigger(opening);
        manager = opening.result;
        const copy = await appeared;
        async function copyValue() {
            const click = $.Event('click');
            $(copy).trigger(click);
            await click.result;
        }

        for (const [name, response, detail] of [
            ['missing value', () => new window.Response('Not found: Secret not found: api_key_custom', { status: 404 }), /Secret not found/],
            ['storage failure', () => window.Response.json({ error: { InternalServerError: 'Secret file could not be read' } }, { status: 500 }), /Secret file could not be read/],
            ['transport failure', () => { throw new Error('Secret transport interrupted'); }, /Secret transport interrupted/],
            ['invalid JSON', () => new window.Response('{', { headers: { 'content-type': 'application/json' } }), /Could not find secret value/],
            ['invalid value shape', () => window.Response.json({ value: { unexpected: true } }), /Invalid secret value response/],
        ]) {
            await context.test(`copying a secret value reports ${name} without changing the clipboard or saved metadata`, async () => {
                window.toastr.remove();
                await window.navigator.clipboard.writeText('EXISTING-TEST-ONLY');
                findResponse = response;
                await copyValue();
                assert.equal($('.toast-error').length, 1);
                assert.match($('.toast-error').text(), detail);
                assert.doesNotMatch($('.toast-error').text(), /key exposure is disabled/);
                assert.equal($('.toast-info, .toast-success').length, 0);
                assert.equal(await window.navigator.clipboard.readText(), 'EXISTING-TEST-ONLY');
                assert.equal($('#api_key_custom').attr('data-secret-saved'), 'true');
                assert.equal(secrets.secret_state.api_key_custom[0].id, 'test-id');
            });
        }

        await context.test('key exposure rejection preserves the nullable lookup and its specific copy guidance', async () => {
            for (const status of [401, 403]) {
                window.toastr.remove();
                findResponse = () => new window.Response('Keys exposure not allowed', { status });
                assert.equal(await secrets.findSecret('api_key_custom', 'test-id'), null);
                assert.equal($('.toast-error').length, 0, 'The query itself does not notify');
                await copyValue();
                assert.equal($('.toast-error').length, 1);
                assert.match($('.toast-error').text(), /key exposure is disabled/);
                assert.equal($('#api_key_custom').attr('data-secret-saved'), 'true');
            }
        });

        await context.test('copying a successful value does not queue a metadata refresh', async () => {
            for (const value of ['COPIED-TEST-ONLY', '']) {
                window.toastr.remove();
                findResponse = () => window.Response.json({ value });
                await copyValue();
                assert.equal(await window.navigator.clipboard.readText(), value);
                assert.equal($('.toast-info').length, 1);
                assert.equal($('.toast-error').length, 0);
                const readCount = reads;
                await secrets.flushPendingSecretWrites();
                assert.equal(reads, readCount);
            }
        });

        await context.test('a clipboard failure is shown once without reporting a successful secret copy', async () => {
            window.toastr.remove();
            findResponse = () => window.Response.json({ value: 'COPY-FAILURE-TEST-ONLY' });
            const write = window.navigator.clipboard.writeText;
            window.navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); };
            try {
                await copyValue();
                assert.equal($('.toast-error').length, 1);
                assert.match($('.toast-error').text(), /Clipboard unavailable/);
                assert.equal($('.toast-info, .toast-success').length, 0);
            } finally {
                window.navigator.clipboard.writeText = write;
            }
        });

        await context.test('secret read aliases retain their pipe result and quiet notification behavior', async () => {
            for (const alias of ['secret-read', 'secret-find', 'secret-get']) {
                for (const quiet of [false, true]) {
                    window.toastr.remove();
                    findResponse = () => new window.Response('Secret file could not be read', { status: 500 });
                    const result = await executeSlashCommandsWithOptions(`/${alias} key=api_key_custom quiet=${quiet} test-id`,
                        { handleParserErrors: false });
                    assert.equal(result.pipe, '');
                    assert.equal($('.toast-error').length, quiet ? 0 : 1);
                    if (!quiet) {
                        assert.match($('.toast-error').text(), /Secret file could not be read/);
                        assert.doesNotMatch($('.toast-error').text(), /exposure.*disabled/);
                    }
                }
            }
            window.toastr.remove();
            findResponse = () => window.Response.json({ value: 'SCRIPT-TEST-ONLY' });
            const result = await executeSlashCommandsWithOptions('/secret-read key=api_key_custom test-id',
                { handleParserErrors: false });
            assert.equal(result.pipe, 'SCRIPT-TEST-ONLY');
            assert.equal($('.toast-error').length, 0);
        });

        await Popup.util.popups.at(-1).completeCancelled();
        await manager;
        manager = null;
    } finally {
        const popup = getModule('scripts/popup.js').namespace.Popup.util.popups.at(-1);
        if (popup) await popup.completeCancelled();
        await Promise.allSettled([manager]);
        getModule('script.js').namespace.cancelPendingSettingsSave();
        await window.happyDOM.close();
    }
});
