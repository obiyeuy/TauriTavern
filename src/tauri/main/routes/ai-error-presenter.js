import { stripCommandErrorPrefixes } from '../../../scripts/util/command-error-utils.js';
import { translateSillyTavern } from '../adapters/st/sillytavern-i18n.js';
import {
    asUpstreamFailureDetails,
    findUpstreamFailureDetails,
    UPSTREAM_FAILURE_FALLBACKS,
} from '../kernel/upstream-failure.js';

export { asUpstreamFailureDetails };

export function getErrorMessage(error) {
    if (!error) {
        return 'Unknown error';
    }

    if (typeof error === 'string') {
        return error;
    }

    return error.message || error.toString?.() || 'Unknown error';
}

export function getUpstreamFailureDetails(error) {
    return findUpstreamFailureDetails(error);
}

export function translateApiErrorLabel() {
    return `[${translateSillyTavern('API Error', 'API Error')}]`;
}

export function getUserFacingErrorMessage(error, fallbackMessage = 'Chat completion request failed') {
    const details = getUpstreamFailureDetails(error);
    if (!details) {
        return stripCommandErrorPrefixes(getErrorMessage(error)) || fallbackMessage;
    }

    const fallback = UPSTREAM_FAILURE_FALLBACKS[details.code] || 'Upstream request failed.';
    const message = translateSillyTavern(details.messageKey, fallback);
    const lines = [message];

    if (details.category === 'network') {
        lines.push(
            '',
            translateSillyTavern(
                'tauritavern.error.network.action',
                'Check your network, VPN, proxy, or custom endpoint address, then try again.',
            ),
        );
    }
    if (details.code === 'http.not_found') {
        lines.push(
            '',
            translateSillyTavern(
                'tauritavern.error.http.not_found_action',
                'Check the service Base URL, API protocol and model ID. A working model list does not confirm the generation protocol. OpenAI-compatible services usually use /chat/completions; /responses requires explicit service support.',
            ),
        );
    }

    if (details.providerMessage) {
        lines.push('', details.providerMessage);
    }

    if (details.endpoint) {
        lines.push(
            '',
            `${translateSillyTavern('tauritavern.error.network.endpoint_label', 'Endpoint')}: ${details.endpoint}`,
        );
    }

    return lines.join('\n');
}

export function buildLegacyErrorPayload(error) {
    const details = getUpstreamFailureDetails(error);
    const payload = {
        message: getUserFacingErrorMessage(error),
    };

    if (details) {
        payload.code = details.code;
        payload.category = details.category;
        payload.message_key = details.messageKey;
        if (details.endpoint) {
            payload.endpoint = details.endpoint;
        }
        if (details.providerMessage) {
            payload.provider_message = details.providerMessage;
        }
    }

    return { error: payload };
}
