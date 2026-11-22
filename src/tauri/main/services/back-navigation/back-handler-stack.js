// @ts-check

/** @type {Array<{ handler: () => boolean; layer: 'overlay' | 'navigation' }>} */
const backHandlers = [];

/**
 * Registers a temporary back-navigation handler.
 *
 * Handlers are evaluated in LIFO order and must be synchronous because the
 * native Android back bridge expects an immediate boolean result.
 *
 * @param {() => boolean} handler
 * @param {{ layer?: 'overlay' | 'navigation' }} [options]
 * @returns {() => void}
 */
export function pushBackNavigationHandler(handler, { layer = 'overlay' } = {}) {
    if (typeof handler !== 'function') {
        throw new Error('Back navigation handler must be a function');
    }

    const entry = { handler, layer };
    backHandlers.push(entry);

    let active = true;
    return () => {
        if (!active) {
            return;
        }
        active = false;

        const index = backHandlers.lastIndexOf(entry);
        if (index >= 0) {
            backHandlers.splice(index, 1);
        }
    };
}

/** @param {'overlay' | 'navigation'} [layer] */
export function consumeBackNavigationHandlers(layer = 'overlay') {
    for (let index = backHandlers.length - 1; index >= 0; index -= 1) {
        const entry = backHandlers[index];
        if (entry?.layer === layer && entry.handler()) {
            return true;
        }
    }

    return false;
}
