import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { runTimedRequest } from '../src/analysis/request-timeout.js';
import { checkAnalysisContext } from '../src/analysis/context-limit.js';
import { describeDebugError } from '../src/analysis/debug-log.js';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function getSelectedAnalysisProfile('), source.indexOf('function refreshPromptInjection('));

function harness({ profileId = 'dpm', profiles = [{ id: 'dpm', model: 'gpt-analysis', preset: '' }], response = { content: '{"proposalVersion":1,"operations":[]}' } } = {}) {
    const calls = [];
    const events = [];
    let active = 0;
    const scope = {
        AbortController, runTimedRequest, checkAnalysisContext, describeDebugError,
        getSettings: () => ({ analysisProfileId: profileId, requestTimeoutSeconds: 180, analysisContextLimit: 6000 }),
        getConnectionProfiles: () => profiles,
        getContext: () => ({ generateRaw: async options => { calls.push({ route: 'active', options }); return 'active result'; } }),
        ConnectionManagerRequestService: { sendRequest: async (...args) => { calls.push({ route: 'profile', args }); return response; } },
        recordDebug: (event, details) => events.push({ event, details }),
        beginDpmOperation: () => active++, endDpmOperation: () => active--,
    };
    vm.createContext(scope);
    vm.runInContext(`let debugRequestId = 0; const dpmRequestControllers = new Set(); ${functions}`, scope);
    return { scope, calls, events, active: () => active };
}

test('dedicated model without a preset is explicitly quiet and cannot use the current roleplay connection', async () => {
    const { scope, calls, events, active } = harness();
    const text = await scope.generateDpmRaw({ prompt: 'analysis prompt', responseLength: 1200 });
    assert.match(text, /proposalVersion/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].route, 'profile');
    const [profileId, prompt, maxTokens, options, payload] = calls[0].args;
    assert.equal(profileId, 'dpm');
    assert.equal(prompt, 'analysis prompt');
    assert.equal(maxTokens, 1200);
    assert.equal(options.modelOverride, 'gpt-analysis');
    assert.equal(options.includePreset, true);
    assert.equal(payload.type, 'quiet');
    assert.equal(payload.cacheScope, 'auxiliary');
    assert.equal(payload.stream, false);
    assert.equal(active(), 0);
    assert.equal(events.find(event => event.event === 'request.profile-selected').details.profileHasPreset, false);
});

test('a profile with a preset retains the explicit type, model, signal, and nonstreaming overrides', async () => {
    const { scope, calls } = harness({ profiles: [{ id: 'dpm', model: 'different-provider/analysis-model', preset: 'analysis preset' }] });
    await scope.generateDpmRaw({ prompt: 'test', responseLength: 900 });
    const [, , , options, payload] = calls[0].args;
    assert.equal(options.modelOverride, 'different-provider/analysis-model');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.stream, false);
    assert.equal(payload.type, 'quiet');
    assert.equal(payload.stream, false);
});

test('missing or incomplete configured profiles fail without silently calling the active model', async () => {
    for (const profiles of [[], [{ id: 'dpm', model: '' }]]) {
        const { scope, calls, active } = harness({ profiles });
        await assert.rejects(scope.generateDpmRaw({ prompt: 'test' }), /profile/);
        assert.equal(calls.length, 0);
        assert.equal(active(), 0);
    }
});

test('current-connection mode still uses generateRaw when no dedicated profile is selected', async () => {
    const { scope, calls } = harness({ profileId: '' });
    assert.equal(await scope.generateDpmRaw({ prompt: 'test' }), 'active result');
    assert.equal(calls[0].route, 'active');
    assert.equal(calls[0].options.cacheScope, 'auxiliary');
});

test('empty profile content remains empty and unexpected response objects are rejected', async () => {
    const { scope } = harness({ response: { content: '', reasoning: 'not JSON output' } });
    assert.equal(await scope.generateDpmRaw({ prompt: 'test' }), '');
    const invalid = harness({ response: { unexpected: 'shape' } });
    await assert.rejects(invalid.scope.generateDpmRaw({ prompt: 'test' }), /unsupported response format/);
});
