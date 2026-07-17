import { parseJsonPointer } from '../utils/paths.js';

function pathsOverlap(leftPath, rightPath) {
    const left = parseJsonPointer(leftPath);
    const right = parseJsonPointer(rightPath);
    const shortest = Math.min(left.length, right.length);
    for (let index = 0; index < shortest; index += 1) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

function operationConflictReason(left, right) {
    if (!left?.path || !right?.path) return '';
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
