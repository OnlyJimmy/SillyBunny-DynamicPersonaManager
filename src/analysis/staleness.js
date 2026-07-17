import { fingerprintPair, getActiveMessageText } from './fingerprints.js';

export function getProposalSourceState(chat, proposal) {
    const source = proposal?.source ?? {};
    if (source.type !== 'latest-pair' || source.assistantMessageId === undefined) {
        return { stale: false, reason: '' };
    }

    const assistantIndex = Number(source.assistantMessageId);
    const assistantMessage = Array.isArray(chat) ? chat[assistantIndex] : null;
    if (!assistantMessage || assistantMessage.is_user || assistantMessage.is_system) {
        return { stale: true, reason: 'Source assistant message is no longer available.' };
    }

    const activeSwipeId = Number.isInteger(assistantMessage.swipe_id) ? assistantMessage.swipe_id : 0;
    const sourceSwipeId = Number(source.assistantSwipeId ?? 0);
    if (activeSwipeId !== sourceSwipeId) {
        return {
            stale: true,
            reason: `Proposal belongs to swipe ${sourceSwipeId + 1}; active swipe is ${activeSwipeId + 1}.`,
        };
    }

    if (source.fingerprint) {
        const userIndex = Number(source.userMessageId);
        const userMessage = Array.isArray(chat) ? chat[userIndex] : null;
        if (!userMessage || !userMessage.is_user || userMessage.is_system) {
            return { stale: true, reason: 'Source user message is no longer available.' };
        }
        const activeFingerprint = fingerprintPair({
            userIndex,
            assistantIndex,
            assistantSwipeId: activeSwipeId,
            userText: getActiveMessageText(userMessage),
            assistantText: getActiveMessageText(assistantMessage),
        });
        if (activeFingerprint !== source.fingerprint) {
            return { stale: true, reason: 'Source message text has changed since analysis.' };
        }
    }

    return { stale: false, reason: '' };
}

export function annotateProposalStaleness(chat, proposal) {
    const sourceState = getProposalSourceState(chat, proposal);
    return {
        ...proposal,
        stale: sourceState.stale,
        staleReason: sourceState.reason,
    };
}
