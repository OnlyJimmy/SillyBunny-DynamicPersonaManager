import { COLLECTION_FIELDS } from '../constants.js';
import { createDefaultCollectionEntry } from '../ui/character-editor.js';
import { createId } from '../utils/ids.js';
import { parseJsonPointer } from '../utils/paths.js';

export const OPERATION_TYPES = Object.freeze(['set', 'add', 'remove']);
const SOURCE_MESSAGE_ROLES = Object.freeze(['user', 'assistant', 'both', 'unknown']);

function normalizeTextField(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function inferCategoryFromPath(path) {
    const [root] = parseJsonPointer(path);
    return root || 'persona';
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => String(item ?? '').trim())
        .filter(Boolean);
}

function firstTextValue(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function normalizeRelationshipAddValue(base, incoming) {
    const next = { ...base, ...incoming };
    next.entityName = firstTextValue(
        next.entityName,
        incoming.name,
        incoming.characterName,
        incoming.personName,
        incoming.person,
        incoming.entity,
        incoming.target,
        incoming.targetName,
    );
    next.summary = firstTextValue(
        next.summary,
        incoming.relationship,
        incoming.relationshipType,
        incoming.description,
        incoming.details,
    );
    next.attitude = firstTextValue(next.attitude, incoming.disposition, incoming.feeling, incoming.feelings);

    if (typeof incoming.notes === 'string' && incoming.notes.trim()) {
        next.notes = [incoming.notes.trim()];
    }
    if (typeof incoming.status === 'string' && incoming.status.trim()) {
        next.statusTags = normalizeStringArray(next.statusTags).includes(incoming.status.trim())
            ? normalizeStringArray(next.statusTags)
            : [...normalizeStringArray(next.statusTags), incoming.status.trim()];
    }

    return next;
}

export function normalizeOperation(operation) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        throw new Error('Operation must be an object.');
    }

    const type = String(operation.type ?? operation.op ?? '').trim();
    if (!OPERATION_TYPES.includes(type)) {
        throw new Error(`Unsupported operation type: ${type || 'missing'}.`);
    }

    const path = String(operation.path ?? '').trim();
    parseJsonPointer(path);

    return {
        operationId: typeof operation.operationId === 'string' && operation.operationId.trim()
            ? operation.operationId
            : createId('operation'),
        type,
        path,
        value: operation.value,
        oldValue: operation.oldValue,
        reason: String(operation.reason ?? '').trim(),
        evidence: String(operation.evidence ?? '').trim(),
        confidence: operation.confidence === undefined || operation.confidence === null ? null : Number(operation.confidence),
        importance: String(operation.importance ?? 'material').trim() || 'material',
        status: operation.status || 'pending',
        category: normalizeTextField(operation.category) || inferCategoryFromPath(path),
        targetLabel: normalizeTextField(operation.targetLabel),
        changeType: normalizeTextField(operation.changeType),
        severity: normalizeTextField(operation.severity),
        sourceMessageRole: SOURCE_MESSAGE_ROLES.includes(operation.sourceMessageRole) ? operation.sourceMessageRole : 'unknown',
        sourceMessageId: normalizeTextField(operation.sourceMessageId),
        sourceSwipeId: Number.isInteger(operation.sourceSwipeId) ? operation.sourceSwipeId : null,
        validationWarnings: normalizeStringArray(operation.validationWarnings),
        tags: normalizeStringArray(operation.tags),
        transactionId: normalizeTextField(operation.transactionId),
        transactionLabel: normalizeTextField(operation.transactionLabel),
    };
}

export function normalizeAddValue(path, value) {
    const [root] = parseJsonPointer(path);
    if (!COLLECTION_FIELDS.includes(root)) {
        return value;
    }

    const base = createDefaultCollectionEntry(root);
    const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const next = {
        ...base,
        ...incoming,
        id: typeof incoming.id === 'string' && incoming.id.trim() ? incoming.id : base.id,
    };
    if (root === 'relationships') {
        return normalizeRelationshipAddValue(next, incoming);
    }
    return next;
}
