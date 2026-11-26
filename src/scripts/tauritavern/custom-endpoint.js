/**
 * Build a credential-free preview matching the Custom provider URL builders.
 * An unsupported non-empty Base URL has no request preview.
 * @returns {{ suffix: string, url: string | null }}
 */
export function getCustomEndpointPreview(settings) {
    const rawBase = String(settings.custom_url || '').trim();
    let base = '<Base URL>';
    if (rawBase) {
        try {
            const url = new URL(rawBase);
            // href preserves empty ?/# delimiters that search/hash omit.
            const hasQueryOrFragment = url.href.includes('?') || url.href.includes('#');
            const allowed = ['http:', 'https:'].includes(url.protocol)
                && !url.username && !url.password && !hasQueryOrFragment;
            base = allowed ? url.href.replace(/\/+$/, '') : null;
        } catch {
            base = null;
        }
    }
    let suffix;
    switch (settings.custom_api_format) {
        case 'gemini_generate_content': {
            const model = String(settings.custom_model || '').trim() || '<Model>';
            const modelPath = model.startsWith('models/') ? model : `models/${model}`;
            const version = /\/v1(?:beta)?$/.test(base ?? '') ? '' : '/v1beta';
            const method = settings.stream_openai ? 'streamGenerateContent?alt=sse' : 'generateContent';
            suffix = `${version}/${modelPath}:${method}`;
            break;
        }
        case 'gemini_interactions':
            suffix = '/interactions';
            break;
        case 'claude_messages':
            suffix = '/messages';
            break;
        case 'openai_responses':
            suffix = '/responses';
            break;
        default:
            suffix = '/chat/completions';
    }
    return { suffix, url: base === null ? null : `${base}${suffix}` };
}
