import { METADATA_KEY } from '../constants.js';
import { cloneJson } from '../utils/cloning.js';
import { createDefaultChatState } from './defaults.js';
import { migrateChatState } from './migrations.js';
import { validateChatState } from './schema.js';

function getMetadata(context) {
    if (!context?.chatMetadata) {
        throw new Error('No active chat metadata is available.');
    }

    return context.chatMetadata;
}

export function readChatState(context) {
    const metadata = getMetadata(context);
    const migration = migrateChatState(metadata[METADATA_KEY]);
    return {
        ...migration,
        state: cloneJson(migration.state),
    };
}

export function ensureChatState(context) {
    const metadata = getMetadata(context);
    const migration = migrateChatState(metadata[METADATA_KEY]);
    metadata[METADATA_KEY] = cloneJson(migration.state);
    return readChatState(context);
}

export function writeChatState(context, nextState, { immediate = false } = {}) {
    const metadata = getMetadata(context);
    const validation = validateChatState(nextState);
    if (!validation.ok) {
        throw new Error(`DPM metadata failed validation: ${validation.errors.join(' ')}`);
    }

    metadata[METADATA_KEY] = cloneJson(nextState);
    if (immediate && typeof context.saveMetadata === 'function') {
        return context.saveMetadata();
    }
    if (typeof context.saveMetadataDebounced === 'function') {
        context.saveMetadataDebounced();
    }
    return undefined;
}

export function resetChatState(context) {
    return writeChatState(context, createDefaultChatState(), { immediate: true });
}
