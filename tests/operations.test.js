import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankPersona } from '../src/state/defaults.js';
import { applyOperation, simulateOperations } from '../src/operations/apply.js';
import { createProposal } from '../src/operations/proposals.js';
import { createPersonaDiffOperations } from '../src/operations/diff.js';
import { createInverseOperation } from '../src/operations/inverse.js';
import { normalizeOperation } from '../src/operations/normalize.js';
import { annotateOperationConflicts, operationHasConflicts } from '../src/operations/conflicts.js';

test('set operation updates editable scalar path', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    applyOperation(persona, { type: 'set', path: '/identity/species', value: 'Human' });
    assert.equal(persona.identity.species, 'Human');
});

test('operation rejects protected persona identity paths', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    assert.throws(() => applyOperation(persona, { type: 'set', path: '/personaId', value: 'bad' }), /protected path/);
});

test('operation rejects stale old value', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.identity.species = 'Human';
    assert.throws(
        () => applyOperation(persona, { type: 'set', path: '/identity/species', oldValue: 'Elf', value: 'Human' }),
        /stale/,
    );
});

test('add operation inserts a collection entry with a stable id', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    applyOperation(persona, { type: 'add', path: '/inventory', value: { name: 'Iron key', quantity: 1 } });
    assert.equal(persona.inventory.length, 1);
    assert.equal(persona.inventory[0].name, 'Iron key');
    assert.match(persona.inventory[0].id, /^item_/);
});

test('relationship add operation maps common aliases to editable fields', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    applyOperation(persona, {
        type: 'add',
        path: '/relationships',
        value: {
            name: 'Dain',
            relationship: 'trusted ally',
            disposition: 'warm',
            status: 'travelling companion',
            notes: 'Saved Ren from an ambush.',
        },
    });

    assert.equal(persona.relationships.length, 1);
    assert.equal(persona.relationships[0].entityName, 'Dain');
    assert.equal(persona.relationships[0].summary, 'trusted ally');
    assert.equal(persona.relationships[0].attitude, 'warm');
    assert.deepEqual(persona.relationships[0].statusTags, ['travelling companion']);
    assert.deepEqual(persona.relationships[0].notes, ['Saved Ren from an ambush.']);
});

test('remove operation removes array entries by index', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.inventory.push({ id: 'item_1', name: 'Iron key', quantity: 1 });
    applyOperation(persona, { type: 'remove', path: '/inventory/0' });
    assert.equal(persona.inventory.length, 0);
});

test('inverse operation reverts a set operation', () => {
    const before = createBlankPersona();
    before.identity.species = 'Elf';
    const after = createBlankPersona();
    after.identity.species = 'Human';
    const inverse = createInverseOperation({ type: 'set', path: '/identity/species', value: 'Human' }, before, after);

    applyOperation(after, inverse, { source: 'manual' });

    assert.equal(after.identity.species, 'Elf');
});

test('inverse operation reverts an appended add operation', () => {
    const before = createBlankPersona();
    const after = createBlankPersona();
    after.inventory.push({ id: 'item_1', name: 'Iron key', quantity: 1 });
    const inverse = createInverseOperation({ type: 'add', path: '/inventory', value: { name: 'Iron key', quantity: 1 } }, before, after);

    applyOperation(after, inverse, { source: 'manual' });

    assert.equal(after.inventory.length, 0);
});

test('simulation leaves original persona untouched', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    const result = simulateOperations(persona, [{ type: 'set', path: '/summary', value: 'A mapmaker.' }]);
    assert.equal(persona.summary, '');
    assert.equal(result.persona.summary, 'A mapmaker.');
});

test('persona diff operations capture editable snapshot changes only', () => {
    const before = createBlankPersona({ name: 'Before' });
    const after = createBlankPersona({ name: 'After' });
    after.personaId = 'different_persona_id';
    after.summary = 'Imported summary.';
    after.inventory.push({ id: 'item_1', name: 'Iron key', quantity: 1 });

    const operations = createPersonaDiffOperations(before, after);

    assert.deepEqual(operations.map(operation => operation.path).sort(), ['/inventory', '/name', '/summary']);
    assert.equal(operations.some(operation => operation.path === '/personaId'), false);
});

test('persona diff operations can be inverted for manual import revert', () => {
    const before = createBlankPersona({ name: 'Before' });
    before.summary = 'Original summary.';
    const after = createBlankPersona({ name: 'After' });
    after.summary = 'Imported summary.';

    const operations = createPersonaDiffOperations(before, after);
    const result = simulateOperations(before, operations, { source: 'manual' });
    const inverse = operations.map(operation => createInverseOperation(operation, before, result.persona)).reverse();
    const reverted = simulateOperations(result.persona, inverse, { source: 'manual' });

    assert.equal(reverted.persona.name, 'Before');
    assert.equal(reverted.persona.summary, 'Original summary.');
});

test('proposal wraps normalized pending operations', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    const proposal = createProposal({
        personaId: persona.personaId,
        summary: 'Update species',
        operations: [{ type: 'set', path: '/identity/species', value: 'Human' }],
    });
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.operations[0].status, 'pending');
    assert.match(proposal.proposalId, /^proposal_/);
});

test('operation normalization preserves transaction metadata', () => {
    const operation = normalizeOperation({
        type: 'set',
        path: '/summary',
        value: 'A careful scout.',
        transactionId: 'txn-alertness',
        transactionLabel: 'Alertness update',
    });

    assert.equal(operation.transactionId, 'txn-alertness');
    assert.equal(operation.transactionLabel, 'Alertness update');
});

test('operation normalization preserves review metadata', () => {
    const operation = normalizeOperation({
        type: 'add',
        path: '/inventory',
        value: { name: 'Iron key' },
        category: 'inventory',
        targetLabel: 'Iron key',
        changeType: 'acquisition',
        severity: 'normal',
        sourceMessageRole: 'assistant',
        sourceMessageId: '4',
        sourceSwipeId: 2,
        validationWarnings: ['Needs attention'],
        tags: ['loot'],
    });

    assert.equal(operation.category, 'inventory');
    assert.equal(operation.targetLabel, 'Iron key');
    assert.equal(operation.changeType, 'acquisition');
    assert.equal(operation.severity, 'normal');
    assert.equal(operation.sourceMessageRole, 'assistant');
    assert.equal(operation.sourceMessageId, '4');
    assert.equal(operation.sourceSwipeId, 2);
    assert.deepEqual(operation.validationWarnings, ['Needs attention']);
    assert.deepEqual(operation.tags, ['loot']);
});

test('conflict annotation flags overlapping pending paths', () => {
    const proposals = annotateOperationConflicts([
        createProposal({
            personaId: 'persona_1',
            summary: 'Set summary',
            operations: [{ type: 'set', path: '/summary', value: 'Calm.' }],
        }),
        createProposal({
            personaId: 'persona_1',
            summary: 'Replace identity',
            operations: [{ type: 'set', path: '/identity/species', value: 'Human' }],
        }),
        createProposal({
            personaId: 'persona_1',
            summary: 'Replace identity branch',
            operations: [{ type: 'set', path: '/identity', value: { species: 'Elf' } }],
        }),
    ]);

    assert.equal(operationHasConflicts(proposals[0].operations[0]), false);
    assert.equal(operationHasConflicts(proposals[1].operations[0]), true);
    assert.equal(operationHasConflicts(proposals[2].operations[0]), true);
});

test('conflict annotation treats same-proposal transactions as one unit', () => {
    const proposal = createProposal({
        personaId: 'persona_1',
        summary: 'Grouped identity update',
        operations: [
            {
                type: 'set',
                path: '/identity/species',
                value: 'Human',
                transactionId: 'txn-identity',
            },
            {
                type: 'set',
                path: '/identity',
                value: { species: 'Human' },
                transactionId: 'txn-identity',
            },
        ],
    });

    annotateOperationConflicts([proposal]);

    assert.equal(operationHasConflicts(proposal.operations[0]), false);
    assert.equal(operationHasConflicts(proposal.operations[1]), false);
});

test('conflict annotation does not merge transactions across proposals', () => {
    const proposals = annotateOperationConflicts([
        createProposal({
            personaId: 'persona_1',
            summary: 'First grouped update',
            operations: [{ type: 'set', path: '/summary', value: 'Calm.', transactionId: 'txn-shared' }],
        }),
        createProposal({
            personaId: 'persona_1',
            summary: 'Second grouped update',
            operations: [{ type: 'set', path: '/summary', value: 'Alert.', transactionId: 'txn-shared' }],
        }),
    ]);

    assert.equal(operationHasConflicts(proposals[0].operations[0]), true);
    assert.equal(operationHasConflicts(proposals[1].operations[0]), true);
});
