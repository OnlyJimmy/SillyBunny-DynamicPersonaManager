import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { runTimedRequest } from '../src/analysis/request-timeout.js';
import { checkAnalysisContext } from '../src/analysis/context-limit.js';
import { describeDebugError } from '../src/analysis/debug-log.js';
import { generateParsedAnalysis } from '../src/analysis/analyser.js';

function fakeTimers() {
    const timeouts = new Map();
    const intervals = new Map();
    let id = 0;
    return {
        timeouts, intervals,
        setTimeout(fn) { timeouts.set(++id, fn); return id; },
        clearTimeout(key) { timeouts.delete(key); },
        setInterval(fn) { intervals.set(++id, fn); return id; },
        clearInterval(key) { intervals.delete(key); },
        expire() { for (const fn of [...timeouts.values()]) fn(); },
        heartbeat() { for (const fn of [...intervals.values()]) fn(); },
    };
}

test('a hung provider times out, receives abort, and cleans up all timers', async () => {
    const timers = fakeTimers();
    let providerSignal;
    let elapsed = 0;
    const progress = [];
    const result = runTimedRequest({
        request: signal => { providerSignal = signal; return new Promise(() => {}); },
        timeoutMs: 180000, timers, now: () => elapsed,
        onProgress: details => progress.push(details),
    });
    await Promise.resolve();
    elapsed = 15000;
    timers.heartbeat();
    assert.equal(progress[0].durationMs, 15000);
    timers.expire();
    await assert.rejects(result, { name: 'TimeoutError' });
    assert.equal(providerSignal.aborted, true);
    assert.equal(timers.timeouts.size + timers.intervals.size, 0);
});

test('cancellation settles even when a provider ignores abort; late results are discarded', async () => {
    const timers = fakeTimers();
    const controller = new AbortController();
    let finish;
    const result = runTimedRequest({ request: () => new Promise(resolve => { finish = resolve; }), signal: controller.signal, timeoutMs: 180000, timers });
    await Promise.resolve();
    controller.abort();
    await assert.rejects(result, { name: 'AbortError' });
    finish('late response');
    await Promise.resolve();
    assert.equal(timers.timeouts.size + timers.intervals.size, 0);
});

test('late provider rejection after timeout is consumed', async () => {
    const timers = fakeTimers();
    let rejectProvider;
    const result = runTimedRequest({ request: () => new Promise((resolve, reject) => { rejectProvider = reject; }), timeoutMs: 180000, timers });
    await Promise.resolve();
    timers.expire();
    await assert.rejects(result, { name: 'TimeoutError' });
    rejectProvider(new Error('late error'));
    await new Promise(resolve => setImmediate(resolve));
});

test('successful requests preserve responses and remove timers; pre-aborted requests never start', async () => {
    const timers = fakeTimers();
    assert.equal(await runTimedRequest({ request: async () => 'response', timeoutMs: 180000, timers }), 'response');
    assert.equal(timers.timeouts.size + timers.intervals.size, 0);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(runTimedRequest({ request: () => assert.fail('must not start'), signal: controller.signal, timeoutMs: 180000, timers }), { name: 'AbortError' });
});

test('both actual DPM request routes release operation state on timeout', async () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const requestFunction = source.slice(source.indexOf('async function generateDpmRaw('), source.indexOf('function refreshPromptInjection('));
    for (const dedicated of [true, false]) {
        const timers = fakeTimers();
        const entries = [];
        let active = 0;
        const scope = {
            AbortController, checkAnalysisContext, describeDebugError,
            beginDpmOperation: () => active++, endDpmOperation: () => active--,
            getSelectedAnalysisProfile: () => dedicated ? { id: 'profile' } : null,
            getSettings: () => ({ requestTimeoutSeconds: 180, analysisContextLimit: 6000 }),
            getContext: () => ({ generateRaw: () => new Promise(() => {}) }),
            ConnectionManagerRequestService: { sendRequest: () => new Promise(() => {}) },
            runTimedRequest: options => runTimedRequest({ ...options, timers }),
            recordDebug: (event, details) => entries.push({ event, details }),
        };
        vm.createContext(scope);
        vm.runInContext(`let debugRequestId = 0; const dpmRequestControllers = new Set(); ${requestFunction}`, scope);
        const result = scope.generateDpmRaw({ prompt: 'test', responseLength: 800 });
        await Promise.resolve();
        assert.equal(active, 1);
        timers.expire();
        await assert.rejects(result, { name: 'TimeoutError' });
        assert.equal(active, 0);
        assert.equal(entries.at(-1).details.errorKind, 'request-timeout');
        assert.equal(vm.runInContext('dpmRequestControllers.size', scope), 0);
    }
});

test('provider timeouts do not consume malformed-response retries or start extra requests', async () => {
    let calls = 0;
    await assert.rejects(generateParsedAnalysis({
        prompt: 'test', retryLimit: 5,
        generate: async () => { calls++; throw Object.assign(new Error('Timed out'), { name: 'TimeoutError' }); },
    }), { name: 'TimeoutError' });
    assert.equal(calls, 1);
});
