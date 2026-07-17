import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankPersona } from '../src/state/defaults.js';
import { createCheckpoint, createRevision, findNearestCheckpointForAnchor, findPreviousCheckpointBeforeAnchor } from '../src/state/revisions.js';

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
