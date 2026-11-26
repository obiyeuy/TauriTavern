import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRuntime } from './runtime.mjs';

test('extension prompt conditions follow the actual query and assembly', async context => {
    const { window, load, getModule, startHost, initializeChatRendering } = await createBrowserRuntime();
    try {
        await startHost();
        const app = (await load('script.js')).namespace;
        const openai = getModule('scripts/openai.js').namespace;
        const { extension_prompt_types: types, extension_prompt_roles: roles } = getModule('scripts/extension-prompts.js').namespace;
        const { snapshotExtensionPromptsForFrozenRun } = getModule('scripts/tauritavern/agent/frozen-run-input-snapshot.js').namespace;
        const { macros, initRegisterMacros } = getModule('scripts/macros/macro-system.js').namespace;
        getModule('scripts/power-user.js').namespace.power_user.experimental_macro_engine = true;
        initRegisterMacros();
        const ajax = window.jQuery.ajax;
        window.jQuery.ajax = options => options.url?.startsWith('/api/tokenizers/openai/count-batch')
            ? Promise.resolve({ token_counts: JSON.parse(options.data).map(() => 1) })
            : ajax(options);

        const prompt = (value, filter, position = types.IN_PROMPT, depth = 0, role = roles.SYSTEM) =>
            ({ value, filter, position, depth, role, scan: false });
        const assemble = (extensionPrompts, markers = []) => {
            const settings = openai.normalizeChatCompletionSettingsForPromptAssembly({
                chat_completion_source: 'custom', custom_model: 'condition-model',
                openai_max_context: 4096, openai_max_tokens: 32, new_chat_prompt: '',
            });
            settings.prompts.push(...markers);
            settings.prompts.find(item => item.identifier === 'main').content = mainContent;
            settings.prompt_order = [{ character_id: 100001, order: ['main', 'chatHistory', ...markers.map(marker => marker.identifier)]
                .map(identifier => ({ identifier, enabled: true })) }];
            return openai.assembleOpenAIChatCompletionPrompt({
                settings, macroContext: macros.captureContext(), agentMode: false,
                promptInputs: {
                    messages: [{ role: 'user', content: 'Hello' }], messageExamples: [],
                    extensionPrompts, allowToolCalls: false,
                },
            });
        };
        let mainContent = 'MAIN';
        const texts = result => result.messages.map(message => message.content);

        await context.test('grouped queries await false conditions and preserve ordering, wrapping and request macros', async () => {
            const keys = ['condition-z', 'condition-b', 'condition-a', 'condition-c', 'condition-other'];
            const calls = [];
            try {
                app.extension_prompts['condition-z'] = prompt(' LAST {{maxResponse}} ', null);
                app.extension_prompts['condition-b'] = prompt('HIDDEN SYNC', () => { calls.push('sync'); return false; });
                app.extension_prompts['condition-a'] = prompt('HIDDEN ASYNC', async () => { calls.push('async'); return false; });
                app.extension_prompts['condition-c'] = prompt('OLD', async function () {
                    await Promise.resolve();
                    this.value = ' FIRST {{maxResponse}} ';
                    return true;
                });
                app.extension_prompts['condition-other'] = prompt('OTHER ROLE', () => {
                    throw new Error('An unselected condition must not run');
                }, types.IN_PROMPT, 0, roles.USER);
                const substitute = text => app.substituteParams(text, { system: { maxResponse: 32 } });
                assert.equal(await app.getExtensionPrompt(types.IN_PROMPT, 0, '|', roles.SYSTEM, true, { substitute }),
                    '|FIRST 32|LAST 32|');
                assert.deepEqual(calls, ['async', 'sync']);
                assert.equal(await app.getExtensionPromptByName('condition-a', { substitute }), '');
                assert.equal(await app.getExtensionPromptByName('condition-c', { substitute }), ' FIRST 32 ');
                app.extension_prompts['condition-z'].depth = undefined;
                app.extension_prompts['condition-z'].role = undefined;
                assert.equal(await app.getExtensionPrompt(types.IN_PROMPT, 4, '|', roles.ASSISTANT, false, { substitute }),
                    'LAST 32');
            } finally {
                for (const key of keys) delete app.extension_prompts[key];
            }
        });

        await context.test('all known and custom relative CC prompts honor the same conditions', async () => {
            const source = {};
            const calls = [];
            for (const key of ['1_memory', '2_floating_prompt', '3_vectors', '4_vectors_data_bank', 'chromadb', 'custom-hidden']) {
                source[key] = prompt(`HIDDEN ${key}`, async () => { calls.push(key); return false; });
            }
            source['custom-visible'] = prompt('OLD', function () { this.value = 'VISIBLE {{maxResponse}}'; return true; });
            const content = texts(await assemble(source));
            assert.equal(content.some(text => text.includes('HIDDEN')), false, JSON.stringify(content));
            assert.ok(content.includes('VISIBLE 32'), JSON.stringify(content));
            assert.deepEqual(calls, ['1_memory', '2_floating_prompt', '3_vectors', '4_vectors_data_bank', 'chromadb', 'custom-hidden']);
        });

        await context.test('visible relative prompts retain known insertion order and vector roles', async () => {
            const source = {
                '1_memory': prompt('SUMMARY', () => true),
                '2_floating_prompt': prompt('NOTE', async () => true),
                '3_vectors': prompt('VECTORS', () => true, types.BEFORE_PROMPT, 0, roles.USER),
                'custom-visible': prompt('CUSTOM', async () => true),
            };
            const result = await assemble(source);
            assert.deepEqual(Array.from(result.messages.slice(0, 5), ({ role, content }) => ({ role, content })), [
                { role: 'system', content: 'VECTORS' },
                { role: 'system', content: 'MAIN' },
                { role: 'system', content: 'SUMMARY' },
                { role: 'system', content: 'NOTE' },
                { role: 'system', content: 'CUSTOM' },
            ]);
        });

        await context.test('known and custom depth conditions run after main macros without preparing unused copies', async () => {
            let phase = 'before', depthReads = 0, noneReads = 0;
            const calls = [];
            macros.register('conditionMainPhase', { handler: () => { phase = 'prepared'; return 'MAIN'; } });
            macros.register('conditionDepthReads', { handler: () => { depthReads++; return 'KNOWN DEPTH'; } });
            macros.register('conditionNoneReads', { handler: () => { noneReads++; return 'UNUSED'; } });
            mainContent = '{{conditionMainPhase}}';
            try {
                const source = {
                    '1_memory': prompt('{{conditionDepthReads}}', async () => {
                        calls.push(['known', phase]); return phase === 'prepared';
                    }, types.IN_CHAT),
                    'custom-depth': prompt('CUSTOM DEPTH', async () => {
                        calls.push(['custom', phase]); return phase === 'prepared';
                    }, types.IN_CHAT),
                    '3_vectors': prompt('{{conditionNoneReads}}', () => {
                        throw new Error('NONE must not be queried');
                    }, types.NONE),
                };
                const content = texts(await assemble(source));
                assert.ok(content.some(text => text.includes('KNOWN DEPTH') && text.includes('CUSTOM DEPTH')), JSON.stringify(content));
                assert.deepEqual(calls, [['known', 'prepared'], ['custom', 'prepared']]);
                assert.equal(depthReads, 1);
                assert.equal(noneReads, 0);
            } finally {
                mainContent = 'MAIN';
                for (const name of ['conditionMainPhase', 'conditionDepthReads', 'conditionNoneReads']) macros.registry.unregisterMacro(name);
            }
        });

        await context.test('depth queries see future additions and ignore unsupported depths', async () => {
            const unselected = () => { throw new Error('Unsupported depth must not query a condition'); };
            const source = {
                trigger: prompt('TRIGGER', async () => {
                    await Promise.resolve();
                    source.future = prompt('FUTURE', null, types.IN_CHAT, 10000, roles.USER);
                    return true;
                }, types.IN_CHAT),
                negative: prompt('NEGATIVE', unselected, types.IN_CHAT, -1),
                fractional: prompt('FRACTIONAL', unselected, types.IN_CHAT, 0.5),
                beyondLimit: prompt('BEYOND', unselected, types.IN_CHAT, 10001),
            };
            assert.deepEqual(Array.from((await assemble(source)).messages, item => item.content),
                ['MAIN', 'FUTURE', 'Hello', 'TRIGGER']);
        });

        await context.test('wildcard depth keeps querying until its condition selects a concrete depth', async () => {
            let calls = 0;
            const source = { wildcard: { ...prompt('WAITING', async function () {
                if (++calls < 3) return false;
                this.depth = 2;
                this.value = 'WILDCARD';
                return true;
            }, types.IN_CHAT), depth: undefined } };
            assert.deepEqual(Array.from((await assemble(source)).messages, item => item.content),
                ['MAIN', 'WILDCARD', 'Hello']);
            assert.equal(calls, 3);
        });

        await context.test('known depth prompts retain absolute and attach marker overrides as one effective placement', async () => {
            let macroReads = 0, mainPrepared = false;
            macros.register('conditionMarkerText', { handler: () => { macroReads++; return 'MEMORY'; } });
            macros.register('conditionMarkerMain', { handler: () => { mainPrepared = true; return 'MAIN'; } });
            mainContent = '{{conditionMarkerMain}}';
            const marker = { identifier: 'summary', name: 'Memory marker', marker: true,
                system_prompt: true, role: 'user', content: 'PLACEHOLDER' };
            try {
                for (const placement of [
                    { injection_position: 1, injection_depth: 1, want: [
                        { role: 'system', content: 'MAIN' },
                        { role: 'user', content: 'MEMORY 32' },
                        { role: 'user', content: 'Hello' },
                    ] },
                    { injection_position: 2, attach_role: 'user', attach_index: 1, attach_side: 'end', want: [
                        { role: 'system', content: 'MAIN' },
                        { role: 'user', content: 'Hello\n\nMEMORY 32' },
                    ] },
                ]) {
                    macroReads = 0;
                    mainPrepared = false;
                    const phases = [];
                    const source = { '1_memory': prompt('{{conditionMarkerText}} {{maxResponse}}', async () => {
                        phases.push(mainPrepared); return true;
                    }, types.IN_CHAT) };
                    const { want, ...options } = placement;
                    const result = await assemble(source, [{ ...marker, ...options }]);
                    assert.deepEqual(Array.from(result.messages, ({ role, content }) => ({ role, content })), want);
                    assert.deepEqual(phases, [true]);
                    assert.equal(macroReads, 1);

                    macroReads = 0;
                    source['1_memory'].filter = () => false;
                    const excluded = texts(await assemble(source, [{ ...marker, ...options }]));
                    assert.equal(excluded.some(text => text.includes('MEMORY') || text.includes('PLACEHOLDER')), false);
                    assert.equal(macroReads, 0);
                }
            } finally {
                mainContent = 'MAIN';
                macros.registry.unregisterMacro('conditionMarkerText');
                macros.registry.unregisterMacro('conditionMarkerMain');
            }
        });

        await context.test('real CC generation evaluates relative conditions once at their actual assembly', async () => {
            await initializeChatRendering();
            await app.getSettings();
            getModule('scripts/power-user.js').namespace.power_user.experimental_macro_engine = true;
            getModule('scripts/macros.js').namespace.initMacros();
            app.changeMainAPI('openai');
            Object.assign(openai.oai_settings, {
                chat_completion_source: 'custom', custom_model: 'condition-model',
                custom_url: 'https://api.example.test/v1', custom_api_format: 'openai_compat',
                openai_max_context: 4096, openai_max_tokens: 32,
            });
            app.characters.push({
                name: 'Condition', avatar: 'Condition.png', chat: 'condition-chat', shallow: false,
                description: '', personality: '', scenario: '', mes_example: '', first_mes: '',
                data: { extensions: {} },
            });
            app.setCharacterId(app.characters.length - 1);
            app.setCharacterName('Condition');
            const calls = { known: [], custom: [] };
            for (const [key, label, value] of [['1_memory', 'known', 'BASE'], ['flow-custom', 'custom', 'CUSTOM']]) {
                app.setExtensionPrompt(key, value, types.IN_PROMPT, 0, false, roles.SYSTEM, async function () {
                    calls[label].push(this.value);
                    this.value += '.X';
                    return true;
                });
            }
            let messages;
            const capture = ({ chat }) => { messages = Array.from(chat, item => item.content); };
            app.eventSource.on(app.event_types.CHAT_COMPLETION_PROMPT_READY, capture);
            try {
                await app.Generate('quiet', { quiet_prompt: 'Inspect conditions.', responseLength: 32 }, true);
                assert.deepEqual(calls, { known: ['BASE'], custom: ['CUSTOM'] });
                assert.ok(messages.includes('BASE.X'), JSON.stringify(messages));
                assert.ok(messages.includes('CUSTOM.X'), JSON.stringify(messages));
            } finally {
                app.eventSource.removeListener(app.event_types.CHAT_COMPLETION_PROMPT_READY, capture);
                delete app.extension_prompts['1_memory'];
                delete app.extension_prompts['flow-custom'];
            }
        });

        await context.test('real TC generation sees a future depth added by an awaited condition', async () => {
            const previousApi = app.main_api;
            app.changeMainAPI('textgenerationwebui');
            app.setOnlineStatus('depth-model');
            app.setExtensionPrompt('tc-trigger', 'TC_TRIGGER', types.IN_CHAT, 0, false, roles.SYSTEM, async () => {
                await Promise.resolve();
                app.setExtensionPrompt('tc-future', 'TC_FUTURE', types.IN_CHAT, 10000, false, roles.USER);
                return true;
            });
            let captured;
            const capture = data => { captured = data.prompt; };
            app.eventSource.on(app.event_types.GENERATE_AFTER_DATA, capture);
            try {
                await app.Generate('quiet', { quiet_prompt: 'Inspect depths.', responseLength: 32 }, true);
                assert.equal(typeof captured, 'string');
                assert.ok(captured.includes('TC_FUTURE') && captured.includes('TC_TRIGGER'), captured);
                assert.ok(captured.indexOf('TC_FUTURE') < captured.indexOf('TC_TRIGGER'), captured);
            } finally {
                app.eventSource.removeListener(app.event_types.GENERATE_AFTER_DATA, capture);
                delete app.extension_prompts['tc-trigger'];
                delete app.extension_prompts['tc-future'];
                app.changeMainAPI(previousApi);
            }
        });

        await context.test('ordinary CC rejects a failed condition instead of returning partial messages', async () => {
            const failure = new Error('condition service unavailable');
            const source = { 'custom-reject': prompt('UNSAFE TO SEND', async () => { throw failure; }) };
            app.extension_prompts['custom-reject'] = source['custom-reject'];
            try {
                await assert.rejects(assemble(source), error => error === failure);
                await assert.rejects(app.getExtensionPrompt(), error => error === failure);
                await assert.rejects(app.getExtensionPromptByName('custom-reject'), error => error === failure);
                await assert.rejects(snapshotExtensionPromptsForFrozenRun(source), error => error === failure);
            } finally {
                delete app.extension_prompts['custom-reject'];
            }
        });

        await context.test('by-name and frozen capture preserve the condition receiver and value changes', async () => {
            let calls = 0;
            const source = {
                captured: prompt('', async function () {
                    calls++;
                    this.value = 'CAPTURED {{maxResponse}}';
                    return true;
                }),
                hidden: prompt('HIDDEN', () => false),
            };
            app.extension_prompts.captured = source.captured;
            try {
                const substitute = text => app.substituteParams(text, { system: { maxResponse: 32 } });
                assert.equal(await app.getExtensionPromptByName('captured', { substitute }), 'CAPTURED 32');
                source.captured.value = '';
                const snapshot = await snapshotExtensionPromptsForFrozenRun(source);
                assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
                    captured: { value: 'CAPTURED {{maxResponse}}', position: 0, depth: 0, scan: false, role: 0 },
                });
                assert.equal(calls, 2);
            } finally {
                delete app.extension_prompts.captured;
            }
        });

        await context.test('macro outlets remain synchronous text reads without evaluating conditions', () => {
            let calls = 0;
            app.extension_prompts.customWIOutlet_condition = prompt('OUTLET', async () => { calls++; return false; }, types.NONE);
            try {
                assert.equal(app.substituteParams('{{outlet::condition}}'), 'OUTLET');
                assert.equal(calls, 0);
            } finally {
                delete app.extension_prompts.customWIOutlet_condition;
            }
        });
    } finally {
        await window.happyDOM.close();
    }
});
