import { createBlankPersona } from '../state/defaults.js';
import { validateChatState, validatePersona } from '../state/schema.js';
import { cloneJson } from '../utils/cloning.js';
import { COLLECTION_FIELDS } from '../constants.js';

export function parseDpmImport(text) {
    let parsed;
    try {
        parsed = JSON.parse(String(text ?? ''));
    } catch (error) {
        throw new Error(`Import is not valid JSON: ${error.message}`);
    }

    const persona = parsed?.exportType === 'dpm.persona'
        ? parsed.persona
        : parsed?.persona ?? parsed;

    const state = parsed?.exportType === 'dpm.full-backup' ? parsed.state : null;
    if (state) {
        const validation = validateChatState(state);
        if (!validation.ok) {
            throw new Error(`Imported backup is invalid: ${validation.errors.join(' ')}`);
        }
        return { type: 'full-backup', state: cloneJson(state), persona: cloneJson(state.persona) };
    }

    const validation = validatePersona(persona);
    if (!validation.ok) {
        throw new Error(`Imported persona is invalid: ${validation.errors.join(' ')}`);
    }

    return { type: 'persona', persona: cloneJson(persona) };
}

export function createPersonaFromNativeText(text, name = '') {
    return createBlankPersona({
        name: String(name || '').trim(),
        summary: String(text || '').trim(),
        metadata: {
            importSource: 'native-persona-text',
            importedAt: new Date().toISOString(),
        },
    });
}

function hasMeaningfulValue(value) {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.values(value).some(hasMeaningfulValue);
    return true;
}

function mergeObjects(current, incoming) {
    const result = cloneJson(current || {});
    for (const [key, value] of Object.entries(incoming || {})) {
        if (Array.isArray(value)) {
            if (value.length) result[key] = cloneJson(value);
            continue;
        }
        if (value && typeof value === 'object') {
            result[key] = mergeObjects(result[key], value);
            continue;
        }
        if (hasMeaningfulValue(value)) result[key] = value;
    }
    return result;
}

function mergeStringList(current, incoming) {
    return [...new Set([...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])].filter(Boolean))];
}

function mergeCollectionById(current, incoming) {
    const result = (Array.isArray(current) ? current : []).map(cloneJson);
    const byId = new Map(result.map((entry, index) => [entry.id, index]));
    for (const entry of Array.isArray(incoming) ? incoming : []) {
        if (!entry?.id || !byId.has(entry.id)) {
            result.push(cloneJson(entry));
            continue;
        }
        result[byId.get(entry.id)] = mergeObjects(result[byId.get(entry.id)], entry);
    }
    return result;
}

export function mergeImportedPersona(currentPersona, importedPersona) {
    const current = currentPersona ? cloneJson(currentPersona) : createBlankPersona();
    const incoming = cloneJson(importedPersona);
    const result = {
        ...current,
        name: hasMeaningfulValue(incoming.name) ? incoming.name : current.name,
        aliases: mergeStringList(current.aliases, incoming.aliases),
        summary: hasMeaningfulValue(incoming.summary) ? incoming.summary : current.summary,
        identity: mergeObjects(current.identity, incoming.identity),
        appearance: mergeObjects(current.appearance, incoming.appearance),
        personality: mergeObjects(current.personality, incoming.personality),
        metadata: {
            ...mergeObjects(current.metadata, incoming.metadata),
            lastImportMergeAt: new Date().toISOString(),
        },
    };

    for (const field of COLLECTION_FIELDS) {
        result[field] = mergeCollectionById(current[field], incoming[field]);
    }

    result.locks = mergeCollectionById(current.locks, incoming.locks);
    result.promptSettings = mergeObjects(current.promptSettings, incoming.promptSettings);

    const validation = validatePersona(result);
    if (!validation.ok) {
        throw new Error(`Merged persona is invalid: ${validation.errors.join(' ')}`);
    }
    return result;
}
