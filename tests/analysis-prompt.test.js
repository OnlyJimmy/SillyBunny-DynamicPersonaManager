import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysisPrompt } from '../src/analysis/prompt-builder.js';
import { checkAnalysisContext } from '../src/analysis/context-limit.js';
import { createBlankPersona } from '../src/state/defaults.js';
import { COLLECTION_FIELDS } from '../src/constants.js';
import { analysePair } from '../src/analysis/analyser.js';
import { simulateOperations } from '../src/operations/apply.js';

const pair = { userIndex: 0, assistantIndex: 1, userText: 'I read the gate schedule.', assistantText: 'You learn the gate opens at dawn.' };
const snapshotFrom = prompt => JSON.parse(prompt.split('Current canonical persona (JSON snapshot for paths and oldValue):\n')[1].split('\n\nLocks')[0]);

test('blank persona receives all section templates before state and messages, including with custom instructions', () => {
    const persona = createBlankPersona();
    const prompt = buildAnalysisPrompt({ persona, pair, customPrompt: 'Focus on discoveries.' });
    for (const section of COLLECTION_FIELDS) {
        assert.ok(prompt.includes(`/${section}/{index}/field`), section);
        assert.deepEqual(snapshotFrom(prompt)[section], []);
    }
    for (const section of ['identity', 'appearance', 'personality']) assert.ok(prompt.includes(`/${section}/field`));
    assert.match(prompt, /"certainty":"known\|suspected\|rumoured\|uncertain\|false"/);
    assert.match(prompt, /Focus on discoveries/);
    assert.match(prompt, /Every operation needs a short exact evidence/);
    assert.ok(prompt.indexOf('Section formatting templates') < prompt.indexOf('Current canonical persona'));
    assert.ok(prompt.indexOf('Current canonical persona') < prompt.indexOf('Latest user message'));
});

test('analysis snapshot preserves hidden entry indices and omits nested hidden values and disabled custom data', () => {
    const persona = createBlankPersona();
    persona.identity.species = 'SECRET_SPECIES';
    persona.knowledge = [
        { id: 'hidden', subject: 'SECRET_ENTRY', fact: 'SECRET_FACT' },
        { id: 'visible', subject: 'Gate', fact: 'SECRET_NESTED', certainty: 'known' },
    ];
    persona.customSections = [{ id: 'custom', analysisEnabled: false, entries: ['SECRET_CUSTOM'] }];
    persona.locks = [
        { path: '/identity/species', mode: 'analysisHidden' },
        { path: '/knowledge/hidden', mode: 'analysisHidden' },
        { path: '/knowledge/visible/fact', mode: 'analysisHidden' },
    ];
    const prompt = buildAnalysisPrompt({ persona, pair });
    const snapshot = snapshotFrom(prompt);
    assert.doesNotMatch(prompt, /SECRET_/);
    assert.equal(snapshot.knowledge[0], null);
    assert.equal(snapshot.knowledge[1].subject, 'Gate');
    assert.equal(snapshot.knowledge[1].fact, undefined);
    assert.equal(snapshot.customSections[0], null);
    assert.equal(persona.knowledge[1].fact, 'SECRET_NESTED');
});

test('analysis includes full existing state even when roleplay prompt settings hide completed entries or restrict tokens', () => {
    const persona = createBlankPersona();
    persona.quests = [{ id: 'quest', title: 'Gate access', status: 'completed' }];
    persona.promptSettings.maximumTokens = 1;
    const snapshot = snapshotFrom(buildAnalysisPrompt({ persona, pair }));
    assert.equal(snapshot.quests[0].status, 'completed');
});

test('knowledge addition from analysis validates and applies to an empty section', async () => {
    const persona = createBlankPersona();
    const result = await analysePair({
        context: {}, persona, pair, fingerprint: 'dpm_knowledge',
        generateRaw: async ({ prompt }) => {
            assert.deepEqual(snapshotFrom(prompt).knowledge, []);
            return JSON.stringify({ proposalVersion: 1, summary: 'Learned schedule', operations: [{
                type: 'add', path: '/knowledge', value: { subject: 'Gate', fact: 'Opens at dawn.', certainty: 'known' },
                evidence: 'You learn the gate opens at dawn.', confidence: 0.9,
            }] });
        },
    });
    assert.deepEqual(result.warnings, []);
    const next = simulateOperations(persona, result.proposal.operations).persona;
    assert.equal(next.knowledge[0].fact, 'Opens at dawn.');
    assert.ok(next.knowledge[0].id);
    assert.deepEqual(persona.knowledge, []);
});

test('context limit preserves complete requests or fails before sending truncated instructions', () => {
    assert.equal(checkAnalysisContext('x'.repeat(4000), 1000).length, 4000);
    assert.throws(() => checkAnalysisContext('x'.repeat(4001), 1000), /Increase the Analysis context limit.*1001/);
    assert.doesNotThrow(() => checkAnalysisContext(buildAnalysisPrompt({ persona: createBlankPersona(), pair })));
});
