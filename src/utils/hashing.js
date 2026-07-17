/**
 * Deterministic stringify for hashing and equality checks.
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/**
 * Lightweight non-cryptographic hash for revision audit records.
 * @param {unknown} value
 * @returns {string}
 */
export function hashJson(value) {
    const input = stableStringify(value);
    let hash = 5381;

    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }

    return `dpm_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
