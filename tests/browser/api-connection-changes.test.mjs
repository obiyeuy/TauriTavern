import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRuntime } from './runtime.mjs';

test('native connection changes invalidate obsolete checks without discarding new configuration', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime();
    const resourceFetch = window.fetch;
    try {
        await startHost();
        await load('script.js');
        const $ = window.jQuery;
        const script = getModule('script.js').namespace;
        const openai = getModule('scripts/openai.js').namespace;
        const textgen = getModule('scripts/textgen-settings.js').namespace;
        const power = getModule('scripts/power-user.js').namespace;
        const secrets = getModule('scripts/secrets.js').namespace;
        const { createInterceptors } = getModule('tauri/main/interceptors.js').namespace;
        const { accountStorage } = getModule('scripts/util/AccountStorage.js').namespace;
        const { getStringHash } = getModule('scripts/utils.js').namespace;
        openai.initOpenAI();
        textgen.initTextGenSettings();
        await textgen.loadTextGenSettings({}, { textgenerationwebui_settings: {
            ...textgen.textgenerationwebui_settings, bypass_status_check: false,
        } });
        power.prepareGenerationControls({ enableLabMode: false, max_context_unlocked: false });
        await power.loadPowerUserSettings({ power_user: { ...power.power_user } }, {
            themes: [], movingUIPresets: [], context: [],
        });
        const keys = Object.fromEntries(Object.values(secrets.SECRET_KEYS).map(key => [
            key, [{ id: 'connection-fixture', value: 'masked', label: 'Test', active: true }],
        ]));
        const configureOpenAI = settings => script.withConnectionValidationSuspended('Connection fixture setup', () => {
            openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, {
                ...openai.oai_settings, reverse_proxy: '', proxy_password: '', custom_model: '', bypass_status_check: false,
                custom_url: 'https://first.example.test/v1', azure_base_url: 'https://azure.example.test',
                additional_parameters_by_source: {}, ...settings,
            });
            script.changeMainAPI('openai');
        });

        await context.test('changing the Custom address preserves the new model and newer loading while the old response completes', async () => {
            await configureOpenAI({ chat_completion_source: 'custom', custom_api_format: 'openai_compat' });
            const firstStarted = Promise.withResolvers();
            const firstResponse = Promise.withResolvers();
            const secondStarted = Promise.withResolvers();
            const secondResponse = Promise.withResolvers();
            const requests = [];
            let firstClick;
            let secondClick;
            window.fetch = async url => {
                assert.equal(url, '/api/secrets/read');
                return window.Response.json(keys);
            };
            createInterceptors({
                originalFetch: window.fetch,
                canHandleRequest: url => url.pathname === '/api/backends/chat-completions/status',
                toUrl: (input, base) => new window.URL(String(input), base),
                routeRequest: async (_url, _input, init) => {
                    requests.push(JSON.parse(init.body));
                    if (requests.length === 1) {
                        firstStarted.resolve();
                        return firstResponse.promise;
                    }
                    assert.equal(requests.length, 2);
                    secondStarted.resolve();
                    return secondResponse.promise;
                },
            }).patchFetch(window);
            try {
                firstClick = $.Event('click');
                $('#api_button_openai').trigger(firstClick);
                await firstStarted.promise;
                const signal = script.abortStatusCheck.signal;
                $('#custom_api_url_text').trigger('input');
                assert.equal(signal.aborted, false, 'the unchanged address keeps its pending check');
                $('#azure_base_url').val('https://remembered-azure.example.test').trigger('input');
                assert.equal(signal.aborted, false, 'an inactive provider address does not invalidate the Custom check');
                $('#generic_api_url_text').val('https://remembered-textgen.example.test/v1').trigger('input');
                assert.equal(signal.aborted, false, 'an inactive API family does not invalidate the Custom check');
                $('#custom_api_url_text').val('https://second.example.test/v1').trigger('input');
                $('#custom_model_id').val('hand-entered-new-model').trigger('input');
                assert.equal(signal.aborted, true, 'editing the address cancels the old check');
                assert.equal($('#api_button_openai').attr('aria-busy'), undefined);
                secondClick = $.Event('click');
                $('#api_button_openai').trigger(secondClick);
                await secondStarted.promise;
                const status = script.online_status;
                firstResponse.resolve(window.Response.json({ data: [{ id: 'first-endpoint-only-model' }] }));
                await firstClick.result;
                assert.equal(script.online_status, status);
                assert.equal($('#api_button_openai').attr('aria-busy'), 'true');
                assert.equal(openai.oai_settings.custom_model, 'hand-entered-new-model');
                assert.equal(openai.model_list.some(model => model.id === 'first-endpoint-only-model'), false);
                secondResponse.resolve(window.Response.json({ data: [{ id: 'second-endpoint-only-model' }] }));
                await secondClick.result;
                assert.deepEqual(requests.map(request => request.custom_url), [
                    'https://first.example.test/v1', 'https://second.example.test/v1',
                ]);
                assert.equal(openai.oai_settings.custom_url, 'https://second.example.test/v1');
                assert.equal(openai.oai_settings.custom_model, 'hand-entered-new-model');
                assert.deepEqual(Array.from(openai.model_list, model => model.id), ['second-endpoint-only-model']);
                assert.match(script.online_status, /Models loaded/);
            } finally {
                firstResponse.resolve(window.Response.json({ data: [] }));
                secondResponse.resolve(window.Response.json({ data: [] }));
                await Promise.allSettled([firstClick?.result, secondClick?.result]);
                script.cancelStatusCheck('Custom address fixture finished');
            }
        });

        await context.test('connection fields cancel pending key preparation only when their actual values change', async () => {
            const fields = [
                ['custom', 'custom_url', '#custom_api_url_text', 'https://first.example.test/v1', 'https://second.example.test/v1'],
                ['openai', 'reverse_proxy', '#openai_reverse_proxy', 'https://first.example.test/v1', 'https://second.example.test/v1'],
                ['openai', 'proxy_password', '#openai_proxy_access_key', 'FIRST-TEST-ONLY', 'SECOND-TEST-ONLY'],
                ['opencode', 'opencode_endpoint', '#opencode_endpoint', 'zen', 'go'],
                ['opencode', 'opencode_api_format', '#opencode_api_format', 'openai_compat', 'openai_responses'],
                ['azure_openai', 'azure_base_url', '#azure_base_url', 'https://first.example.test', 'https://second.example.test'],
                ['azure_openai', 'azure_deployment_name', '#azure_deployment_name', 'first-deployment', 'second-deployment'],
                ['azure_openai', 'azure_api_version', '#azure_api_version', '2025-04-01-preview', '2024-10-21'],
                ['siliconflow', 'siliconflow_endpoint', '#siliconflow_endpoint', 'global', 'cn'],
                ['moonshot', 'moonshot_endpoint', '#moonshot_endpoint', 'global', 'cn'],
                ['pollinations', 'pollinations_endpoint', '#pollinations_endpoint', 'anonymous', 'authenticated'],
                ['aws_bedrock', 'aws_bedrock_region', '#aws_bedrock_region', 'us-east-1', 'us-west-2'],
                ['workers_ai', 'workers_ai_account_id', '#workers_ai_account_id', 'first-account', 'second-account'],
                ['vertexai', 'vertexai_auth_mode', '#vertexai_auth_mode', 'express', 'full', 'change'],
                ['vertexai', 'vertexai_region', '#vertexai_region', 'us-central1', 'us-east1'],
                ['vertexai', 'vertexai_express_project_id', '#vertexai_express_project_id', 'first-project', 'second-project'],
                ['zai', 'zai_endpoint', '#zai_endpoint', 'common', 'coding'],
                ['minimax', 'minimax_endpoint', '#minimax_endpoint', 'global', 'cn'],
            ];
            for (const url of ['https://first.example.test/v1', 'https://second.example.test/v1']) {
                accountStorage.setItem(`Proxy_SkipConfirm_${getStringHash(url)}`, 'true');
            }
            const outcomes = [];
            for (const [source, key, selector, before, after, event = 'input'] of fields) {
                await configureOpenAI({ chat_completion_source: source, [key]: before });
                $(selector).val(before);
                const started = Promise.withResolvers();
                const preparation = Promise.withResolvers();
                let requests = 0;
                let click;
                window.fetch = async url => {
                    if (url === '/api/secrets/read') {
                        started.resolve();
                        return preparation.promise;
                    }
                    assert.equal(url, '/api/backends/chat-completions/status');
                    requests++;
                    return window.Response.json({ data: [] });
                };
                try {
                    click = $.Event('click');
                    $('#api_button_openai').trigger(click);
                    await started.promise;
                    const signal = script.abortStatusCheck.signal;
                    $(selector).trigger(event);
                    assert.equal(signal.aborted, false, `${key}: unchanged input retains the check`);
                    $(selector).val(after).trigger(event);
                    const cancelled = signal.aborted;
                    preparation.resolve(window.Response.json(keys));
                    await click.result;
                    outcomes.push({
                        field: key, cancelled, valueSaved: openai.oai_settings[key] === after,
                        obsoleteCheckNotStarted: requests === 0, statusCleared: script.online_status === 'no_connection',
                    });
                } finally {
                    preparation.resolve(window.Response.json(keys));
                    await click?.result;
                    script.cancelStatusCheck('Connection field fixture finished');
                }
            }
            assert.deepEqual(outcomes, fields.map(([, key]) => ({
                field: key, cancelled: true, valueSaved: true, obsoleteCheckNotStarted: true, statusCleared: true,
            })));
        });

        await context.test('request header edits invalidate the model check while body parameters and unchanged headers keep it', async () => {
            await configureOpenAI({ chat_completion_source: 'custom', custom_api_format: 'openai_compat' });
            const { Popup } = getModule('scripts/popup.js').namespace;
            const started = Promise.withResolvers();
            const response = Promise.withResolvers();
            const opened = Promise.withResolvers();
            const observer = new window.MutationObserver(() => {
                const popup = Popup.util.popups.at(-1);
                if (popup?.dlg.open) opened.resolve(popup);
            });
            let click;
            let customize;
            let popup;
            let request;
            let requests = 0;
            window.fetch = async (url, init) => url === '/api/secrets/read'
                ? window.Response.json(keys) : resourceFetch(url, init);
            createInterceptors({
                originalFetch: window.fetch,
                canHandleRequest: url => url.pathname === '/api/backends/chat-completions/status',
                toUrl: (input, base) => new window.URL(String(input), base),
                routeRequest: async (_url, _input, init) => {
                    request = JSON.parse(init.body);
                    if (++requests === 1) {
                        started.resolve();
                        return response.promise;
                    }
                    return window.Response.json({ data: [{ id: 'updated-header-model' }] });
                },
            }).patchFetch(window);
            try {
                click = $.Event('click');
                $('#api_button_openai').trigger(click);
                await started.promise;
                const signal = script.abortStatusCheck.signal;
                observer.observe(window.document.body, { childList: true, subtree: true });
                customize = $.Event('click');
                $('#customize_additional_parameters').trigger(customize);
                popup = await opened.promise;
                const headers = $(popup.content).find('#custom_include_headers');
                $(popup.content).find('#custom_include_body').val('temperature: 0.1').trigger('input');
                headers.trigger('input');
                assert.equal(signal.aborted, false, 'body-only or unchanged header edits retain the model check');
                headers.val('X-Connection-Fixture: updated').trigger('input');
                const cancelled = signal.aborted;
                response.resolve(window.Response.json({ data: [{ id: 'obsolete-header-model' }] }));
                await click.result;
                assert.equal(cancelled, true);
                assert.equal(script.online_status, 'no_connection');
                assert.equal(openai.model_list.some(model => model.id === 'obsolete-header-model'), false);
                assert.equal(openai.getAdditionalParametersForSource().include_headers, 'X-Connection-Fixture: updated');
                await popup.completeAffirmative();
                await customize.result;
                const reconnect = $.Event('click');
                $('#api_button_openai').trigger(reconnect);
                await reconnect.result;
                assert.equal(request.custom_include_headers, 'X-Connection-Fixture: updated');
            } finally {
                observer.disconnect();
                response.resolve(window.Response.json({ data: [] }));
                if (popup?.dlg.open) await popup.completeCancelled();
                await Promise.allSettled([click?.result, customize?.result]);
                script.cancelStatusCheck('Header edit fixture finished');
            }
        });

        await context.test('proxy preset selection and deletion cancel the old connection before their replacement check', async () => {
            const outcomes = [];
            for (const action of ['select', 'delete', 'delete-last']) {
                await configureOpenAI({ chat_completion_source: 'openai' });
                const first = { name: 'First', url: 'https://first.example.test/v1', password: 'FIRST-TEST-ONLY' };
                const second = { name: 'Second', url: 'https://second.example.test/v1', password: 'SECOND-TEST-ONLY' };
                await script.withConnectionValidationSuspended('Proxy preset fixture setup', () => {
                    openai.loadProxyPresets({
                        proxies: action === 'delete-last' ? [first] : [first, second],
                        selected_proxy: action === 'delete' ? second : first,
                    });
                });
                const started = Promise.withResolvers();
                const response = Promise.withResolvers();
                const replacementStarted = Promise.withResolvers();
                const replacementResponse = Promise.withResolvers();
                const requests = [];
                let click;
                let replacement;
                window.fetch = async url => {
                    assert.equal(url, '/api/secrets/read');
                    return window.Response.json(keys);
                };
                createInterceptors({
                    originalFetch: window.fetch,
                    canHandleRequest: url => url.pathname === '/api/backends/chat-completions/status',
                    toUrl: (input, base) => new window.URL(String(input), base),
                    routeRequest: async (_url, _input, init) => {
                        requests.push(JSON.parse(init.body));
                        if (requests.length === 1) {
                            started.resolve();
                            return response.promise;
                        }
                        assert.equal(requests.length, 2);
                        replacementStarted.resolve();
                        return replacementResponse.promise;
                    },
                }).patchFetch(window);
                try {
                    click = $.Event('click');
                    $('#api_button_openai').trigger(click);
                    await started.promise;
                    const signal = script.abortStatusCheck.signal;
                    $('#api_button_openai').one('click.proxy-fixture', event => { replacement = event.result; });
                    const edit = $.Event(action === 'select' ? 'change' : 'click');
                    if (action === 'select') $('#openai_proxy_preset').val('Second').trigger(edit);
                    else $('#delete_proxy').trigger(edit);
                    await edit.result;
                    if (replacement) await replacementStarted.promise;
                    const cancelled = signal.aborted;
                    response.resolve(window.Response.json({ data: [{ id: 'obsolete-proxy-model' }] }));
                    await click.result;
                    outcomes.push({
                        action, cancelled, replacementStarted: !!replacement,
                        oldResultIgnored: !openai.model_list.some(model => model.id === 'obsolete-proxy-model'),
                        replacementLoadingHeld: $('#api_button_openai').attr('aria-busy') === 'true',
                    });
                    replacementResponse.resolve(window.Response.json({ data: [{ id: 'replacement-proxy-model' }] }));
                    await replacement;
                    if (replacement) {
                        assert.equal(requests[1].reverse_proxy, action === 'select' ? second.url : action === 'delete' ? first.url : '');
                        assert.equal(requests[1].proxy_password, action === 'select' ? second.password : action === 'delete' ? first.password : '');
                    }
                    if (action === 'delete-last') assert.equal(openai.proxies.length, 0);
                } finally {
                    $('#api_button_openai').off('click.proxy-fixture');
                    response.resolve(window.Response.json({ data: [] }));
                    replacementResponse.resolve(window.Response.json({ data: [] }));
                    await Promise.allSettled([click?.result, replacement]);
                    script.cancelStatusCheck('Proxy preset fixture finished');
                }
            }
            assert.deepEqual(outcomes, ['select', 'delete', 'delete-last'].map(action => ({
                action, cancelled: true, replacementStarted: true, oldResultIgnored: true, replacementLoadingHeld: true,
            })));
        });

        await context.test('Text Completion native address inputs invalidate pending results across supported server types', async () => {
            Object.assign(power.power_user, { context_size_derived: false, context_derived: false, instruct_derived: false });
            const outcomes = [];
            for (const [type, selector] of Object.entries(textgen.SERVER_INPUTS)) {
                await script.withConnectionValidationSuspended('Text Completion fixture setup', () => {
                    textgen.textgenerationwebui_settings.type = type;
                    textgen.textgenerationwebui_settings.server_urls[type] = 'https://first.example.test/v1';
                    $(selector).val('https://first.example.test/v1');
                    script.changeMainAPI('textgenerationwebui');
                });
                const started = Promise.withResolvers();
                const response = Promise.withResolvers();
                let click;
                window.fetch = async url => {
                    assert.equal(url, '/api/secrets/read');
                    return window.Response.json(keys);
                };
                createInterceptors({
                    originalFetch: window.fetch,
                    canHandleRequest: url => url.pathname === '/api/backends/text-completions/status',
                    toUrl: (input, base) => new window.URL(String(input), base),
                    routeRequest: async (_url, _input, init) => {
                        assert.equal(JSON.parse(init.body).api_server, 'https://first.example.test/v1');
                        started.resolve();
                        return response.promise;
                    },
                }).patchFetch(window);
                try {
                    click = $.Event('click');
                    $('#api_button_textgenerationwebui').trigger(click);
                    await started.promise;
                    const signal = script.abortStatusCheck.signal;
                    $(selector).trigger('input');
                    assert.equal(signal.aborted, false, `${type}: unchanged input retains the check`);
                    const [, inactiveSelector] = Object.entries(textgen.SERVER_INPUTS).find(([otherType]) => otherType !== type);
                    $(inactiveSelector).val('https://remembered-other-server.example.test/v1').trigger('input');
                    assert.equal(signal.aborted, false, `${type}: another server's remembered address retains the check`);
                    $('#openai_reverse_proxy').val('https://remembered-openai-proxy.example.test/v1').trigger('input');
                    assert.equal(signal.aborted, false, `${type}: an inactive API family retains the check`);
                    $(selector).val('https://second.example.test/v1').trigger('input');
                    const cancelled = signal.aborted;
                    response.resolve(window.Response.json({ result: 'obsolete-model', data: [{ id: 'obsolete-model' }] }));
                    await click.result;
                    outcomes.push({
                        type, cancelled, valueSaved: textgen.getTextGenServer() === 'https://second.example.test/v1',
                        statusCleared: script.online_status === 'no_connection',
                        loadingCleared: $('#api_button_textgenerationwebui').attr('aria-busy') === undefined,
                    });
                } finally {
                    response.resolve(window.Response.json({ data: [] }));
                    await click?.result;
                    script.cancelStatusCheck('Text Completion address fixture finished');
                }
            }
            assert.deepEqual(outcomes, Object.keys(textgen.SERVER_INPUTS).map(type => ({
                type, cancelled: true, valueSaved: true, statusCleared: true, loadingCleared: true,
            })));
        });
    } finally {
        window.fetch = resourceFetch;
        getModule('script.js').namespace.cancelPendingSettingsSave();
        await window.happyDOM.close();
    }
});
