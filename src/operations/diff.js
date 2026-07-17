import { cloneJson } from '../utils/cloning.js';

const PROTECTED_DIFF_FIELDS = new Set(['$schema', 'schemaVersion', 'personaId']);

function valuesMatch(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function createPersonaDiffOperations(personaBefore, personaAfter, { reason = 'Snapshot diff operation.' } = {}) {
    if (!personaBefore || !personaAfter || typeof personaBefore !== 'object' || typeof personaAfter !== 'object') {
        return [];
    }

    const keys = new Set([
        ...Object.keys(personaBefore),
        ...Object.keys(personaAfter),
    ]);

    return [...keys]
        .filter(key => !PROTECTED_DIFF_FIELDS.has(key))
        .filter(key => !valuesMatch(personaBefore[key], personaAfter[key]))
        .map(key => ({
            type: 'set',
            path: `/${key}`,
            oldValue: cloneJson(personaBefore[key]),
            value: cloneJson(personaAfter[key]),
            reason,
            evidence: 'Validated persona snapshot diff.',
            confidence: 1,
            importance: 'material',
            category: key,
            targetLabel: key,
            changeType: 'snapshot update',
        }));
}
