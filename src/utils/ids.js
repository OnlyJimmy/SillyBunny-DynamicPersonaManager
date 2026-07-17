/**
 * Creates a stable extension-owned id with a readable prefix.
 * @param {string} prefix
 * @returns {string}
 */
export function createId(prefix = 'dpm') {
    const normalizedPrefix = String(prefix || 'dpm').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'dpm';

    if (globalThis.crypto?.randomUUID) {
        return `${normalizedPrefix}_${globalThis.crypto.randomUUID()}`;
    }

    const random = Math.random().toString(36).slice(2, 10);
    const time = Date.now().toString(36);
    return `${normalizedPrefix}_${time}_${random}`;
}
