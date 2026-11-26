/** Mobile presentation reads its owners afresh; these writes keep no second state. */
export function syncText(node, value) {
    const text = value ?? '';
    if (node.textContent !== text) node.textContent = text;
}

/** Return whether the attribute changed, for a dependent part of the same control. */
export function syncAttribute(node, name, value) {
    if (node.getAttribute(name) === value) return false;
    if (value === null) node.removeAttribute(name);
    else node.setAttribute(name, value);
    return true;
}

/** Preserve the original boolean property setter, including inert on older WebViews. */
export function syncBooleanProperty(node, name, value) {
    if (node[name] !== value) node[name] = value;
}
