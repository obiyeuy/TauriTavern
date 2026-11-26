import { eventSource, event_types } from '/scripts/events.js';

// Card renderers such as JSR initialize through jQuery ready after evaluation.
jQuery(() => {
    // The gallery's durable source remains the saved chat message.
    eventSource.on(event_types.CHAT_CHANGED, () => {
        for (const code of document.querySelectorAll('#chat .mes_text pre code')) {
            if (!code.textContent.includes('data-chat-media-fixture')) continue;
            const source = code.parentElement;
            if (source.closest('.TH-render')) continue;
            const wrapper = document.createElement('div');
            wrapper.className = 'TH-render';
            const iframe = document.createElement('iframe');
            iframe.srcdoc = code.textContent;
            source.before(wrapper);
            wrapper.append(source, iframe);
            source.hidden = true;
        }
    });
    // Test-owned evidence that deferred renderer initialization actually ran.
    globalThis.webHostFixtureActivated = true;
});
