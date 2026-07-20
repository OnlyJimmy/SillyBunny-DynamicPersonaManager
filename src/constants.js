export const MODULE_NAME = 'dynamic-persona-manager';
export const DISPLAY_NAME = 'Dynamic Persona Manager';
export const METADATA_KEY = 'dynamicPersonaManager';
export const PERSONA_SCHEMA = 'dpm.persona.v1';
export const STORAGE_VERSION = 1;
export const PERSONA_SCHEMA_VERSION = 1;
export const REVISION_SCHEMA = 'dpm.revision.v1';
export const REVISION_VERSION = 1;
export const CHECKPOINT_SCHEMA = 'dpm.checkpoint.v1';
export const CHECKPOINT_VERSION = 1;
export const PROPOSAL_SCHEMA = 'dpm.proposal.v1';
export const PROPOSAL_VERSION = 1;

export const LOCAL_STORAGE_KEYS = Object.freeze({
    handlePosition: 'dpm--panel-handle-position-v1',
    panelLocked: 'dpm--panel-locked',
    panelWidth: 'dpm--panel-width',
    lastTab: 'dpm--panel-last-tab',
    collapsedSections: 'dpm--collapsed-sections',
});

export const PANEL_EVENT = 'sillybunny:right-panel-opening';
export const PANEL_ID = 'dynamic-persona-manager';

export const PROMPT_MODES = Object.freeze({
    full: 'full',
    compact: 'compact',
    minimal: 'minimal',
    adaptive: 'adaptive',
    custom: 'custom',
});

export const SECTION_ORDER = Object.freeze([
    'overview',
    'identity',
    'appearance',
    'personality',
    'attributes',
    'skills',
    'inventory',
    'equipment',
    'conditions',
    'relationships',
    'quests',
    'goals',
    'knowledge',
    'currencies',
    'customSections',
]);

export const COLLECTION_FIELDS = Object.freeze([
    'attributes',
    'skills',
    'inventory',
    'equipment',
    'conditions',
    'relationships',
    'quests',
    'goals',
    'knowledge',
    'currencies',
    'customSections',
]);

export const DEFAULT_GLOBAL_SETTINGS = Object.freeze({
    automaticAnalysisDefault: true,
    confidenceThreshold: 0.7,
    minimumImportance: 'material',
    analyserPromptVersion: 1,
    analyserPrompt: '',
    responseTokenAllowance: 800,
    analysisMalformedRetryLimit: 1,
    analysisProfileId: '',
    analysisContextLimit: 6000,
    nativeConversionTokenAllowance: 1800,
    promptMode: PROMPT_MODES.compact,
    promptTokenBudget: 1200,
    promptSectionOrder: [],
    promptSortMode: 'sectionOrder',
    nativePersonaMode: 'hybrid',
    failurePauseThreshold: 3,
    historyRetention: 500,
    checkpointInterval: 25,
    evidenceExcerptMaximum: 200,
    blockChatSendDuringOperation: false,
    debugMode: false,
    defaultSectionVisibility: {},
});
