import { PROMPT_MODES, SECTION_ORDER } from '../constants.js';
import { LOCK_MODES, filterHiddenEntries, isPathHidden } from '../state/locks.js';

const OMITTED_VALUES = new Set(['', null, undefined]);
const RESOLVED_CONDITION_STATUSES = new Set(['resolved']);
const CLOSED_QUEST_STATUSES = new Set(['completed', 'failed', 'abandoned', 'expired']);

function cleanText(value) {
    return String(value ?? '').trim();
}

function hasValue(value) {
    if (OMITTED_VALUES.has(value)) return false;
    if (Array.isArray(value)) return value.some(hasValue);
    return true;
}

function addLine(lines, label, value) {
    const text = cleanText(value);
    if (text) lines.push(`- ${label}: ${text}`);
}

function canRender(persona, path, hiddenMode) {
    return !isPathHidden(persona, path, hiddenMode);
}

function addListLine(lines, label, values) {
    const items = (Array.isArray(values) ? values : [])
        .map(value => typeof value === 'string' ? value : value?.name || value?.text || value?.title || value?.notes)
        .map(cleanText)
        .filter(Boolean);

    if (items.length) lines.push(`- ${label}: ${items.join(', ')}`);
}

function addSection(lines, heading, sectionLines) {
    const cleanLines = sectionLines.filter(Boolean);
    if (!cleanLines.length) return;
    lines.push(`${heading}:`, ...cleanLines, '');
}

function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
}

function sortByPriority(entries) {
    return [...(Array.isArray(entries) ? entries : [])]
        .filter(entry => entry && typeof entry === 'object')
        .sort((a, b) => Number(b.promptPriority ?? 50) - Number(a.promptPriority ?? 50));
}

function joinDetails(details) {
    return details
        .filter(([_, value]) => hasValue(value))
        .map(([label, value]) => {
            if (Array.isArray(value)) return `${label}: ${value.map(cleanText).filter(Boolean).join(', ')}`;
            if (typeof value === 'boolean') return value ? label : '';
            return `${label}: ${cleanText(value)}`;
        })
        .filter(Boolean)
        .join('; ');
}

function formatEntry(title, details = []) {
    const cleanTitle = cleanText(title) || 'Unnamed';
    const detailText = joinDetails(details);
    return detailText ? `- ${cleanTitle} (${detailText})` : `- ${cleanTitle}`;
}

function renderIdentity(persona, hiddenMode) {
    const identity = persona.identity ?? {};
    const lines = [];
    if (canRender(persona, '/name', hiddenMode)) addLine(lines, 'Name', persona.name);
    if (canRender(persona, '/aliases', hiddenMode)) addListLine(lines, 'Aliases', persona.aliases);
    if (canRender(persona, '/identity/age', hiddenMode) && canRender(persona, '/identity/ageDisplay', hiddenMode)) addLine(lines, 'Age', identity.ageDisplay || identity.age);
    if (canRender(persona, '/identity/gender', hiddenMode)) addLine(lines, 'Gender', identity.gender);
    if (canRender(persona, '/identity/pronouns', hiddenMode)) addLine(lines, 'Pronouns', identity.pronouns);
    if (canRender(persona, '/identity/species', hiddenMode)) addLine(lines, 'Species', identity.species);
    if (canRender(persona, '/identity/race', hiddenMode)) addLine(lines, 'Race', identity.race);
    if (canRender(persona, '/identity/nationality', hiddenMode)) addLine(lines, 'Nationality', identity.nationality);
    if (canRender(persona, '/identity/occupation', hiddenMode)) addLine(lines, 'Occupation', identity.occupation);
    if (canRender(persona, '/identity/rank', hiddenMode)) addLine(lines, 'Rank', identity.rank);
    if (canRender(persona, '/identity/title', hiddenMode)) addLine(lines, 'Title', identity.title);
    if (canRender(persona, '/identity/origin', hiddenMode)) addLine(lines, 'Origin', identity.origin);
    if (canRender(persona, '/identity/affiliations', hiddenMode)) addListLine(lines, 'Affiliations', identity.affiliations);
    if (canRender(persona, '/identity/backstorySummary', hiddenMode)) addLine(lines, 'Backstory', identity.backstorySummary);
    return lines;
}

function renderAppearance(persona) {
    const appearance = persona.appearance ?? {};
    const lines = [];
    if (appearance.baseDescription) lines.push(`- ${appearance.baseDescription}`);
    addLine(lines, 'Height', appearance.height);
    addLine(lines, 'Weight', appearance.weight);
    addLine(lines, 'Build', appearance.build);
    addLine(lines, 'Skin', appearance.skin);
    addLine(lines, 'Hair', appearance.hair);
    addLine(lines, 'Eyes', appearance.eyes);
    addLine(lines, 'Facial features', appearance.facialFeatures);
    addListLine(lines, 'Distinguishing features', appearance.distinguishingFeatures);
    const attire = sortByPriority(appearance.currentAttire).map(item => formatEntry(item.name, [
        ['slot', item.slot],
        ['state', item.state],
        ['description', item.description],
    ]));
    if (attire.length) lines.push('- Current attire:', ...attire.map(line => `  ${line}`));
    addListLine(lines, 'Temporary changes', appearance.temporaryChanges);
    addLine(lines, 'Other', appearance.other);
    return lines;
}

function renderPersonality(persona) {
    const personality = persona.personality ?? {};
    const lines = [];
    const traits = sortByPriority(personality.coreTraits).map(trait => formatEntry(trait.name, [
        ['description', trait.description],
        ['strength', trait.strength],
    ]));
    if (traits.length) lines.push('- Core traits:', ...traits.map(line => `  ${line}`));
    addListLine(lines, 'Values', personality.values);
    addListLine(lines, 'Fears', personality.fears);
    addListLine(lines, 'Motivations', personality.motivations);
    addListLine(lines, 'Habits', personality.habits);
    addListLine(lines, 'Preferences', personality.preferences);
    addListLine(lines, 'Dislikes', personality.dislikes);
    addListLine(lines, 'Boundaries', personality.boundaries);
    addLine(lines, 'Speech style', personality.speechStyle);
    addLine(lines, 'Temporary mood', personality.temporaryMood);
    addListLine(lines, 'Development notes', personality.developmentNotes);
    return lines;
}

function renderAttributes(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/attributes', persona.attributes, hiddenMode)).map(entry => formatEntry(entry.name, [
        ['value', entry.value],
        ['type', entry.valueType],
        ['unit', entry.unit],
        ['category', entry.category],
        ['description', entry.description],
    ]));
}

function renderSkills(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/skills', persona.skills, hiddenMode)).map(entry => formatEntry(entry.name, [
        ['category', entry.category],
        ['rank', entry.rank],
        ['level', entry.level],
        ['progress', entry.progress && entry.maximumProgress ? `${entry.progress}/${entry.maximumProgress}` : entry.progress],
        ['status', entry.status],
        ['description', entry.description],
    ]));
}

function renderInventory(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/inventory', persona.inventory, hiddenMode))
        .filter(entry => Number(entry.quantity ?? 1) !== 0)
        .map(entry => formatEntry(entry.name, [
            ['quantity', entry.quantity],
            ['category', entry.category],
            ['state', entry.state],
            ['location', entry.location],
            ['equipped', entry.equipped],
            ['consumable', entry.consumable],
            ['quest item', entry.questItem],
            ['description', entry.description],
        ]));
}

function renderEquipment(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/equipment', persona.equipment, hiddenMode)).map(entry => formatEntry(entry.name, [
        ['slot', entry.slot],
        ['category', entry.category],
        ['state', entry.state],
        ['quantity', entry.quantity],
        ['description', entry.description],
        ['effects', entry.effects],
    ]));
}

function renderConditions(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/conditions', persona.conditions, hiddenMode))
        .filter(entry => !RESOLVED_CONDITION_STATUSES.has(entry.status))
        .map(entry => formatEntry(entry.name, [
            ['category', entry.category],
            ['severity', entry.severity],
            ['status', entry.status],
            ['temporary', entry.temporary],
            ['cause', entry.cause],
            ['duration', entry.expectedDuration],
            ['effects', entry.effects],
            ['description', entry.description],
        ]));
}

function renderRelationships(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/relationships', persona.relationships, hiddenMode)).map(entry => formatEntry(entry.entityName, [
        ['type', entry.entityType],
        ['attitude', entry.attitude],
        ['trust', entry.trust],
        ['affection', entry.affection],
        ['respect', entry.respect],
        ['fear', entry.fear],
        ['tags', entry.statusTags],
        ['summary', entry.summary],
    ]));
}

function renderQuests(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/quests', persona.quests, hiddenMode))
        .filter(entry => !CLOSED_QUEST_STATUSES.has(entry.status))
        .map(entry => {
            const objectives = (Array.isArray(entry.objectives) ? entry.objectives : [])
                .map(objective => `${objective.text}${objective.status ? ` [${objective.status}]` : ''}`)
                .filter(Boolean);
            return formatEntry(entry.title, [
                ['status', entry.status],
                ['priority', entry.priority],
                ['giver', entry.giver],
                ['description', entry.description],
                ['objectives', objectives],
                ['rewards', entry.rewards],
                ['notes', entry.notes],
            ]);
        });
}

function renderGoals(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/goals', persona.goals, hiddenMode)).map(entry => formatEntry(entry.title, [
        ['category', entry.category],
        ['status', entry.status],
        ['priority', entry.priority],
        ['description', entry.description],
        ['progress', entry.progressNotes],
    ]));
}

function renderKnowledge(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/knowledge', persona.knowledge, hiddenMode)).map(entry => formatEntry(entry.subject, [
        ['fact', entry.fact],
        ['certainty', entry.certainty],
        ['source', entry.source],
        ['private', entry.private],
        ['importance', entry.importance],
    ]));
}

function renderCurrencies(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/currencies', persona.currencies, hiddenMode)).map(entry => formatEntry(entry.name, [
        ['amount', entry.amount],
        ['symbol', entry.symbol],
        ['unit', entry.unit],
        ['description', entry.description],
    ]));
}

function renderCustomSections(persona, hiddenMode) {
    return sortByPriority(filterHiddenEntries(persona, '/customSections', persona.customSections, hiddenMode))
        .filter(section => section.promptEnabled !== false)
        .map(section => formatEntry(section.name, [
            ['type', section.entryType],
            ['description', section.description],
            ['entries', Array.isArray(section.entries) ? section.entries.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry)) : []],
        ]));
}

const SECTION_RENDERERS = Object.freeze({
    identity: {
        heading: 'Identity',
        priority: 100,
        render: (persona, hiddenMode) => renderIdentity(persona, hiddenMode),
    },
    appearance: {
        heading: 'Appearance',
        priority: 80,
        render: (persona, hiddenMode) => renderAppearance(persona),
    },
    personality: {
        heading: 'Personality',
        priority: 80,
        render: (persona) => renderPersonality(persona),
    },
    attributes: {
        heading: 'Attributes',
        priority: 60,
        render: (persona, hiddenMode) => renderAttributes(persona, hiddenMode),
    },
    skills: {
        heading: 'Skills',
        priority: 60,
        render: (persona, hiddenMode) => renderSkills(persona, hiddenMode),
    },
    inventory: {
        heading: 'Inventory',
        priority: 70,
        render: (persona, hiddenMode) => renderInventory(persona, hiddenMode),
    },
    equipment: {
        heading: 'Equipment',
        priority: 65,
        render: (persona, hiddenMode) => renderEquipment(persona, hiddenMode),
    },
    conditions: {
        heading: 'Current Conditions',
        priority: 90,
        render: (persona, hiddenMode) => renderConditions(persona, hiddenMode),
    },
    relationships: {
        heading: 'Important Relationships',
        priority: 55,
        render: (persona, hiddenMode) => renderRelationships(persona, hiddenMode),
    },
    quests: {
        heading: 'Active Quests',
        priority: 55,
        render: (persona, hiddenMode) => renderQuests(persona, hiddenMode),
    },
    goals: {
        heading: 'Goals',
        priority: 45,
        render: (persona, hiddenMode) => renderGoals(persona, hiddenMode),
    },
    knowledge: {
        heading: 'Character Knowledge',
        priority: 50,
        render: (persona, hiddenMode) => renderKnowledge(persona, hiddenMode),
    },
    currencies: {
        heading: 'Currency',
        priority: 40,
        render: (persona, hiddenMode) => renderCurrencies(persona, hiddenMode),
    },
    customSections: {
        heading: 'Custom Sections',
        priority: 30,
        render: (persona, hiddenMode) => renderCustomSections(persona, hiddenMode),
    },
});

function getModeSections(mode) {
    if (mode === PROMPT_MODES.minimal) return ['identity', 'conditions', 'inventory', 'quests'];
    return [...SECTION_ORDER].filter(section => section !== 'overview');
}

function getOrderedSections(mode, sectionOrder = [], sortMode = 'sectionOrder') {
    const allowed = new Set(getModeSections(mode));
    const order = (Array.isArray(sectionOrder) && sectionOrder.length ? sectionOrder : SECTION_ORDER)
        .filter(section => allowed.has(section) && SECTION_RENDERERS[section]);
    const missing = [...allowed].filter(section => !order.includes(section) && SECTION_RENDERERS[section]);
    const sections = [...order, ...missing];
    if (sortMode === 'priority') {
        return sections.sort((left, right) => SECTION_RENDERERS[right].priority - SECTION_RENDERERS[left].priority);
    }
    return sections;
}

function trimToBudget(lines, maximumTokens) {
    const budget = Number(maximumTokens || 0);
    if (!budget || estimateTokens(lines.join('\n')) <= budget) return lines;
    const trimmed = [...lines];
    const closing = trimmed.splice(-1, 1);
    while (trimmed.length > 4 && estimateTokens([...trimmed, ...closing].join('\n')) > budget) {
        trimmed.splice(-2, 1);
    }
    if (estimateTokens([...trimmed, '- Some lower-priority details were omitted to fit the configured prompt budget.', ...closing].join('\n')) <= budget) {
        trimmed.push('- Some lower-priority details were omitted to fit the configured prompt budget.');
    }
    return [...trimmed, ...closing];
}

export function renderCompactPrompt(persona, {
    hiddenMode = LOCK_MODES.promptHidden,
    mode = PROMPT_MODES.compact,
    maximumTokens = 0,
    sectionOrder = [],
    sortMode = 'sectionOrder',
    customHeader = '',
    customFooter = '',
} = {}) {
    if (!persona) return '';

    const promptMode = Object.values(PROMPT_MODES).includes(mode) ? mode : PROMPT_MODES.compact;
    const lines = ['[Managed Player Character State]', ''];
    if (customHeader) lines.push(cleanText(customHeader), '');

    for (const section of getOrderedSections(promptMode, sectionOrder, sortMode)) {
        if (!canRender(persona, `/${section}`, hiddenMode)) continue;
        const renderer = SECTION_RENDERERS[section];
        addSection(lines, renderer.heading, renderer.render(persona, hiddenMode));
    }

    if (persona.summary && canRender(persona, '/summary', hiddenMode)) lines.push('Summary:', `- ${persona.summary}`, '');
    if (customFooter) lines.push(cleanText(customFooter), '');
    lines.push('Treat this state as the current canonical state of the user-controlled character.');
    lines.push('Do not rewrite or enumerate this record unless relevant to the roleplay.', '');
    lines.push('[/Managed Player Character State]');
    return trimToBudget(lines, maximumTokens).join('\n');
}
