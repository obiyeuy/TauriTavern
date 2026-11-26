import assert from 'node:assert/strict';
import test from 'node:test';

import { jsonResponse } from '../src/tauri/main/http-utils.js';
import { createRouteRegistry } from '../src/tauri/main/router.js';

async function createAiRouter(safeInvoke) {
    globalThis.window ??= {};
    globalThis.document ??= { visibilityState: 'visible' };
    globalThis.localStorage ??= {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
    };

    const { registerAiRoutes } = await import('../src/tauri/main/routes/ai-routes.js');
    const router = createRouteRegistry();
    registerAiRoutes(router, { safeInvoke }, { jsonResponse });
    return router;
}

test('chat completion status exposes structured network failures', async () => {
    const router = await createAiRouter(async () => {
        const error = new Error('error sending request for url (https://api.example.test/v1/chat/completions)');
        error.details = {
            code: 'network.proxy_failed',
            category: 'network',
            endpoint: 'https://api.example.test/v1/chat/completions',
            messageKey: 'tauritavern.error.network.proxy_failed',
        };
        throw error;
    });

    const originalConsoleError = console.error;
    console.error = () => {};
    let response;
    try {
        response = await router.handle({
            method: 'POST',
            path: '/api/backends/chat-completions/status',
            body: { chat_completion_source: 'openai' },
        });
    } finally {
        console.error = originalConsoleError;
    }

    const body = await response.json();
    assert.deepEqual({
        status: response.status,
        error: body.error,
        code: body.code,
        category: body.category,
        messageKey: body.message_key,
        endpoint: body.endpoint,
    }, {
        status: 200,
        error: true,
        code: 'network.proxy_failed',
        category: 'network',
        messageKey: 'tauritavern.error.network.proxy_failed',
        endpoint: 'https://api.example.test/v1/chat/completions',
    });
    assert.match(body.message, /Could not connect through the configured proxy/);
});

test('unavailable generation endpoints expose the address, protocol guidance and original service error', async () => {
    const router = await createAiRouter(async command => {
        if (command !== 'generate_chat_completion') return;
        const error = new Error('API endpoint unavailable');
        error.details = {
            code: 'http.not_found',
            category: 'http',
            endpoint: 'https://api.example.test/v1/responses',
            message_key: 'tauritavern.error.http.not_found',
            provider_message: 'This API does not provide /responses',
        };
        throw error;
    });
    const originalConsoleError = console.error;
    console.error = () => {};
    let response;
    try {
        response = await router.handle({
            method: 'POST',
            path: '/api/backends/chat-completions/generate',
            body: { chat_completion_source: 'custom', custom_api_format: 'openai_responses', type: 'quiet' },
        });
    } finally {
        console.error = originalConsoleError;
    }
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.error.code, 'http.not_found');
    assert.equal(body.error.endpoint, 'https://api.example.test/v1/responses');
    assert.match(body.error.message, /HTTP 404/);
    assert.match(body.error.message, /Base URL/);
    assert.match(body.error.message, /protocol/);
    assert.match(body.error.message, /This API does not provide \/responses/);
});

test('OpenCode generation carries the current stable chat id', async () => {
    globalThis.__TAURITAVERN__ = {
        api: {
            chat: {
                current: {
                    handle: () => ({ stableId: async () => 'stable-chat' }),
                },
            },
        },
    };
    const calls = [];
    const router = await createAiRouter(async (command, args) => {
        calls.push({ command, args });
        return {};
    });
    window.SillyTavern = {
        getContext: () => ({ getCurrentChatId: () => 'current-chat' }),
    };

    await router.handle({
        method: 'POST',
        path: '/api/backends/chat-completions/generate',
        body: { chat_completion_source: 'opencode', type: 'quiet' },
    });

    const generate = calls.find(call => call.command === 'generate_chat_completion');
    assert.equal(generate.args.dto._tauritavern_stable_chat_id, 'stable-chat');
});
