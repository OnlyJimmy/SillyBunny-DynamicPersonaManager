import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankPersona, createDefaultChatState } from '../src/state/defaults.js';
import { buildNativePersonaTextExport, buildPersonaExport, buildPlainTextPersonaExport, buildPromptTextExport } from '../src/import-export/exporter.js';
import { mergeImportedPersona, parseDpmImport } from '../src/import-export/importer.js';

test('persona export imports as a valid persona payload', () => {
    const state = createDefaultChatState();
    state.persona = createBlankPersona({ name: 'Ren' });
    const exported = buildPersonaExport(state);
    const imported = parseDpmImport(JSON.stringify(exported));

    assert.equal(imported.type, 'persona');
    assert.equal(imported.persona.name, 'Ren');
});

test('plain text export is readable and not an import payload', () => {
    const state = createDefaultChatState();
    state.persona = createBlankPersona({ name: 'Ren', summary: 'A cautious mapmaker.' });
    state.persona.inventory.push({ id: 'item_1', name: 'Iron key', quantity: 1 });

    const exported = buildPlainTextPersonaExport(state);

    assert.match(exported, /Dynamic Persona Manager Plain Text Export/);
    assert.match(exported, /Persona: Ren/);
    assert.match(exported, /Iron key/);
    assert.match(exported, /Use JSON export to reimport/);
    assert.throws(() => parseDpmImport(exported), /not valid JSON/);
});

test('prompt and native text exports are readable text formats', () => {
    const state = createDefaultChatState();
    state.persona = createBlankPersona({ name: 'Ren', summary: 'A cautious mapmaker.' });
    state.persona.personality.speechStyle = 'Soft-spoken and precise.';

    assert.match(buildPromptTextExport(state), /Managed Player Character State/);
    const nativeText = buildNativePersonaTextExport(state);
    assert.match(nativeText, /Name: Ren/);
    assert.match(nativeText, /Personality:/);
    assert.match(nativeText, /Soft-spoken/);
});

test('persona import merge keeps current values and merges collections by id', () => {
    const current = createBlankPersona({ name: 'Current', summary: 'Keep me.' });
    current.aliases = ['Ren'];
    current.inventory.push({ id: 'item_1', name: 'Iron key', quantity: 1, location: 'pouch' });
    const incoming = createBlankPersona({ name: '', summary: 'Imported summary.' });
    incoming.aliases = ['Ren', 'Mapmaker'];
    incoming.inventory.push({ id: 'item_1', name: 'Iron key', quantity: 2 });
    incoming.inventory.push({ id: 'item_2', name: 'Lantern', quantity: 1 });

    const merged = mergeImportedPersona(current, incoming);

    assert.equal(merged.name, 'Current');
    assert.equal(merged.summary, 'Imported summary.');
    assert.deepEqual(merged.aliases, ['Ren', 'Mapmaker']);
    assert.equal(merged.inventory.length, 2);
    assert.equal(merged.inventory.find(item => item.id === 'item_1').quantity, 2);
    assert.equal(merged.inventory.find(item => item.id === 'item_1').location, 'pouch');
});

test('invalid JSON import fails closed', () => {
    assert.throws(() => parseDpmImport('{'), /not valid JSON/);
});
