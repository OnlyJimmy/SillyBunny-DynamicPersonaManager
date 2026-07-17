import { cloneJson } from '../utils/cloning.js';
import { getPathValue, parseJsonPointer } from '../utils/paths.js';
import { normalizeOperation } from './normalize.js';

function arrayAppendPath(path, beforeValue, afterValue) {
    if (!Array.isArray(beforeValue) || !Array.isArray(afterValue)) return null;
    if (afterValue.length !== beforeValue.length + 1) return null;
    return `${path}/${afterValue.length - 1}`;
}

export function createInverseOperation(operation, personaBefore, personaAfter) {
    const normalized = normalizeOperation(operation);
    const beforeValue = cloneJson(getPathValue(personaBefore, normalized.path));
    const afterValue = cloneJson(getPathValue(personaAfter, normalized.path));

    if (normalized.type === 'set') {
        return {
            type: 'set',
            path: normalized.path,
            oldValue: afterValue,
            value: beforeValue,
            reason: `Revert ${normalized.path}`,
            evidence: 'Revision inverse operation.',
            confidence: 1,
            importance: normalized.importance || 'material',
        };
    }

    if (normalized.type === 'add') {
        const appendPath = arrayAppendPath(normalized.path, beforeValue, afterValue);
        return {
            type: 'remove',
            path: appendPath || normalized.path,
            oldValue: appendPath ? cloneJson(getPathValue(personaAfter, appendPath)) : afterValue,
            reason: `Revert add at ${normalized.path}`,
            evidence: 'Revision inverse operation.',
            confidence: 1,
            importance: normalized.importance || 'material',
        };
    }

    if (normalized.type === 'remove') {
        const parts = parseJsonPointer(normalized.path);
        const parentPath = `/${parts.slice(0, -1).join('/')}`;
        return {
            type: 'add',
            path: parentPath === '/' ? normalized.path : parentPath,
            value: beforeValue,
            reason: `Revert remove at ${normalized.path}`,
            evidence: 'Revision inverse operation.',
            confidence: 1,
            importance: normalized.importance || 'material',
        };
    }

    throw new Error(`Unsupported operation type for inverse: ${normalized.type}`);
}

export function createInverseOperations(operations, personaBefore, personaAfter) {
    return [...(Array.isArray(operations) ? operations : [])]
        .map(operation => createInverseOperation(operation, personaBefore, personaAfter))
        .reverse();
}
