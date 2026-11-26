/**
 * App shortcuts leave IME keystrokes to composition. Some WebKit versions
 * mark the final key as 229 after isComposing has become false.
 * jQuery wrappers retain the original native keyboard event.
 */
export function isComposingKeyboardEvent(event) {
    const keyboardEvent = event.originalEvent ?? event;
    return Boolean(keyboardEvent.isComposing || keyboardEvent.keyCode === 229);
}
