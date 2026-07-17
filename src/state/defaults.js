import { DEFAULT_GLOBAL_SETTINGS, PERSONA_SCHEMA, PERSONA_SCHEMA_VERSION, STORAGE_VERSION } from '../constants.js';
import { createId } from '../utils/ids.js';

export function createDefaultGlobalSettings() {
    return { ...DEFAULT_GLOBAL_SETTINGS };
}

export function createDefaultPromptSettings() {
    return {
        mode: 'compact',
        position: 'inPrompt',
        role: 'system',
        depth: 2,
        maximumTokens: 1200,
        includeEmptySections: false,
        includeCompletedQuests: false,
        includeResolvedConditions: false,
        includeHistory: false,
        sectionOrder: [],
        sectionOverrides: {},
        customHeader: '',
        customFooter: '',
    };
}

export function createBlankPersona(overrides = {}) {
    return {
        $schema: PERSONA_SCHEMA,
        schemaVersion: PERSONA_SCHEMA_VERSION,
        personaId: createId('persona'),
        name: '',
        aliases: [],
        summary: '',
        identity: {
            age: null,
            ageDisplay: '',
            gender: '',
            pronouns: '',
            species: '',
            race: '',
            nationality: '',
            occupation: '',
            rank: '',
            title: '',
            origin: '',
            affiliations: [],
            backstorySummary: '',
        },
        appearance: {
            baseDescription: '',
            height: '',
            weight: '',
            build: '',
            skin: '',
            hair: '',
            eyes: '',
            facialFeatures: '',
            distinguishingFeatures: [],
            currentAttire: [],
            temporaryChanges: [],
            other: '',
        },
        personality: {
            coreTraits: [],
            values: [],
            fears: [],
            motivations: [],
            habits: [],
            preferences: [],
            dislikes: [],
            boundaries: [],
            speechStyle: '',
            temporaryMood: '',
            developmentNotes: [],
        },
        attributes: [],
        skills: [],
        inventory: [],
        equipment: [],
        conditions: [],
        relationships: [],
        quests: [],
        goals: [],
        knowledge: [],
        currencies: [],
        customSections: [],
        locks: [],
        promptSettings: createDefaultPromptSettings(),
        metadata: {},
        ...overrides,
    };
}

export function createDefaultChatState() {
    return {
        storageVersion: STORAGE_VERSION,
        enabled: false,
        persona: null,
        pendingProposals: [],
        revisionHistory: [],
        checkpoints: [],
        analysisState: {
            status: 'idle',
            failures: 0,
            paused: false,
            lastAnalysedFingerprint: '',
            analysedFingerprints: [],
            lastError: '',
            lastWarnings: [],
            lastAnalysedAt: '',
            lockedSkipNotice: null,
        },
        chatSettings: {
            automaticAnalysis: true,
            streamlinedMode: false,
            branchStateSync: true,
        },
    };
}
