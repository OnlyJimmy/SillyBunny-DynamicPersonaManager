import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebugLog, describeDebugError } from '../src/analysis/debug-log.js';
import { generateParsedAnalysis } from '../src/analysis/analyser.js';

function storage() {
    const values = new Map();
    return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}

test('debug logging is opt-in, bounded, persisted across reload, and clearable', () => {
    const saved = storage();
    let enabled = false;
    const log = createDebugLog({ isEnabled: () => enabled, storage: saved, limit: 2 });
    log.record('request.started', { requestId: 1 });
    assert.equal(JSON.parse(log.report()).entries.length, 0);
    enabled = true;
    for (let requestId = 1; requestId <= 3; requestId++) log.record('request.started', { requestId });
    const reloaded = createDebugLog({ isEnabled: () => enabled, storage: saved, limit: 2 });
    assert.deepEqual(JSON.parse(reloaded.report()).entries.map(entry => entry.details.requestId), [2, 3]);
    enabled = false;
    reloaded.record('request.completed');
    assert.equal(JSON.parse(reloaded.report()).entries.length, 2);
    reloaded.clear();
    assert.equal(JSON.parse(createDebugLog({ isEnabled: () => true, storage: saved }).report()).entries.length, 0);
});

test('reports omit unapproved content and arbitrary exception text', () => {
    const log = createDebugLog({ isEnabled: () => true });
    const error = new Error('JSON parse failed for SECRET_TEXT https://secret.example?token=SECRET_TOKEN at position 1300 (line 1 column 1301)');
    log.record('response.invalid', { ...describeDebugError(error), prompt: 'SECRET_PROMPT', rawResponse: 'SECRET_RESPONSE', apiKey: 'SECRET_KEY', route: 'https://secret.example' });
    const report = log.report({ responseLength: 800, persona: 'SECRET_PERSONA' });
    assert.doesNotMatch(report, /SECRET_|secret\.example/);
    const details = JSON.parse(report).entries[0].details;
    assert.equal(details.errorKind, 'invalid-json-response');
    assert.equal(details.position, 1300);
    assert.equal(details.column, 1301);
});

test('unavailable browser storage cannot interrupt logging', () => {
    const log = createDebugLog({ isEnabled: () => true, storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } } });
    log.record('request.started');
    assert.equal(JSON.parse(log.report()).entries.length, 1);
    assert.doesNotThrow(() => log.clear());
});

test('retry diagnostics describe both attempts without collecting response content', async () => {
    const log = createDebugLog({ isEnabled: () => true });
    let calls = 0;
    await generateParsedAnalysis({
        prompt: 'SECRET_PROMPT', retryLimit: 1, responseLength: 800,
        onDebug: (event, details) => log.record(event, details),
        generate: async () => ++calls === 1 ? 'SECRET_INVALID_RESPONSE' : '{"proposalVersion":1,"summary":"SECRET_SUMMARY","operations":[]}',
    });
    const report = log.report();
    assert.deepEqual(JSON.parse(report).entries.map(entry => entry.event), ['response.attempt', 'response.invalid', 'response.attempt', 'response.parsed']);
    assert.doesNotMatch(report, /SECRET_/);
});
