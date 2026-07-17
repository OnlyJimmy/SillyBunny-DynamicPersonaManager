import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankPersona } from '../src/state/defaults.js';
import { renderCompactPrompt } from '../src/prompting/renderer.js';

test('compact prompt omits empty sections and includes canonical fields', () => {
    const persona = createBlankPersona({
        name: 'Ren',
        summary: 'A cautious mapmaker.',
    });
    persona.identity.species = 'Human';
    persona.skills.push({ id: 'skill_1', name: 'Map copying', promptPriority: 50 });
    persona.inventory.push({ id: 'item_1', name: 'Iron key', quantity: 1, promptPriority: 50 });

    const prompt = renderCompactPrompt(persona);
    assert.match(prompt, /Managed Player Character State/);
    assert.match(prompt, /Name: Ren/);
    assert.match(prompt, /Map copying/);
    assert.match(prompt, /Iron key/);
    assert.doesNotMatch(prompt, /Pending/);
});

test('compact prompt excludes zero quantity inventory', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.inventory.push({ id: 'item_1', name: 'Spent torch', quantity: 0 });

    assert.doesNotMatch(renderCompactPrompt(persona), /Spent torch/);
});

test('compact prompt includes section editor details', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.inventory.push({
        id: 'item_1',
        name: 'Iron key',
        quantity: 1,
        state: 'rusted',
        location: 'belt pouch',
        description: 'Opens the cellar door.',
        promptPriority: 50,
    });
    persona.relationships.push({
        id: 'rel_1',
        entityName: 'Dain',
        entityType: 'character',
        attitude: 'hostile rival',
        summary: 'Competes with Ren for guild work.',
        promptPriority: 50,
    });
    persona.quests.push({
        id: 'quest_1',
        title: 'Find Elira',
        status: 'active',
        priority: 'high',
        description: 'Locate Elira before sundown.',
        objectives: [{ id: 'obj_1', text: 'Ask at the Cartographers Guild', status: 'incomplete' }],
        promptPriority: 50,
    });

    const prompt = renderCompactPrompt(persona);
    assert.match(prompt, /Iron key/);
    assert.match(prompt, /rusted/);
    assert.match(prompt, /belt pouch/);
    assert.match(prompt, /Opens the cellar door/);
    assert.match(prompt, /Dain/);
    assert.match(prompt, /hostile rival/);
    assert.match(prompt, /Find Elira/);
    assert.match(prompt, /Ask at the Cartographers Guild \[incomplete\]/);
});

test('compact prompt omits resolved conditions and closed quests by default', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.conditions.push({ id: 'condition_1', name: 'Healed wrist', status: 'resolved' });
    persona.quests.push({ id: 'quest_1', title: 'Finished errand', status: 'completed' });

    const prompt = renderCompactPrompt(persona);
    assert.doesNotMatch(prompt, /Healed wrist/);
    assert.doesNotMatch(prompt, /Finished errand/);
});

test('prompt renderer respects configured section order', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.inventory.push({ id: 'item_1', name: 'Iron key', quantity: 1 });
    persona.skills.push({ id: 'skill_1', name: 'Map copying' });

    const prompt = renderCompactPrompt(persona, {
        sectionOrder: ['inventory', 'skills', 'identity'],
    });

    assert.ok(prompt.indexOf('Inventory:') < prompt.indexOf('Skills:'));
    assert.ok(prompt.indexOf('Skills:') < prompt.indexOf('Identity:'));
});

test('minimal prompt mode omits lower priority sections', () => {
    const persona = createBlankPersona({ name: 'Ren' });
    persona.skills.push({ id: 'skill_1', name: 'Map copying' });
    persona.inventory.push({ id: 'item_1', name: 'Iron key', quantity: 1 });

    const prompt = renderCompactPrompt(persona, { mode: 'minimal' });

    assert.match(prompt, /Inventory:/);
    assert.doesNotMatch(prompt, /Skills:/);
});

test('prompt renderer trims to configured budget', () => {
    const persona = createBlankPersona({
        name: 'Ren',
        summary: 'A cautious mapmaker with a deliberately long source summary that should not fit inside a tiny prompt budget.',
    });
    persona.knowledge.push({ id: 'knowledge_1', subject: 'Archives', fact: 'A very long and detailed fact about many archive rooms and hidden ledgers.' });

    const prompt = renderCompactPrompt(persona, { maximumTokens: 45 });

    assert.match(prompt, /Managed Player Character State/);
    assert.match(prompt, /Managed Player Character State\]/);
    assert.ok(prompt.length < 260);
});
