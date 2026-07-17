import { createDefaultChatState } from './defaults.js';
import { validateChatState } from './schema.js';

/**
 * Migrates known chat metadata into the current storage shape.
 * Unknown future versions are returned as read-only invalid data.
 * @param {unknown} rawState
 */
export function migrateChatState(rawState) {
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
        return { state: createDefaultChatState(), readOnly: false, errors: [] };
    }

    const storageVersion = Number(rawState.storageVersion ?? 1);
    if (storageVersion > 1) {
        return {
            state: rawState,
            readOnly: true,
            errors: [`DPM metadata version ${storageVersion} is newer than this extension supports.`],
        };
    }

    const state = {
        ...createDefaultChatState(),
        ...rawState,
        storageVersion: 1,
        analysisState: {
            ...createDefaultChatState().analysisState,
            ...(rawState.analysisState && typeof rawState.analysisState === 'object' ? rawState.analysisState : {}),
        },
        chatSettings: {
            ...createDefaultChatState().chatSettings,
            ...(rawState.chatSettings && typeof rawState.chatSettings === 'object' ? rawState.chatSettings : {}),
        },
    };

    const validation = validateChatState(state);
    return { state, readOnly: false, errors: validation.errors };
}
