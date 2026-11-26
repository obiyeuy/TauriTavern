import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createBrowserRuntime } from './runtime.mjs';

test('temporary generation lengths belong to their requests', async context => {
    const { window, load, getModule, startHost, fixture, initializeChatRendering } = await createBrowserRuntime();
    try {
        await startHost();
        const app = await initializeChatRendering();
        await app.getSettings();
        const openai = getModule('scripts/openai.js').namespace;
        const { power_user } = getModule('scripts/power-user.js').namespace;
        const { extension_settings } = getModule('scripts/extensions.js').namespace;
        const { eventSource, event_types } = getModule('scripts/events.js').namespace;
        getModule('scripts/macros.js').namespace.initMacros();
        const originalFetch = window.fetch;
        let requests = [];
        let responseText = 'OK';
        window.fetch = async (input, options) => {
            if (!['/api/backends/chat-completions/generate', '/api/backends/text-completions/generate'].includes(input)) {
                return originalFetch(input, options);
            }
            requests.push(JSON.parse(options.body));
            return window.Response.json(input.includes('chat-completions')
                ? { choices: [{ message: { role: 'assistant', content: responseText } }] }
                : { choices: [{ index: 0, text: responseText, finish_reason: 'stop' }] });
        };
        const reset = () => {
            requests = [];
            responseText = 'OK';
            app.changeMainAPI('openai');
            Object.assign(openai.oai_settings, {
                chat_completion_source: 'custom', custom_model: 'budget-model',
                custom_url: 'https://api.example.test/v1', custom_api_format: 'openai_compat',
                openai_max_context: 128000, openai_max_tokens: 65535,
            });
        };

        await context.test('overlapping raw requests retain 32 and 64 without changing the 65535 preference', async () => {
            reset();
            const entered = { first: Promise.withResolvers(), second: Promise.withResolvers() };
            const release = { first: Promise.withResolvers(), second: Promise.withResolvers() };
            const hook = async ({ chat }) => {
                const label = chat[0].content;
                entered[label].resolve();
                await release[label].promise;
            };
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, hook);
            const observedPreferences = [];
            let first, second;
            try {
                first = app.generateRawData({ api: 'openai', prompt: 'first', responseLength: 32 });
                await entered.first.promise;
                observedPreferences.push(openai.oai_settings.openai_max_tokens);
                second = app.generateRawData({ api: 'openai', prompt: 'second', responseLength: 64 });
                await entered.second.promise;
                observedPreferences.push(openai.oai_settings.openai_max_tokens);
                release.first.resolve();
                await first;
                observedPreferences.push(openai.oai_settings.openai_max_tokens);
                release.second.resolve();
                await second;
                observedPreferences.push(openai.oai_settings.openai_max_tokens);
                assert.deepEqual(requests.map(request => [request.messages[0].content, request.max_tokens]),
                    [['first', 32], ['second', 64]]);
                assert.deepEqual(observedPreferences, [65535, 65535, 65535, 65535]);
            } finally {
                release.first.resolve();
                release.second.resolve();
                await Promise.allSettled([first, second]);
                eventSource.removeListener(event_types.CHAT_COMPLETION_PROMPT_READY, hook);
            }
        });

        await context.test('settings flush saves the preference while raw prompt hooks are still waiting', async () => {
            reset();
            const entered = Promise.withResolvers();
            const release = Promise.withResolvers();
            const hook = async () => { entered.resolve(); await release.promise; };
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, hook);
            const generation = app.generateRawData({ api: 'openai', prompt: 'held', responseLength: 32 });
            try {
                await entered.promise;
                const flushing = app.flushPendingSettingsSave(true);
                // All fixture IO is immediate. Drain the microtasks once; generation remains gated.
                const result = await Promise.race([flushing.then(() => 'saved'), setImmediate('waiting')]);
                assert.equal(result, 'saved');
                const saved = JSON.parse(JSON.parse(fixture.backend.handle({
                    method: 'POST', url: '/api/settings/get', headers: {}, body: '{}',
                }).body).settings);
                assert.equal(saved.oai_settings.openai_max_tokens, 65535);
                assert.equal(requests.length, 0);
            } finally {
                release.resolve();
                await generation;
                eventSource.removeListener(event_types.CHAT_COMPLETION_PROMPT_READY, hook);
            }
        });

        await context.test('raw CC prompt, nested fields, prefill, stop and templates share live budget macros', async () => {
            for (const engine of [false, true]) {
                reset();
                power_user.experimental_macro_engine = engine;
                power_user.persona_description = 'persona:{{maxResponse}}';
                app.chat_metadata.variables = { budgetWrites: 0 };
                extension_settings.variables.global = { marker: '' };
                power_user.custom_stopping_strings = '["stop:{{maxResponse}}/{{maxPrompt}}"]';
                power_user.custom_stopping_strings_macro = true;
                const parameters = openai.getAdditionalParametersForSource(openai.oai_settings);
                parameters.include_headers = 'X-Budget: {{maxResponse}}/{{maxPrompt}}';
                const data = await app.generateRawData({
                    api: 'openai', responseLength: 32,
                    prompt: '{{incvar::budgetWrites}}{{setglobalvar::marker::updated}}'
                        + '{{maxResponse}}/{{maxPrompt}}/{{maxPromptTokens}}/{{persona}}',
                    prefill: 'prefill:{{maxResponse}}',
                });
                assert.equal(data.choices[0].message.content, 'OK');
                assert.equal(requests[0].messages[0].content, '132/127968/127968/persona:32');
                assert.equal(requests[0].messages[1].content, 'prefill:32');
                assert.deepEqual(Array.from(requests[0].stop), ['stop:32/127968']);
                assert.equal(requests[0].custom_include_headers, 'X-Budget: 32/127968');
                assert.equal(app.chat_metadata.variables.budgetWrites, 1);
                assert.equal(extension_settings.variables.global.marker, 'updated');
                assert.equal(openai.oai_settings.openai_max_tokens, 65535);
            }
            power_user.custom_stopping_strings = '[]';
            power_user.persona_description = '';
            openai.getAdditionalParametersForSource(openai.oai_settings).include_headers = '';
        });

        await context.test('raw output strips the stop sequence prepared with the request length', async () => {
            reset();
            power_user.user_prompt_bias = '';
            power_user.custom_stopping_strings = '["stop:{{maxResponse}}"]';
            power_user.custom_stopping_strings_macro = true;
            responseText = 'Answerstop:32';
            assert.equal(await app.generateRaw({ prompt: 'probe', responseLength: 32, trimNames: false }), 'Answer');
            assert.deepEqual(requests[0].stop, ['stop:32']);
            assert.equal(openai.oai_settings.openai_max_tokens, 65535);
            power_user.custom_stopping_strings = '[]';
        });

        await context.test('an empty raw response does not execute output stop macros', async () => {
            reset();
            app.chat_metadata.variables = { stopReads: 0 };
            power_user.custom_stopping_strings = '["{{incvar::stopReads}}"]';
            power_user.custom_stopping_strings_macro = true;
            responseText = '';
            await assert.rejects(app.generateRaw({ prompt: 'probe', responseLength: 32 }), /No message generated/);
            assert.equal(app.chat_metadata.variables.stopReads, 1);
            power_user.custom_stopping_strings = '[]';
        });

        await context.test('raw text completion keeps its own length and macro budget while another request starts', async () => {
            reset();
            app.changeMainAPI('textgenerationwebui');
            const userLength = app.amount_gen;
            const entered = { first: Promise.withResolvers(), second: Promise.withResolvers() };
            const release = { first: Promise.withResolvers(), second: Promise.withResolvers() };
            const hook = async ({ prompt }) => {
                const label = prompt.includes('first:') ? 'first' : 'second';
                entered[label].resolve();
                await release[label].promise;
            };
            eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, hook);
            let first, second;
            try {
                first = app.generateRawData({ prompt: 'first:{{maxResponse}}', responseLength: 32, instructOverride: true });
                await entered.first.promise;
                second = app.generateRawData({ prompt: 'second:{{maxResponse}}', responseLength: 64, instructOverride: true });
                await entered.second.promise;
                release.first.resolve();
                await first;
                release.second.resolve();
                await second;
                assert.deepEqual(requests.map(request => request.max_new_tokens), [32, 64]);
                assert.ok(requests[0].prompt.includes('first:32'), requests[0].prompt);
                assert.ok(requests[1].prompt.includes('second:64'), requests[1].prompt);
                assert.equal(app.amount_gen, userLength);
            } finally {
                release.first.resolve();
                release.second.resolve();
                await Promise.allSettled([first, second]);
                eventSource.removeListener(event_types.GENERATE_AFTER_COMBINE_PROMPTS, hook);
            }
        });

        await context.test('cancellation preserves a preference changed during prompt preparation', async () => {
            reset();
            const hook = async () => {
                openai.oai_settings.openai_max_tokens = 1024;
                await eventSource.emit(event_types.GENERATION_STOPPED);
            };
            eventSource.once(event_types.CHAT_COMPLETION_PROMPT_READY, hook);
            await assert.rejects(app.generateRawData({ prompt: 'cancel', responseLength: 32 }), /Cancelled by extension/);
            assert.equal(requests.length, 0);
            assert.equal(openai.oai_settings.openai_max_tokens, 1024);
        });

        await context.test('quiet prompt assembly and raw generation each keep their length across a shared hook', async () => {
            reset();
            power_user.custom_stopping_strings = '[]';
            power_user.persona_description = '';
            openai.getAdditionalParametersForSource(openai.oai_settings).include_headers = '';
            Object.assign(openai.oai_settings, { openai_max_context: 512, openai_max_tokens: 480 });
            power_user.user_prompt_bias = 'bias:{{maxResponse}}';
            const ajax = window.jQuery.ajax;
            window.jQuery.ajax = options => {
                if (options.url?.startsWith('/api/tokenizers/openai/count-batch')) {
                    return Promise.resolve({
                        token_counts: JSON.parse(options.data).map(message => 4 + Math.ceil(JSON.stringify(message).length / 4)),
                    });
                }
                return ajax(options);
            };
            app.characters.push({
                name: 'Budget', avatar: 'Budget.png', chat: 'budget-chat', shallow: false,
                description: 'description:{{maxResponse}}', personality: '', scenario: '', mes_example: '', first_mes: '',
                data: { extensions: {} },
            });
            app.setCharacterId(app.characters.length - 1);
            app.setCharacterName('Budget');
            app.setOnlineStatus('budget-model');
            const worldInfo = getModule('scripts/world-info.js').namespace;
            worldInfo.selected_world_info.push('Budget lore');
            worldInfo.worldInfoCache.set('Budget lore', { entries: { 0: {
                ...structuredClone(worldInfo.newWorldInfoEntryTemplate), uid: 0, constant: true,
                content: 'world:{{maxResponse}}', position: worldInfo.world_info_position.before,
            } } });
            const { extension_prompt_types } = getModule('scripts/extension-prompts.js').namespace;
            app.setExtensionPrompt('budget-inline', 'extension:{{maxResponse}}', extension_prompt_types.IN_CHAT, 0, false);
            app.chat.push(
                { name: 'User', is_user: true, is_system: false, mes: 'Old context ' + 'x'.repeat(2400), extra: {} },
                { name: 'User', is_user: true, is_system: false, mes: 'Recent context {{maxResponse}}', extra: {} },
            );
            openai.oai_settings.prompts.find(prompt => prompt.identifier === 'main').content = 'main:{{maxResponse}}';
            const entered = Promise.withResolvers();
            const release = Promise.withResolvers();
            const hook = async () => { entered.resolve(); await release.promise; };
            eventSource.once(event_types.CHAT_COMPLETION_PROMPT_READY, hook);
            const quiet = app.generateQuietPrompt({ quietPrompt: 'quiet:{{maxResponse}}', responseLength: 32 });
            try {
                await Promise.race([entered.promise, quiet.then(() => { throw new Error('Quiet generation did not reach its prompt hook'); })]);
                await app.generateRawData({ prompt: 'raw', responseLength: 64 });
                release.resolve();
                assert.equal(await quiet, 'bias:32OK');
                assert.deepEqual(requests.map(request => request.max_tokens), [64, 32]);
                const text = requests[1].messages.map(message => message.content).join('\n');
                assert.ok(text.includes('main:32'), text);
                assert.ok(text.includes('description:32'), text);
                assert.ok(text.includes('quiet:32'), text);
                assert.ok(text.includes('world:32'), text);
                assert.ok(text.includes('extension:32'), text);
                assert.ok(text.includes('Recent context 32'), text);
                assert.equal(text.includes('Old context'), false);
                assert.equal(openai.oai_settings.openai_max_tokens, 480);
            } finally {
                release.resolve();
                await quiet;
                power_user.user_prompt_bias = '';
                window.jQuery.ajax = ajax;
                eventSource.removeListener(event_types.CHAT_COMPLETION_PROMPT_READY, hook);
            }
        });

        await context.test('quiet text completion uses its request budget in instruction, lore and stop macros', async () => {
            reset();
            app.changeMainAPI('textgenerationwebui');
            app.setOnlineStatus('budget-model');
            const userLength = app.amount_gen;
            Object.assign(power_user.instruct, {
                enabled: true, macro: true, story_string_prefix: 'prefix:{{maxResponse}}',
                input_sequence: 'input:{{maxResponse}}', output_sequence: 'output:{{maxResponse}}',
                last_system_sequence: 'last:{{maxResponse}}',
            });
            Object.assign(power_user.sysprompt, { enabled: true, content: 'system:{{maxResponse}}' });
            power_user.custom_stopping_strings = '["stop:{{maxResponse}}"]';
            power_user.custom_stopping_strings_macro = true;
            assert.equal(await app.generateQuietPrompt({ quietPrompt: 'quiet:{{maxResponse}}', responseLength: 32 }), 'OK');
            assert.equal(requests[0].max_new_tokens, 32);
            for (const text of ['prefix:32', 'system:32', 'world:32', 'extension:32', 'quiet:32', 'last:32']) {
                assert.ok(requests[0].prompt.includes(text), `${text} missing from ${requests[0].prompt}`);
            }
            assert.ok(requests[0].stop.includes('stop:32'));
            assert.equal(app.amount_gen, userLength);
        });
    } finally {
        await window.happyDOM.close();
    }
});
