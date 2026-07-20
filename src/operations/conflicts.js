import { parseJsonPointer } from '../utils/paths.js';

const COLLECTION_ITEM_LABEL_FIELDS = Object.freeze([
    'targetLabel',
    'entityName',
    'name',
    'title',
    'subject',
    'fact',
]);

function pathsOverlap(leftPath, rightPath) {
    const left = parseJsonPointer(leftPath);
    const right = parseJsonPointer(rightPath);
    const shortest = Math.min(left.length, right.length);
    for (let index = 0; index < shortest; index += 1) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

function normalizeConflictLabel(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function formatConflictLabel(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getAddOperationCollectionName(operation) {
    if (operation?.type !== 'add') return '';
    const parts = parseJsonPointer(operation.path || '');
    return parts.length === 1 ? parts[0] : '';
}

function getAddOperationItemLabel(operation) {
    for (const field of COLLECTION_ITEM_LABEL_FIELDS) {
        const direct = normalizeConflictLabel(operation?.[field]);
        if (direct) return direct;
        const nested = normalizeConflictLabel(operation?.value?.[field]);
        if (nested) return nested;
    }
    return '';
}

function getAddOperationItemDisplayLabel(operation) {
    for (const field of COLLECTION_ITEM_LABEL_FIELDS) {
        const direct = formatConflictLabel(operation?.[field]);
        if (direct) return direct;
        const nested = formatConflictLabel(operation?.value?.[field]);
        if (nested) return nested;
    }
    return '';
}

function collectionAddsConflict(left, right) {
    const leftCollection = getAddOperationCollectionName(left);
    const rightCollection = getAddOperationCollectionName(right);
    if (!leftCollection || leftCollection !== rightCollection) return null;

    const leftLabel = getAddOperationItemLabel(left);
    const rightLabel = getAddOperationItemLabel(right);
    if (leftLabel && rightLabel && leftLabel !== rightLabel) return '';
    if (leftLabel && rightLabel && leftLabel === rightLabel) {
        return `Both operations add ${getAddOperationItemDisplayLabel(left) || leftLabel} to /${leftCollection}.`;
    }

    return `Both operations add entries to /${leftCollection} without enough target detail to prove they are distinct.`;
}

function operationConflictReason(left, right) {
    if (!left?.path || !right?.path) return '';
    const addConflict = collectionAddsConflict(left, right);
    if (addConflict !== null) return addConflict;
    if (!pathsOverlap(left.path, right.path)) return '';
    if (left.path === right.path) return `Both operations target ${left.path}.`;
    return `Operations target overlapping paths: ${left.path} and ${right.path}.`;
}

export function annotateOperationConflicts(proposals) {
    const pending = [];
    for (const proposal of Array.isArray(proposals) ? proposals : []) {
        for (const operation of proposal.operations || []) {
            if (operation.status === 'accepted' || operation.status === 'rejected') continue;
            pending.push({ proposal, operation });
            operation.conflicts = [];
        }
    }

    for (let leftIndex = 0; leftIndex < pending.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < pending.length; rightIndex += 1) {
            const left = pending[leftIndex];
            const right = pending[rightIndex];
            const sameTransaction = left.proposal.proposalId === right.proposal.proposalId
                && left.operation.transactionId
                && left.operation.transactionId === right.operation.transactionId;
            if (sameTransaction) continue;

            const reason = operationConflictReason(left.operation, right.operation);
            if (!reason) continue;

            left.operation.conflicts.push({
                proposalId: right.proposal.proposalId,
                operationId: right.operation.operationId,
                reason,
            });
            right.operation.conflicts.push({
                proposalId: left.proposal.proposalId,
                operationId: left.operation.operationId,
                reason,
            });
        }
    }

    return proposals;
}

export function operationHasConflicts(operation) {
    return Array.isArray(operation?.conflicts) && operation.conflicts.length > 0;
}
