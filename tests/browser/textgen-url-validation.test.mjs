import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRuntime } from './runtime.mjs';

test('Text Completion Connect validates and commits its address before preparing keys', async context => {
    const { window, load, getModule, startHost } = await createBrowserRuntime();
    const resourceFetch = window.fetch;
    try {
        await startHost();
        await load('script.js');
        const $ = window.jQuery;
        const script = getModule('script.js').namespace;
        const textgen = getModule('scripts/textgen-settings.js').namespace;
        textgen.initTextGenSettings();
        await textgen.loadTextGenSettings({}, { textgenerationwebui_settings: {
            ...textgen.textgenerationwebui_settings, type: 'generic', bypass_status_check: false,
        } });
        script.changeMainAPI('textgenerationwebui');
        window.toastr.options.timeOut = 0;

        await context.test('invalid and empty addresses retain both drafts without key or status I/O', async () => {
            const outcomes = [];
            for (const address of ['not-a-url', '']) {
                window.toastr.remove();
                const state = {};
                const calls = { read: 0, write: 0, status: 0 };
                window.fetch = async (url, init) => {
                    if (url === '/api/secrets/read') {
                        calls.read++;
                        return window.Response.json(state);
                    }
                    if (url === '/api/secrets/write') {
                        calls.write++;
                        const { key } = JSON.parse(init.body);
                        state[key] = [{ id: 'saved', value: 'masked', label: 'Test', active: true }];
                        return window.Response.json({ id: 'saved' });
                    }
                    if (url === '/api/backends/text-completions/status') {
                        calls.status++;
                        return window.Response.json({ result: 'no_connection' });
                    }
                    return resourceFetch(url, init);
                };
                $('#generic_api_url_text').val(address).trigger('input');
                $('#api_key_generic').val('VALIDATION-DRAFT-TEST-ONLY');
                const click = $.Event('click');
                $('#api_button_textgenerationwebui').trigger(click);
                await click.result;
                outcomes.push({
                    address, calls, addressRetained: $('#generic_api_url_text').val() === address,
                    keyDraftRetained: $('#api_key_generic').val() === 'VALIDATION-DRAFT-TEST-ONLY',
                    loadingReleased: $('#api_button_textgenerationwebui').attr('aria-busy') === undefined,
                    validationErrorShown: $('.toast-error').text().includes('valid API URL'),
                });
            }
            assert.deepEqual(outcomes, ['not-a-url', ''].map(address => ({
                address, calls: { read: 0, write: 0, status: 0 }, addressRetained: true,
                keyDraftRetained: true, loadingReleased: true, validationErrorShown: true,
            })));
        });

        await context.test('the normalized address is already saved while key preparation waits and is used by the new request', async () => {
            window.toastr.remove();
            $('#api_key_generic').val('');
            $('#generic_api_url_text').val('https://EXAMPLE.test').trigger('input');
            const started = Promise.withResolvers();
            const preparation = Promise.withResolvers();
            const requests = [];
            let click;
            window.fetch = async (url, init) => {
                if (url === '/api/secrets/read') {
                    started.resolve();
                    return preparation.promise;
                }
                if (url === '/api/backends/text-completions/status') {
                    requests.push(JSON.parse(init.body));
                    return window.Response.json({ result: 'no_connection' });
                }
                return resourceFetch(url, init);
            };
            try {
                click = $.Event('click');
                $('#api_button_textgenerationwebui').trigger(click);
                await started.promise;
                assert.equal($('#generic_api_url_text').val(), 'https://example.test/');
                assert.equal(textgen.getTextGenServer(), 'https://example.test/');
                preparation.resolve(window.Response.json({}));
                await click.result;
                assert.equal(requests.length, 1);
                assert.equal(requests[0].api_server, 'https://example.test/');
                assert.equal($('#api_button_textgenerationwebui').attr('aria-busy'), undefined);
            } finally {
                preparation.resolve(window.Response.json({}));
                await click?.result;
                script.cancelStatusCheck('URL normalization fixture finished');
            }
        });

        await context.test('a provider with a fixed service URL connects despite an unrelated invalid address draft', async () => {
            await script.withConnectionValidationSuspended('Fixed service fixture setup', () => {
                textgen.textgenerationwebui_settings.type = textgen.textgen_types.MANCER;
                $('#textgen_type').val(textgen.textgen_types.MANCER).trigger('change');
                $('#generic_api_url_text').val('not-a-url').trigger('input');
                $('#api_key_generic').val('');
            });
            const requests = [];
            window.fetch = async (url, init) => {
                if (url === '/api/secrets/read') return window.Response.json({});
                if (url === '/api/backends/text-completions/status') {
                    requests.push(JSON.parse(init.body));
                    return window.Response.json({ result: 'no_connection', data: [] });
                }
                return resourceFetch(url, init);
            };
            const click = $.Event('click');
            $('#api_button_textgenerationwebui').trigger(click);
            await click.result;
            assert.equal(requests.length, 1);
            assert.equal(requests[0].api_type, textgen.textgen_types.MANCER);
            assert.equal(requests[0].api_server, textgen.getTextGenServer());
            assert.equal($('#generic_api_url_text').val(), 'not-a-url');
        });
    } finally {
        window.fetch = resourceFetch;
        getModule('script.js').namespace.cancelPendingSettingsSave();
        await window.happyDOM.close();
    }
});
