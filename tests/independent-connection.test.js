import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeConnectionUrl, buildIndependentRequest, sendIndependentRequest } from '../src/analysis/independent-connection.js';
import { runTimedRequest } from '../src/analysis/request-timeout.js';
import { checkAnalysisContext } from '../src/analysis/context-limit.js';
import { createDebugLog, describeDebugError } from '../src/analysis/debug-log.js';

const settings = { analysisConnectionMode: 'independent', independentBaseUrl: 'https://provider.example/v1', independentModel: 'analysis-model', analysisProfileId: 'missing-profile' };
const successfulResponse = () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'DPM connection OK' }, finish_reason: 'stop' }] }) });

test('normalizes base URLs and rejects embedded secrets or unsupported schemes', () => {
    assert.equal(normalizeConnectionUrl('https://provider.example/v1/chat/completions/'), 'https://provider.example/v1');
    assert.equal(normalizeConnectionUrl('http://localhost:5000/v1/'), 'http://localhost:5000/v1');
    for (const value of ['garbage', 'file:///tmp/test', 'https://user:password@example.com', 'https://example.com?key=secret', 'https://example.com#fragment']) {
        assert.throws(() => normalizeConnectionUrl(value));
    }
});

test('builds a self-contained request with explicit endpoint, model, auth, prompt, and allowance', () => {
    const payload = buildIndependentRequest({ settings, apiKey: 'secret', prompt: 'test', responseLength: 1200 });
    assert.equal(payload.reverse_proxy, settings.independentBaseUrl);
    assert.equal(payload.proxy_password, 'secret');
    assert.equal(payload.model, 'analysis-model');
    assert.equal(payload.max_tokens, 1200);
    assert.equal(payload.type, 'quiet');
    assert.equal(payload.stream, false);
    assert.equal(payload.cacheScope, 'auxiliary');
    assert.equal(payload.secret_id, undefined);
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'test' }]);
    assert.throws(() => buildIndependentRequest({ settings: { ...settings, independentModel: '' } }), /model ID/);
});

test('sends through the same-origin relay with CSRF headers and the supplied abort signal', async () => {
    const signal = new AbortController().signal;
    const result = await sendIndependentRequest({ settings, apiKey: 'secret', prompt: 'test', signal, headers: { 'X-CSRF-Token': 'csrf' },
        fetchImpl: async (url, options) => {
            assert.equal(url, '/api/backends/chat-completions/generate');
            assert.equal(options.signal, signal);
            assert.equal(options.headers['X-CSRF-Token'], 'csrf');
            assert.equal(JSON.parse(options.body).model, 'analysis-model');
            return successfulResponse();
        },
    });
    assert.equal(result, 'DPM connection OK');
});

test('HTTP errors, invalid HTTP JSON, provider errors, and reasoning-only output remain distinct failures', async () => {
    const cases = [
        [{ ok: false, status: 401 }, /HTTP 401/],
        [{ ok: true, status: 200, json: async () => { throw new Error('not JSON'); } }, /non-JSON HTTP/],
        [{ ok: true, status: 200, json: async () => ({ error: { message: 'secret details' } }) }, /provider returned an error/],
        [{ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '', reasoning_content: 'thinking' }, finish_reason: 'length' }] }) }, /token limit/],
    ];
    for (const [response, pattern] of cases) {
        await assert.rejects(sendIndependentRequest({ settings, fetchImpl: async () => response }), pattern);
    }
});

test('debug metadata preserves status and content counts without API keys or response text', async () => {
    const log = createDebugLog({ isEnabled: () => true });
    await sendIndependentRequest({ settings, apiKey: 'SECRET_KEY', prompt: 'SECRET_PROMPT', fetchImpl: async () => successfulResponse(), onDebug: (event, details) => log.record(event, details) });
    const report = log.report();
    assert.doesNotMatch(report, /SECRET_|provider\.example|DPM connection OK/);
    assert.equal(JSON.parse(report).entries[0].details.httpStatus, 200);
    assert.equal(JSON.parse(report).entries[1].details.finishReason, 'stop');
});

test('actual DPM independent route never looks up a profile or calls current-connection generation', async () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('async function generateDpmRaw('), source.indexOf('function refreshPromptInjection('));
    let active = 0;
    const scope = {
        AbortController, runTimedRequest, checkAnalysisContext, describeDebugError,
        getSettings: () => settings,
        getSelectedAnalysisProfile: () => assert.fail('must not look up a profile'),
        getContext: () => assert.fail('must not access the active connection'),
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf' }),
        sendIndependentRequest: options => sendIndependentRequest({ ...options, fetchImpl: async () => successfulResponse() }),
        beginDpmOperation: () => active++, endDpmOperation: () => active--,
        recordDebug: () => {},
    };
    vm.createContext(scope);
    vm.runInContext(`let debugRequestId = 0; const dpmRequestControllers = new Set(); let independentApiKey = 'secret'; ${fn}`, scope);
    assert.equal(await scope.generateDpmRaw({ prompt: 'test', responseLength: 1000 }), 'DPM connection OK');
    assert.equal(active, 0);
});
