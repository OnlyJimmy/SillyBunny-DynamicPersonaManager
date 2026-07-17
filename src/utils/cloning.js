/**
 * Deep clone JSON-compatible data.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function cloneJson(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
}
