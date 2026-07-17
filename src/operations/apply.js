import { COLLECTION_FIELDS } from '../constants.js';
import { validatePersona } from '../state/schema.js';
import { assertOperationUnlocked } from '../state/locks.js';
import { cloneJson } from '../utils/cloning.js';
import { getPathValue, isProtectedPersonaPath, parseJsonPointer, removePathValue, setPathValue } from '../utils/paths.js';
import { normalizeAddValue, normalizeOperation } from './normalize.js';

function assertAllowedPath(path) {
    if (isProtectedPersonaPath(path)) {
        throw new Error(`Operation cannot modify protected path ${path}.`);
    }
}

function valuesMatch(expected, actual) {
    return JSON.stringify(expected) === JSON.stringify(actual);
}

export function applyOperation(persona, rawOperation, { source = 'proposal' } = {}) {
    const operation = normalizeOperation(rawOperation);
    assertAllowedPath(operation.path);
    assertOperationUnlocked(persona, operation.path, { source });

    if (operation.oldValue !== undefined) {
        const currentValue = getPathValue(persona, operation.path);
        if (!valuesMatch(operation.oldValue, currentValue)) {
            throw new Error(`Operation target is stale at ${operation.path}.`);
        }
    }

    if (operation.type === 'set') {
        setPathValue(persona, operation.path, operation.value);
        return operation;
    }

    if (operation.type === 'add') {
        const parts = parseJsonPointer(operation.path);
        const target = getPathValue(persona, operation.path);
        if (Array.isArray(target)) {
            target.push(normalizeAddValue(operation.path, operation.value));
            return operation;
        }
        const [root] = parts;
        if (COLLECTION_FIELDS.includes(root) && parts.length === 1) {
            persona[root] = [normalizeAddValue(operation.path, operation.value)];
            return operation;
        }
        throw new Error(`Add operation must target a collection array: ${operation.path}.`);
    }

    if (operation.type === 'remove') {
        removePathValue(persona, operation.path);
        return operation;
    }

    throw new Error(`Unsupported operation type: ${operation.type}.`);
}

export function simulateOperations(persona, operations, options = {}) {
    const nextPersona = cloneJson(persona);
    const appliedOperations = [];

    for (const operation of operations) {
        appliedOperations.push(applyOperation(nextPersona, operation, options));
    }

    const validation = validatePersona(nextPersona);
    if (!validation.ok) {
        throw new Error(`Operation result is invalid: ${validation.errors.join(' ')}`);
    }

    return { persona: nextPersona, appliedOperations };
}
