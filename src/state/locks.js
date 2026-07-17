import { parseJsonPointer } from '../utils/paths.js';

export const LOCK_MODES = Object.freeze({
    proposalLocked: 'proposalLocked',
    confirmationLocked: 'confirmationLocked',
    promptHidden: 'promptHidden',
    analysisHidden: 'analysisHidden',
    immutable: 'immutable',
});

export function normalizePointer(path) {
    const parts = parseJsonPointer(path);
    return `/${parts.join('/')}`;
}

export function pathContains(parentPath, childPath) {
    const parent = parseJsonPointer(parentPath);
    const child = parseJsonPointer(childPath);
    if (parent.length > child.length) return false;
    return parent.every((part, index) => part === child[index]);
}

export function getLocksForPath(persona, path, modes = []) {
    const modeSet = new Set(modes);
    return (Array.isArray(persona?.locks) ? persona.locks : [])
        .filter(lock => lock && typeof lock === 'object')
        .filter(lock => !modeSet.size || modeSet.has(lock.mode))
        .filter(lock => typeof lock.path === 'string' && lock.path.startsWith('/'))
        .filter(lock => pathContains(lock.path, path));
}

export function assertOperationUnlocked(persona, path, { source = 'proposal' } = {}) {
    const blockingModes = source === 'proposal'
        ? [LOCK_MODES.immutable, LOCK_MODES.proposalLocked]
        : [LOCK_MODES.immutable];
    const locks = getLocksForPath(persona, path, blockingModes);
    if (locks.length) {
        const lock = locks[0];
        throw new Error(`Operation blocked by ${lock.mode} lock at ${lock.path}.`);
    }
}

export function isPathHidden(persona, path, mode) {
    return getLocksForPath(persona, path, [mode]).length > 0;
}

export function filterHiddenEntries(persona, path, entries, mode) {
    return (Array.isArray(entries) ? entries : []).filter((entry, index) => {
        const entryPath = `${path}/${index}`;
        if (isPathHidden(persona, entryPath, mode)) return false;
        if (entry?.id && isPathHidden(persona, `${path}/${entry.id}`, mode)) return false;
        return true;
    });
}
