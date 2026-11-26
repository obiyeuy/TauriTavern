import { inject_ids } from './constants.js';

export const NOTE_MODULE_NAME = '2_floating_prompt'; // Sort after memory.

export function isWorldInfoInjection(key) {
    return key.startsWith(inject_ids.CUSTOM_WI_DEPTH) || key.startsWith(inject_ids.CUSTOM_WI_OUTLET(''));
}

/** World Info surrounds the note; Persona surrounds that result. */
export function composeAuthorsNote(note, { position, depth, role, worldInfo, persona }) {
    let value = note?.value ?? '';
    if (worldInfo) {
        value = `${worldInfo.before}\n${value}\n${worldInfo.after}`.replace(/(^\n)|(\n$)/g, '');
    }
    if (persona?.before) value = `${persona.before}\n${value}`;
    if (persona?.after) value = `${value}\n${persona.after}`;
    return { ...note, value, position, depth, role };
}

/**
 * @enum {number} Extension prompt types
 */
export const extension_prompt_types = {
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
};

/**
 * @enum {number} Extension prompt roles
 */
export const extension_prompt_roles = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
};

/**
 * @typedef {{value: string, position: number, depth?: number, role?: number, filter?: (() => boolean | Promise<boolean>) | null}} ExtensionPrompt
 */

/**
 * Conditions can update their prompt before it is consumed. Keep the receiver
 * and wait for both synchronous and asynchronous conditions at the query site.
 * @param {{ filter?: (() => boolean | Promise<boolean>) | null }} prompt
 * @returns {Promise<boolean>}
 */
export async function isExtensionPromptEnabled(prompt) {
    return typeof prompt.filter !== 'function' || Boolean(await prompt.filter());
}

/**
 * Query and format matching extension prompts before expanding their macros.
 * @param {Record<string, ExtensionPrompt>} source
 * @param {{position?: number, depth?: number, role?: number, separator?: string, wrap?: boolean, substitute: (text: string) => string, excludeKeys?: ReadonlySet<string>}} options
 * @returns {Promise<string>}
 */
export async function getExtensionPromptText(source, {
    position = extension_prompt_types.IN_PROMPT, depth, role, separator = '\n', wrap = true, substitute, excludeKeys,
}) {
    const matching = Object.keys(source).filter(key => !excludeKeys?.has(key)).sort()
        .map(key => source[key])
        .filter(prompt => prompt.position == position && prompt.value)
        .filter(prompt => depth === undefined || prompt.depth === undefined || prompt.depth === depth)
        .filter(prompt => role === undefined || prompt.role === undefined || prompt.role === role);
    const prompts = await Promise.all(matching.map(async prompt =>
        await isExtensionPromptEnabled(prompt) ? prompt : null));

    let text = prompts.filter(Boolean).map(prompt => String(prompt.value).trim()).join(separator);
    if (wrap && text.length && !text.startsWith(separator)) text = separator + text;
    if (wrap && text.length && !text.endsWith(separator)) text += separator;
    return text.length ? substitute(text) : text;
}

/**
 * Visit only depths that can match a prompt. Read the source again after each
 * yield so awaited conditions can add or move later injections.
 * @param {Record<string, ExtensionPrompt>} source
 * @param {number} maxDepth Allowed upper bound.
 * @param {{additionalDepths?: number[], excludeKeys?: ReadonlySet<string>}} [options]
 * @returns {Generator<number>}
 */
export function* getExtensionPromptDepths(source, maxDepth, { additionalDepths = [], excludeKeys } = {}) {
    const roles = Object.values(extension_prompt_roles);
    let previous = -1;
    while (previous < maxDepth) {
        let next = Infinity;
        for (const key in source) {
            if (!Object.hasOwn(source, key) || excludeKeys?.has(key)) continue;
            const prompt = source[key];
            if (prompt.position != extension_prompt_types.IN_CHAT || !prompt.value) continue;
            if (prompt.role !== undefined && !roles.includes(prompt.role)) continue;
            const depth = prompt.depth === undefined ? previous + 1 : prompt.depth;
            if (Number.isInteger(depth) && depth > previous && depth <= maxDepth) next = Math.min(next, depth);
            // No integer candidate can precede this immediate next depth.
            if (next === previous + 1) break;
        }
        for (const depth of additionalDepths) {
            if (next === previous + 1) break;
            if (Number.isInteger(depth) && depth > previous && depth <= maxDepth) next = Math.min(next, depth);
        }
        if (next > maxDepth) return;
        previous = next;
        yield next;
    }
}
