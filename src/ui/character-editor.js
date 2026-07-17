import { COLLECTION_FIELDS, LOCAL_STORAGE_KEYS } from '../constants.js';
import { createId } from '../utils/ids.js';

export const COLLAPSIBLE_SECTIONS = Object.freeze([
    'overview',
    'identity',
    'appearance',
    'personality',
    ...COLLECTION_FIELDS,
    'advancedJson',
]);

export const COLLECTION_LABELS = Object.freeze({
    attributes: 'Attributes',
    skills: 'Skills',
    inventory: 'Inventory',
    equipment: 'Equipment',
    conditions: 'Conditions',
    relationships: 'Relationships',
    quests: 'Quests',
    goals: 'Goals',
    knowledge: 'Knowledge',
    currencies: 'Currencies',
    customSections: 'Custom sections',
});

export const SECTION_LABELS = Object.freeze({
    overview: 'Overview',
    identity: 'Identity',
    appearance: 'Appearance',
    personality: 'Personality',
    advancedJson: 'Advanced JSON',
    ...COLLECTION_LABELS,
});

export const ID_PREFIXES = Object.freeze({
    attributes: 'attribute',
    skills: 'skill',
    inventory: 'item',
    equipment: 'equipment',
    conditions: 'condition',
    relationships: 'relationship',
    quests: 'quest',
    goals: 'goal',
    knowledge: 'knowledge',
    currencies: 'currency',
    customSections: 'custom_section',
});

export const COLLECTION_FIELD_DEFINITIONS = Object.freeze({
    attributes: [
        ['name', 'Name', 'text'],
        ['value', 'Value', 'text'],
        ['valueType', 'Type', 'select:number|integer|string|rank|percentage|boolean'],
        ['category', 'Category', 'text'],
        ['unit', 'Unit', 'text'],
        ['description', 'Description', 'textarea'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    skills: [
        ['name', 'Name', 'text'],
        ['category', 'Category', 'text'],
        ['rank', 'Rank', 'text'],
        ['level', 'Level', 'number'],
        ['progress', 'Progress', 'number'],
        ['maximumProgress', 'Maximum progress', 'number'],
        ['description', 'Description', 'textarea'],
        ['status', 'Status', 'select:active|inactive|locked|forgotten'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    inventory: [
        ['name', 'Name', 'text'],
        ['quantity', 'Quantity', 'number'],
        ['category', 'Category', 'text'],
        ['state', 'State', 'text'],
        ['location', 'Location', 'text'],
        ['description', 'Description', 'textarea'],
        ['equipped', 'Equipped', 'checkbox'],
        ['consumable', 'Consumable', 'checkbox'],
        ['questItem', 'Quest item', 'checkbox'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    equipment: [
        ['name', 'Name', 'text'],
        ['slot', 'Slot', 'text'],
        ['category', 'Category', 'text'],
        ['state', 'State', 'text'],
        ['quantity', 'Quantity', 'number'],
        ['description', 'Description', 'textarea'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    conditions: [
        ['name', 'Name', 'text'],
        ['category', 'Category', 'select:injury|illness|buff|debuff|curse|transformation|fatigue|mental|environmental|other'],
        ['severity', 'Severity', 'select:minor|moderate|major|severe|critical'],
        ['status', 'Status', 'select:active|improving|worsening|resolved'],
        ['temporary', 'Temporary', 'checkbox'],
        ['cause', 'Cause', 'text'],
        ['expectedDuration', 'Expected duration', 'text'],
        ['description', 'Description', 'textarea'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    relationships: [
        ['entityName', 'Entity name', 'text'],
        ['entityType', 'Entity type', 'select:character|group|faction|place|other'],
        ['summary', 'Summary', 'textarea'],
        ['attitude', 'Attitude', 'text'],
        ['trust', 'Trust', 'number'],
        ['affection', 'Affection', 'number'],
        ['respect', 'Respect', 'number'],
        ['fear', 'Fear', 'number'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    quests: [
        ['title', 'Title', 'text'],
        ['status', 'Status', 'select:rumoured|offered|active|onHold|completed|failed|abandoned|expired'],
        ['priority', 'Priority', 'select:low|normal|high|urgent'],
        ['giver', 'Giver', 'text'],
        ['description', 'Description', 'textarea'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    goals: [
        ['title', 'Title', 'text'],
        ['category', 'Category', 'text'],
        ['status', 'Status', 'select:active|onHold|completed|abandoned'],
        ['priority', 'Priority', 'select:low|normal|high|urgent'],
        ['description', 'Description', 'textarea'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    knowledge: [
        ['subject', 'Subject', 'text'],
        ['fact', 'Fact', 'textarea'],
        ['certainty', 'Certainty', 'select:known|suspected|rumoured|uncertain|false'],
        ['source', 'Source', 'text'],
        ['private', 'Private', 'checkbox'],
        ['importance', 'Importance', 'select:minor|normal|material|critical'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    currencies: [
        ['name', 'Name', 'text'],
        ['amount', 'Amount', 'number'],
        ['symbol', 'Symbol', 'text'],
        ['unit', 'Unit', 'text'],
        ['precision', 'Precision', 'number'],
        ['description', 'Description', 'textarea'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
    customSections: [
        ['name', 'Name', 'text'],
        ['description', 'Description', 'textarea'],
        ['entryType', 'Entry type', 'select:list|text|table|json'],
        ['promptEnabled', 'Prompt enabled', 'checkbox'],
        ['analysisEnabled', 'Analysis enabled', 'checkbox'],
        ['promptPriority', 'Prompt priority', 'number'],
    ],
});

export function readCollapsedSections() {
    try {
        const parsed = JSON.parse(globalThis.localStorage?.getItem?.(LOCAL_STORAGE_KEYS.collapsedSections) || '[]');
        return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
        return new Set(['advancedJson']);
    }
}

export function storeCollapsedSections(collapsed) {
    try {
        globalThis.localStorage?.setItem?.(LOCAL_STORAGE_KEYS.collapsedSections, JSON.stringify([...collapsed]));
    } catch {
        // Storage failure only affects panel display preferences.
    }
}

export function listToText(value) {
    return (Array.isArray(value) ? value : []).join('\n');
}

export function textToList(value) {
    return String(value ?? '')
        .split('\n')
        .map(item => item.trim())
        .filter(Boolean);
}

export function coerceEditorValue(value, type, fallback = null) {
    if (type === 'checkbox') return !!value;
    if (type === 'number') {
        if (value === '' || value === null || value === undefined) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }
    if (type.startsWith('select:')) return String(value ?? '');
    return String(value ?? '');
}

export function getCollectionItemTitle(collectionName, entry) {
    if (!entry || typeof entry !== 'object') return 'Unnamed entry';
    return entry.name || entry.title || entry.subject || entry.entityName || COLLECTION_LABELS[collectionName]?.slice(0, -1) || 'Entry';
}

export function createDefaultCollectionEntry(collectionName) {
    const id = createId(ID_PREFIXES[collectionName] || 'entry');
    const shared = { id, promptPriority: 50, tags: [] };

    switch (collectionName) {
        case 'attributes':
            return { ...shared, name: '', value: null, valueType: 'number', minimum: null, maximum: null, unit: '', category: '', description: '' };
        case 'skills':
            return { ...shared, name: '', category: '', rank: '', level: null, progress: null, maximumProgress: null, description: '', specialisations: [], status: 'active' };
        case 'inventory':
            return { ...shared, name: '', quantity: 1, category: '', description: '', state: 'intact', location: '', owner: 'player', equipped: false, consumable: false, questItem: false, unitValue: null, currencyId: null, metadata: {} };
        case 'equipment':
            return { ...shared, name: '', slot: '', category: '', description: '', state: 'equipped', sourceItemId: null, quantity: 1, effects: [], promptPriority: 60 };
        case 'conditions':
            return { ...shared, name: '', category: 'other', description: '', severity: 'minor', status: 'active', temporary: true, cause: '', effects: [], startedAtMessageId: '', expectedDuration: '', promptPriority: 80 };
        case 'relationships':
            return { ...shared, entityId: null, entityName: '', entityType: 'character', summary: '', attitude: '', trust: null, affection: null, respect: null, fear: null, statusTags: [], notes: [], lastChangedAtMessageId: '' };
        case 'quests':
            return { ...shared, title: '', status: 'active', description: '', giver: '', objectives: [], rewards: [], failConditions: [], notes: [], priority: 'normal', startedAtMessageId: '', completedAtMessageId: null, promptPriority: 70 };
        case 'goals':
            return { ...shared, title: '', description: '', category: '', status: 'active', priority: 'normal', progressNotes: [], source: 'manual' };
        case 'knowledge':
            return { ...shared, subject: '', fact: '', certainty: 'known', source: '', private: false, importance: 'normal', acquiredAtMessageId: '', promptPriority: 30 };
        case 'currencies':
            return { id, name: '', amount: 0, symbol: '', unit: '', precision: 0, description: '', promptPriority: 40 };
        case 'customSections':
            return { ...shared, name: '', description: '', entryType: 'list', promptEnabled: true, analysisEnabled: false, promptPriority: 30, entries: [] };
        default:
            return { ...shared, name: '' };
    }
}
