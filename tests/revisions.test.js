import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintPair } from '../src/analysis/fingerprints.js';
import { createBlankPersona } from '../src/state/defaults.js';
import { createCheckpoint, createRevision, findNearestCheckpointForAnchor, findPreviousCheckpointBeforeAnchor } from '../src/state/revisions.js';

function createPairAnchor(chat, userIndex, assistantIndex, assistantSwipeId = 0) {
    const assistantMessage = chat[assistantIndex];
    return {
        type: 'latest-pair',
        fingerprint: fingerprintPair({
            userIndex,
            assistantIndex,
            userText: chat[userIndex].mes,
            assistantText: Array.isArray(assistantMessage.swipes)
                ? assistantMessage.swipes[assistantSwipeId]
                : assistantMessage.mes,
            assistantSwipeId,
        }),
        userMessageId: String(userIndex),
        assistantMessageId: String(assistantIndex),
        assistantSwipeId,
    };
}

test('checkpoint stores a restorable persona snapshot for a revision', () => {
    const before = createBlankPersona({ name: 'Before' });
    const after = createBlankPersona({ name: 'After' });
    const sourceAnchor = {
        type: 'latest-pair',
        fingerprint: 'dpm_pair',
        userMessageId: '4',
        assistantMessageId: '5',
        assistantSwipeId: 2,
    };
    const revision = createRevision({
        personaBefore: before,
        personaAfter: after,
        summary: 'Changed name',
        sequence: 7,
        sourceAnchor,
    });
    const checkpoint = createCheckpoint({ persona: after, revision, sourceAnchor });

    assert.equal(checkpoint.revisionId, revision.revisionId);
    assert.equal(checkpoint.sequence, 7);
    assert.equal(checkpoint.sourceAnchor.assistantSwipeId, 2);
    assert.equal(checkpoint.persona.name, 'After');
    after.name = 'Mutated after checkpoint';
    assert.equal(checkpoint.persona.name, 'After');
});

test('revision stores inverse operations for revert workflows', () => {
    const before = createBlankPersona({ name: 'Before' });
    const after = createBlankPersona({ name: 'After' });
    const revision = createRevision({
        personaBefore: before,
        personaAfter: after,
        summary: 'Changed name',
        sequence: 3,
        operations: [{ type: 'set', path: '/name', value: 'After' }],
        inverseOperations: [{ type: 'set', path: '/name', oldValue: 'After', value: 'Before' }],
    });

    assert.equal(revision.inverseOperations.length, 1);
    assert.equal(revision.inverseOperations[0].value, 'Before');
});

test('nearest checkpoint follows the active chat anchor and swipe', () => {
    const first = createBlankPersona({ name: 'First' });
    const secondSwipeOne = createBlankPersona({ name: 'Second swipe one' });
    const secondSwipeTwo = createBlankPersona({ name: 'Second swipe two' });
    const current = createBlankPersona({ name: 'Current later state' });
    const revisionOne = createRevision({
        personaBefore: null,
        personaAfter: first,
        sequence: 1,
        sourceAnchor: { type: 'latest-pair', assistantMessageId: '3', assistantSwipeId: 0 },
    });
    const revisionTwoSwipeOne = createRevision({
        personaBefore: first,
        personaAfter: secondSwipeOne,
        sequence: 2,
        sourceAnchor: { type: 'latest-pair', assistantMessageId: '7', assistantSwipeId: 0 },
    });
    const revisionTwoSwipeTwo = createRevision({
        personaBefore: first,
        personaAfter: secondSwipeTwo,
        sequence: 3,
        sourceAnchor: { type: 'latest-pair', assistantMessageId: '7', assistantSwipeId: 1 },
    });
    const checkpoints = [
        createCheckpoint({ persona: first, revision: revisionOne, sourceAnchor: revisionOne.sourceAnchor }),
        createCheckpoint({ persona: secondSwipeOne, revision: revisionTwoSwipeOne, sourceAnchor: revisionTwoSwipeOne.sourceAnchor }),
        createCheckpoint({ persona: secondSwipeTwo, revision: revisionTwoSwipeTwo, sourceAnchor: revisionTwoSwipeTwo.sourceAnchor }),
    ];

    const activeSwipeOne = findNearestCheckpointForAnchor(
        checkpoints,
        { type: 'latest-pair', assistantMessageId: '7', assistantSwipeId: 0 },
        current,
    );
    assert.equal(activeSwipeOne.sequence, 2);

    const rewoundBeforeSecond = findNearestCheckpointForAnchor(
        checkpoints,
        { type: 'latest-pair', assistantMessageId: '5', assistantSwipeId: 0 },
        current,
    );
    assert.equal(rewoundBeforeSecond.sequence, 1);

    const sameMessageUnseenSwipe = findNearestCheckpointForAnchor(
        checkpoints,
        { type: 'latest-pair', assistantMessageId: '7', assistantSwipeId: 2 },
        current,
    );
    assert.equal(sameMessageUnseenSwipe.sequence, 1);

    const alreadyMatching = findNearestCheckpointForAnchor(
        checkpoints,
        { type: 'latest-pair', assistantMessageId: '7', assistantSwipeId: 1 },
        secondSwipeTwo,
    );
    assert.equal(alreadyMatching, null);
});

test('previous checkpoint excludes the active pair checkpoint for edit reanalysis', () => {
    const happy = createBlankPersona({ name: 'Happy' });
    happy.personality.temporaryMood = 'Happy';
    const tired = createBlankPersona({ name: 'Tired' });
    tired.personality.temporaryMood = 'Tired';
    const sad = createBlankPersona({ name: 'Sad' });
    sad.personality.temporaryMood = 'Sad';
    const firstRevision = createRevision({
        personaBefore: null,
        personaAfter: happy,
        sequence: 1,
        sourceAnchor: { type: 'latest-pair', assistantMessageId: '3', assistantSwipeId: 0 },
    });
    const activeRevision = createRevision({
        personaBefore: happy,
        personaAfter: tired,
        sequence: 2,
        sourceAnchor: { type: 'latest-pair', assistantMessageId: '5', assistantSwipeId: 0 },
    });
    const alternateSwipeRevision = createRevision({
        personaBefore: happy,
        personaAfter: sad,
        sequence: 3,
        sourceAnchor: { type: 'latest-pair', assistantMessageId: '5', assistantSwipeId: 1 },
    });
    const checkpoints = [
        createCheckpoint({ persona: happy, revision: firstRevision, sourceAnchor: firstRevision.sourceAnchor }),
        createCheckpoint({ persona: tired, revision: activeRevision, sourceAnchor: activeRevision.sourceAnchor }),
        createCheckpoint({ persona: sad, revision: alternateSwipeRevision, sourceAnchor: alternateSwipeRevision.sourceAnchor }),
    ];

    const checkpoint = findPreviousCheckpointBeforeAnchor(
        checkpoints,
        { type: 'latest-pair', assistantMessageId: '5', assistantSwipeId: 0 },
        tired,
    );

    assert.equal(checkpoint.sequence, 1);
    assert.equal(checkpoint.persona.personality.temporaryMood, 'Happy');
});

test('nearest checkpoint ignores origin branch checkpoints that do not match active chat content', () => {
    const root = createBlankPersona({ name: 'Root branch state' });
    const origin = createBlankPersona({ name: 'Origin branch state' });
    const current = createBlankPersona({ name: 'Current branch state' });
    const originChat = [
        { is_user: true, mes: 'Opening state' },
        { is_user: false, mes: 'Opening response', swipe_id: 0 },
        { is_user: true, mes: 'Shared user update' },
        { is_user: false, mes: 'Shared assistant update', swipe_id: 0 },
        { is_user: true, mes: 'Origin-only user update' },
        { is_user: false, mes: 'Origin-only assistant update', swipe_id: 0 },
        { is_user: true, mes: 'Origin continuation' },
        { is_user: false, mes: 'Origin continuation response', swipe_id: 0 },
    ];
    const branchChat = [
        ...originChat.slice(0, 4),
        { is_user: true, mes: 'Branch-only user update' },
        { is_user: false, mes: 'Branch-only assistant update', swipe_id: 0 },
        { is_user: true, mes: 'Branch continuation' },
        { is_user: false, mes: 'Branch continuation response', swipe_id: 0 },
    ];
    const rootRevision = createRevision({
        personaBefore: null,
        personaAfter: root,
        sequence: 1,
        sourceAnchor: createPairAnchor(originChat, 2, 3),
    });
    const originRevision = createRevision({
        personaBefore: root,
        personaAfter: origin,
        sequence: 2,
        sourceAnchor: createPairAnchor(originChat, 4, 5),
    });
    const checkpoints = [
        createCheckpoint({ persona: root, revision: rootRevision, sourceAnchor: rootRevision.sourceAnchor }),
        createCheckpoint({ persona: origin, revision: originRevision, sourceAnchor: originRevision.sourceAnchor }),
    ];

    const originCheckpoint = findNearestCheckpointForAnchor(
        checkpoints,
        createPairAnchor(originChat, 6, 7),
        current,
        originChat,
    );
    assert.equal(originCheckpoint.sequence, 2);

    const branchCheckpoint = findNearestCheckpointForAnchor(
        checkpoints,
        createPairAnchor(branchChat, 6, 7),
        current,
        branchChat,
    );
    assert.equal(branchCheckpoint.sequence, 1);
});
