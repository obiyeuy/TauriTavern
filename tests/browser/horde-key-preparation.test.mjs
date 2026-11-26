import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRuntime } from './runtime.mjs';

test('Horde key submission retains its cancellation lifetime through key preparation', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime();
    const resourceFetch = window.fetch;
    try {
        await startHost();
        await load('script.js');
        const $ = window.jQuery;
        const script = getModule('script.js').namespace;
        const horde = getModule('scripts/horde.js').namespace;
        const openai = getModule('scripts/openai.js').namespace;
        const secrets = getModule('scripts/secrets.js').namespace;
        const { createInterceptors } = getModule('tauri/main/interceptors.js').namespace;
        horde.initHorde();
        openai.initOpenAI();
        openai.loadOpenAISettings({ openai_setting_names: [], openai_settings: [] }, {
            ...openai.oai_settings, chat_completion_source: 'custom',
            custom_url: 'https://next.example.test/v1', reverse_proxy: '',
        });
        window.toastr.options.timeOut = 0;

        async function activateHorde() {
            script.cancelStatusCheck('Horde fixture setup');
            window.fetch = async (url, init) => {
                if (url === '/api/horde/status') return window.Response.json({ ok: true });
                if (url === '/api/horde/text-models') return window.Response.json([]);
                return resourceFetch(url, init);
            };
            script.changeMainAPI('koboldhorde');
            await horde.getStatusHorde();
            await horde.getHordeModels(true);
        }

        for (const [action, fails] of [['read', false], ['write', false], ['read', true], ['write', true]]) {
            await context.test(`cancelled Horde ${action}${fails ? ' failure remains visible' : ' cannot restart its query'}`, async () => {
                window.toastr.remove();
                await activateHorde();
                $('#horde_api_key').val(action === 'write' ? 'HORDE-KEY-TEST-ONLY' : '');
                $('#api_key_custom').val('');
                const state = { api_key_horde: [{ id: 'saved', value: 'masked', label: 'Test', active: true }] };
                const preparationStarted = Promise.withResolvers();
                const preparation = Promise.withResolvers();
                const nextStarted = Promise.withResolvers();
                const nextResponse = Promise.withResolvers();
                let reads = 0;
                let writes = 0;
                let hordeQueries = 0;
                let click;
                let nextClick;

                window.fetch = async (url, init) => {
                    if (url === '/api/secrets/read') {
                        if (++reads === 1 && action === 'read') {
                            preparationStarted.resolve();
                            return preparation.promise;
                        }
                        return window.Response.json(state);
                    }
                    if (url === '/api/secrets/write') {
                        writes++;
                        assert.equal(JSON.parse(init.body).key, secrets.SECRET_KEYS.HORDE);
                        preparationStarted.resolve();
                        const response = await preparation.promise;
                        if (response.ok) state.api_key_horde = [{ id: 'written', value: 'masked', label: 'Test', active: true }];
                        return response;
                    }
                    return resourceFetch(url, init);
                };
                createInterceptors({
                    originalFetch: window.fetch,
                    canHandleRequest: url => ['/api/horde/status', '/api/backends/chat-completions/status'].includes(url.pathname),
                    toUrl: (input, base) => new window.URL(String(input), base),
                    routeRequest: async url => {
                        if (url.pathname === '/api/horde/status') {
                            hordeQueries++;
                            return window.Response.json({ ok: true });
                        }
                        nextStarted.resolve();
                        return nextResponse.promise;
                    },
                }).patchFetch(window);

                try {
                    click = $.Event('click');
                    $('#horde_api_key_button').trigger(click);
                    await preparationStarted.promise;
                    script.cancelStatusCheck('Switched APIs during Horde key preparation');
                    script.changeMainAPI('openai');
                    nextClick = $.Event('click');
                    $('#api_button_openai').trigger(nextClick);
                    await nextStarted.promise;
                    const currentStatus = script.online_status;
                    preparation.resolve(fails ? new window.Response('Key operation failed', { status: 500 })
                        : window.Response.json(action === 'read' ? state : { id: 'written' }));
                    await click.result;
                    assert.deepEqual({
                        hordeQueries, writes, statusPreserved: script.online_status === currentStatus,
                        loadingPreserved: $('#api_button_openai').attr('aria-busy') === 'true',
                        errors: $('.toast-error').length,
                    }, {
                        hordeQueries: 0, writes: action === 'write' ? 1 : 0,
                        statusPreserved: true, loadingPreserved: true, errors: fails ? 1 : 0,
                    });
                    if (fails) {
                        assert.match($('.toast-error').text(), action === 'read' ? /refresh API key state/ : /save API key/);
                    } else if (action === 'write') {
                        assert.equal(secrets.secret_state.api_key_horde[0].id, 'written');
                        assert.equal($('#horde_api_key').val(), '');
                    }
                } finally {
                    preparation.resolve(window.Response.json(state));
                    nextResponse.resolve(window.Response.json({ data: [] }));
                    await Promise.allSettled([click?.result, nextClick?.result]);
                    $('#horde_api_key').val('');
                    script.cancelStatusCheck('Horde key fixture finished');
                    window.fetch = resourceFetch;
                }
            });
        }

        await context.test('the current submission saves its key and checks Horde once', async () => {
            window.toastr.remove();
            await activateHorde();
            const state = {};
            let writes = 0;
            let hordeQueries = 0;
            window.fetch = async (url, init) => {
                if (url === '/api/secrets/read') return window.Response.json(state);
                if (url === '/api/secrets/write') {
                    writes++;
                    const body = JSON.parse(init.body);
                    assert.equal(body.key, secrets.SECRET_KEYS.HORDE);
                    assert.equal(body.value, 'CURRENT-HORDE-KEY-TEST-ONLY');
                    state.api_key_horde = [{ id: 'current', value: 'masked', label: 'Test', active: true }];
                    return window.Response.json({ id: 'current' });
                }
                if (url === '/api/horde/status') {
                    hordeQueries++;
                    return window.Response.json({ ok: true });
                }
                return resourceFetch(url, init);
            };
            $('#horde_api_key').val('CURRENT-HORDE-KEY-TEST-ONLY');
            const click = $.Event('click');
            $('#horde_api_key_button').trigger(click);
            await click.result;
            assert.deepEqual({ writes, hordeQueries, errors: $('.toast-error').length }, { writes: 1, hordeQueries: 1, errors: 0 });
            assert.equal(secrets.secret_state.api_key_horde[0].id, 'current');
            assert.equal($('#horde_api_key').val(), '');
            assert.equal($('#horde_api_key').attr('data-secret-saved'), 'true');
            assert.notEqual(script.online_status, 'no_connection');
        });
    } finally {
        window.fetch = resourceFetch;
        getModule('script.js').namespace.cancelStatusCheck('Horde key submission test finished');
        getModule('script.js').namespace.cancelPendingSettingsSave();
        await window.happyDOM.close();
    }
});
