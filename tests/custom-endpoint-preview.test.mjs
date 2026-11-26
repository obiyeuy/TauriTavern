import assert from 'node:assert/strict';
import test from 'node:test';

import { getCustomEndpointPreview } from '../src/scripts/tauritavern/custom-endpoint.js';

test('Custom Gemini preview follows version, model and streaming URL rules without credentials', () => {
    for (const [base, model, stream, expected] of [
        [' https://example.test/ ', 'gemini-test', false, 'https://example.test/v1beta/models/gemini-test:generateContent'],
        ['https://example.test/proxy/v1/', 'models/gemini-test', true, 'https://example.test/proxy/v1/models/gemini-test:streamGenerateContent?alt=sse'],
        ['https://example.test/v1beta', ' gemini-test ', true, 'https://example.test/v1beta/models/gemini-test:streamGenerateContent?alt=sse'],
        ['https://example.test/proxy', '', false, 'https://example.test/proxy/v1beta/models/<Model>:generateContent'],
        [' HTTPS://EXAMPLE.test:443/代理/v1/// ', 'gemini-test', false, 'https://example.test/%E4%BB%A3%E7%90%86/v1/models/gemini-test:generateContent'],
    ]) {
        const { url } = getCustomEndpointPreview({
            custom_api_format: 'gemini_generate_content', custom_url: base,
            custom_model: model, stream_openai: stream,
        });
        assert.equal(url, expected);
    }
});

test('Custom previews reject unsupported bases instead of showing credentials or non-request URLs', () => {
    for (const base of [
        'https://preview-user:preview-secret@api.example.test/v1',
        'https://api.example.test/v1?key=preview-secret',
        'https://api.example.test/v1#models',
        'https://api.example.test/v1?',
        'https://api.example.test/v1#',
        'ftp://api.example.test/v1',
        'an invalid address',
    ]) {
        const { url } = getCustomEndpointPreview({ custom_url: base, custom_api_format: 'openai_compat' });
        assert.equal(url, null, 'an unsupported Base URL must not be displayed as a request endpoint');
    }
});

test('Custom previews preserve encoded path characters and the empty-field setup placeholder', () => {
    const settings = { custom_api_format: 'openai_responses' };
    assert.equal(getCustomEndpointPreview({ ...settings, custom_url: 'https://api.example.test/a%3Fb%23c/' }).url,
        'https://api.example.test/a%3Fb%23c/responses');
    assert.equal(getCustomEndpointPreview({ ...settings, custom_url: '  ' }).url, '<Base URL>/responses');
});
