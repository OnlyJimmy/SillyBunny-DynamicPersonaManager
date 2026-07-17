import { cloneJson } from '../utils/cloning.js';
import { renderCompactPrompt } from '../prompting/renderer.js';

export function buildPersonaExport(state) {
    if (!state?.persona) {
        throw new Error('No managed persona is available to export.');
    }

    return {
        exportType: 'dpm.persona',
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        persona: cloneJson(state.persona),
    };
}

export function buildFullBackupExport(state) {
    return {
        exportType: 'dpm.full-backup',
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        state: cloneJson(state),
    };
}

export function buildPlainTextPersonaExport(state, options = {}) {
    if (!state?.persona) {
        throw new Error('No managed persona is available to export.');
    }

    const persona = state.persona;
    const exportedAt = new Date().toISOString();
    const rendered = renderCompactPrompt(persona, {
        maximumTokens: 0,
        ...(options.renderOptions || {}),
    });

    return [
        `Dynamic Persona Manager Plain Text Export`,
        `Exported: ${exportedAt}`,
        `Persona: ${persona.name || 'Unnamed'}`,
        '',
        rendered,
        '',
        'Note: This plain-text export is for reading, sharing, or external analysis. Use JSON export to reimport into DPM.',
    ].join('\n');
}

export function buildPromptTextExport(state, options = {}) {
    if (!state?.persona) {
        throw new Error('No managed persona is available to export.');
    }

    return renderCompactPrompt(state.persona, {
        maximumTokens: 0,
        ...(options.renderOptions || {}),
    });
}

export function buildNativePersonaTextExport(state) {
    if (!state?.persona) {
        throw new Error('No managed persona is available to export.');
    }

    const persona = state.persona;
    const identity = persona.identity || {};
    const appearance = persona.appearance || {};
    const personality = persona.personality || {};
    const lines = [
        `Name: ${persona.name || 'Unnamed'}`,
        persona.aliases?.length ? `Aliases: ${persona.aliases.join(', ')}` : '',
        '',
        'Description:',
        [
            persona.summary,
            identity.backstorySummary,
            appearance.baseDescription,
            appearance.currentAttire?.length ? `Current attire: ${appearance.currentAttire.map(item => item.name || item.description).filter(Boolean).join(', ')}` : '',
            appearance.distinguishingFeatures?.length ? `Distinguishing features: ${appearance.distinguishingFeatures.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
        '',
        'Personality:',
        [
            personality.coreTraits?.length ? `Traits: ${personality.coreTraits.map(trait => trait.name || trait.description).filter(Boolean).join(', ')}` : '',
            personality.values?.length ? `Values: ${personality.values.join(', ')}` : '',
            personality.motivations?.length ? `Motivations: ${personality.motivations.join(', ')}` : '',
            personality.speechStyle ? `Speech style: ${personality.speechStyle}` : '',
            personality.boundaries?.length ? `Boundaries: ${personality.boundaries.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
        '',
        'Scenario notes:',
        [
            persona.quests?.length ? `Quests: ${persona.quests.map(quest => quest.title || quest.description).filter(Boolean).join('; ')}` : '',
            persona.goals?.length ? `Goals: ${persona.goals.map(goal => goal.title || goal.description).filter(Boolean).join('; ')}` : '',
            persona.relationships?.length ? `Relationships: ${persona.relationships.map(rel => `${rel.entityName || 'Unknown'}${rel.summary ? ` - ${rel.summary}` : ''}`).join('; ')}` : '',
            persona.knowledge?.length ? `Knowledge: ${persona.knowledge.map(item => `${item.subject || 'Fact'}: ${item.fact || ''}`).join('; ')}` : '',
        ].filter(Boolean).join('\n'),
    ];

    return lines
        .map(line => String(line || '').trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
