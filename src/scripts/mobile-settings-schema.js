/**
 * Telegram-style grouping of native settings panels. Each row names the native
 * control that owns the value; its kind follows the control (checkbox, select
 * or range) and rows whose control is absent are skipped. Rows reuse the native
 * translated label unless a shorter mobile label is specified. Desktop-only options (blur, shadows,
 * MovingUI, hover magnification) stay reachable through "All settings".
 */
export const userSettingsPage = {
    sections: [
        { title: 'Appearance', rows: [
            { id: 'themes', label: 'UI Theme' },
            { id: 'avatar_style', label: 'Avatars' },
            { id: 'chat_display', label: 'Chat Style' },
            { id: 'media_display', label: 'Media display' },
            { id: 'font_scale', label: 'Font Scale' },
            { id: 'chat_width_slider', label: 'Chat Width' },
            { id: 'reduced_motion' },
            { id: 'compact_input_area' },
            { id: 'hideChatAvatarsEnabled' },
        ] },
        { title: 'Message details', rows: [
            { id: 'messageTimestampsEnabled' },
            { id: 'messageTimerEnabled' },
            { id: 'messageModelIconEnabled' },
            { id: 'mesIDDisplayEnabled' },
            { id: 'messageTokensEnabled' },
            { id: 'messageFirstTokenEnabled' },
            { id: 'messageTokenRateEnabled' },
            { id: 'messageCacheEnabled' },
            { id: 'show_swipe_num_all_messages' },
            { id: 'expandMessageActions' },
        ] },
        { title: 'Sending and editing', rows: [
            { id: 'send_on_enter', label: 'Send on Enter' },
            { id: 'continue_on_send' },
            { id: 'quick_continue' },
            { id: 'quick_impersonate' },
            { id: 'enable_auto_select_input' },
            { id: 'restore_user_input' },
            { id: 'spellcheck_enabled' },
            { id: 'click_to_edit' },
            { id: 'auto_save_msg_edits' },
            { id: 'confirm_message_delete' },
        ] },
        { title: 'Streaming', rows: [
            { id: 'smooth_streaming' },
            { id: 'smooth_streaming_speed', label: 'Streaming speed' },
            { id: 'smooth_streaming_no_think' },
            { id: 'stream_fade_in' },
            { id: 'streaming_fps', label: 'Streaming FPS' },
        ], note: 'Smooth streaming changes how text appears, not how fast the service generates it. If scrolling stutters, disable smooth streaming or lower its frame rate.' },
        { title: 'Chat', rows: [
            { id: 'swipes-checkbox' },
            { id: 'gestures-checkbox' },
            { id: 'auto_scroll_chat_to_bottom' },
            { id: 'chat_truncation', label: 'Messages to load' },
            { id: 'example_messages_behavior', label: 'Example messages' },
            { id: 'image_overswipe', label: 'Image swipes' },
            { id: 'auto_fix_generated_markdown' },
            { id: 'forbid_external_media' },
            { id: 'allow_name2_display' },
            { id: 'allow_name1_display' },
            { id: 'encode_tags' },
            { id: 'pin_styles' },
        ] },
        { title: 'Group chats', rows: [
            { id: 'show_group_chat_queue' },
            { id: 'disable_group_trimming' },
        ] },
        { title: 'Character cards', rows: [
            { id: 'aux_field', label: 'Auxiliary field' },
            { id: 'tag_import_setting', label: 'Import card tags' },
            { id: 'fuzzy_search_checkbox' },
            { id: 'prefer_character_prompt' },
            { id: 'prefer_character_jailbreak' },
            { id: 'bogus_folders' },
            { id: 'spoiler_free_mode' },
            { id: 'never_resize_avatars' },
            { id: 'show_card_avatar_urls' },
        ] },
        { title: 'Notifications and sounds', rows: [
            { id: 'toastr_position', label: 'Notification position' },
            { id: 'play_message_sound' },
            { id: 'play_sound_unfocused' },
        ] },
        { title: 'Language', rows: [
            { id: 'ui_language_select', label: 'Interface language' },
        ] },
        { title: 'Advanced', rows: [
            { id: 'world_import_dialog' },
            { id: 'relaxed_api_urls' },
            { id: 'experimental_macro_engine' },
            { id: 'request_token_probabilities' },
            { id: 'console_log_prompts' },
        ] },
    ],
};

const CONNECTORS = { openai: 'openai_api', textgenerationwebui: 'textgenerationwebui_api', novel: 'novel_api', kobold: 'kobold_api' };
const CONNECT_BUTTONS = { openai: 'api_button_openai', textgenerationwebui: 'api_button_textgenerationwebui', novel: 'api_button_novel', kobold: 'api_button' };
const SOURCE_SELECTS = { openai: 'chat_completion_source', textgenerationwebui: 'textgen_type' };
const SKIPPED_TYPES = new Set(['hidden', 'file', 'button', 'submit', 'reset', 'radio', 'image']);
const CONNECTION_HELP = {
    chat_completion_source: 'Choose the protocol your service documents. Most OpenAI-compatible services use Custom (OpenAI-compatible), regardless of the model name.',
    custom_api_url_text: 'Enter the service Base URL, for example https://example.com/v1. Keep its version path. Do not append /chat/completions or /models.',
    custom_model_id: 'Use the exact model ID returned by your service, including any prefixes or Chinese text. The model name does not decide the API protocol. Connect to load models, or enter the ID manually.',
    model_custom_select: 'Connect to fetch the list, then choose a model. This fills the Model ID automatically. If the service does not provide a list, enter the ID manually.',
};

/** Native code toggles source-specific fields with inline display or classes. */
function shownWithin(element, root) {
    // Native icon toggles hide only the checkbox’s drawing. Their label remains
    // the visible control; source-hidden labels and sections still stay hidden.
    const visibleControl = element.type === 'checkbox' && element.style?.display === 'none'
        && !element.hidden && !element.classList.contains('displayNone')
        ? element.closest('label') || element : element;
    for (let node = visibleControl; node && node !== root; node = node.parentElement) {
        if (node.hidden || node.style?.display === 'none' || node.classList?.contains('displayNone')) return false;
    }
    return true;
}

/** Number fields mirroring a slider ("_counter" ids, data-for) are not separate settings. */
const isCounter = element => element.id.endsWith('_counter') || element.id.includes('_counter_') || element.hasAttribute('data-for');

/** Editable native controls the native panel currently shows inside `root`. */
function visibleControls(root, within, skip = new Set()) {
    if (!root || !shownWithin(root, within)) return [];
    return [...root.querySelectorAll('input, select, textarea')]
        .filter(element => element.id && !skip.has(element.id) && !isCounter(element)
            && !SKIPPED_TYPES.has(element.type) && shownWithin(element, within))
        .map(element => ({ element }));
}

/**
 * The connection page follows the native form: the selected API and source
 * decide which fields the native panel shows, and the page lists exactly those.
 */
export function connectionSections(document) {
    const api = document.getElementById('main_api')?.value || '';
    const root = document.getElementById(CONNECTORS[api]);
    const source = SOURCE_SELECTS[api];
    const preview = api === 'openai' && document.getElementById('custom_endpoint_preview');
    const details = visibleControls(root, root, new Set([source]))
        .map(row => ({ ...row, help: CONNECTION_HELP[row.element.id] }));
    const advanced = row => row.element.type === 'checkbox' || row.element.tagName === 'TEXTAREA' || row.element.id === 'custom_prompt_post_processing'
        || Boolean(row.element.closest('.inline-drawer'));
    return [
        { title: 'Connection', rows: [
            { id: 'main_api', label: 'API' },
            source && { id: source, label: 'API source', help: CONNECTION_HELP[source] },
        ].filter(Boolean), note: CONNECTION_HELP.chat_completion_source },
        { title: 'Connection details', rows: [
            ...details.filter(row => !advanced(row)),
            preview && root && shownWithin(preview, root) && { status: preview, label: 'Request endpoint' },
        ].filter(Boolean),
            note: 'Save the address, API key and model first, then Connect. Saved keys stay hidden after restarting; Saved means the key is stored on this device.' },
        { title: 'Advanced connection options', rows: details.filter(advanced), collapsed: true,
            note: 'Keep these defaults unless your service specifically requires a change.' },
        { title: 'Connect and test', rows: [
            root?.querySelector('.online_status_text') && { status: root.querySelector('.online_status_text'), label: 'Status' },
            CONNECT_BUTTONS[api] && { action: CONNECT_BUTTONS[api], label: 'Connect' },
            api === 'openai' && { action: 'test_api_button', label: 'Test Message' },
        ].filter(Boolean), note: 'Connect checks the connection and loads models. Test Message sends a short request and may use API credit. A server error does not erase your saved configuration.' },
    ];
}

export const connectionPage = {
    intro: 'Choose an API type and source, enter your service details, then connect. The protocol comes from your API service, not from the character card.',
    sections: connectionSections,
    footer: 'HTTP 404: check the service address and protocol. HTTP 503: the service is temporarily unavailable, such as during maintenance or heavy load. Check its announcements and retry later. Saved connection settings remain on this device.',
};

const LENGTH_CONTROL = /context|max_tokens|amount_gen/i;
const GENERATION_BEHAVIOR_CONTROL = /^n_|_n$|stream|function_call|recurs/i;

const GENERATION_BLOCKS = {
    openai: { ranges: 'range_block_openai', settings: 'openai_settings' },
    textgenerationwebui: { ranges: 'range_block_textgenerationwebui', settings: 'textgenerationwebui_api-settings' },
    novel: { ranges: 'range_block_novel', settings: 'novel_api-settings' },
    kobold: { ranges: 'range_block', settings: 'kobold_api-settings' },
    koboldhorde: { ranges: 'range_block', settings: 'kobold_api-settings' },
};

/**
 * Generation settings follow the selected API exactly as the native panel
 * does: changeMainAPI() and the per-source toggles decide which blocks and
 * samplers are shown, and the page lists the shown controls in that order.
 */
export function generationSections(document) {
    const panel = document.getElementById('left-nav-panel');
    const api = document.getElementById('main_api')?.value || '';
    const manager = api === 'koboldhorde' ? 'kobold' : api;
    const blocks = GENERATION_BLOCKS[api] || {};
    const preset = document.querySelector(`select[data-preset-manager-for="${manager}"]`);
    const update = api === 'openai' ? document.getElementById('update_oai_preset')
        : document.querySelector(`[data-preset-manager-update="${manager}"]`);
    const saveAs = api === 'openai' ? document.getElementById('new_oai_preset')
        : document.querySelector(`[data-preset-manager-new="${manager}"]`);
    const binding = api === 'openai' ? document.getElementById('bind_preset_to_connection') : null;
    const seen = new Set([preset?.id, binding?.id].filter(Boolean));
    const take = id => visibleControls(document.getElementById(id), panel, seen)
        .filter(({ element }) => !seen.has(element.id) && seen.add(element.id));
    // Native blocks mix length, sampling and prompt fields per API; regroup
    // them by what they control, keeping the native order inside each group.
    const controls = [...take('common-gen-settings-block'), ...take(blocks.ranges), ...take(blocks.settings)];
    const isLength = ({ element }) => LENGTH_CONTROL.test(element.id);
    const isPrompt = ({ element }) => element.tagName === 'TEXTAREA';
    const isSampling = row => !isLength(row) && !GENERATION_BEHAVIOR_CONTROL.test(row.element.id)
        && row.element.type === 'range';
    return [
        { title: 'Presets', rows: [
            preset && { element: preset, label: 'Preset' },
            binding && { element: binding, label: 'Restore API connection with preset' },
            update && { element: update, action: true, label: 'Update current preset' },
            saveAs && { element: saveAs, action: true, label: 'Save preset as' },
        ].filter(Boolean), note: binding
            ? 'When enabled, switching presets restores the API source, URL and model. Turn this off to keep your current connection. API keys are saved separately.'
            : undefined },
        { title: 'Context and length', rows: controls.filter(isLength),
            note: 'Context includes your history, prompts and reserved reply space. Set it above the maximum response length and follow your service’s limits. Higher reply limits allow more text and thinking, which may take longer.' },
        { title: 'Sampling', rows: controls.filter(isSampling),
            note: 'Tap a number to enter an exact value, or drag its slider. Start with the model or preset defaults; you do not need to adjust every sampler.' },
        { title: 'More options', rows: controls.filter(row => !isLength(row) && !isPrompt(row) && !isSampling(row)), collapsed: true,
            note: 'Streaming shows the reply as it arrives. Multiple replies and tool-call recursion may make extra API requests. Change these only when you need them.' },
        { title: 'Utility prompts', rows: controls.filter(isPrompt), collapsed: true,
            note: 'These are reusable prompt templates. Keep their macros, such as {{char}} and {{user}}, and only replace them when your character card or preset gives instructions.' },
    ];
}

export const generationPage = {
    intro: 'These settings control the current chat. Saving an edit keeps it on this device; Update current preset also writes the values into the selected preset. Tap a slider’s number for precise input.',
    sections: generationSections,
    footer: 'The original panel, with preset import and export.',
};

/** Row for a native preset button, which has no id of its own. */
const presetButton = (document, kind, manager, label) => {
    const element = document.querySelector(`[data-preset-manager-${kind}="${manager}"]`);
    return element && { element, action: true, label };
};

/** Drop rows the native panel currently hides (per-API blocks, disabled templates). */
function shownRows(document, rows, panelId = 'AdvancedFormatting') {
    const panel = document.getElementById(panelId);
    return rows.filter(Boolean).filter(row => {
        const element = row.element || row.pick || (typeof row.status === 'object' ? row.status : null)
            || document.getElementById(typeof row.action === 'string' ? row.action : row.id);
        return element && (element.type === 'file' || shownWithin(element, panel));
    });
}

/**
 * Advanced formatting mirrors the native drawer's own sections. Long text
 * fields open an editor; template selects keep their native save buttons.
 */
export function formattingSections(document) {
    const rows = list => shownRows(document, list);
    return [
        { title: 'Context Template', rows: rows([
            { id: 'context_presets', label: 'Template' },
            presetButton(document, 'update', 'context', 'Update current template'),
            presetButton(document, 'new', 'context', 'Save template as'),
            { id: 'context_derived', label: 'Choose context template from model metadata' },
            { id: 'context_story_string', label: 'Story String' },
            { id: 'context_story_string_position', label: 'Position' },
            { id: 'context_story_string_depth', label: 'Depth' },
            { id: 'context_story_string_role', label: 'Role' },
            { id: 'context_example_separator', label: 'Example Separator' },
            { id: 'context_chat_start', label: 'Chat Start' },
        ]), note: 'A context template arranges character information and chat prompts. Choose a preset first. Keep template expressions such as {{description}} unless the preset author tells you to change them.' },
        { title: 'Context Formatting', collapsed: true, rows: rows([
            { id: 'always-force-name2-checkbox' },
            { id: 'single_line' },
            { id: 'collapse-newlines-checkbox' },
            { id: 'trim_spaces' },
            { id: 'trim_sentences_checkbox' },
            { id: 'context_use_stop_strings' },
            { id: 'context_names_as_stop_strings' },
        ]) },
        { title: 'Instruct Template', rows: rows([
            { id: 'instruct_enabled' },
            { id: 'instruct_presets', label: 'Template' },
            presetButton(document, 'update', 'instruct', 'Update current template'),
            presetButton(document, 'new', 'instruct', 'Save template as'),
            { id: 'instruct_derived', label: 'Choose instruct template from model metadata' },
            { id: 'instruct_bind_to_context', label: 'Match context template to instruct template' },
            { id: 'instruct_activation_regex', label: 'Activation Regex' },
            { id: 'instruct_wrap' },
            { id: 'instruct_macro' },
            { id: 'instruct_sequences_as_stop_strings' },
            { id: 'instruct_skip_examples' },
            { id: 'instruct_names_behavior', label: 'Include Names' },
        ]), note: 'An instruct template defines how user and assistant turns are formatted. Follow your model’s template instructions; these fields are not connection credentials.' },
        { title: 'Instruct Sequences', collapsed: true, rows: rows([
            { id: 'instruct_story_string_prefix', label: 'Story String Prefix' },
            { id: 'instruct_story_string_suffix', label: 'Story String Suffix' },
            { id: 'instruct_input_sequence', label: 'User Message Prefix' },
            { id: 'instruct_input_suffix', label: 'User Message Suffix' },
            { id: 'instruct_output_sequence', label: 'Assistant Message Prefix' },
            { id: 'instruct_output_suffix', label: 'Assistant Message Suffix' },
            { id: 'instruct_system_sequence', label: 'System Message Prefix' },
            { id: 'instruct_system_suffix', label: 'System Message Suffix' },
            { id: 'instruct_system_same_as_user' },
            { id: 'instruct_first_output_sequence', label: 'First Assistant Prefix' },
            { id: 'instruct_last_output_sequence', label: 'Last Assistant Prefix' },
            { id: 'instruct_first_input_sequence', label: 'First User Prefix' },
            { id: 'instruct_last_input_sequence', label: 'Last User Prefix' },
            { id: 'instruct_last_system_sequence', label: 'System Instruction Prefix' },
            { id: 'instruct_stop_sequence', label: 'Stop Sequence' },
            { id: 'instruct_user_alignment_message', label: 'User Filler Message' },
        ]), note: 'Prefixes and suffixes are literal template text. Spaces and newlines matter. A preview such as "\\n\\n" means two real newlines; the editor keeps the original characters.' },
        { title: 'System Prompt', rows: rows([
            { id: 'sysprompt_enabled' },
            { id: 'sysprompt_select', label: 'Prompt' },
            presetButton(document, 'update', 'sysprompt', 'Update current prompt'),
            presetButton(document, 'new', 'sysprompt', 'Save prompt as'),
            { id: 'sysprompt_content', label: 'Prompt Content' },
            { id: 'sysprompt_post_history', label: 'Post-History Instructions' },
        ]) },
        { title: 'Reasoning', collapsed: true, rows: rows([
            { id: 'reasoning_auto_parse' },
            { id: 'reasoning_auto_expand' },
            { id: 'reasoning_show_hidden' },
            { id: 'reasoning_add_to_prompts' },
            { id: 'reasoning_max_additions', label: 'Max Additions' },
            { id: 'reasoning_select', label: 'Reasoning Formatting' },
            presetButton(document, 'update', 'reasoning', 'Update current template'),
            presetButton(document, 'new', 'reasoning', 'Save template as'),
            { id: 'reasoning_prefix', label: 'Prefix' },
            { id: 'reasoning_suffix', label: 'Suffix' },
            { id: 'reasoning_separator', label: 'Separator' },
        ]) },
        { title: 'Stopping strings and tokenizer', collapsed: true, rows: rows([
            { id: 'custom_stopping_strings', label: 'Custom Stopping Strings' },
            { id: 'custom_stopping_strings_macro' },
            { id: 'tokenizer', label: 'Tokenizer' },
            { id: 'token_padding', label: 'Token Padding' },
        ]) },
        { title: 'Miscellaneous', collapsed: true, rows: rows([
            { id: 'bind_model_templates' },
            { id: 'start_reply_with', label: 'Start Reply With' },
            { id: 'chat-show-reply-prefix-checkbox' },
            { id: 'markdown_escape_strings', label: 'Non-markdown strings' },
        ]) },
    ];
}

export const formattingPage = {
    intro: 'These are advanced prompt templates, not API credentials. Start with the defaults; only change them when your model or character card provides specific instructions. You do not need to fill every field.',
    sections: formattingSections,
    footer: 'The original panel, with template import and export.',
};

const text = (element, selector) => element.querySelector(selector)?.textContent || '';

/**
 * Personas: the native list (current page) as chat-like rows, then the
 * selected persona's own settings. Selecting clicks the native card.
 */
export function personaSections(document) {
    const rows = list => shownRows(document, list, 'PersonaManagement');
    const cards = [...document.querySelectorAll('#user_avatar_block .avatar-container')].map(card => ({
        pick: card,
        title: element => text(element, '.ch_name'),
        subtitle: element => text(element, '.ch_additional_info') || text(element, '.ch_description'),
        image: element => element.querySelector('img')?.getAttribute('src'),
        selected: element => element.classList.contains('selected'),
    }));
    return [
        { title: 'Personas', rows: [
            ...cards,
            ...rows([{ action: 'create_dummy_persona', label: 'Create a dummy persona' }]),
        ] },
        { title: 'Current Persona', rows: rows([
            { status: document.getElementById('your_name'), label: 'Name', key: 'your_name' },
            { action: 'persona_rename_button', label: 'Rename Persona' },
            { action: 'persona_set_image_button', label: 'Change Persona Image' },
            { action: 'sync_name_button', label: 'Use this name for all messages' },
            { action: 'persona_lore_button', label: 'Persona Lore' },
            { action: 'persona_duplicate_button', label: 'Duplicate Persona' },
            { action: 'persona_delete_button', label: 'Delete Persona' },
        ]) },
        { title: 'Persona Description', rows: rows([
            { id: 'persona_description', label: 'Description' },
            { id: 'persona_description_position', label: 'Position' },
            { id: 'persona_depth_value', label: 'Depth' },
            { id: 'persona_depth_role', label: 'Role' },
        ]) },
        { title: 'Connections', rows: rows([
            { action: 'lock_persona_default', label: 'Default persona for new chats' },
            { action: 'lock_persona_to_char', label: 'Lock to this character' },
            { action: 'lock_user_name', label: 'Lock to this chat' },
        ]) },
        { title: 'Global Settings', rows: rows([
            { id: 'persona_show_notifications' },
            { id: 'persona_allow_multi_connections' },
            { id: 'persona_auto_lock' },
        ]) },
    ];
}

export const personaPage = {
    sections: personaSections,
    footer: 'The original panel, with search, backup and restore.',
};

/**
 * World info: which lorebooks are active and how they activate, then the
 * lorebook being edited. Entries stay in the native editor, which already
 * pages and edits them; this page links to it.
 */
export function worldInfoSections(document) {
    const rows = list => shownRows(document, list, 'WorldInfo');
    return [
        { title: 'Active World Info', rows: rows([{ id: 'world_info', label: 'Active lorebooks' }]),
            note: 'Active lorebooks apply to every chat.' },
        { title: 'Activation Settings', rows: rows([
            { id: 'world_info_depth', label: 'Scan Depth' },
            { id: 'world_info_budget', label: 'Context %' },
            { id: 'world_info_budget_cap', label: 'Budget Cap' },
            { id: 'world_info_min_activations', label: 'Min Activations' },
            { id: 'world_info_min_activations_depth_max', label: 'Max Depth' },
            { id: 'world_info_max_recursion_steps', label: 'Max Recursion Steps' },
            { id: 'world_info_character_strategy', label: 'Insertion Strategy' },
            { id: 'world_info_include_names' },
            { id: 'world_info_recursive' },
            { id: 'world_info_case_sensitive' },
            { id: 'world_info_match_whole_words' },
            { id: 'world_info_use_group_scoring' },
            { id: 'world_info_overflow_alert' },
        ]) },
        { title: 'Edit Lorebook', rows: rows([
            { id: 'world_editor_select', label: 'Lorebook' },
            { action: 'world_popup_new', label: 'New Entry' },
            { action: 'world_create_button', label: 'Create New World Info' },
            { action: 'world_import_button', label: 'Import World Info' },
            { action: 'world_popup_export', label: 'Export World Info' },
            { action: 'world_popup_name_button', label: 'Rename World Info' },
            { action: 'world_duplicate', label: 'Duplicate World Info' },
            { action: 'world_popup_delete', label: 'Delete World Info' },
        ]) },
    ];
}

export const worldInfoPage = {
    sections: worldInfoSections,
    footer: 'Open the original editor to edit entries.',
    linkLabel: 'Edit entries',
};

/**
 * Backgrounds: Telegram puts wallpaper options above the gallery. The image
 * gallery itself (folders, lazy thumbnails, per-image menus) stays native.
 */
export function backgroundSections(document) {
    const rows = list => shownRows(document, list, 'Backgrounds');
    return [
        { title: 'Chat background', rows: rows([
            { id: 'background_fitting', label: 'Background Fitting' },
            { action: 'auto_background', label: 'Auto-select background' },
            { action: 'add_bg_button', label: 'Upload a background' },
        ]) },
    ];
}

export const backgroundPage = {
    sections: backgroundSections,
    footer: 'Pick, rename, lock and organize backgrounds in the gallery.',
    linkLabel: 'Choose a background',
};

/**
 * Extensions: install and manage here; each extension's own settings are
 * rendered by that extension into the native panel, so they stay there.
 */
export function extensionSections(document) {
    const rows = list => shownRows(document, list, 'rm_extensions_block');
    const installed = document.querySelectorAll('#extensions_settings > .extension_container, #extensions_settings2 > .extension_container').length;
    return [
        { title: 'Extensions', rows: rows([
            { action: 'extensions_details', label: 'Manage extensions' },
            { action: 'third_party_extension_button', label: 'Install extension' },
            { id: 'extensions_notify_updates' },
        ]), note: installed ? '' : 'Extension settings appear in the full panel once installed.' },
    ];
}

export const extensionPage = {
    sections: extensionSections,
    footer: 'Each extension keeps its own settings in the full panel.',
    linkLabel: 'Extension settings',
};

/** Native panels that have a Telegram-style page on phones. */
export const mobileSettingsPages = {
    rm_extensions_block: extensionPage,
    Backgrounds: backgroundPage,
    WorldInfo: worldInfoPage,
    PersonaManagement: personaPage,
    AdvancedFormatting: formattingPage,
    'user-settings-block': userSettingsPage,
    rm_api_block: connectionPage,
    'left-nav-panel': generationPage,
};
