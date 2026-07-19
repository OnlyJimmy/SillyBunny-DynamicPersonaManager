import { COLLECTION_FIELDS } from '../constants.js';
import { createBlankPersona } from '../state/defaults.js';
import { validatePersona } from '../state/schema.js';
import { cloneJson } from '../utils/cloning.js';
import { createId } from '../utils/ids.js';

const CONVERTER_PROMPT = `You are converting a SillyBunny/SillyTavern-style freeform persona into Dynamic Persona Manager structured JSON.
Extract only information supported by the source text. Do not invent new facts.
Return JSON only. No markdown.

Return this shape:
{
  "name": "",
  "aliases": [],
  "summary": "",
  "identity": {
    "age": null,
    "ageDisplay": "",
    "gender": "",
    "pronouns": "",
    "species": "",
    "race": "",
    "nationality": "",
    "occupation": "",
    "rank": "",
    "title": "",
    "origin": "",
    "affiliations": [],
    "backstorySummary": ""
  },
  "appearance": {
    "baseDescription": "",
    "height": "",
    "weight": "",
    "build": "",
    "skin": "",
    "hair": "",
    "eyes": "",
    "facialFeatures": "",
    "distinguishingFeatures": [],
    "currentAttire": [],
    "temporaryChanges": [],
    "other": ""
  },
  "personality": {
    "coreTraits": [],
    "values": [],
    "fears": [],
    "motivations": [],
    "habits": [],
    "preferences": [],
    "dislikes": [],
    "boundaries": [],
    "speechStyle": "",
    "temporaryMood": "",
    "developmentNotes": []
  },
  "attributes": [],
  "skills": [],
  "inventory": [],
  "equipment": [],
  "conditions": [],
  "relationships": [
    {
      "entityName": "",
      "entityType": "character",
      "summary": "",
      "attitude": "",
      "trust": null,
      "affection": null,
      "respect": null,
      "fear": null
    }
  ],
  "quests": [],
  "goals": [],
  "knowledge": [],
  "currencies": [],
  "customSections": []
}

Collection entries may omit ids; the extension will assign them.
Prefer concise summaries over copying long paragraphs.
Use customSections for important source material that does not fit the named sections.`;

function extractJsonObject(text) {
    const value = String(text ?? '').trim();
    try {
        return JSON.parse(value);
    } catch {
        const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) return JSON.parse(fenced[1]);
        const start = value.indexOf('{');
        const end = value.lastIndexOf('}');
        if (start !== -1 && end > start) {
            return JSON.parse(value.slice(start, end + 1));
        }
        throw new Error('Converter response did not contain a JSON object.');
    }
}

function asText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function asTextArray(value) {
    return (Array.isArray(value) ? value : [])
        .map(item => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean);
}

function mergeObject(defaultValue, incomingValue) {
    const next = { ...defaultValue };
    if (!incomingValue || typeof incomingValue !== 'object' || Array.isArray(incomingValue)) return next;
    for (const key of Object.keys(next)) {
        if (Array.isArray(next[key])) next[key] = asTextArray(incomingValue[key]);
        else if (key === 'age') {
            const number = Number(incomingValue[key]);
            next[key] = Number.isFinite(number) ? number : null;
        }
        else next[key] = asText(incomingValue[key]);
    }
    return next;
}

function normalizeCollection(collectionName, value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
        .filter(item => item && typeof item === 'object' && !Array.isArray(item))
        .map(item => {
            const next = cloneJson(item);
            const providedId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
            next.id = providedId && !seen.has(providedId) ? providedId : createId(collectionName);
            seen.add(next.id);
            return next;
        });
}

export function buildNativePersonaConversionPrompt(nativeText, suggestedName = '') {
    return `${CONVERTER_PROMPT}

Suggested persona name: ${suggestedName || '(none)'}

Source persona text:
${String(nativeText || '').trim()}

Return JSON only.`;
}

export function normalizeConvertedNativePersona(parsed, { sourceText = '', suggestedName = '' } = {}) {
    const blank = createBlankPersona();
    const persona = {
        ...blank,
        name: asText(parsed?.name) || asText(suggestedName),
        aliases: asTextArray(parsed?.aliases),
        summary: asText(parsed?.summary) || String(sourceText || '').trim().slice(0, 1200),
        identity: mergeObject(blank.identity, parsed?.identity),
        appearance: mergeObject(blank.appearance, parsed?.appearance),
        personality: mergeObject(blank.personality, parsed?.personality),
        metadata: {
            ...blank.metadata,
            importSource: 'native-persona-analysis',
            importedAt: new Date().toISOString(),
            sourceTextLength: String(sourceText || '').length,
        },
    };

    for (const field of COLLECTION_FIELDS) {
        persona[field] = normalizeCollection(field, parsed?.[field]);
    }

    const validation = validatePersona(persona);
    if (!validation.ok) {
        throw new Error(`Converted persona is invalid: ${validation.errors.join(' ')}`);
    }
    return persona;
}

export function parseNativePersonaConversionResponse(raw, { nativeText = '', suggestedName = '' } = {}) {
    const parsed = extractJsonObject(raw);
    return normalizeConvertedNativePersona(parsed, { sourceText: nativeText, suggestedName });
}

export async function analyseNativePersona({ context, nativeText, suggestedName = '', settings = {}, signal = null, generateRaw = null, prompt = null, responseLength = null }) {
    const generate = generateRaw || context?.generateRaw;
    if (typeof generate !== 'function') {
        throw new Error('No analysis generation function is available.');
    }
    const conversionPrompt = typeof prompt === 'string' && prompt.trim()
        ? prompt
        : buildNativePersonaConversionPrompt(nativeText, suggestedName);
    const raw = await generate({
        prompt: conversionPrompt,
        responseLength: Number(responseLength ?? settings.nativeConversionTokenAllowance ?? 1800),
        trimNames: true,
        cacheScope: 'auxiliary',
        signal,
    });
    try {
        return parseNativePersonaConversionResponse(raw, { nativeText, suggestedName });
    } catch (error) {
        error.rawResponse = raw;
        error.conversionPrompt = conversionPrompt;
        throw error;
    }
}
