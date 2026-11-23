import { mobileChatIcon as icon } from './mobile-chat-icons.js';

const TEXT_TYPES = new Set(['', 'text', 'number', 'password', 'url', 'search', 'email', 'tel']);
const SEARCHABLE_OPTIONS = 10;
/** Credential fields are never echoed back into the page. */
const isSensitive = element => element.type === 'password' || /api_key|secret|password/i.test(element.id);

/**
 * Telegram-style settings page bound to native controls. The native inputs
 * keep owning every value and its side effects (saving, presets, connections,
 * extension notifications): rows only read their state and write it back with
 * the same events a user edit would fire, or click the native button.
 *
 * `schema.sections` is a list, or a function of the document for pages whose
 * rows depend on native state (the API page follows the selected source).
 */
export function renderSettingsPage({ document, schema, translate: t = text => text, openNative }) {
    const win = document.defaultView;
    const page = document.createElement('div');
    page.className = 'tt-sp';
    const groups = document.createElement('div');
    page.append(groups);
    let rows = [];
    let signature = '';
    let timers = [];

    const fire = (element, events) => {
        for (const type of events) element.dispatchEvent(new win.Event(type, { bubbles: true }));
    };
    const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
    function nativeLabel(element) {
        const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/)
            .map(id => id && document.getElementById(id)?.textContent).filter(Boolean).join(' ');
        const label = element.closest('label') || (element.id && document.querySelector(`label[for="${element.id}"]`));
        return clean(labelled || label?.textContent || element.getAttribute('aria-label')
            || element.getAttribute('title') || element.getAttribute('placeholder') || element.id);
    }
    const labelOf = (row, element) => row.label ? t(row.label) : nativeLabel(element);

    // Native code often reacts asynchronously (themes, presets, connecting).
    function settle(delays = [400]) {
        refresh();
        for (const timer of timers) win.clearTimeout(timer);
        timers = delays.map(delay => win.setTimeout(() => { refresh(); rebuildIfChanged(); }, delay));
    }

    const sheet = document.createElement('div');
    sheet.className = 'tt-sp-sheet';
    sheet.hidden = true;
    sheet.innerHTML = '<button type="button" class="tt-sp-sheet-scrim"></button><div class="tt-sp-dialog" role="dialog" aria-modal="true"><h3></h3><div class="tt-sp-sheet-body"></div><div class="tt-sp-actions" hidden></div></div>';
    const sheetTitle = sheet.querySelector('h3');
    const sheetBody = sheet.querySelector('.tt-sp-sheet-body');
    const sheetActions = sheet.querySelector('.tt-sp-actions');
    sheet.querySelector('.tt-sp-sheet-scrim').setAttribute('aria-label', t('Close'));
    sheet.querySelector('.tt-sp-sheet-scrim').addEventListener('click', () => closeSheet());
    let sheetOrigin;

    function closeSheet() {
        if (sheet.hidden) return false;
        sheet.hidden = true;
        sheetOrigin?.focus({ preventScroll: true });
        return true;
    }

    function presentSheet(title, origin, actions = []) {
        sheetTitle.textContent = title;
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

    function openChoice(title, select, origin) {
        sheetBody.replaceChildren();
        const list = document.createElement('div');
        list.className = 'tt-sp-options';
        list.setAttribute('role', 'radiogroup');
        const options = [...select.options].filter(option => !option.disabled && !option.hidden && option.value !== '');
        // Multiple selects (active lorebooks) toggle options and stay open.
        const multiple = select.multiple;
        if (multiple) list.setAttribute('role', 'group');
        for (const option of options) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tt-sp-option';
            button.setAttribute('role', multiple ? 'checkbox' : 'radio');
            button.setAttribute('aria-checked', String(multiple ? option.selected : option.value === select.value));
            button.innerHTML = `<span class="${multiple ? 'tt-sp-box' : 'tt-sp-radio'}" aria-hidden="true"></span><span></span>`;
            button.lastElementChild.textContent = clean(option.textContent);
            button.addEventListener('click', () => {
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
                closeSheet();
                settle([400, 1500]);
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
            filter.addEventListener('input', () => {
                const query = filter.value.trim().toLocaleLowerCase();
                for (const item of list.children) item.hidden = !item.textContent.toLocaleLowerCase().includes(query);
            });
            sheetBody.append(filter);
        }
        sheetBody.append(list);
        presentSheet(title, origin, multiple ? [['Done', () => closeSheet()]] : []);
        const current = list.querySelector('[aria-checked="true"]');
        current?.scrollIntoView?.({ block: 'center' });
        (current || list.firstElementChild)?.focus({ preventScroll: true });
    }

    function openEdit(title, element, origin) {
        sheetBody.replaceChildren();
        const field = document.createElement(element.tagName === 'TEXTAREA' ? 'textarea' : 'input');
        field.className = 'tt-sp-field';
        if (field.tagName === 'INPUT') field.type = element.type === 'number' ? 'number' : 'text';
        for (const attribute of ['min', 'max', 'step', 'placeholder', 'inputmode']) {
            if (element.hasAttribute(attribute)) field.setAttribute(attribute, element.getAttribute(attribute));
        }
        field.autocomplete = 'off';
        field.spellcheck = false;
        field.value = element.value;
        field.setAttribute('aria-label', title);
        const save = () => {
            if (element.value !== field.value) {
                element.value = field.value;
                fire(element, ['input', 'change']);
            }
            closeSheet();
            settle();
        };
        if (field.tagName === 'INPUT') field.addEventListener('keydown', event => { if (event.key === 'Enter') save(); });
        sheetBody.append(field);
        presentSheet(title, origin, [['Cancel', () => closeSheet()], ['Save', save]]);
        field.focus({ preventScroll: true });
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
            node.setAttribute('aria-checked', String(element.checked));
            node.disabled = element.disabled;
        } };
    }

    function selectRow(row, element) {
        const node = rowButton();
        node.setAttribute('aria-haspopup', 'dialog');
        node.insertAdjacentHTML('beforeend', '<span class="tt-sp-value"></span>');
        const label = labelOf(row, element);
        node.firstElementChild.textContent = label;
        node.addEventListener('click', () => openChoice(label, element, node));
        return { node, sync() {
            // An empty list (presets not loaded yet) has nothing to choose.
            const choices = [...element.options].filter(option => option.value !== '');
            const empty = !choices.length;
            const chosen = [...element.selectedOptions].filter(option => option.value !== '' || !element.multiple);
            node.lastElementChild.textContent = empty ? t('Not set')
                : element.multiple ? (chosen.length ? chosen.map(option => clean(option.textContent)).join(', ') : t('None'))
                    : clean(chosen[0]?.textContent);
            node.lastElementChild.classList.toggle('tt-sp-empty', empty);
            node.disabled = element.disabled || empty;
        } };
    }

    function textRow(row, element) {
        const node = rowButton('tt-sp-text');
        node.setAttribute('aria-haspopup', 'dialog');
        node.insertAdjacentHTML('beforeend', '<span class="tt-sp-value"></span>');
        const label = labelOf(row, element);
        node.firstElementChild.textContent = label;
        const masked = isSensitive(element);
        node.addEventListener('click', () => openEdit(label, element, node));
        return { node, sync() {
            const value = element.value;
            node.lastElementChild.textContent = masked ? t(value ? 'Entered' : 'Not set') : value || t('Not set');
            node.lastElementChild.classList.toggle('tt-sp-empty', !value);
            node.disabled = element.disabled || element.readOnly;
        } };
    }

    function sliderRow(row, element) {
        const node = document.createElement('div');
        node.className = 'tt-sp-row tt-sp-slider';
        node.innerHTML = '<span class="tt-sp-label"></span><span class="tt-sp-value"></span><input type="range">';
        node.firstElementChild.textContent = labelOf(row, element);
        const value = node.querySelector('.tt-sp-value');
        const range = node.querySelector('input');
        range.setAttribute('aria-label', labelOf(row, element));
        for (const attribute of ['min', 'max', 'step']) {
            if (element.hasAttribute(attribute)) range.setAttribute(attribute, element.getAttribute(attribute));
        }
        const counter = document.getElementById(`${element.id}_counter`) || document.querySelector(`input[data-for="${element.id}"]`);
        const show = () => {
            value.textContent = counter?.value || element.value;
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
            range.value = element.value;
            range.disabled = element.disabled;
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
            node.disabled = element.disabled || element.classList.contains('disabled');
        } };
    }

    function statusRow(row, element) {
        const node = document.createElement('div');
        node.className = 'tt-sp-row tt-sp-status';
        node.setAttribute('role', 'status');
        node.innerHTML = '<span class="tt-sp-label"></span><span class="tt-sp-value"></span>';
        node.firstElementChild.textContent = t(row.label || 'Status');
        return { node, sync() {
            node.lastElementChild.textContent = clean(element.textContent);
            node.dataset.ttOnline = String(Boolean(row.online?.()));
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
            label.textContent = title;
            subtitle.textContent = clean(row.subtitle?.(element));
            subtitle.hidden = !subtitle.textContent;
            const image = row.image?.(element);
            avatar.style.backgroundImage = image ? `url(${JSON.stringify(image)})` : '';
            avatar.textContent = image ? '' : [...title][0] || '';
            const selected = Boolean(row.selected?.(element));
            node.setAttribute('aria-current', String(selected));
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
        if (row.action) return actionRow(row, element);
        if (element.tagName === 'SELECT') return selectRow(row, element);
        if (element.tagName === 'TEXTAREA') return textRow(row, element);
        if (element.tagName !== 'INPUT') return null;
        if (element.type === 'checkbox') return toggleRow(row, element);
        if (element.type === 'range') return sliderRow(row, element);
        return TEXT_TYPES.has(element.type) ? textRow(row, element) : null;
    }

    const currentSections = () => typeof schema.sections === 'function' ? schema.sections(document) : schema.sections;
    const keyOf = sections => sections.map(section => `${section.title}:${section.rows
        .map(row => row.element?.id || row.element?.className || row.pick?.dataset?.avatarId || row.key || row.action || row.status || row.id).join(',')}`).join('|');

    function build(sections) {
        signature = keyOf(sections);
        rows = [];
        groups.replaceChildren();
        for (const section of sections) {
            const built = section.rows.map(rowFor).filter(Boolean);
            if (!built.length) continue;
            const group = document.createElement('section');
            group.className = 'tt-sp-group';
            const heading = document.createElement('h2');
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
    build(currentSections());
    return {
        element: page,
        refresh() { refresh(); rebuildIfChanged(); },
        closeSheet,
        dispose() { for (const timer of timers) win.clearTimeout(timer); },
    };
}
