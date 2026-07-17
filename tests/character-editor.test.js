import test from 'node:test';
import assert from 'node:assert/strict';
import {
    COLLECTION_LABELS,
    coerceEditorValue,
    createDefaultCollectionEntry,
    getCollectionItemTitle,
    listToText,
    textToList,
} from '../src/ui/character-editor.js';
import { validatePersona } from '../src/state/schema.js';
import { createBlankPersona } from '../src/state/defaults.js';

test('default collection entries validate inside a persona', () => {
    const persona = createBlankPersona();

    for (const collectionName of Object.keys(COLLECTION_LABELS)) {
        persona[collectionName].push(createDefaultCollectionEntry(collectionName));
    }

    const result = validatePersona(persona);
    assert.equal(result.ok, true, result.errors.join('\n'));
});

test('list text helpers round trip trimmed non-empty lines', () => {
    const list = textToList(' first \n\nsecond\n ');
    assert.deepEqual(list, ['first', 'second']);
    assert.equal(listToText(list), 'first\nsecond');
});

test('editor value coercion handles common form field types', () => {
    assert.equal(coerceEditorValue('', 'number'), null);
    assert.equal(coerceEditorValue('42', 'number'), 42);
    assert.equal(coerceEditorValue(true, 'checkbox'), true);
    assert.equal(coerceEditorValue('active', 'select:active|inactive'), 'active');
});

test('collection titles prefer human-readable fields', () => {
    assert.equal(getCollectionItemTitle('inventory', { name: 'Iron key' }), 'Iron key');
    assert.equal(getCollectionItemTitle('quests', { title: 'Find Elira' }), 'Find Elira');
    assert.equal(getCollectionItemTitle('knowledge', { subject: 'Old gate' }), 'Old gate');
});
