import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankPersona, createDefaultChatState } from '../src/state/defaults.js';
import { validateChatState, validatePersona } from '../src/state/schema.js';
import { migrateChatState } from '../src/state/migrations.js';
import { METADATA_KEY } from '../src/constants.js';
import { ensureChatState, readChatState, writeChatState } from '../src/state/repository.js';

function createContext() {
    return {
        chatMetadata: {},
        saved: 0,
        saveMetadataDebounced() {
            this.saved += 1;
        },
    };
}

test('blank persona matches current schema', () => {
    const persona = createBlankPersona();
    const result = validatePersona(persona);
    assert.equal(result.ok, true, result.errors.join('\n'));
});

test('default chat state validates', () => {
    const result = validateChatState(createDefaultChatState());
    assert.equal(result.ok, true, result.errors.join('\n'));
});

test('metadata repository keeps chats isolated by context', () => {
    const contextA = createContext();
    const contextB = createContext();

    const { state: stateA } = ensureChatState(contextA);
    stateA.persona = createBlankPersona({ name: 'Aster' });
    stateA.enabled = true;
    writeChatState(contextA, stateA);

    const { state: stateB } = ensureChatState(contextB);
    stateB.persona = createBlankPersona({ name: 'Briar' });
    writeChatState(contextB, stateB);

    assert.equal(readChatState(contextA).state.persona.name, 'Aster');
    assert.equal(readChatState(contextB).state.persona.name, 'Briar');
    assert.notDeepEqual(contextA.chatMetadata[METADATA_KEY], contextB.chatMetadata[METADATA_KEY]);
});

test('future metadata opens read-only', () => {
    const migration = migrateChatState({ storageVersion: 999, persona: null });
    assert.equal(migration.readOnly, true);
    assert.match(migration.errors[0], /newer/);
});
