import test from 'node:test';
import assert from 'node:assert/strict';
import { findLatestCompletedPair, fingerprintPair, hasAnalysedFingerprint, rememberAnalysedFingerprint } from '../src/analysis/fingerprints.js';
import { parseAnalysisResponse } from '../src/analysis/response-parser.js';
import { validateOperationEvidence } from '../src/analysis/evidence.js';
import { getProposalSourceState } from '../src/analysis/staleness.js';
import { buildValidatedProposal } from '../src/analysis/validator.js';
import { analysePair } from '../src/analysis/analyser.js';
import { createBlankPersona } from '../src/state/defaults.js';
import { LOCK_MODES } from '../src/state/locks.js';

test('latest completed pair selects final user assistant pair', () => {
    const pair = findLatestCompletedPair([
        { is_user: true, mes: 'hello' },
        { is_user: false, mes: 'hi' },
        { is_user: true, mes: 'I pick up the key.' },
        { is_user: false, mes: 'You pocket the key.' },
    ]);

    assert.equal(pair.userIndex, 2);
    assert.equal(pair.assistantIndex, 3);
    assert.equal(pair.userText, 'I pick up the key.');
    assert.equal(pair.assistantText, 'You pocket the key.');
    assert.match(fingerprintPair(pair), /^dpm_/);
});

test('latest completed pair skips transitional swipe placeholder', () => {
    const pair = findLatestCompletedPair([
        { is_user: true, mes: 'hello' },
        { is_user: false, mes: 'real reply' },
        { is_user: true, mes: 'try again' },
        { is_user: false, mes: '...', swipes: ['old reply'], swipe_id: 1 },
    ]);

    assert.equal(pair.userIndex, 0);
    assert.equal(pair.assistantIndex, 1);
});

test('analysis state remembers multiple analysed fingerprints', () => {
    const state = {};
    rememberAnalysedFingerprint(state, 'dpm_one');
    rememberAnalysedFingerprint(state, 'dpm_two');

    assert.equal(hasAnalysedFingerprint(state, 'dpm_one'), true);
    assert.equal(hasAnalysedFingerprint(state, 'dpm_two'), true);
    assert.equal(hasAnalysedFingerprint(state, 'dpm_three'), false);
    assert.equal(state.lastAnalysedFingerprint, 'dpm_two');
});

test('analysis parser extracts fenced json and repairs trailing commas', () => {
    const parsed = parseAnalysisResponse('Here:\n```json\n{"proposalVersion":1,"summary":"x","operations":[],}\n```');
    assert.equal(parsed.proposalVersion, 1);
    assert.equal(parsed.summary, 'x');
    assert.deepEqual(parsed.operations, []);
});

test('validated proposal keeps valid operations and reports invalid ones', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    const pair = {
        userText: 'I am human.',
        assistantText: 'You are human.',
    };
    const result = buildValidatedProposal({
        persona,
        parsedResponse: {
            proposalVersion: 1,
            summary: 'Mixed response',
            operations: [
                { type: 'set', path: '/identity/species', value: 'Human', evidence: 'You are human.', confidence: 0.9 },
                { type: 'set', path: '/personaId', value: 'bad', evidence: 'You are human.', confidence: 0.9 },
            ],
        },
        source: { fingerprint: 'dpm_test' },
        minimumConfidence: 0.7,
        pair,
    });

    assert.equal(result.proposal.operations.length, 1);
    assert.equal(result.proposal.operations[0].sourceMessageRole, 'assistant');
    assert.equal(result.proposal.operations[0].sourceMessageId, '');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /protected path/);
});

test('validated no-change response returns no proposal', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    const result = buildValidatedProposal({
        persona,
        parsedResponse: { proposalVersion: 1, summary: '', operations: [] },
        source: { fingerprint: 'dpm_test' },
    });

    assert.equal(result.proposal, null);
    assert.deepEqual(result.warnings, []);
});

test('validated proposal counts lock-skipped operations', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.locks.push({ id: 'lock_1', path: '/identity', mode: LOCK_MODES.proposalLocked });
    const result = buildValidatedProposal({
        persona,
        parsedResponse: {
            proposalVersion: 1,
            summary: 'Locked response',
            operations: [
                { type: 'set', path: '/identity/species', value: 'Human', evidence: 'You are human.', confidence: 0.9 },
            ],
        },
        source: { fingerprint: 'dpm_test' },
        pair: {
            userText: 'I am human.',
            assistantText: 'You are human.',
        },
    });

    assert.equal(result.proposal, null);
    assert.equal(result.lockedSkippedCount, 1);
    assert.equal(result.warnings[0].code, 'lockedOperationSkipped');
});

test('evidence validation requires exact source excerpt', () => {
    const pair = {
        userText: 'I pick up the iron key.',
        assistantText: 'You pocket the iron key.',
    };

    assert.equal(validateOperationEvidence({ evidence: 'iron key' }, pair).ok, true);
    assert.equal(validateOperationEvidence({ evidence: 'silver key' }, pair).ok, false);
    assert.equal(validateOperationEvidence({ evidence: '' }, pair).ok, false);
});

test('validated proposal rejects fabricated evidence', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    const result = buildValidatedProposal({
        persona,
        parsedResponse: {
            proposalVersion: 1,
            summary: 'Bad evidence',
            operations: [
                { type: 'set', path: '/identity/species', value: 'Human', evidence: 'Ren is secretly a dragon.', confidence: 0.9 },
            ],
        },
        source: { fingerprint: 'dpm_test' },
        pair: {
            userText: 'I introduce myself.',
            assistantText: 'You give your name as Ren.',
        },
    });

    assert.equal(result.proposal, null);
    assert.match(result.warnings[0].message, /evidence/);
});

test('validated proposal records exact source message metadata', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    const result = buildValidatedProposal({
        persona,
        parsedResponse: {
            proposalVersion: 1,
            summary: 'Source metadata',
            operations: [
                { type: 'set', path: '/summary', value: 'Alert.', evidence: 'I feel alert.', confidence: 0.9 },
                { type: 'set', path: '/identity/species', value: 'Human', evidence: 'You are human.', confidence: 0.9 },
            ],
        },
        source: { fingerprint: 'dpm_source' },
        pair: {
            userIndex: 8,
            assistantIndex: 9,
            assistantSwipeId: 2,
            userText: 'I feel alert.',
            assistantText: 'You are human.',
        },
    });

    assert.equal(result.proposal.operations[0].sourceMessageRole, 'user');
    assert.equal(result.proposal.operations[0].sourceMessageId, '8');
    assert.equal(result.proposal.operations[0].sourceSwipeId, null);
    assert.equal(result.proposal.operations[1].sourceMessageRole, 'assistant');
    assert.equal(result.proposal.operations[1].sourceMessageId, '9');
    assert.equal(result.proposal.operations[1].sourceSwipeId, 2);
});

test('analysis retries malformed model response and keeps warning history', async () => {
    const persona = createBlankPersona({ name: 'Ren' });
    const pair = {
        userIndex: 0,
        assistantIndex: 1,
        assistantSwipeId: 0,
        userText: 'I feel alert.',
        assistantText: 'You feel alert.',
    };
    const responses = [
        'not json',
        JSON.stringify({
            proposalVersion: 1,
            summary: 'Update alertness',
            operations: [
                { type: 'set', path: '/summary', value: 'Feels alert.', evidence: 'You feel alert.', confidence: 0.9 },
            ],
        }),
    ];
    const prompts = [];

    const result = await analysePair({
        context: {},
        persona,
        pair,
        fingerprint: 'dpm_retry',
        settings: { analysisMalformedRetryLimit: 1 },
        generateRaw: async ({ prompt }) => {
            prompts.push(prompt);
            return responses.shift();
        },
    });

    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /previous Dynamic Persona Manager analysis response was malformed/i);
    assert.equal(result.proposal.operations.length, 1);
    assert.deepEqual(result.warnings.map(warning => warning.code).slice(0, 2), [
        'analysisResponseMalformed',
        'analysisResponseRetrySucceeded',
    ]);
});

test('analysis fails after malformed retry limit is exhausted', async () => {
    const persona = createBlankPersona({ name: 'Ren' });
    const pair = {
        userIndex: 0,
        assistantIndex: 1,
        assistantSwipeId: 0,
        userText: 'I feel alert.',
        assistantText: 'You feel alert.',
    };
    let calls = 0;

    await assert.rejects(
        () => analysePair({
            context: {},
            persona,
            pair,
            fingerprint: 'dpm_retry_fail',
            settings: { analysisMalformedRetryLimit: 1 },
            generateRaw: async () => {
                calls += 1;
                return 'still not json';
            },
        }),
        /remained malformed after 2 attempts/,
    );
    assert.equal(calls, 2);
});

test('proposal is active only for the swipe it was generated from', () => {
    const sourcePair = {
        userIndex: 0,
        assistantIndex: 1,
        assistantSwipeId: 2,
        userText: 'User',
        assistantText: 's3',
    };
    const proposal = {
        source: {
            type: 'latest-pair',
            assistantMessageId: '1',
            userMessageId: '0',
            assistantSwipeId: 2,
            fingerprint: fingerprintPair(sourcePair),
        },
    };
    const chat = [
        { is_user: true, mes: 'User' },
        { is_user: false, mes: 'Assistant swipe 3', swipes: ['s1', 's2', 's3'], swipe_id: 2 },
    ];

    assert.deepEqual(getProposalSourceState(chat, proposal), { stale: false, reason: '', code: '' });

    chat[1].swipe_id = 4;
    const stale = getProposalSourceState(chat, proposal);
    assert.equal(stale.stale, true);
    assert.equal(stale.code, 'swipeMismatch');
    assert.match(stale.reason, /swipe 3/);

    chat[1].swipe_id = 2;
    assert.equal(getProposalSourceState(chat, proposal).stale, false);
});

test('proposal becomes stale when source text is edited', () => {
    const pair = {
        userIndex: 0,
        assistantIndex: 1,
        assistantSwipeId: 0,
        userText: 'I feel tired.',
        assistantText: 'You seem tired.',
    };
    const proposal = {
        source: {
            type: 'latest-pair',
            userMessageId: '0',
            assistantMessageId: '1',
            assistantSwipeId: 0,
            fingerprint: fingerprintPair(pair),
        },
    };
    const chat = [
        { is_user: true, mes: 'I feel alert.' },
        { is_user: false, mes: 'You seem tired.', swipe_id: 0 },
    ];

    const stale = getProposalSourceState(chat, proposal);
    assert.equal(stale.stale, true);
    assert.equal(stale.code, 'fingerprintMismatch');
    assert.match(stale.reason, /text has changed/);
});

test('proposal is stale when source assistant message is missing', () => {
    const stale = getProposalSourceState([], {
        source: {
            type: 'latest-pair',
            assistantMessageId: '1',
            assistantSwipeId: 0,
        },
    });
    assert.equal(stale.stale, true);
    assert.equal(stale.code, 'missingAssistant');
    assert.match(stale.reason, /no longer available/);
});
