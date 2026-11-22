// One outline icon family for the mobile shell. Native controls retain their
// existing markup and accessible names.
const paths = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    back: '<path d="m12 5-7 7 7 7M5 12h14"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
    history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-4v5l3 2"/>',
    settings: '<path d="m9.2 4 .7-2h4.2l.7 2 2 .9 2.1-.4 2.1 3.6-1.4 1.6.2 2.3 1.4 1.6-2.1 3.6-2.1-.4-2 .9-.7 2H10l-.7-2-2-.9-2.1.4-2.1-3.6L4.5 12l-.2-2.3-1.4-1.6L5 4.5l2.1.4Z"/><circle cx="12" cy="11" r="3"/>',
    search: '<circle cx="10.8" cy="10.8" r="7.3"/><path d="m16 16 5 5"/>',
    connection: '<path d="M8 12a4 4 0 0 1 4-4h3m-4 8H8a4 4 0 0 1 0-8m5-4h3a4 4 0 0 1 0 8h-3m-5 0h8"/>',
    sliders: '<path d="M4 6h4m4 0h8M4 12h8m4 0h4M4 18h2m4 0h10"/><circle cx="10" cy="6" r="2"/><circle cx="14" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Zm2 5H16m-7.5 4H14"/>',
    puzzle: '<path d="M8 3v3a3 3 0 1 0 6 0V3h6v6h-3a3 3 0 1 0 0 6h3v6h-6v-3a3 3 0 1 0-6 0v3H2v-6h3a3 3 0 1 0 0-6H2V3h6Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L6 21"/>',
    format: '<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
    moon: '<path d="M20.9 13.1A9 9 0 0 1 10.9 3.1a9 9 0 1 0 10 10Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
};

export function mobileChatIcon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
