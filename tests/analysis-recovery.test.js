import test from 'node:test';
import assert from 'node:assert/strict';
import { generateParsedAnalysis } from '../src/analysis/analyser.js';
import { createMalformedResponseRecord, recoverAnalysisResponse } from '../src/analysis/recovery.js';
import { createBlankPersona } from '../src/state/defaults.js';
import { parseAnalysisResponse } from '../src/analysis/response-parser.js';
import { findLatestCompletedPair } from '../src/analysis/fingerprints.js';

function fixture() {
    const persona = createBlankPersona();
    const chat = [{ is_user: true, mes: 'I feel alert.' }, { is_user: false, mes: 'You feel alert.' }];
    const record = createMalformedResponseRecord({ persona, pair: findLatestCompletedPair(chat), attempts: [{ attempt: 1, rawResponse: '{broken', error: 'Invalid JSON' }] });
    const text = JSON.stringify({ proposalVersion: 1, summary: 'Alert', operations: [{ type: 'set', path: '/summary', oldValue: '', value: 'Alert.', evidence: 'You feel alert.', confidence: 0.9 }] });
    return { persona, chat, record, text };
}

test('failed generation retains each exact raw attempt and requires JSON on every request', async () => {
    const rawResponses = ['not JSON', '{"proposalVersion":1,"operations":['];
    let count = 0;
    await assert.rejects(() => generateParsedAnalysis({
        prompt: 'Inspect the messages.', responseLength: 800, retryLimit: 1,
        generate: async ({ prompt }) => {
            assert.match(prompt, /Return ONLY one complete, valid JSON object/);
            assert.match(prompt, /Escape double quotes, backslashes, and line breaks/);
            return rawResponses[count++];
        },
    }), error => {
        assert.deepEqual(error.malformedResponses.map(attempt => attempt.rawResponse), rawResponses);
        assert.deepEqual(error.malformedResponses.map(attempt => attempt.attempt), [1, 2]);
        assert.match(error.malformedResponses[1].error, /not valid JSON/);
        return true;
    });
});

test('successful retry retains the malformed response for inspection', async () => {
    let count = 0;
    const result = await generateParsedAnalysis({ prompt: 'Analyse.', retryLimit: 1, generate: async () => ++count === 1 ? 'broken' : '{"proposalVersion":1,"operations":[]}' });
    assert.equal(result.malformedResponses[0].rawResponse, 'broken');
    assert.deepEqual(result.parsedResponse.operations, []);
});

test('corrected JSON creates pending operations without mutating persona', () => {
    const input = fixture();
    const result = recoverAnalysisResponse(input);
    assert.equal(result.proposal.operations[0].status, 'pending');
    assert.equal(result.proposal.source.type, 'latest-pair');
    assert.equal(input.persona.summary, '');
});

test('recovery rejects invalid JSON and invalid evidence', () => {
    const input = fixture();
    assert.throws(() => recoverAnalysisResponse({ ...input, text: '{' }), /not valid JSON/);
    const result = recoverAnalysisResponse({ ...input, text: input.text.replace('You feel alert.', 'Invented evidence.') });
    assert.equal(result.proposal, null);
    assert.match(result.warnings[0].message, /evidence/i);
});

test('recovery preserves lock and confidence checks', () => {
    const input = fixture();
    const low = recoverAnalysisResponse({ ...input, text: input.text.replace('0.9', '0.1') });
    assert.equal(low.proposal, null);
    input.persona.locks.push({ id: 'lock', path: '/summary', mode: 'immutable' });
    input.record = createMalformedResponseRecord({ persona: input.persona, pair: findLatestCompletedPair(input.chat), attempts: [] });
    const locked = recoverAnalysisResponse(input);
    assert.equal(locked.proposal, null);
    assert.equal(locked.lockedSkippedCount, 1);
});

test('recovery rejects changed persona, changed messages/swipes, and already handled records', () => {
    const input = fixture();
    input.persona.summary = 'Changed';
    assert.throws(() => recoverAnalysisResponse(input), /persona has changed/);
    input.persona.summary = '';
    input.chat[1].swipe_id = 1;
    assert.throws(() => recoverAnalysisResponse(input), /messages or active swipe have changed/);
    input.chat[1].swipe_id = 0;
    input.chat[1].mes = 'Edited';
    assert.throws(() => recoverAnalysisResponse(input), /messages or active swipe have changed/);
    input.record.handled = true;
    assert.throws(() => recoverAnalysisResponse(input), /already been handled/);
});

test('trailing comma repair preserves commas and escaped quotes inside string values', () => {
    const summary = 'Keep ,} and ,] and "quoted" text unchanged.';
    const raw = `{"proposalVersion":1,"summary":${JSON.stringify(summary)},"operations":[],}`;
    assert.equal(parseAnalysisResponse(raw).summary, summary);
});
