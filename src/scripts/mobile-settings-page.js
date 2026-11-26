import { mobileChatIcon as icon } from './mobile-chat-icons.js';
import { syncAttribute, syncBooleanProperty, syncText } from './mobile-chat-dom.js';
import { isComposingKeyboardEvent } from './util/keyboard-event.js';
import { isControlDisabled } from './legacy-controls.js';

const TEXT_TYPES = new Set(['', 'text', 'number', 'password', 'url', 'search', 'email', 'tel']);
const SEARCHABLE_OPTIONS = 10;
/** Credential fields are never echoed back into the page. */
const isSensitive = element => element.type === 'password' || element.hasAttribute('data-tt-sensitive')
    || element.classList.contains('masked-secret') || /api_key|secret|password/i.test(element.id);

/**
 * Telegram-style settings page bound to native controls. The native inputs
 * keep owning every value and its side effects (saving, presets, connections,
 * extension notifications): rows only read their state and write it back with
 * the same events a user edit would fire, or click the native button.
 *
 * `schema.sections` is a list, or a function of the document for pages whose
 * rows depend on native state (the API page follows the selected source).
 */
export function renderSettingsPage({ document, schema, translate: t = text => text, openNative, save }) {
    const win = document.defaultView;
    const page = document.createElement('div');
    page.className = 'tt-sp';
    if (schema.intro) {
        const intro = document.createElement('p');
        intro.className = 'tt-sp-intro';
        intro.textContent = t(schema.intro);
        page.append(intro);
    }
    const groups = document.createElement('div');
    page.append(groups);
    let rows = [];
    let signature = '';
    let timers = [];
    let saving = false;
    let disposed = false;

    const fire = (element, events) => {
        for (const type of events) element.dispatchEvent(new win.Event(type, { bubbles: true }));
    };
    const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
    function nativeLabel(element) {
        const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/)
            .map(id => id && document.getElementById(id)?.textContent).filter(Boolean).join(' ');
        const label = element.closest('label') || (element.id && document.querySelector(`label[for="${element.id}"]`));
        return [labelled, label?.textContent, element.getAttribute('aria-label'), label?.getAttribute('title'),
            element.getAttribute('title'), element.getAttribute('placeholder'), element.id]
            .map(clean).find(Boolean) || '';
    }
    const labelOf = (row, element) => row.label ? t(row.label) : nativeLabel(element);
    const helpOf = (row, element) => row.help ? t(row.help) : clean((element.getAttribute('aria-describedby') || '')
        .split(/\s+/).map(id => id && document.getElementById(id)?.textContent).filter(Boolean).join(' '));

    // Native code often reacts asynchronously (themes, presets, connecting).
    function settle(delays = [400]) {
        refresh();
        for (const timer of timers) win.clearTimeout(timer);
        timers = delays.map(delay => win.setTimeout(() => { refresh(); rebuildIfChanged(); }, delay));
    }

    const sheet = document.createElement('div');
    sheet.className = 'tt-sp-sheet';
    sheet.hidden = true;
    sheet.innerHTML = '<button type="button" class="tt-sp-sheet-scrim" tabindex="-1"></button><div class="tt-sp-dialog" role="dialog" aria-modal="true" aria-labelledby="tt-sp-edit-title" tabindex="-1"><h3 id="tt-sp-edit-title"></h3><div class="tt-sp-sheet-body"></div><div class="tt-sp-actions" hidden></div></div>';
    const dialog = sheet.querySelector('.tt-sp-dialog');
    const sheetTitle = sheet.querySelector('h3');
    const sheetBody = sheet.querySelector('.tt-sp-sheet-body');
    const sheetActions = sheet.querySelector('.tt-sp-actions');
    const sheetError = document.createElement('p');
    sheetError.className = 'tt-sp-edit-error';
    sheetError.setAttribute('role', 'alert');
    sheetError.tabIndex = -1;
    sheetError.hidden = true;
    sheetActions.before(sheetError);
    sheet.querySelector('.tt-sp-sheet-scrim').setAttribute('aria-label', t('Close'));
    sheet.querySelector('.tt-sp-sheet-scrim').addEventListener('click', () => closeSheet());
    let sheetOrigin;

    function closeSheet() {
        if (sheet.hidden) return false;
        if (saving) return true;
        sheet.hidden = true;
        sheetOrigin?.focus({ preventScroll: true });
        return true;
    }

    function onSheetKeyDown(event) {
        if (sheet.hidden || disposed || isComposingKeyboardEvent(event)) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeSheet();
            return;
        }
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button, input, textarea, select, a[href]')]
            .filter(control => !control.disabled && !control.closest('[hidden]') && control.tabIndex >= 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) {
            event.preventDefault();
            dialog.focus({ preventScroll: true });
        } else if (!controls.includes(document.activeElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus({ preventScroll: true });
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
        event.stopImmediatePropagation();
    }
    document.addEventListener('keydown', onSheetKeyDown, true);

    function presentSheet(title, origin, actions = []) {
        sheetTitle.textContent = title;
        sheetError.hidden = true;
        sheetError.textContent = '';
        sheetActions.replaceChildren();
        for (const [label, action] of actions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = t(label);
            button.addEventListener('click', action);
            sheetActions.append(button);
        }
        sheetActions.hidden = !actions.length;
        sheetOrigin = origin;
        sheet.hidden = false;
    }

    function addHelp(help) {
        if (!help) return;
        const description = document.createElement('p');
        description.id = 'tt-sp-edit-help';
        description.className = 'tt-sp-edit-help';
        description.textContent = help;
        sheetBody.append(description);
        return description.id;
    }

    /** Every editor confirms persistence through the native settings owner. */
    async function saveEditing(element) {
        saving = true;
        sheetActions.setAttribute('aria-busy', 'true');
        const submit = sheetActions.lastElementChild;
        const label = submit?.textContent;
        if (submit) submit.textContent = t('Saving…');
        const controls = [...sheet.querySelectorAll('button, input, textarea')].map(control => ({
            control, disabled: control.disabled,
        }));
        for (const { control } of controls) control.disabled = true;
        sheetError.hidden = true;
        try {
            await save(element);
            return true;
        } catch (failure) {
            const message = t('Settings could not be saved.');
            const detail = failure instanceof Error ? failure.message : String(failure);
            sheetError.textContent = detail === message ? message : `${message} ${detail}`;
            sheetError.hidden = false;
            return false;
        } finally {
            saving = false;
            sheetActions.removeAttribute('aria-busy');
            if (submit) submit.textContent = label;
            for (const { control, disabled } of controls) control.disabled = disabled;
            if (!sheetError.hidden && !disposed) sheetError.focus({ preventScroll: true });
        }
    }

    function openChoice(title, select, origin, row) {
        sheetBody.replaceChildren();
        addHelp(helpOf(row, select));
        const list = document.createElement('div');
        list.className = 'tt-sp-options';
        list.setAttribute('role', 'radiogroup');
        list.setAttribute('aria-labelledby', sheetTitle.id);
        const options = [...select.options].filter(option => !option.disabled && !option.hidden
            && (!select.multiple || option.value !== '') && clean(option.textContent));
        // Multiple selects (active lorebooks) toggle options and stay open.
        const multiple = select.multiple;
        if (multiple) list.setAttribute('role', 'group');
        const syncChoices = () => {
            for (const [index, option] of options.entries()) {
                list.children[index].setAttribute('aria-checked', String(option.selected));
            }
        };
        const submit = async () => {
            if (saving) return;
            if (save) sheetActions.lastElementChild.hidden = false;
            if (save && !await saveEditing(select)) {
                syncChoices();
                return;
            }
            if (disposed) return;
            closeSheet();
            settle([400, 1500]);
        };
        for (const option of options) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tt-sp-option';
            button.setAttribute('role', multiple ? 'checkbox' : 'radio');
            button.setAttribute('aria-checked', String(multiple ? option.selected : option.value === select.value));
            button.innerHTML = `<span class="${multiple ? 'tt-sp-box' : 'tt-sp-radio'}" aria-hidden="true"></span><span></span>`;
            button.lastElementChild.textContent = clean(option.textContent);
            if (option.title) {
                const help = document.createElement('small');
                help.className = 'tt-sp-option-help';
                help.textContent = t(option.title);
                button.lastElementChild.append(help);
            }
            button.addEventListener('click', () => {
                if (saving) return;
                if (multiple) {
                    option.selected = !option.selected;
                    button.setAttribute('aria-checked', String(option.selected));
                    fire(select, ['input', 'change']);
                    settle([400, 1500]);
                    return;
                }
                if (select.value !== option.value) {
                    select.value = option.value;
                    fire(select, ['input', 'change']);
                }
                syncChoices();
                void submit();
            });
            list.append(button);
        }
        // Long lists (models, providers) get a filter like Telegram's pickers.
        if (options.length > SEARCHABLE_OPTIONS) {
            const filter = document.createElement('input');
            filter.type = 'search';
            filter.className = 'tt-sp-filter';
            filter.placeholder = t('Search');
            filter.setAttribute('aria-label', t('Search'));
            const empty = document.createElement('p');
            empty.className = 'tt-sp-options-empty';
            empty.setAttribute('role', 'status');
            empty.textContent = t('No matching options. Try another search.');
            empty.hidden = true;
            filter.addEventListener('input', () => {
                const query = filter.value.trim().toLocaleLowerCase();
                for (const item of list.children) item.hidden = !item.textContent.toLocaleLowerCase().includes(query);
                empty.hidden = [...list.children].some(item => !item.hidden);
            });
            sheetBody.append(filter);
            sheetBody.append(list, empty);
        } else {
            sheetBody.append(list);
        }
        presentSheet(title, origin, [['Close', () => closeSheet()], [multiple ? 'Done' : 'Retry', () => void submit()]]);
        sheetActions.lastElementChild.hidden = !multiple;
        const current = list.querySelector('[aria-checked="true"]');
        current?.scrollIntoView?.({ block: 'center' });
        (current || list.firstElementChild)?.focus({ preventScroll: true });
    }

    function openEdit(title, element, origin, row) {
        sheetBody.replaceChildren();
        const address = element.type === 'url';
        const numericRange = element.type === 'range';
        const field = document.createElement(element.tagName === 'TEXTAREA' || address ? 'textarea' : 'input');
        field.className = 'tt-sp-field';
        if (address) {
            field.classList.add('tt-sp-address');
            field.rows = 3;
        }
        if (field.tagName === 'INPUT') field.type = row.sensitive || isSensitive(element) ? 'password'
            : numericRange ? 'number' : element.type;
        for (const attribute of ['min', 'max', 'step', 'required', 'pattern', 'minlength', 'maxlength', 'placeholder', 'inputmode', 'list']) {
            if (element.hasAttribute(attribute)) field.setAttribute(attribute, element.getAttribute(attribute));
        }
        field.autocomplete = 'off';
        field.setAttribute('autocapitalize', 'none');
        field.spellcheck = false;
        if (numericRange) field.required = true;
        if (field.type === 'number' && !field.hasAttribute('inputmode')
            && element.hasAttribute('min') && Number(element.min) >= 0) {
            field.inputMode = !element.step || Number.isInteger(Number(element.step)) ? 'numeric' : 'decimal';
        }
        field.value = element.value;
        field.setAttribute('aria-label', title);
        sheetBody.append(field);
        const descriptionId = addHelp(helpOf(row, element));
        if (descriptionId) field.setAttribute('aria-describedby', descriptionId);
        const submit = async () => {
            if (saving) return;
            if (numericRange) {
                // Model discovery can change limits while this editor is open.
                // Validate the draft against the owner’s latest bounds before
                // assigning it, since a range silently clamps invalid values.
                for (const attribute of ['min', 'max', 'step']) {
                    if (element.hasAttribute(attribute)) field.setAttribute(attribute, element.getAttribute(attribute));
                    else field.removeAttribute(attribute);
                }
            }
            if (address) {
                // A wrapping editor still uses the native URL input's rules.
                const validator = element.cloneNode(false);
                validator.value = field.value;
                field.setCustomValidity(validator.checkValidity() ? '' : validator.validationMessage || t('Enter a valid URL.'));
            }
            if (!field.reportValidity()) return;
            if (element.value !== field.value) {
                element.value = field.value;
                fire(element, numericRange ? ['input', 'change', 'mouseup', 'touchend'] : ['input', 'change']);
            }
            if (save && !await saveEditing(element)) {
                // A key can be stored even when its metadata refresh failed.
                // Only the native owner decides when the draft is acknowledged.
                if ((row.sensitive || isSensitive(element)) && !element.value) field.value = '';
                return;
            }
            if (disposed) return;
            closeSheet();
            settle();
        };
        if (field.tagName === 'INPUT' || address) field.addEventListener('keydown', event => {
            if (isComposingKeyboardEvent(event)) return;
            if (event.key === 'Enter') { event.preventDefault(); void submit(); }
        });
        presentSheet(title, origin, [['Cancel', () => closeSheet()], ['Save', () => void submit()]]);
        // Native focus scrolling keeps the input visible below long help text
        // and when a mobile keyboard shortens the content viewport.
        field.focus();
        if (address) {
            field.setSelectionRange(0, 0);
            field.scrollTop = 0;
            field.scrollLeft = 0;
        }
    }

    function rowButton(className = '') {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = `tt-sp-row ${className}`.trim();
        node.innerHTML = '<span class="tt-sp-label"></span>';
        return node;
    }

    function toggleRow(row, element) {
        const node = rowButton();
        node.setAttribute('role', 'switch');
        node.insertAdjacentHTML('beforeend', '<span class="tt-sp-switch" aria-hidden="true"></span>');
        node.firstElementChild.textContent = labelOf(row, element);
        node.addEventListener('click', () => {
            element.checked = !element.checked;
            fire(element, ['input', 'change']);
            settle([400, 1500]);
        });
        return { node, sync() {
            syncAttribute(node, 'aria-checked', String(element.checked));
            syncBooleanProperty(node, 'disabled', element.disabled);
        } };
    }

    function selectRow(row, element) {
        const node = rowButton('tt-sp-select');
        node.setAttribute('aria-haspopup', 'dialog');
        node.insertAdjacentHTML('beforeend', '<span class="tt-sp-value"></span>');
        const label = labelOf(row, element);
        node.firstElementChild.textContent = label;
        node.addEventListener('click', () => openChoice(label, element, node, row));
        return { node, sync() {
            // An empty list (presets not loaded yet) has nothing to choose.
            const choices = [...element.options].filter(option => !option.disabled && !option.hidden
                && (!element.multiple || option.value !== '') && clean(option.textContent));
            const empty = !choices.length;
            const chosen = [...element.selectedOptions];
            syncText(node.lastElementChild, empty ? t('Not set')
                : element.multiple ? (chosen.length ? chosen.map(option => clean(option.textContent)).join(', ') : t('None'))
                    : clean(chosen[0]?.textContent));
            node.lastElementChild.classList.toggle('tt-sp-empty', empty);
            syncBooleanProperty(node, 'disabled', element.disabled || empty);
        } };
    }

    function textRow(row, element) {
        const node = rowButton('tt-sp-text');
        node.setAttribute('aria-haspopup', 'dialog');
        node.insertAdjacentHTML('beforeend', '<span class="tt-sp-value"></span>');
        const label = labelOf(row, element);
        node.firstElementChild.textContent = label;
        const masked = row.sensitive || isSensitive(element);
        node.addEventListener('click', () => openEdit(label, element, node, row));
        return { node, sync() {
            const value = element.value;
            const stored = element.dataset.secretSaved === 'true';
            syncText(node.lastElementChild, masked ? t(value ? 'Entered' : stored ? 'Saved' : 'Not set')
                : value && !value.trim() ? JSON.stringify(value) : value || t('Not set'));
            node.lastElementChild.classList.toggle('tt-sp-empty', !value && !stored);
            syncBooleanProperty(node, 'disabled', element.disabled || element.readOnly);
        } };
    }

    function sliderRow(row, element) {
        const node = document.createElement('div');
        node.className = 'tt-sp-row tt-sp-slider';
        node.innerHTML = '<span class="tt-sp-label"></span><button type="button" class="tt-sp-value"></button><input type="range">';
        const label = labelOf(row, element);
        node.firstElementChild.textContent = label;
        const value = node.querySelector('.tt-sp-value');
        value.setAttribute('aria-label', `${t('Edit value')}: ${label}`);
        value.setAttribute('aria-haspopup', 'dialog');
        value.title = t('Enter an exact value');
        value.addEventListener('click', () => openEdit(label, element, value, row));
        const range = node.querySelector('input');
        range.setAttribute('aria-label', label);
        const counter = document.getElementById(`${element.id}_counter`) || document.querySelector(`input[data-for="${element.id}"]`);
        const show = () => {
            syncText(value, counter?.value || element.value);
            const min = Number(range.min || 0);
            const max = Number(range.max || 100);
            const ratio = max > min ? (Number(range.value) - min) / (max - min) : 0;
            range.style.setProperty('--tt-fill', `${Math.min(1, Math.max(0, ratio)) * 100}%`);
        };
        range.addEventListener('input', () => {
            element.value = range.value;
            fire(element, ['input']);
            show();
        });
        // Some native sliders apply only on release.
        range.addEventListener('change', () => { fire(element, ['change', 'mouseup', 'touchend']); settle(); });
        return { node, sync() {
            for (const attribute of ['min', 'max', 'step']) {
                syncAttribute(range, attribute, element.getAttribute(attribute));
            }
            range.value = element.value;
            syncBooleanProperty(range, 'disabled', element.disabled);
            syncBooleanProperty(value, 'disabled', element.disabled);
            show();
        } };
    }

    function actionRow(row, element) {
        const node = rowButton('tt-sp-action');
        node.firstElementChild.textContent = labelOf(row, element);
        node.addEventListener('click', () => {
            element.click();
            settle([400, 1500, 4000]);
        });
        return { node, sync() {
            const busy = element.getAttribute('aria-busy') === 'true';
            syncBooleanProperty(node, 'disabled', isControlDisabled(element));
            syncText(node.firstElementChild, busy && clean(element.textContent) || labelOf(row, element));
            syncAttribute(node, 'aria-busy', busy ? 'true' : null);
        } };
    }

    function statusRow(row, element) {
        const node = document.createElement('div');
        node.className = 'tt-sp-row tt-sp-status';
        node.setAttribute('role', 'status');
        node.innerHTML = '<span class="tt-sp-label"></span><span class="tt-sp-value"></span>';
        node.firstElementChild.textContent = t(row.label || 'Status');
        return { node, sync() {
            syncText(node.lastElementChild, clean(element.textContent));
            syncAttribute(node, 'data-tt-online', String(Boolean(row.online?.())));
        } };
    }

    /** A native list item (persona, background...) shown as a Telegram chat-like row. */
    function pickRow(row) {
        const element = row.pick;
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'tt-sp-row tt-sp-pick';
        node.innerHTML = '<span class="tt-sp-avatar" aria-hidden="true"></span><span class="tt-sp-pick-copy"><span class="tt-sp-label"></span><small></small></span><span class="tt-sp-check" aria-hidden="true"></span>';
        const avatar = node.querySelector('.tt-sp-avatar');
        const label = node.querySelector('.tt-sp-label');
        const subtitle = node.querySelector('small');
        node.addEventListener('click', () => {
            element.click();
            settle([300, 1200]);
        });
        return { node, sync() {
            const title = clean(row.title?.(element));
            syncText(label, title);
            syncText(subtitle, clean(row.subtitle?.(element)));
            syncBooleanProperty(subtitle, 'hidden', !subtitle.textContent);
            const image = row.image?.(element);
            avatar.style.backgroundImage = image ? `url(${JSON.stringify(image)})` : '';
            syncText(avatar, image ? '' : [...title][0] || '');
            const selected = Boolean(row.selected?.(element));
            syncAttribute(node, 'aria-current', String(selected));
        } };
    }

    function rowFor(row) {
        if (row.pick) return pickRow(row);
        if (row.status) {
            const element = typeof row.status === 'string' ? document.querySelector(row.status) : row.status;
            return element && statusRow(row, element);
        }
        const element = row.element || (row.action && document.getElementById(row.action)) || document.getElementById(row.id);
        if (!element) return null;
        let rendered;
        if (row.action) rendered = actionRow(row, element);
        else if (element.tagName === 'SELECT') rendered = selectRow(row, element);
        else if (element.tagName === 'TEXTAREA') rendered = textRow(row, element);
        else if (element.tagName === 'INPUT') {
            if (element.type === 'checkbox') rendered = toggleRow(row, element);
            else if (element.type === 'range') rendered = sliderRow(row, element);
            else if (TEXT_TYPES.has(element.type)) rendered = textRow(row, element);
        }
        if (rendered) rendered.controlId = element.id;
        return rendered;
    }

    const currentSections = () => typeof schema.sections === 'function' ? schema.sections(document) : schema.sections;
    const keyOf = sections => sections.map(section => `${section.title}:${section.rows
        .map(row => row.element?.id || row.element?.className || row.pick?.dataset?.avatarId || row.key || row.action || row.status || row.id).join(',')}`).join('|');

    function build(sections) {
        const focused = rows.find(row => row.node.contains(document.activeElement));
        const controlId = focused?.controlId;
        const nestedTag = document.activeElement === focused?.node ? null : document.activeElement?.tagName;
        signature = keyOf(sections);
        rows = [];
        groups.replaceChildren();
        for (const section of sections) {
            const built = section.rows.map(rowFor).filter(Boolean);
            if (!built.length) continue;
            const group = document.createElement(section.collapsed ? 'details' : 'section');
            group.className = 'tt-sp-group';
            const heading = document.createElement(section.collapsed ? 'summary' : 'h2');
            heading.textContent = t(section.title);
            group.append(heading, ...built.map(row => row.node));
            if (section.note) {
                const note = document.createElement('p');
                note.className = 'tt-sp-note';
                note.textContent = t(section.note);
                group.append(note);
            }
            groups.append(group);
            rows.push(...built);
        }
        refresh();
        if (controlId) {
            const replacement = rows.find(row => row.controlId === controlId)?.node;
            (nestedTag ? replacement?.querySelector(nestedTag.toLowerCase()) : replacement)?.focus({ preventScroll: true });
        }
    }

    function rebuildIfChanged() {
        if (typeof schema.sections !== 'function' || !sheet.hidden) return;
        const sections = currentSections();
        if (keyOf(sections) !== signature) build(sections);
    }

    if (openNative) {
        const group = document.createElement('section');
        group.className = 'tt-sp-group';
        const link = rowButton('tt-sp-link');
        link.insertAdjacentHTML('beforeend', icon('chevron'));
        link.firstElementChild.textContent = t(schema.linkLabel || 'All settings');
        link.addEventListener('click', () => void openNative());
        group.append(link);
        const footer = document.createElement('p');
        footer.className = 'tt-sp-footer';
        footer.textContent = t(schema.footer || 'Custom CSS, STscript, auto-continue and other advanced options.');
        page.append(group, footer);
    }
    page.append(sheet);

    function refresh() {
        for (const row of rows) row.sync();
    }
    function onNativeControlChange(event) {
        if (event.target?.id && rows.some(row => row.controlId === event.target.id)) refresh();
    }
    document.addEventListener('change', onNativeControlChange);
    build(currentSections());
    return {
        element: page,
        refresh() { refresh(); rebuildIfChanged(); },
        closeSheet,
        dispose() {
            disposed = true;
            for (const timer of timers) win.clearTimeout(timer);
            document.removeEventListener('keydown', onSheetKeyDown, true);
            document.removeEventListener('change', onNativeControlChange);
        },
    };
}
