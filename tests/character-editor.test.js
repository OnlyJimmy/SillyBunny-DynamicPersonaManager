import test from 'node:test';
import assert from 'node:assert/strict';
import {
    COLLECTION_LABELS,
    coerceEditorValue,
    createDefaultCollectionEntry,
    customEntriesToText,
    getCollectionItemTitle,
    listToText,
    readCollapsedEntries,
    storeCollapsedEntries,
    textToCustomEntries,
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

test('custom section content helpers handle text list table and json entries', () => {
    assert.deepEqual(textToCustomEntries('Long property note.', 'text'), ['Long property note.']);
    assert.deepEqual(textToCustomEntries('Key\nCellar', 'list'), ['Key', 'Cellar']);
    assert.deepEqual(textToCustomEntries('room\towner\nKitchen\tRen', 'table'), [{ room: 'Kitchen', owner: 'Ren' }]);
    assert.deepEqual(textToCustomEntries('{"value":42}', 'json'), [{ value: 42 }]);

    assert.equal(customEntriesToText(['Long property note.'], 'text'), 'Long property note.');
    assert.equal(customEntriesToText([{ room: 'Kitchen', owner: 'Ren' }], 'table'), 'room\towner\nKitchen\tRen');
    assert.equal(customEntriesToText([{ value: 42 }], 'json'), '[\n  {\n    "value": 42\n  }\n]');
});

test('collection titles prefer human-readable fields', () => {
    assert.equal(getCollectionItemTitle('inventory', { name: 'Iron key' }), 'Iron key');
    assert.equal(getCollectionItemTitle('quests', { title: 'Find Elira' }), 'Find Elira');
    assert.equal(getCollectionItemTitle('knowledge', { subject: 'Old gate' }), 'Old gate');
});

test('collapsed collection entries round trip through local storage', () => {
    const storage = new Map();
    const originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
    };

    try {
        storeCollapsedEntries(new Set(['skills:skill_1', 'equipment:index-0']));
        assert.deepEqual([...readCollapsedEntries()].sort(), ['equipment:index-0', 'skills:skill_1']);
    } finally {
        if (originalLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = originalLocalStorage;
    }
});
