import { COLLECTION_FIELDS, PERSONA_SCHEMA, PERSONA_SCHEMA_VERSION, STORAGE_VERSION } from '../constants.js';
import { LOCK_MODES } from './locks.js';

const OBJECT_FIELDS = ['identity', 'appearance', 'personality', 'promptSettings', 'metadata'];
const ARRAY_FIELDS = ['aliases', ...COLLECTION_FIELDS, 'locks'];

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validatePersona(persona) {
    const errors = [];

    if (!isPlainObject(persona)) {
        return { ok: false, errors: ['Persona must be an object.'] };
    }

    if (persona.$schema !== PERSONA_SCHEMA) errors.push(`Unsupported persona schema: ${persona.$schema ?? 'missing'}.`);
    if (persona.schemaVersion !== PERSONA_SCHEMA_VERSION) errors.push(`Unsupported persona schema version: ${persona.schemaVersion ?? 'missing'}.`);
    if (typeof persona.personaId !== 'string' || !persona.personaId.trim()) errors.push('Persona id is required.');
    if (typeof persona.name !== 'string') errors.push('Persona name must be text.');
    if (typeof persona.summary !== 'string') errors.push('Persona summary must be text.');

    for (const field of OBJECT_FIELDS) {
        if (!isPlainObject(persona[field])) errors.push(`${field} must be an object.`);
    }

    for (const field of ARRAY_FIELDS) {
        if (!Array.isArray(persona[field])) errors.push(`${field} must be an array.`);
    }

    for (const field of COLLECTION_FIELDS) {
        const seen = new Set();
        for (const [index, entry] of (Array.isArray(persona[field]) ? persona[field] : []).entries()) {
            if (!isPlainObject(entry)) {
                errors.push(`${field}[${index}] must be an object.`);
                continue;
            }
            if (typeof entry.id !== 'string' || !entry.id.trim()) {
                errors.push(`${field}[${index}] must have a stable id.`);
            } else if (seen.has(entry.id)) {
                errors.push(`${field}[${index}] duplicates id ${entry.id}.`);
            } else {
                seen.add(entry.id);
            }
        }
    }

    for (const [index, lock] of (Array.isArray(persona.locks) ? persona.locks : []).entries()) {
        if (!isPlainObject(lock)) {
            errors.push(`locks[${index}] must be an object.`);
            continue;
        }
        if (typeof lock.id !== 'string' || !lock.id.trim()) errors.push(`locks[${index}] must have a stable id.`);
        if (typeof lock.path !== 'string' || !lock.path.startsWith('/')) errors.push(`locks[${index}] must have a JSON pointer path.`);
        if (!Object.values(LOCK_MODES).includes(lock.mode)) errors.push(`locks[${index}] has unsupported mode ${lock.mode ?? 'missing'}.`);
    }

    return { ok: errors.length === 0, errors };
}

export function validateChatState(state) {
    const errors = [];

    if (!isPlainObject(state)) {
        return { ok: false, errors: ['DPM metadata must be an object.'] };
    }

    if (state.storageVersion !== STORAGE_VERSION) errors.push(`Unsupported storage version: ${state.storageVersion ?? 'missing'}.`);
    if (typeof state.enabled !== 'boolean') errors.push('enabled must be boolean.');
    if (state.persona !== null && state.persona !== undefined) {
        const personaResult = validatePersona(state.persona);
        errors.push(...personaResult.errors);
    }
    if (!Array.isArray(state.pendingProposals)) errors.push('pendingProposals must be an array.');
    if (!Array.isArray(state.revisionHistory)) errors.push('revisionHistory must be an array.');
    if (!Array.isArray(state.checkpoints)) errors.push('checkpoints must be an array.');
    if (!isPlainObject(state.analysisState)) errors.push('analysisState must be an object.');
    if (!isPlainObject(state.chatSettings)) errors.push('chatSettings must be an object.');

    return { ok: errors.length === 0, errors };
}
