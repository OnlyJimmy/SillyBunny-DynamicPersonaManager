import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseManualInstruction, buildManualInstructionPrompt } from '../src/analysis/manual-instruction.js';
import { createBlankPersona } from '../src/state/defaults.js';
import { LOCK_MODES } from '../src/state/locks.js';

test('manual instruction prompt includes instruction and current persona', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.inventory.push({ id: 'item_1', name: 'Torch', quantity: 3 });
    persona.relationships.push({ id: 'rel_1', entityName: 'Mary', trust: 25 });
    const prompt = buildManualInstructionPrompt({
        persona,
        instruction: 'Use one torch',
    });

    assert.match(prompt, /manual editor/);
    assert.match(prompt, /Name: Ren/);
    assert.match(prompt, /Use one torch/);
    assert.match(prompt, /Exact JSON snapshot/);
    assert.match(prompt, /"name": "Torch"/);
    assert.match(prompt, /\/inventory\/2\/quantity/);
    assert.match(prompt, /\/relationships\/1\/trust/);
});

test('manual instruction analysis accepts operations without chat evidence', async () => {
    const persona = createBlankPersona({ name: 'Ren' });
    const result = await analyseManualInstruction({
        context: {},
        persona,
        instruction: 'Add two gold pieces',
        generateRaw: async () => JSON.stringify({
            proposalVersion: 1,
            summary: 'Add gold pieces',
            operations: [{
                type: 'add',
                path: '/inventory',
                value: { name: 'Gold piece', quantity: 2 },
                confidence: 1,
            }],
        }),
    });

    assert.equal(result.proposal.operations.length, 1);
    assert.equal(result.proposal.source.type, 'manual-instruction');
    assert.equal(result.proposal.operations[0].path, '/inventory');
});

test('manual instruction analysis still respects proposal locks', async () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.locks.push({ id: 'lock_1', path: '/inventory', mode: LOCK_MODES.proposalLocked });

    const result = await analyseManualInstruction({
        context: {},
        persona,
        instruction: 'Add two gold pieces',
        generateRaw: async () => JSON.stringify({
            proposalVersion: 1,
            summary: 'Add gold pieces',
            operations: [{
                type: 'add',
                path: '/inventory',
                value: { name: 'Gold piece', quantity: 2 },
                confidence: 1,
            }],
        }),
    });

    assert.equal(result.proposal, null);
    assert.equal(result.lockedSkippedCount, 1);
});

test('manual instruction analysis accepts existing quantity reductions', async () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.inventory.push({ id: 'item_1', name: 'Torch', quantity: 3 });

    const result = await analyseManualInstruction({
        context: {},
        persona,
        instruction: 'Use one torch',
        generateRaw: async () => JSON.stringify({
            proposalVersion: 1,
            summary: 'Use one torch',
            operations: [{
                type: 'set',
                path: '/inventory/0/quantity',
                oldValue: 3,
                value: 2,
                confidence: 1,
            }],
        }),
    });

    assert.equal(result.proposal.operations.length, 1);
    assert.equal(result.proposal.operations[0].type, 'set');
    assert.equal(result.proposal.operations[0].path, '/inventory/0/quantity');
    assert.equal(result.proposal.operations[0].value, 2);
});
