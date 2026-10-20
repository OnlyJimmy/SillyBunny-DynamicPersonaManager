import { parseAnalysisResponse } from './response-parser.js';
import { buildValidatedProposal } from './validator.js';
import { findLatestCompletedPair, fingerprintPair } from './fingerprints.js';
import { hashJson } from '../utils/hashing.js';

export function createMalformedResponseRecord({ attempts, persona, pair, handled = false }) {
    return {
        attempts,
        personaHash: hashJson(persona),
        fingerprint: fingerprintPair(pair),
        createdAt: new Date().toISOString(),
        handled,
        draft: attempts.at(-1)?.rawResponse ?? '',
    };
}

export function recoverAnalysisResponse({ record, text, persona, chat, settings = {} }) {
    if (!record || record.handled) throw new Error('This analysis has already been handled. Scan the latest pair for new changes.');
    const pair = findLatestCompletedPair(chat);
    if (!pair || fingerprintPair(pair) !== record.fingerprint) {
        throw new Error('The source messages or active swipe have changed. Scan the latest pair again.');
    }
    if (hashJson(persona) !== record.personaHash) {
        throw new Error('The persona has changed since this response. Scan the latest pair again.');
    }
    return buildValidatedProposal({
        persona,
        parsedResponse: parseAnalysisResponse(text),
        pair,
        source: {
            type: 'latest-pair', fingerprint: record.fingerprint,
            userMessageId: String(pair.userIndex), assistantMessageId: String(pair.assistantIndex),
            assistantSwipeId: pair.assistantSwipeId,
        },
        analysis: { recoveredFromMalformedResponse: true, analysedAt: new Date().toISOString() },
        minimumConfidence: Number(settings.confidenceThreshold ?? 0.7),
        evidenceMaximumLength: Number(settings.evidenceExcerptMaximum ?? 200),
    });
}
