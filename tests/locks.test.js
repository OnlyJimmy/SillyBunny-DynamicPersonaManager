import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysisPrompt } from '../src/analysis/prompt-builder.js';
import { applyOperation, simulateOperations } from '../src/operations/apply.js';
import { renderCompactPrompt } from '../src/prompting/renderer.js';
import { createBlankPersona } from '../src/state/defaults.js';
import { LOCK_MODES, getLocksForPath, pathContains } from '../src/state/locks.js';
import { validatePersona } from '../src/state/schema.js';

test('lock path matching inherits from parent paths', () => {
    assert.equal(pathContains('/identity', '/identity/species'), true);
    assert.equal(pathContains('/identity/species', '/identity/species'), true);
    assert.equal(pathContains('/identity/species', '/identity/gender'), false);
});

test('proposal locks block analyser operations', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.locks.push({ id: 'lock_1', path: '/identity', mode: LOCK_MODES.proposalLocked });

    assert.throws(
        () => simulateOperations(persona, [{ type: 'set', path: '/identity/species', value: 'Human' }]),
        /proposalLocked lock/,
    );
});

test('immutable locks block operation application', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.locks.push({ id: 'lock_1', path: '/summary', mode: LOCK_MODES.immutable });

    assert.throws(
        () => applyOperation(persona, { type: 'set', path: '/summary', value: 'Locked summary' }),
        /immutable lock/,
    );
});

test('locks can be queried for descendant paths', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.locks.push({ id: 'lock_1', path: '/inventory/0', mode: LOCK_MODES.promptHidden });

    assert.equal(getLocksForPath(persona, '/inventory/0/name', [LOCK_MODES.promptHidden]).length, 1);
});

test('promptHidden locks omit values from prompt rendering', () => {
    const persona = createBlankPersona({ name: 'Ren', summary: 'Secret summary' });
    persona.identity.species = 'Human';
    persona.locks.push({ id: 'lock_1', path: '/identity/species', mode: LOCK_MODES.promptHidden });
    persona.locks.push({ id: 'lock_2', path: '/summary', mode: LOCK_MODES.promptHidden });

    const prompt = renderCompactPrompt(persona);
    assert.doesNotMatch(prompt, /Species/);
    assert.doesNotMatch(prompt, /Secret summary/);
});

test('analysisHidden locks omit values from analyser prompt only', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.identity.species = 'Human';
    persona.locks.push({ id: 'lock_1', path: '/identity/species', mode: LOCK_MODES.analysisHidden });

    const prompt = buildAnalysisPrompt({
        persona,
        pair: { userIndex: 0, assistantIndex: 1, userText: 'User', assistantText: 'Assistant' },
    });

    assert.doesNotMatch(prompt, /Species/);
    assert.match(renderCompactPrompt(persona), /Species: Human/);
});

test('schema rejects malformed locks', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.locks.push({ id: '', path: 'identity/species', mode: 'badMode' });

    const result = validatePersona(persona);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /locks\[0\]/);
});
