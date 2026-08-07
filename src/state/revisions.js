import { CHECKPOINT_SCHEMA, CHECKPOINT_VERSION, REVISION_SCHEMA, REVISION_VERSION } from '../constants.js';
import { getActiveMessageText } from '../analysis/fingerprints.js';
import { cloneJson } from '../utils/cloning.js';
import { createId } from '../utils/ids.js';
import { hashJson } from '../utils/hashing.js';

export function createRevision({ personaBefore, personaAfter, sourceType = 'manual', summary = 'Manual edit', operations = [], inverseOperations = [], sourceProposalId = null, sourceMessageIds = [], sourceAnchor = null, sequence = 1 }) {
    return {
        $schema: REVISION_SCHEMA,
        revisionVersion: REVISION_VERSION,
        revisionId: createId('revision'),
        personaId: personaAfter?.personaId ?? personaBefore?.personaId ?? '',
        sequence,
        timestamp: new Date().toISOString(),
        sourceType,
        sourceProposalId,
        sourceMessageIds,
        sourceAnchor,
        summary,
        operations,
        inverseOperations,
        personaHashBefore: hashJson(personaBefore ?? null),
        personaHashAfter: hashJson(personaAfter ?? null),
        revertedByRevisionId: null,
    };
}

export function createCheckpoint({ persona, revision, sourceAnchor = null }) {
    return {
        $schema: CHECKPOINT_SCHEMA,
        checkpointVersion: CHECKPOINT_VERSION,
        checkpointId: createId('checkpoint'),
        revisionId: revision?.revisionId ?? null,
        personaId: persona?.personaId ?? '',
        sequence: revision?.sequence ?? 1,
        timestamp: new Date().toISOString(),
        sourceAnchor,
        personaHash: hashJson(persona ?? null),
        persona: cloneJson(persona ?? null),
    };
}

function anchorMessageIndex(anchor) {
    if (anchor?.type === 'latest-pair') return Number(anchor.assistantMessageId);
    if (anchor?.type === 'chat-position') return Number(anchor.messageId);
    return Number.NaN;
}

function anchorSwipeId(anchor) {
    return Number.isInteger(anchor?.assistantSwipeId) ? anchor.assistantSwipeId : null;
}

function getMessageTextForSwipe(message, swipeId = null) {
    if (!message || typeof message !== 'object') return '';
    if (Number.isInteger(swipeId) && Array.isArray(message.swipes) && typeof message.swipes[swipeId] === 'string') {
        return message.swipes[swipeId];
    }
    return getActiveMessageText(message);
}

function anchorMatchesChat(checkpointAnchor, chat) {
    if (!checkpointAnchor?.fingerprint || !Array.isArray(chat)) return true;
    if (checkpointAnchor.type !== 'latest-pair') return true;

    const userIndex = Number(checkpointAnchor.userMessageId);
    const assistantIndex = Number(checkpointAnchor.assistantMessageId);
    if (!Number.isInteger(userIndex) || !Number.isInteger(assistantIndex)) return false;

    const userMessage = chat[userIndex];
    const assistantMessage = chat[assistantIndex];
    if (!userMessage || !assistantMessage) return false;

    const assistantSwipeId = anchorSwipeId(checkpointAnchor) ?? 0;
    const fingerprint = hashJson({
        userIndex,
        assistantIndex,
        assistantSwipeId,
        userText: getMessageTextForSwipe(userMessage),
        assistantText: getMessageTextForSwipe(assistantMessage, assistantSwipeId),
    });

    return fingerprint === checkpointAnchor.fingerprint;
}

function checkpointMatchesActiveBranch(checkpoint, activeAnchor, chat = null) {
    const checkpointIndex = anchorMessageIndex(checkpoint?.sourceAnchor);
    const activeIndex = anchorMessageIndex(activeAnchor);
    if (!Number.isFinite(checkpointIndex) || !Number.isFinite(activeIndex)) return false;
    if (!anchorMatchesChat(checkpoint.sourceAnchor, chat)) return false;
    if (checkpointIndex < activeIndex) return true;
    if (checkpointIndex > activeIndex) return false;

    const activeSwipe = anchorSwipeId(activeAnchor);
    const checkpointSwipe = anchorSwipeId(checkpoint.sourceAnchor);
    if (activeSwipe === null) return true;
    return checkpointSwipe === activeSwipe;
}

export function findNearestCheckpointForAnchor(checkpoints, activeAnchor, currentPersona = null, chat = null) {
    if (!Array.isArray(checkpoints) || !activeAnchor) return null;
    const currentHash = currentPersona ? hashJson(currentPersona) : '';
    const candidates = checkpoints
        .filter(checkpoint => checkpoint?.persona && checkpoint?.sourceAnchor)
        .filter(checkpoint => checkpointMatchesActiveBranch(checkpoint, activeAnchor, chat))
        .sort((left, right) => {
            const leftIndex = anchorMessageIndex(left.sourceAnchor);
            const rightIndex = anchorMessageIndex(right.sourceAnchor);
            if (leftIndex !== rightIndex) return rightIndex - leftIndex;
            return Number(right.sequence || 0) - Number(left.sequence || 0);
        });
    const checkpoint = candidates[0] || null;
    if (!checkpoint || checkpoint.personaHash === currentHash) return null;
    return checkpoint;
}

export function findPreviousCheckpointBeforeAnchor(checkpoints, activeAnchor, currentPersona = null, chat = null) {
    if (!Array.isArray(checkpoints) || !activeAnchor) return null;
    const activeIndex = anchorMessageIndex(activeAnchor);
    if (!Number.isFinite(activeIndex)) return null;
    const currentHash = currentPersona ? hashJson(currentPersona) : '';
    const checkpoint = checkpoints
        .filter(item => item?.persona && item?.sourceAnchor)
        .filter(item => {
            const checkpointIndex = anchorMessageIndex(item.sourceAnchor);
            return Number.isFinite(checkpointIndex)
                && checkpointIndex < activeIndex
                && anchorMatchesChat(item.sourceAnchor, chat);
        })
        .sort((left, right) => {
            const leftIndex = anchorMessageIndex(left.sourceAnchor);
            const rightIndex = anchorMessageIndex(right.sourceAnchor);
            if (leftIndex !== rightIndex) return rightIndex - leftIndex;
            return Number(right.sequence || 0) - Number(left.sequence || 0);
        })[0] || null;
    if (!checkpoint || checkpoint.personaHash === currentHash) return null;
    return checkpoint;
}
