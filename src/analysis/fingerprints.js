import { hashJson } from '../utils/hashing.js';

export function getActiveMessageText(message) {
    if (!message || typeof message !== 'object') return '';
    if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id) && typeof message.swipes[message.swipe_id] === 'string') {
        return message.swipes[message.swipe_id];
    }
    return String(message.mes ?? '');
}

export function findLatestCompletedPair(chat) {
    if (!Array.isArray(chat) || chat.length < 2) return null;

    for (let assistantIndex = chat.length - 1; assistantIndex >= 1; assistantIndex--) {
        const assistantMessage = chat[assistantIndex];
        const assistantText = getActiveMessageText(assistantMessage).trim();
        if (!assistantMessage || assistantMessage.is_user || assistantMessage.is_system || !assistantText || assistantText === '...') {
            continue;
        }

        for (let userIndex = assistantIndex - 1; userIndex >= 0; userIndex--) {
            const userMessage = chat[userIndex];
            if (userMessage?.is_user && !userMessage.is_system && getActiveMessageText(userMessage).trim()) {
                return {
                    userIndex,
                    assistantIndex,
                    userMessage,
                    assistantMessage,
                    userText: getActiveMessageText(userMessage),
                    assistantText: getActiveMessageText(assistantMessage),
                    assistantSwipeId: Number.isInteger(assistantMessage.swipe_id) ? assistantMessage.swipe_id : 0,
                };
            }
        }
    }

    return null;
}

export function hasAnalysedFingerprint(analysisState, fingerprint) {
    if (!fingerprint) return true;
    if (analysisState?.lastAnalysedFingerprint === fingerprint) return true;
    return Array.isArray(analysisState?.analysedFingerprints)
        && analysisState.analysedFingerprints.includes(fingerprint);
}

export function rememberAnalysedFingerprint(analysisState, fingerprint, limit = 100) {
    if (!analysisState || !fingerprint) return;
    const fingerprints = Array.isArray(analysisState.analysedFingerprints)
        ? analysisState.analysedFingerprints.filter(item => item !== fingerprint)
        : [];
    fingerprints.push(fingerprint);
    analysisState.analysedFingerprints = fingerprints.slice(-limit);
    analysisState.lastAnalysedFingerprint = fingerprint;
}

export function fingerprintPair(pair) {
    if (!pair) return '';
    return hashJson({
        userIndex: pair.userIndex,
        assistantIndex: pair.assistantIndex,
        assistantSwipeId: pair.assistantSwipeId,
        userText: pair.userText,
        assistantText: pair.assistantText,
    });
}
