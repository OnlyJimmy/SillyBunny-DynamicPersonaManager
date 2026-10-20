import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createAnalysisRunGuard, hasAttemptedPair, isAuxiliaryGeneration } from '../src/analysis/run-guard.js';
import { createBlankPersona, createDefaultChatState } from '../src/state/defaults.js';
import { findLatestCompletedPair, fingerprintPair, hasAnalysedFingerprint, rememberAnalysedFingerprint } from '../src/analysis/fingerprints.js';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

// Exercise the extension's actual event handlers and run function without host UI imports.
function harness(generate) {
    const state = createDefaultChatState();
    state.enabled = true;
    state.persona = createBlankPersona();
    const handlers = {};
    const timers = new Map();
    let nextTimer = 0;
    const context = {
        chatMetadata: {},
        chat: [{ is_user: true, mes: 'I feel alert.' }, { is_user: false, mes: 'You feel alert.' }],
        eventTypes: Object.fromEntries(['CHAT_CHANGED', 'CHAT_LOADED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_RECEIVED', 'MESSAGE_DELETED', 'MESSAGE_SWIPE_DELETED'].map(key => [key, key])),
        eventSource: { on: (name, handler) => { handlers[name] = handler; } },
    };
    const scope = {
        createAnalysisRunGuard, hasAttemptedPair, isAuxiliaryGeneration,
        findLatestCompletedPair, fingerprintPair, hasAnalysedFingerprint, rememberAnalysedFingerprint,
        cloneJson: structuredClone,
        recordDebug: () => {}, describeDebugError: () => ({}),
        getContext: () => context,
        getSettings: () => ({ failurePauseThreshold: 3 }),
        readChatState: () => ({ state }), writeChatState: () => {},
        analysePair: () => generate(handlers), generateDpmRaw: () => {},
        refreshHandleState: () => {}, refreshPromptInjection: () => {}, renderPanel: () => {},
        syncPersonaToActiveBranch: () => {}, ensureChatState: () => {},
        syncPersonaToPreviousPairCheckpoint: () => {}, notify: () => {},
        setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout: id => timers.delete(id), AbortController,
    };
    vm.createContext(scope);
    vm.runInContext(`
        let analysisRunId = 0, analysisAbortController = null, scheduledAnalysisTimer = null;
        let activeDpmOperationCount = 0, panelOpen = false, queuedAnalysisChat = null;
        const analysisRunGuard = createAnalysisRunGuard();
        ${between('function clearLatestPairAnalysisMemory(', 'async function restoreCheckpoint(')}
        ${between('function cancelActiveAnalysis(', 'function cancelAllDpmActions(')}
        ${between('function scheduleLatestPairAnalysis(', 'function exportFileBaseName(')}
        ${between('function bindEvents(', 'function bootstrap(')}
        bindEvents();
    `, scope);
    return { scope, state, handlers, timers, context };
}

test('quiet, auxiliary, and dry-run generation starts leave active analysis intact', () => {
    assert.equal(isAuxiliaryGeneration('quiet'), true);
    assert.equal(isAuxiliaryGeneration('normal', { isAuxiliaryGeneration: true }), true);
    assert.equal(isAuxiliaryGeneration('normal', { cacheScope: 'auxiliary' }), true);
    assert.equal(isAuxiliaryGeneration('normal', {}, true), true);
    assert.equal(isAuxiliaryGeneration('normal'), false);
});

test('self generation events neither invalidate analysis nor schedule an endless retry', async () => {
    let calls = 0;
    const { scope, state, handlers, timers } = harness(async events => {
        calls++;
        events.GENERATION_STARTED('quiet');
        events.GENERATION_ENDED();
        events.MESSAGE_RECEIVED();
        throw new Error('Malformed output');
    });
    await scope.runAnalysisForLatestPair();
    assert.equal(calls, 1);
    assert.equal(state.analysisState.failures, 1);
    assert.equal(state.analysisState.status, 'failed');
    assert.equal(timers.size, 0);
    handlers.GENERATION_ENDED();
    await scope.runAnalysisForLatestPair();
    assert.equal(calls, 1, 'same failed pair is not automatically attempted again');
});

test('overlapping requests cannot replace a running analysis', async () => {
    let finish;
    let calls = 0;
    const { scope, state } = harness(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const first = scope.runAnalysisForLatestPair();
    await scope.runAnalysisForLatestPair();
    assert.equal(calls, 1);
    finish({ proposal: null, warnings: [] });
    await first;
    assert.equal(state.analysisState.status, 'idle');
    await scope.runAnalysisForLatestPair();
    assert.equal(calls, 1);
});

test('explicit scan permits retry after failure and a new pair remains eligible', async () => {
    let calls = 0;
    const { scope, state, context } = harness(async () => { calls++; throw new Error('Failed'); });
    await scope.runAnalysisForLatestPair();
    scope.forceReanalyseLatestPair();
    await scope.runAnalysisForLatestPair();
    assert.equal(calls, 2);
    context.chat.push({ is_user: true, mes: 'Next message.' }, { is_user: false, mes: 'New answer.' });
    await scope.runAnalysisForLatestPair();
    assert.equal(calls, 3);
    assert.equal(state.analysisState.paused, true);
});

test('cancel invalidates a result while keeping its request slot until settlement', async () => {
    let finish;
    const { scope, state } = harness(() => new Promise(resolve => { finish = resolve; }));
    const first = scope.runAnalysisForLatestPair();
    scope.cancelActiveAnalysis();
    await scope.runAnalysisForLatestPair();
    finish({ proposal: null, warnings: [] });
    await first;
    assert.equal(state.analysisState.lastAnalysedFingerprint, '');
    assert.equal(state.analysisState.status, 'idle');
});

test('explicit scan during an active request waits for settlement and then queues one retry', async () => {
    let finish;
    const { scope, state, timers } = harness(() => new Promise(resolve => { finish = resolve; }));
    const first = scope.runAnalysisForLatestPair();
    scope.forceReanalyseLatestPair();
    assert.equal(timers.size, 0);
    finish({ proposal: null, warnings: [] });
    await first;
    assert.equal(timers.size, 1);
    assert.equal(state.analysisState.lastAttemptedFingerprint, '');
});

test('real generation starts clear queued scans while other DPM operations cannot enqueue scans', () => {
    const { scope, timers, handlers } = harness(async () => ({ proposal: null, warnings: [] }));
    handlers.GENERATION_ENDED();
    assert.equal(timers.size, 1);
    handlers.GENERATION_STARTED('normal');
    assert.equal(timers.size, 0);
    vm.runInContext('activeDpmOperationCount = 1;', scope);
    handlers.GENERATION_ENDED();
    handlers.MESSAGE_RECEIVED();
    assert.equal(timers.size, 0);
});
