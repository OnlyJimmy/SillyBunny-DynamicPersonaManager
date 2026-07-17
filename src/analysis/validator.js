import { createProposal } from '../operations/proposals.js';
import { simulateOperations } from '../operations/apply.js';
import { normalizeOperation } from '../operations/normalize.js';
import { validateOperationEvidence } from './evidence.js';

function normalizeEvidenceText(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function annotateOperationSource(operation, pair) {
    if (!pair) return operation;
    const evidence = normalizeEvidenceText(operation.evidence);
    const userText = normalizeEvidenceText(pair.userText);
    const assistantText = normalizeEvidenceText(pair.assistantText);
    const inUser = evidence && userText.includes(evidence);
    const inAssistant = evidence && assistantText.includes(evidence);

    if (inUser && !inAssistant) {
        operation.sourceMessageRole = 'user';
        operation.sourceMessageId = Number.isInteger(pair.userIndex) ? String(pair.userIndex) : '';
        operation.sourceSwipeId = null;
    } else if (inAssistant && !inUser) {
        operation.sourceMessageRole = 'assistant';
        operation.sourceMessageId = Number.isInteger(pair.assistantIndex) ? String(pair.assistantIndex) : '';
        operation.sourceSwipeId = Number.isInteger(pair.assistantSwipeId) ? pair.assistantSwipeId : 0;
    } else if (inUser && inAssistant) {
        operation.sourceMessageRole = 'both';
        operation.sourceMessageId = Number.isInteger(pair.assistantIndex) ? String(pair.assistantIndex) : '';
        operation.sourceSwipeId = Number.isInteger(pair.assistantSwipeId) ? pair.assistantSwipeId : 0;
    }

    return operation;
}

export function buildValidatedProposal({ persona, parsedResponse, source, analysis = {}, minimumConfidence = 0.7, pair = null, evidenceMaximumLength = 200 }) {
    const validOperations = [];
    const warnings = [];

    for (const [index, rawOperation] of parsedResponse.operations.entries()) {
        let operation = null;
        try {
            operation = normalizeOperation(rawOperation);
            if (operation.confidence !== null && operation.confidence < minimumConfidence) {
                throw new Error(`Confidence ${operation.confidence} is below threshold ${minimumConfidence}.`);
            }
            const evidenceResult = validateOperationEvidence(operation, pair, { maximumLength: evidenceMaximumLength });
            if (!evidenceResult.ok) {
                throw new Error(evidenceResult.message);
            }
            annotateOperationSource(operation, pair);
            simulateOperations(persona, [operation]);
            validOperations.push(operation);
        } catch (error) {
            const blockedByLock = /Operation blocked by .* lock at /.test(error.message);
            warnings.push({
                index,
                message: error.message,
                code: blockedByLock ? 'lockedOperationSkipped' : 'operationRejected',
                path: operation?.path || rawOperation?.path || '',
            });
        }
    }
    const lockedSkippedCount = warnings.filter(warning => warning.code === 'lockedOperationSkipped').length;

    if (!validOperations.length) {
        return { proposal: null, warnings, lockedSkippedCount };
    }

    return {
        proposal: createProposal({
            personaId: persona.personaId,
            summary: parsedResponse.summary,
            operations: validOperations,
            source,
            analysis: {
                ...analysis,
                warnings,
            },
        }),
        warnings,
        lockedSkippedCount,
    };
}
