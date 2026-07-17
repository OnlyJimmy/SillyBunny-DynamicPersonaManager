import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativePersonaConversionPrompt, normalizeConvertedNativePersona } from '../src/import-export/native-converter.js';

test('native converter prompt includes source text and suggested name', () => {
    const prompt = buildNativePersonaConversionPrompt('A brave scholar with a silver ring.', 'Iris');

    assert.match(prompt, /Iris/);
    assert.match(prompt, /silver ring/);
    assert.match(prompt, /Return JSON only/);
});

test('native converter normalizes model output into a valid persona', () => {
    const persona = normalizeConvertedNativePersona({
        name: 'Iris',
        aliases: ['The Scholar', ''],
        summary: 'A careful travelling scholar.',
        identity: {
            age: 'unknown',
            species: 'Human',
            affiliations: ['Archive Guild'],
        },
        appearance: {
            hair: 'black',
            distinguishingFeatures: ['silver ring'],
        },
        personality: {
            coreTraits: ['curious'],
        },
        inventory: [
            { id: 'duplicate', name: 'Notebook' },
            { id: 'duplicate', name: 'Silver ring' },
            { name: 'Ink pen' },
        ],
    }, { sourceText: 'native text' });

    assert.equal(persona.name, 'Iris');
    assert.equal(persona.identity.age, null);
    assert.deepEqual(persona.identity.affiliations, ['Archive Guild']);
    assert.equal(persona.inventory.length, 3);
    assert.equal(new Set(persona.inventory.map(item => item.id)).size, 3);
    assert.equal(persona.metadata.importSource, 'native-persona-analysis');
});
