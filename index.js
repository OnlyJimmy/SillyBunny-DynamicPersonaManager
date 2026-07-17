import { extension_settings, getContext } from '../../../extensions.js';
import { POPUP_RESULT, POPUP_TYPE, Popup, callGenericPopup } from '../../../popup.js';
import { download, escapeHtml } from '../../../utils.js';
import { SWIPE_DIRECTION, SWIPE_SOURCE } from '../../../constants.js';
import { extension_prompt_roles, extension_prompt_types, name1, saveSettingsDebounced, setExtensionPrompt, swipe } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { user_avatar } from '../../../personas.js';
import { ConnectionManagerRequestService } from '../../shared.js';
import { DEFAULT_GLOBAL_SETTINGS, DISPLAY_NAME, LOCAL_STORAGE_KEYS, MODULE_NAME, PANEL_EVENT, PANEL_ID, PROMPT_MODES, SECTION_ORDER } from './src/constants.js';
import { analysePair } from './src/analysis/analyser.js';
import { findLatestCompletedPair, fingerprintPair, hasAnalysedFingerprint, rememberAnalysedFingerprint } from './src/analysis/fingerprints.js';
import { annotateProposalStaleness, getProposalSourceState } from './src/analysis/staleness.js';
import { buildFullBackupExport, buildNativePersonaTextExport, buildPersonaExport, buildPlainTextPersonaExport, buildPromptTextExport } from './src/import-export/exporter.js';
import { analyseNativePersona } from './src/import-export/native-converter.js';
import { createPersonaFromNativeText, mergeImportedPersona, parseDpmImport } from './src/import-export/importer.js';
import { simulateOperations } from './src/operations/apply.js';
import { annotateOperationConflicts, operationHasConflicts } from './src/operations/conflicts.js';
import { createPersonaDiffOperations } from './src/operations/diff.js';
import { createInverseOperations } from './src/operations/inverse.js';
import { normalizeOperation } from './src/operations/normalize.js';
import { createProposal, proposalHasPendingOperations } from './src/operations/proposals.js';
import { renderCompactPrompt } from './src/prompting/renderer.js';
import { createBlankPersona, createDefaultGlobalSettings } from './src/state/defaults.js';
import { ensureChatState, readChatState, resetChatState, writeChatState } from './src/state/repository.js';
import { createCheckpoint, createRevision, findNearestCheckpointForAnchor, findPreviousCheckpointBeforeAnchor } from './src/state/revisions.js';
import { validatePersona } from './src/state/schema.js';
import { LOCK_MODES, getLocksForPath } from './src/state/locks.js';
import { cloneJson } from './src/utils/cloning.js';
import { createId } from './src/utils/ids.js';
import {
    COLLECTION_FIELD_DEFINITIONS,
    COLLECTION_LABELS,
    COLLAPSIBLE_SECTIONS,
    SECTION_LABELS,
    coerceEditorValue,
    createDefaultCollectionEntry,
    getCollectionItemTitle,
    listToText,
    readCollapsedSections,
    storeCollapsedSections,
    textToList,
} from './src/ui/character-editor.js';
import { bindDockableHandle, parseStoredHandlePosition } from './src/ui/handle.js';

let initialized = false;
let panelOpen = false;
let activeTab = getLocalValue(LOCAL_STORAGE_KEYS.lastTab) || 'character';
let panelLocked = getLocalValue(LOCAL_STORAGE_KEYS.panelLocked) === 'true';
let cleanupHandle = null;
let collapsedSections = readCollapsedSections();
let analysisRunId = 0;
let analysisAbortController = null;
let scheduledAnalysisTimer = null;
let renderingPersona = null;

const LOCK_MODE_LABELS = Object.freeze({
    [LOCK_MODES.proposalLocked]: 'Block proposals',
    [LOCK_MODES.confirmationLocked]: 'Require individual accept',
    [LOCK_MODES.promptHidden]: 'Hide from prompt',
    [LOCK_MODES.analysisHidden]: 'Hide from analysis',
    [LOCK_MODES.immutable]: 'Immutable',
});

function getLocalValue(key) {
    try {
        return globalThis.localStorage?.getItem?.(key) ?? '';
    } catch {
        return '';
    }
}

function setLocalValue(key, value) {
    try {
        globalThis.localStorage?.setItem?.(key, String(value));
    } catch {
        // Browser storage may be unavailable; panel still works for the session.
    }
}

function getSettings() {
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
        extension_settings[MODULE_NAME] = createDefaultGlobalSettings();
    }

    for (const [key, value] of Object.entries(DEFAULT_GLOBAL_SETTINGS)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = value;
        }
    }

    return extension_settings[MODULE_NAME];
}

function notify(message, type = 'info') {
    if (globalThis.toastr?.[type]) {
        globalThis.toastr[type](message, DISPLAY_NAME);
    } else {
        console[type === 'error' ? 'error' : 'log'](`[DPM] ${message}`);
    }
}

function getPromptPosition(value) {
    switch (value) {
        case 'inChat': return extension_prompt_types.IN_CHAT;
        case 'beforePrompt': return extension_prompt_types.BEFORE_PROMPT;
        case 'none': return extension_prompt_types.NONE;
        case 'inPrompt':
        default: return extension_prompt_types.IN_PROMPT;
    }
}

function getPromptRole(value) {
    switch (value) {
        case 'user': return extension_prompt_roles.USER;
        case 'assistant': return extension_prompt_roles.ASSISTANT;
        case 'system':
        default: return extension_prompt_roles.SYSTEM;
    }
}

function getPromptRenderOptions(persona = null) {
    const settings = getSettings();
    const promptSettings = persona?.promptSettings ?? {};
    return {
        mode: promptSettings.mode || settings.promptMode,
        maximumTokens: Number(promptSettings.maximumTokens || settings.promptTokenBudget || 0),
        sectionOrder: promptSettings.sectionOrder?.length ? promptSettings.sectionOrder : settings.promptSectionOrder,
        sortMode: settings.promptSortMode,
        customHeader: promptSettings.customHeader || '',
        customFooter: promptSettings.customFooter || '',
    };
}

function getConnectionProfiles() {
    return Array.isArray(extension_settings.connectionManager?.profiles)
        ? extension_settings.connectionManager.profiles
        : [];
}

function getSelectedAnalysisProfile() {
    const profileId = getSettings().analysisProfileId;
    if (!profileId) return null;
    return getConnectionProfiles().find(profile => profile.id === profileId) || null;
}

async function generateDpmRaw({ prompt, responseLength, signal }) {
    const profile = getSelectedAnalysisProfile();
    const contextLimit = Math.max(1000, Number(getSettings().analysisContextLimit || 6000));
    const maximumCharacters = contextLimit * 4;
    const requestPrompt = String(prompt || '').length > maximumCharacters
        ? `[Earlier DPM analysis context omitted to fit the configured limit.]\n\n${String(prompt).slice(-maximumCharacters)}`
        : prompt;
    if (!profile) {
        return getContext().generateRaw({
            prompt: requestPrompt,
            responseLength,
            trimNames: true,
            cacheScope: 'auxiliary',
            signal,
        });
    }

    const response = await ConnectionManagerRequestService.sendRequest(
        profile.id,
        requestPrompt,
        Number(responseLength || getSettings().responseTokenAllowance || 800),
        { stream: false, signal, extractData: true, includePreset: true, includeInstruct: true },
    );
    return String(response?.content || response?.text || response || '').trim();
}

function refreshPromptInjection() {
    const context = getContext();
    const { state, readOnly } = readChatState(context);
    const persona = state.enabled && !readOnly ? state.persona : null;
    const prompt = persona ? renderCompactPrompt(persona, getPromptRenderOptions(persona)) : '';
    const settings = persona?.promptSettings ?? {};
    setExtensionPrompt(
        MODULE_NAME,
        prompt,
        getPromptPosition(settings.position),
        Number(settings.depth ?? 2),
        false,
        getPromptRole(settings.role),
    );
    return prompt;
}

function refreshHandleState(state) {
    const handle = getHandle();
    if (!handle) return;
    const analysisState = state?.analysisState ?? {};
    handle.dataset.analysisState = state?.enabled === false
        ? 'disabled'
        : analysisState.paused
            ? 'paused'
            : analysisState.status || 'idle';
}

function getRevisionSourceAnchor(context, source = null) {
    if (source?.type === 'latest-pair') {
        return {
            type: 'latest-pair',
            fingerprint: source.fingerprint || '',
            userMessageId: source.userMessageId ?? null,
            assistantMessageId: source.assistantMessageId ?? null,
            assistantSwipeId: Number.isInteger(source.assistantSwipeId) ? source.assistantSwipeId : 0,
        };
    }
    if (source?.type === 'chat-position') {
        return {
            type: 'chat-position',
            messageId: source.messageId ?? null,
            assistantSwipeId: Number.isInteger(source.assistantSwipeId) ? source.assistantSwipeId : null,
        };
    }

    const pair = findLatestCompletedPair(context?.chat);
    if (pair) {
        return {
            type: 'latest-pair',
            fingerprint: fingerprintPair(pair),
            userMessageId: String(pair.userIndex),
            assistantMessageId: String(pair.assistantIndex),
            assistantSwipeId: pair.assistantSwipeId,
        };
    }

    const lastIndex = Array.isArray(context?.chat) ? context.chat.length - 1 : -1;
    return lastIndex >= 0
        ? { type: 'chat-position', messageId: String(lastIndex), assistantSwipeId: null }
        : null;
}

function makeRevision(state, before, after, summary, options = {}) {
    const retention = Number(getSettings().historyRetention ?? 500);
    const nextSequence = (state.revisionHistory.at(-1)?.sequence ?? 0) + 1;
    const sourceAnchor = getRevisionSourceAnchor(getContext(), options.source);
    const operations = options.operations || createPersonaDiffOperations(before, after, {
        reason: `Revertible snapshot for ${summary}`,
    });
    const inverseOperations = options.inverseOperations || (operations.length ? createInverseOperations(operations, before, after) : []);
    const revision = createRevision({
        personaBefore: before,
        personaAfter: after,
        sourceType: options.sourceType || 'manual',
        sourceProposalId: options.sourceProposalId || null,
        operations,
        inverseOperations,
        sourceAnchor,
        summary,
        sequence: nextSequence,
    });
    const checkpoint = createCheckpoint({
        persona: after,
        revision,
        sourceAnchor,
    });
    state.checkpoints = [...(state.checkpoints || []), checkpoint].slice(-retention);
    return [...state.revisionHistory, revision].slice(-retention);
}

function getPanel() {
    return document.getElementById('dpm--panel');
}

function getHandle() {
    return document.getElementById('dpm--panel-handle');
}

function ensurePanelDom() {
    if (getPanel()) return;

    document.body.insertAdjacentHTML('beforeend', `
        <button id="dpm--panel-handle" type="button" title="Dynamic Persona Manager" aria-label="Open Dynamic Persona Manager">
            <i class="fa-solid fa-user-pen"></i>
            <span id="dpm--panel-handle-label">Persona</span>
            <span id="dpm--panel-handle-badge" hidden></span>
        </button>
        <aside id="dpm--panel" aria-label="Dynamic Persona Manager" aria-hidden="true">
            <div id="dpm--panel-header">
                <div class="dpm--panel-title">
                    <i class="fa-solid fa-user-pen"></i>
                    <div>
                        <strong id="dpm--panel-persona-name">No persona</strong>
                        <small id="dpm--panel-status">Disabled</small>
                    </div>
                </div>
                <div class="dpm--panel-actions">
                    <button id="dpm--panel-lock" class="menu_button menu_button_icon" type="button" title="Lock panel open"><i class="fa-solid fa-lock-open"></i></button>
                    <button id="dpm--panel-close" class="menu_button menu_button_icon" type="button" title="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
            <nav id="dpm--panel-tabs" aria-label="Dynamic Persona Manager tabs">
                <button type="button" data-tab="character">Character</button>
                <button type="button" data-tab="pending">Pending</button>
                <button type="button" data-tab="history">History</button>
                <button type="button" data-tab="prompt">Prompt</button>
                <button type="button" data-tab="settings">Settings</button>
            </nav>
            <div id="dpm--panel-body"></div>
        </aside>
    `);

    const handle = getHandle();
    cleanupHandle = bindDockableHandle(handle, {
        loadPosition: () => parseStoredHandlePosition(getLocalValue(LOCAL_STORAGE_KEYS.handlePosition)),
        savePosition: dock => setLocalValue(LOCAL_STORAGE_KEYS.handlePosition, JSON.stringify(dock)),
        onClick: togglePanel,
    });

    document.getElementById('dpm--panel-close')?.addEventListener('click', closePanel);
    document.getElementById('dpm--panel-lock')?.addEventListener('click', () => {
        panelLocked = !panelLocked;
        setLocalValue(LOCAL_STORAGE_KEYS.panelLocked, panelLocked ? 'true' : 'false');
        renderPanel();
    });
    document.getElementById('dpm--panel-tabs')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-tab]');
        if (!button) return;
        activeTab = button.dataset.tab;
        setLocalValue(LOCAL_STORAGE_KEYS.lastTab, activeTab);
        renderPanel();
    });
    document.getElementById('dpm--panel-body')?.addEventListener('click', onPanelClick);
    document.getElementById('dpm--panel-body')?.addEventListener('change', onPanelChange);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && panelOpen && !panelLocked && !document.querySelector('dialog[open]')) {
            closePanel();
        }
    });
    window.addEventListener(PANEL_EVENT, event => {
        if (event.detail?.panelId !== PANEL_ID && panelOpen && !panelLocked) closePanel();
    });
}

function openPanel() {
    ensurePanelDom();
    window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: { panelId: PANEL_ID } }));
    panelOpen = true;
    getPanel()?.classList.add('dpm--open');
    getPanel()?.setAttribute('aria-hidden', 'false');
    getHandle()?.classList.add('dpm--open');
    renderPanel();
}

function closePanel() {
    panelOpen = false;
    getPanel()?.classList.remove('dpm--open');
    getPanel()?.setAttribute('aria-hidden', 'true');
    getHandle()?.classList.remove('dpm--open');
}

function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
}

function renderPanel() {
    ensurePanelDom();
    closeLockMenus();
    const { state, readOnly, errors } = readChatState(getContext());
    const personaName = state.persona?.name?.trim() || 'No persona';
    const pendingCount = state.pendingProposals?.length ?? 0;

    document.getElementById('dpm--panel-persona-name').textContent = personaName;
    document.getElementById('dpm--panel-status').textContent = readOnly ? 'Read-only metadata' : state.enabled ? 'Enabled' : 'Disabled';
    refreshHandleState(state);
    document.getElementById('dpm--panel-lock').innerHTML = panelLocked ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>';
    const badge = document.getElementById('dpm--panel-handle-badge');
    badge.textContent = String(pendingCount);
    badge.hidden = pendingCount === 0;

    for (const tab of document.querySelectorAll('#dpm--panel-tabs button')) {
        tab.classList.toggle('active', tab.dataset.tab === activeTab);
    }

    const body = document.getElementById('dpm--panel-body');
    closeLockMenus();
    if (readOnly) {
        body.innerHTML = renderReadOnly(errors);
        return;
    }

    const renderers = {
        character: renderCharacterTab,
        pending: renderPendingTab,
        history: renderHistoryTab,
        prompt: renderPromptTab,
        settings: renderSettingsTab,
    };
    body.innerHTML = (renderers[activeTab] ?? renderCharacterTab)(state);
}

function renderReadOnly(errors) {
    return `
        <section class="dpm--notice dpm--danger">
            <strong>DPM metadata opened read-only.</strong>
            <p>${escapeHtml((errors || []).join(' ') || 'The stored metadata is not compatible with this extension version.')}</p>
        </section>
    `;
}

function renderCharacterTab(state) {
    if (!state.persona) {
        return `
            <section class="dpm--empty">
                <i class="fa-solid fa-user-plus"></i>
                <h3>No managed persona in this chat</h3>
                <p>Create a blank persona or import a DPM JSON file to start tracking mutable player-character state.</p>
                <div class="dpm--button-row">
                    <button class="dpm--action-button" type="button" data-action="create-blank">Create blank persona</button>
                    <button class="dpm--action-button" type="button" data-action="analyse-native-persona"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Analyse native persona</span></button>
                    <button class="dpm--action-button" type="button" data-action="import-json">Import JSON</button>
                </div>
            </section>
        `;
    }

    renderingPersona = state.persona;
    return `
        <div class="dpm--sticky-actions">
            <label class="checkbox_label"><input id="dpm--enabled" type="checkbox" ${state.enabled ? 'checked' : ''}> Enabled for this chat</label>
            <div class="dpm--button-row">
                <button class="dpm--action-button dpm--primary-action" type="button" data-action="save-section-editor"><i class="fa-solid fa-floppy-disk"></i><span>Save edits</span></button>
                <button class="dpm--action-button" type="button" data-action="export-persona-text"><i class="fa-solid fa-file-lines"></i><span>Export text</span></button>
                <button class="dpm--action-button" type="button" data-action="export-persona-json"><i class="fa-solid fa-file-code"></i><span>Export JSON</span></button>
                <button class="dpm--action-button" type="button" data-action="analyse-native-persona"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Analyse native</span></button>
                <button class="dpm--action-button" type="button" data-action="import-json"><i class="fa-solid fa-file-import"></i><span>Import</span></button>
            </div>
        </div>
        ${renderOverviewSection(state)}
        ${renderIdentitySection(state.persona)}
        ${renderAppearanceSection(state.persona)}
        ${renderPersonalitySection(state.persona)}
        ${Object.keys(COLLECTION_LABELS).map(collectionName => renderCollectionSection(state.persona, collectionName)).join('')}
        ${renderAdvancedJsonSection(state)}
    `;
}

function isSectionCollapsed(sectionName) {
    return collapsedSections.has(sectionName);
}

function editorPathToPointer(path) {
    if (!path) return '';
    if (path.startsWith('/')) return path;
    if (path === 'name' || path === 'aliases' || path === 'summary') return `/${path}`;
    if (path === 'identity.affiliationsText') return '/identity/affiliations';
    return `/${String(path).split('.').join('/')}`;
}

function getSectionLockPath(sectionName) {
    if (['advancedJson', 'overview'].includes(sectionName)) return '';
    return `/${sectionName}`;
}

function renderLockControls(path, { compact = false } = {}) {
    if (!renderingPersona || !path) return '';
    const locked = getLocksForPath(renderingPersona, path).length > 0;
    return `
        <div class="dpm--lock-controls ${compact ? 'dpm--lock-compact' : ''}" data-lock-path="${escapeHtml(path)}">
            <button class="menu_button menu_button_icon dpm--lock-toggle ${locked ? 'dpm--has-lock' : ''}" type="button" data-action="toggle-lock-menu" data-lock-path="${escapeHtml(path)}" title="${locked ? 'Manage locks' : 'Add lock'}">
                <i class="fa-solid fa-lock${locked ? '' : '-open'}"></i>
            </button>
        </div>
    `;
}

function renderLockMenuContent(path) {
    const exactLocks = getLocksForPath(renderingPersona, path).filter(lock => lock.path === path);
    const inheritedLocks = getLocksForPath(renderingPersona, path).filter(lock => lock.path !== path);
    return `
        <div class="dpm--lock-menu-title">${escapeHtml(path)}</div>
        ${Object.entries(LOCK_MODE_LABELS).map(([mode, label]) => {
            const existing = exactLocks.find(lock => lock.mode === mode);
            return existing
                ? `<button class="dpm--lock-menu-item dpm--active-lock" type="button" data-action="remove-lock" data-lock-id="${escapeHtml(existing.id)}"><i class="fa-solid fa-check"></i><span>${escapeHtml(label)}</span></button>`
                : `<button class="dpm--lock-menu-item" type="button" data-action="add-lock" data-lock-path="${escapeHtml(path)}" data-lock-mode="${escapeHtml(mode)}"><span>${escapeHtml(label)}</span></button>`;
        }).join('')}
        ${inheritedLocks.length ? `
            <div class="dpm--lock-inherited-list">
                <small>Inherited</small>
                ${inheritedLocks.map(lock => `<div>${escapeHtml(LOCK_MODE_LABELS[lock.mode] || lock.mode)} at ${escapeHtml(lock.path)}</div>`).join('')}
            </div>
        ` : ''}
    `;
}

function getLockMenuOverlay() {
    let menu = document.getElementById('dpm--lock-menu-portal');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'dpm--lock-menu-portal';
        menu.className = 'dpm--lock-menu dpm--lock-menu-portal';
        menu.hidden = true;
        document.body.append(menu);
    }
    return menu;
}

function closeLockMenus() {
    const menu = document.getElementById('dpm--lock-menu-portal');
    if (!menu) return;
    menu.hidden = true;
    menu.innerHTML = '';
    menu.removeAttribute('style');
}

function toggleLockMenu(button) {
    const path = button.dataset.lockPath;
    if (!path) return;
    const menu = getLockMenuOverlay();
    const isSameOpenMenu = !menu.hidden && menu.dataset.lockPath === path;
    closeLockMenus();
    if (isSameOpenMenu) return;

    menu.dataset.lockPath = path;
    menu.innerHTML = renderLockMenuContent(path);
    menu.hidden = false;
    positionLockMenu(button, menu);
}

function positionLockMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const menuWidth = Math.min(280, Math.max(210, menu.offsetWidth || 210));
    const menuHeight = menu.offsetHeight || 220;
    const left = Math.min(Math.max(rect.right - menuWidth, 8), Math.max(8, viewportWidth - menuWidth - 8));
    const top = Math.min(rect.bottom + 4, Math.max(8, viewportHeight - menuHeight - 8));

    menu.style.position = 'fixed';
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.right = 'auto';
}

async function onDocumentClick(event) {
    const menuButton = event.target.closest('#dpm--lock-menu-portal button[data-action]');
    if (menuButton) {
        event.preventDefault();
        event.stopPropagation();
        try {
            const action = menuButton.dataset.action;
            if (action === 'add-lock') addLockFromControl(menuButton);
            if (action === 'remove-lock') removeLock(menuButton.dataset.lockId);
        } catch (error) {
            notify(error.message, 'error');
        }
        return;
    }

    if (!event.target.closest('#dpm--lock-menu-portal') && !event.target.closest('.dpm--lock-controls')) {
        closeLockMenus();
    }
}

function renderSectionShell(sectionName, content, actions = '') {
    const collapsed = isSectionCollapsed(sectionName);
    const lockControls = renderLockControls(getSectionLockPath(sectionName), { compact: true });
    return `
        <section class="dpm--section ${collapsed ? 'dpm--collapsed' : ''}" data-section="${escapeHtml(sectionName)}">
            <div class="dpm--section-header">
                <button class="dpm--section-toggle" type="button" data-action="toggle-section" data-section="${escapeHtml(sectionName)}" aria-expanded="${collapsed ? 'false' : 'true'}">
                    <i class="fa-solid fa-chevron-${collapsed ? 'right' : 'down'}"></i>
                    <span>${escapeHtml(SECTION_LABELS[sectionName] || sectionName)}</span>
                </button>
                <div class="dpm--section-actions">${lockControls}${actions}</div>
            </div>
            <div class="dpm--section-body">
                ${content}
            </div>
        </section>
    `;
}

function renderTextInput(path, label, value, options = {}) {
    const rows = Number(options.rows ?? 1);
    const inputType = options.type || 'text';
    const lockControls = renderLockControls(editorPathToPointer(path), { compact: true });
    if (rows > 1) {
        return `<label>${escapeHtml(label)} ${lockControls}<textarea class="text_pole dpm--field" rows="${rows}" data-path="${escapeHtml(path)}">${escapeHtml(value ?? '')}</textarea></label>`;
    }
    return `<label>${escapeHtml(label)} ${lockControls}<input class="text_pole dpm--field" type="${escapeHtml(inputType)}" data-path="${escapeHtml(path)}" value="${escapeHtml(value ?? '')}"></label>`;
}

function renderListInput(path, label, value) {
    return `<label>${escapeHtml(label)} ${renderLockControls(editorPathToPointer(path), { compact: true })}<textarea class="text_pole dpm--field" rows="3" data-path="${escapeHtml(path)}" data-kind="list">${escapeHtml(listToText(value))}</textarea></label>`;
}

function renderOverviewSection(state) {
    const persona = state.persona;
    return renderSectionShell('overview', `
        <div class="dpm--field-grid">
            ${renderTextInput('name', 'Name', persona.name)}
            ${renderListInput('aliases', 'Aliases', persona.aliases)}
        </div>
        ${renderTextInput('summary', 'Summary', persona.summary, { rows: 5 })}
    `);
}

function renderIdentitySection(persona) {
    const identity = persona.identity ?? {};
    return renderSectionShell('identity', `
        <div class="dpm--field-grid">
            ${renderTextInput('identity.ageDisplay', 'Age display', identity.ageDisplay)}
            ${renderTextInput('identity.gender', 'Gender', identity.gender)}
            ${renderTextInput('identity.pronouns', 'Pronouns', identity.pronouns)}
            ${renderTextInput('identity.species', 'Species', identity.species)}
            ${renderTextInput('identity.race', 'Race', identity.race)}
            ${renderTextInput('identity.nationality', 'Nationality', identity.nationality)}
            ${renderTextInput('identity.occupation', 'Occupation', identity.occupation)}
            ${renderTextInput('identity.rank', 'Rank', identity.rank)}
            ${renderTextInput('identity.title', 'Title', identity.title)}
            ${renderTextInput('identity.origin', 'Origin', identity.origin)}
        </div>
        ${renderListInput('identity.affiliationsText', 'Affiliations notes', (identity.affiliations || []).map(item => item.name || item.notes || '').filter(Boolean))}
        ${renderTextInput('identity.backstorySummary', 'Backstory summary', identity.backstorySummary, { rows: 5 })}
    `);
}

function renderAppearanceSection(persona) {
    const appearance = persona.appearance ?? {};
    return renderSectionShell('appearance', `
        ${renderTextInput('appearance.baseDescription', 'Base description', appearance.baseDescription, { rows: 4 })}
        <div class="dpm--field-grid">
            ${renderTextInput('appearance.height', 'Height', appearance.height)}
            ${renderTextInput('appearance.weight', 'Weight', appearance.weight)}
            ${renderTextInput('appearance.build', 'Build', appearance.build)}
            ${renderTextInput('appearance.skin', 'Skin', appearance.skin)}
            ${renderTextInput('appearance.hair', 'Hair', appearance.hair)}
            ${renderTextInput('appearance.eyes', 'Eyes', appearance.eyes)}
        </div>
        ${renderTextInput('appearance.facialFeatures', 'Facial features', appearance.facialFeatures, { rows: 3 })}
        ${renderListInput('appearance.distinguishingFeatures', 'Distinguishing features', appearance.distinguishingFeatures)}
        ${renderListInput('appearance.temporaryChanges', 'Temporary changes', appearance.temporaryChanges)}
        ${renderTextInput('appearance.other', 'Other', appearance.other, { rows: 3 })}
    `);
}

function renderPersonalitySection(persona) {
    const personality = persona.personality ?? {};
    return renderSectionShell('personality', `
        <div class="dpm--field-grid">
            ${renderListInput('personality.values', 'Values', personality.values)}
            ${renderListInput('personality.fears', 'Fears', personality.fears)}
            ${renderListInput('personality.motivations', 'Motivations', personality.motivations)}
            ${renderListInput('personality.habits', 'Habits', personality.habits)}
            ${renderListInput('personality.preferences', 'Preferences', personality.preferences)}
            ${renderListInput('personality.dislikes', 'Dislikes', personality.dislikes)}
            ${renderListInput('personality.boundaries', 'Boundaries', personality.boundaries)}
        </div>
        ${renderTextInput('personality.speechStyle', 'Speech style', personality.speechStyle, { rows: 3 })}
        ${renderTextInput('personality.temporaryMood', 'Temporary mood', personality.temporaryMood)}
        ${renderListInput('personality.developmentNotes', 'Development notes', personality.developmentNotes)}
    `);
}

function renderCollectionSection(persona, collectionName) {
    const entries = Array.isArray(persona[collectionName]) ? persona[collectionName] : [];
    const actions = `
        <button class="menu_button menu_button_icon" type="button" data-action="add-entry" data-collection="${escapeHtml(collectionName)}" title="Add ${escapeHtml(COLLECTION_LABELS[collectionName])}">
            <i class="fa-solid fa-plus"></i>
        </button>
    `;
    const body = entries.length
        ? entries.map((entry, index) => renderCollectionEntry(collectionName, entry, index)).join('')
        : '<div class="dpm--empty-inline">No entries yet.</div>';
    return renderSectionShell(collectionName, body, actions);
}

function renderCollectionEntry(collectionName, entry, index) {
    const definitions = COLLECTION_FIELD_DEFINITIONS[collectionName] || [['name', 'Name', 'text']];
    const entryPath = `/${collectionName}/${index}`;
    return `
        <article class="dpm--entry" data-collection="${escapeHtml(collectionName)}" data-index="${index}">
            <div class="dpm--entry-header">
                <strong>${escapeHtml(getCollectionItemTitle(collectionName, entry))}</strong>
                <div class="dpm--entry-actions">
                    ${renderLockControls(entryPath, { compact: true })}
                    <button class="menu_button menu_button_icon" type="button" data-action="remove-entry" data-collection="${escapeHtml(collectionName)}" data-index="${index}" title="Remove entry">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="dpm--entry-fields">
                ${definitions.map(([field, label, type]) => renderEntryField(collectionName, index, entry, field, label, type)).join('')}
            </div>
        </article>
    `;
}

function renderEntryField(collectionName, index, entry, field, label, type) {
    const path = `${collectionName}.${index}.${field}`;
    const lockControls = renderLockControls(editorPathToPointer(path), { compact: true });
    const value = entry?.[field];
    if (type === 'textarea') {
        return `<label>${escapeHtml(label)} ${lockControls}<textarea class="text_pole dpm--collection-field" rows="3" data-path="${escapeHtml(path)}" data-type="${escapeHtml(type)}">${escapeHtml(value ?? '')}</textarea></label>`;
    }
    if (type === 'checkbox') {
        return `<label class="checkbox_label dpm--checkbox-field">${lockControls}<input class="dpm--collection-field" type="checkbox" data-path="${escapeHtml(path)}" data-type="${escapeHtml(type)}" ${value ? 'checked' : ''}> ${escapeHtml(label)}</label>`;
    }
    if (type?.startsWith('select:')) {
        const options = type.slice('select:'.length).split('|');
        return `
            <label>${escapeHtml(label)} ${lockControls}
                <select class="text_pole dpm--collection-field" data-path="${escapeHtml(path)}" data-type="${escapeHtml(type)}">
                    ${options.map(option => `<option value="${escapeHtml(option)}" ${String(value ?? '') === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
                </select>
            </label>
        `;
    }
    const inputType = type === 'number' ? 'number' : 'text';
    return `<label>${escapeHtml(label)} ${lockControls}<input class="text_pole dpm--collection-field" type="${inputType}" data-path="${escapeHtml(path)}" data-type="${escapeHtml(type)}" value="${escapeHtml(value ?? '')}"></label>`;
}

function renderAdvancedJsonSection(state) {
    return renderSectionShell('advancedJson', `
        <p class="dpm--muted">Advanced fallback. Saving here replaces the structured form values after validation.</p>
        <textarea id="dpm--persona-json" class="text_pole dpm--json-editor" spellcheck="false">${escapeHtml(JSON.stringify(state.persona, null, 2))}</textarea>
        <div class="dpm--button-row">
            <button class="dpm--action-button dpm--primary-action" type="button" data-action="save-persona"><i class="fa-solid fa-code"></i><span>Save JSON</span></button>
            <button class="dpm--action-button" type="button" data-action="export-prompt-text"><i class="fa-solid fa-scroll"></i><span>Export prompt</span></button>
            <button class="dpm--action-button" type="button" data-action="export-native-text"><i class="fa-solid fa-user-pen"></i><span>Export native</span></button>
            <button class="dpm--action-button" type="button" data-action="export-backup"><i class="fa-solid fa-box-archive"></i><span>Export backup</span></button>
        </div>
    `);
}

function renderPendingTab(state) {
    const notice = renderLockedSkipNotice(state.analysisState?.lockedSkipNotice);
    const branchNotice = renderBranchCheckpointNotice(state);
    const streamlinedNotice = renderStreamlinedModeNotice(state);
    if (!state.pendingProposals.length) {
        return `
            ${streamlinedNotice}
            ${notice}
            ${branchNotice}
            <section class="dpm--empty">
                <i class="fa-solid fa-inbox"></i>
                <h3>No pending proposals</h3>
                <p>Model analysis is intentionally deferred. Pending operations will appear here later and will never apply without confirmation.</p>
                ${state.persona && getSettings().debugMode ? '<button class="dpm--action-button" type="button" data-action="create-demo-proposal"><i class="fa-solid fa-flask"></i><span>Create demo proposal</span></button>' : ''}
            </section>
        `;
    }
    return streamlinedNotice + notice + branchNotice + renderPendingBatchToolbar(state) + getAnnotatedPendingProposals(state)
        .map(proposal => renderPendingProposal(proposal))
        .join('');
}

function renderPendingBatchToolbar(state) {
    const pendingCount = (state.pendingProposals || [])
        .flatMap(proposal => proposal.operations || [])
        .filter(operation => operation.status !== 'accepted' && operation.status !== 'rejected')
        .length;
    return `
        <section class="dpm--pending-toolbar">
            <span>${escapeHtml(pendingCount)} operation${pendingCount === 1 ? '' : 's'} awaiting review</span>
            <div class="dpm--button-row">
                <button class="dpm--action-button dpm--primary-action" type="button" data-action="accept-selected-operations"><i class="fa-solid fa-check-double"></i><span>Accept selected</span></button>
                <button class="dpm--action-button dpm--danger-action" type="button" data-action="reject-selected-operations"><i class="fa-solid fa-xmark"></i><span>Reject selected</span></button>
                <button class="dpm--action-button" type="button" data-action="reject-all-operations"><i class="fa-solid fa-trash-can"></i><span>Reject all</span></button>
                <button class="dpm--action-button" type="button" data-action="reanalyse-latest-pair"><i class="fa-solid fa-rotate"></i><span>Reanalyse</span></button>
            </div>
        </section>
    `;
}

function getAnnotatedPendingProposals(state) {
    const context = getContext();
    return annotateOperationConflicts(
        (state.pendingProposals || []).map(proposal => annotateProposalStaleness(context.chat, proposal)),
    );
}

function renderStreamlinedModeNotice(state) {
    const enabled = !!state.chatSettings?.streamlinedMode;
    return `
        <section class="dpm--streamlined-mode-notice ${enabled ? 'dpm--active' : ''}">
            <span><i class="fa-solid fa-bolt"></i> Streamlined Mode ${enabled ? 'enabled' : 'disabled'}</span>
            <label class="checkbox_label"><input id="dpm--streamlined-mode" type="checkbox" ${enabled ? 'checked' : ''}> Auto-approve valid proposals</label>
        </section>
    `;
}

function renderBranchCheckpointNotice(state) {
    if (!state?.persona) return '';
    const activeAnchor = getRevisionSourceAnchor(getContext());
    const checkpoint = findNearestCheckpointForAnchor(state.checkpoints, activeAnchor, state.persona);
    if (!checkpoint) return '';
    return `
        <section class="dpm--branch-checkpoint-notice">
            <span><i class="fa-solid fa-code-branch"></i> Earlier chat checkpoint available: #${escapeHtml(checkpoint.sequence)}${checkpoint.sourceAnchor ? ` (${escapeHtml(renderSourceAnchor(checkpoint.sourceAnchor))})` : ''}</span>
            <button class="dpm--action-button" type="button" data-action="restore-checkpoint" data-checkpoint-id="${escapeHtml(checkpoint.checkpointId)}"><i class="fa-solid fa-clock-rotate-left"></i><span>Restore</span></button>
        </section>
    `;
}

function renderLockedSkipNotice(notice) {
    const count = Number(notice?.count || 0);
    if (!count) return '';
    return `
        <section class="dpm--locked-skip-notice">
            <span><i class="fa-solid fa-lock"></i> Locked Changes Skipped - ${escapeHtml(count)}</span>
            <button class="menu_button menu_button_icon" type="button" data-action="dismiss-locked-skip-notice" title="Dismiss"><i class="fa-solid fa-xmark"></i></button>
        </section>
    `;
}

function stringifyPreview(value) {
    if (value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return text.length > 600 ? `${text.slice(0, 600)}...` : text;
}

function renderPendingProposal(proposal) {
    const pendingOperations = (proposal.operations || []).filter(operation => operation.status !== 'accepted' && operation.status !== 'rejected');
    const completedCount = (proposal.operations || []).length - pendingOperations.length;
    return `
        <article class="dpm--proposal ${proposal.stale ? 'dpm--stale' : ''}" data-proposal-id="${escapeHtml(proposal.proposalId)}">
            <div class="dpm--proposal-header">
                <div>
                    <strong>${escapeHtml(proposal.summary || 'Pending proposal')}</strong>
                    <small>${escapeHtml(new Date(proposal.createdAt || Date.now()).toLocaleString())}</small>
                </div>
                <span class="dpm--muted">${pendingOperations.length} pending${completedCount ? `, ${completedCount} handled` : ''}</span>
            </div>
            ${proposal.stale ? `<p class="dpm--stale-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(proposal.staleReason || 'Proposal is stale for the active swipe.')}</p>` : ''}
            ${pendingOperations.length ? pendingOperations.map(operation => renderPendingOperation(proposal, operation)).join('') : '<p class="dpm--muted">No pending operations remain.</p>'}
        </article>
    `;
}

function renderPendingOperation(proposal, operation) {
    const conflictCount = operation.conflicts?.length || 0;
    const isBlocked = proposal.stale || operationHasConflicts(operation);
    const transactionLabel = operation.transactionLabel || operation.transactionId;
    const sourceAnchor = getOperationSourceAnchor(proposal, operation);
    const title = operation.targetLabel || operation.path;
    const changeType = operation.changeType || operation.type;
    const metadata = [
        operation.category,
        operation.importance ? `importance ${operation.importance}` : '',
        operation.severity ? `severity ${operation.severity}` : '',
        operation.confidence === null || operation.confidence === undefined ? '' : `confidence ${operation.confidence}`,
    ].filter(Boolean);
    return `
        <section class="dpm--operation-card">
            <div class="dpm--operation-header">
                <label class="checkbox_label dpm--operation-select"><input type="checkbox" class="dpm--operation-checkbox" data-proposal-id="${escapeHtml(proposal.proposalId)}" data-operation-id="${escapeHtml(operation.operationId)}"> <strong>${escapeHtml(changeType)}: ${escapeHtml(title)}</strong></label>
                ${renderSourceNavigationButton(sourceAnchor, 'Source')}
            </div>
            <p class="dpm--muted">${escapeHtml(renderSourceAnchor(sourceAnchor) || renderSourceAnchor(proposal.source) || 'Source: latest analysed pair')}</p>
            ${metadata.length ? `<div class="dpm--metadata-row">${metadata.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
            ${transactionLabel ? `<p class="dpm--transaction-note"><i class="fa-solid fa-layer-group"></i> Transaction: ${escapeHtml(transactionLabel)}</p>` : ''}
            ${conflictCount ? `<p class="dpm--conflict-warning"><i class="fa-solid fa-triangle-exclamation"></i> Conflict detected with ${escapeHtml(conflictCount)} pending operation${conflictCount === 1 ? '' : 's'}.</p>` : ''}
            ${operation.validationWarnings?.length ? `<ul class="dpm--validation-warnings">${operation.validationWarnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}
            ${operation.reason ? `<p>${escapeHtml(operation.reason)}</p>` : ''}
            ${operation.evidence ? `<blockquote>${escapeHtml(operation.evidence)}</blockquote>` : ''}
            ${operation.oldValue !== undefined ? `<label>Expected current value<textarea class="text_pole" readonly>${escapeHtml(stringifyPreview(operation.oldValue))}</textarea></label>` : ''}
            ${operation.type !== 'remove' ? `<label>Proposed value<textarea class="text_pole" readonly>${escapeHtml(stringifyPreview(operation.value))}</textarea></label>` : ''}
            <div class="dpm--button-row">
                <button class="dpm--action-button dpm--primary-action" type="button" data-action="accept-operation" data-proposal-id="${escapeHtml(proposal.proposalId)}" data-operation-id="${escapeHtml(operation.operationId)}" ${isBlocked ? 'disabled' : ''}><i class="fa-solid fa-check"></i><span>${operation.transactionId ? 'Accept transaction' : 'Accept'}</span></button>
                <button class="dpm--action-button" type="button" data-action="edit-operation" data-proposal-id="${escapeHtml(proposal.proposalId)}" data-operation-id="${escapeHtml(operation.operationId)}"><i class="fa-solid fa-pen"></i><span>Edit</span></button>
                <button class="dpm--action-button dpm--danger-action" type="button" data-action="reject-operation" data-proposal-id="${escapeHtml(proposal.proposalId)}" data-operation-id="${escapeHtml(operation.operationId)}"><i class="fa-solid fa-xmark"></i><span>Reject</span></button>
            </div>
        </section>
    `;
}

function renderHistoryTab(state) {
    if (!state.revisionHistory.length) {
        return '<section class="dpm--empty"><i class="fa-solid fa-clock-rotate-left"></i><h3>No revisions yet</h3><p>Manual saves create auditable revisions for this chat.</p></section>';
    }

    const checkpointByRevision = new Map((state.checkpoints || []).map(checkpoint => [checkpoint.revisionId, checkpoint]));
    return state.revisionHistory.slice().reverse().map(revision => {
        const checkpoint = checkpointByRevision.get(revision.revisionId);
        const anchor = revision.sourceAnchor || checkpoint?.sourceAnchor;
        return `
        <article class="dpm--history-entry">
            <div class="dpm--history-header">
                <div>
                    <strong>#${revision.sequence} ${escapeHtml(revision.summary)}</strong>
                    <small>${escapeHtml(new Date(revision.timestamp).toLocaleString())}</small>
                    ${anchor ? `<small>${escapeHtml(renderSourceAnchor(anchor))}</small>` : ''}
                    ${revision.revertedByRevisionId ? '<small>Reverted</small>' : ''}
                </div>
                <div class="dpm--button-row">
                    ${renderSourceNavigationButton(anchor, 'Source')}
                    ${checkpoint ? `<button class="dpm--action-button" type="button" data-action="restore-checkpoint" data-checkpoint-id="${escapeHtml(checkpoint.checkpointId)}"><i class="fa-solid fa-clock-rotate-left"></i><span>Restore</span></button>` : ''}
                    <button class="dpm--action-button dpm--danger-action" type="button" data-action="revert-revision" data-revision-id="${escapeHtml(revision.revisionId)}" ${revision.revertedByRevisionId || !revision.inverseOperations?.length ? 'disabled' : ''}><i class="fa-solid fa-rotate-left"></i><span>Revert</span></button>
                </div>
            </div>
            ${renderRevisionOperationSummary(revision)}
            <code>${escapeHtml(revision.personaHashBefore)} -> ${escapeHtml(revision.personaHashAfter)}</code>
        </article>
    `;
    }).join('');
}

function renderRevisionOperationSummary(revision) {
    const operations = Array.isArray(revision.operations) ? revision.operations : [];
    if (!operations.length) return '';
    return `
        <details class="dpm--revision-operations">
            <summary>${escapeHtml(operations.length)} operation${operations.length === 1 ? '' : 's'}</summary>
            <ul>
                ${operations.map(operation => {
                    const label = operation.targetLabel || operation.path || 'operation';
                    const type = operation.changeType || operation.type || 'change';
                    const meta = [operation.category, operation.importance, operation.severity].filter(Boolean).join(' | ');
                    return `<li><strong>${escapeHtml(type)}: ${escapeHtml(label)}</strong>${meta ? ` <span class="dpm--muted">${escapeHtml(meta)}</span>` : ''}</li>`;
                }).join('')}
            </ul>
        </details>
    `;
}

function getOperationSourceAnchor(proposal, operation) {
    if (operation?.sourceMessageId) {
        return {
            type: 'chat-position',
            messageId: operation.sourceMessageId,
            assistantSwipeId: Number.isInteger(operation.sourceSwipeId) ? operation.sourceSwipeId : null,
            sourceMessageRole: operation.sourceMessageRole || 'unknown',
        };
    }
    if (proposal?.source?.type === 'latest-pair') {
        return {
            ...proposal.source,
            sourceMessageRole: operation?.sourceMessageRole || 'assistant',
        };
    }
    return proposal?.source || null;
}

function resolveSourceNavigationTarget(anchor) {
    if (!anchor) return null;
    if (anchor.type === 'latest-pair') {
        const role = anchor.sourceMessageRole || 'assistant';
        const messageId = role === 'user' ? anchor.userMessageId : anchor.assistantMessageId;
        return {
            messageId: Number(messageId),
            swipeId: role === 'user' ? null : anchor.assistantSwipeId,
        };
    }
    if (anchor.type === 'chat-position') {
        return {
            messageId: Number(anchor.messageId),
            swipeId: Number.isInteger(anchor.assistantSwipeId) ? anchor.assistantSwipeId : null,
        };
    }
    return null;
}

function renderSourceNavigationButton(anchor, label = 'Source') {
    const target = resolveSourceNavigationTarget(anchor);
    if (!target || !Number.isInteger(target.messageId) || target.messageId < 0) return '';
    return `<button class="dpm--action-button dpm--source-button" type="button" data-action="navigate-source" data-message-id="${escapeHtml(target.messageId)}" data-swipe-id="${target.swipeId === null || target.swipeId === undefined ? '' : escapeHtml(target.swipeId)}"><i class="fa-solid fa-location-crosshairs"></i><span>${escapeHtml(label)}</span></button>`;
}

async function navigateToSourceMessage(messageId, swipeId = null) {
    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message) throw new Error('Source message is no longer available.');

    if (Number.isInteger(swipeId) && Array.isArray(message.swipes) && message.swipes.length > 1) {
        const currentSwipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
        if (swipeId >= 0 && swipeId < message.swipes.length && swipeId !== currentSwipeId) {
            const direction = swipeId > currentSwipeId ? SWIPE_DIRECTION.RIGHT : SWIPE_DIRECTION.LEFT;
            await swipe(null, direction, {
                source: SWIPE_SOURCE.SWIPE_PICKER,
                forceMesId: messageId,
                forceSwipeId: swipeId,
                forceDuration: 0,
            });
        }
    }

    const element = document.querySelector(`#chat .mes[mesid="${messageId}"], .mes[mesid="${messageId}"]`);
    if (!element) throw new Error('Source message is not currently rendered in the chat view.');

    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.classList.add('dpm--source-highlight');
    globalThis.setTimeout?.(() => element.classList.remove('dpm--source-highlight'), 1800);
}

function renderSourceAnchor(anchor) {
    if (anchor?.type === 'latest-pair') {
        const role = anchor.sourceMessageRole === 'user' ? 'user' : 'assistant';
        const messageId = role === 'user' ? anchor.userMessageId : anchor.assistantMessageId;
        const swipe = role === 'assistant' && Number.isInteger(anchor.assistantSwipeId) ? `, swipe ${anchor.assistantSwipeId + 1}` : '';
        const messageNumber = Number.isFinite(Number(messageId)) ? Number(messageId) + 1 : messageId;
        return `Chat message ${messageNumber ?? '?'}${swipe}`;
    }
    if (anchor?.type === 'chat-position') {
        const messageNumber = Number.isFinite(Number(anchor.messageId)) ? Number(anchor.messageId) + 1 : anchor.messageId;
        const swipe = Number.isInteger(anchor.assistantSwipeId) ? `, swipe ${anchor.assistantSwipeId + 1}` : '';
        return `Chat message ${messageNumber ?? '?'}${swipe}`;
    }
    return '';
}

function renderPromptTab(state) {
    const prompt = state.enabled && state.persona ? renderCompactPrompt(state.persona, getPromptRenderOptions(state.persona)) : '';
    return `
        <section class="dpm--section">
            <div class="dpm--section-header">
                <h3>Prompt Preview</h3>
                <span class="dpm--muted">${prompt ? 'Canonical state only' : 'No prompt injected'}</span>
            </div>
            <textarea class="text_pole dpm--prompt-preview" readonly>${escapeHtml(prompt)}</textarea>
        </section>
    `;
}

function renderSettingsTab(state) {
    const analysisState = state.analysisState ?? {};
    const warnings = Array.isArray(analysisState.lastWarnings) ? analysisState.lastWarnings : [];
    return `
        <section class="dpm--section">
            <h3>Chat Settings</h3>
            <label class="checkbox_label"><input id="dpm--auto-analysis" type="checkbox" ${state.chatSettings.automaticAnalysis ? 'checked' : ''}> Automatic analysis after activation</label>
            <label class="checkbox_label"><input id="dpm--streamlined-mode-settings" type="checkbox" ${state.chatSettings.streamlinedMode ? 'checked' : ''}> Streamlined Mode auto-approves valid proposals</label>
            <label class="checkbox_label"><input id="dpm--branch-state-sync" type="checkbox" ${state.chatSettings.branchStateSync !== false ? 'checked' : ''}> Sync persona state to active swipe</label>
            <label class="checkbox_label"><input id="dpm--analysis-paused" type="checkbox" ${analysisState.paused ? 'checked' : ''}> Pause automatic analysis for this chat</label>
            <p class="dpm--muted">Status: ${escapeHtml(analysisState.status || 'idle')} | Failures: ${Number(analysisState.failures || 0)}</p>
            ${analysisState.lastError ? `<p class="dpm--danger-text">${escapeHtml(analysisState.lastError)}</p>` : ''}
            ${warnings.length ? `<details><summary>Last validation warnings</summary><ul>${warnings.map(warning => `<li>${escapeHtml(warning.message || warning)}</li>`).join('')}</ul></details>` : ''}
            <div class="dpm--button-row">
                <button class="dpm--action-button dpm--danger-action" type="button" data-action="reset-chat">Reset DPM data for this chat</button>
            </div>
        </section>
    `;
}

async function onPanelClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!event.target.closest('.dpm--lock-controls')) {
        closeLockMenus();
    }
    if (!button) return;
    const action = button.dataset.action;

    try {
        if (action === 'create-blank') createBlankForChat();
        if (action === 'save-persona') savePersonaFromEditor();
        if (action === 'save-section-editor') savePersonaFromSectionEditor();
        if (action === 'toggle-section') toggleSection(button.dataset.section);
        if (action === 'add-entry') addCollectionEntry(button.dataset.collection);
        if (action === 'remove-entry') await removeCollectionEntry(button.dataset.collection, Number(button.dataset.index));
        if (action === 'toggle-lock-menu') {
            event.preventDefault();
            event.stopPropagation();
            toggleLockMenu(button);
            return;
        }
        if (action === 'add-lock') addLockFromControl(button);
        if (action === 'remove-lock') removeLock(button.dataset.lockId);
        if (action === 'accept-operation') acceptPendingOperation(button.dataset.proposalId, button.dataset.operationId);
        if (action === 'edit-operation') await editPendingOperation(button.dataset.proposalId, button.dataset.operationId);
        if (action === 'reject-operation') rejectPendingOperation(button.dataset.proposalId, button.dataset.operationId);
        if (action === 'accept-selected-operations') acceptSelectedOperations();
        if (action === 'reject-selected-operations') rejectSelectedOperations();
        if (action === 'reject-all-operations') rejectAllPendingOperations();
        if (action === 'reanalyse-latest-pair') reanalyseLatestPair();
        if (action === 'navigate-source') await navigateToSourceMessage(Number(button.dataset.messageId), button.dataset.swipeId === '' ? null : Number(button.dataset.swipeId));
        if (action === 'restore-checkpoint') await restoreCheckpoint(button.dataset.checkpointId);
        if (action === 'revert-revision') await revertRevision(button.dataset.revisionId);
        if (action === 'dismiss-locked-skip-notice') dismissLockedSkipNotice();
        if (action === 'create-demo-proposal') createDemoProposal();
        if (action === 'export-persona-text') exportPersonaText();
        if (action === 'export-persona-json') exportPersonaJson();
        if (action === 'export-prompt-text') exportPromptText();
        if (action === 'export-native-text') exportNativeText();
        if (action === 'export-backup') exportBackup();
        if (action === 'import-json') await importJson();
        if (action === 'analyse-native-persona') await analyseNativePersonaImport();
        if (action === 'reset-chat') await resetCurrentChat();
    } catch (error) {
        notify(error.message, 'error');
    }
}

function toggleSection(sectionName) {
    if (!COLLAPSIBLE_SECTIONS.includes(sectionName)) return;
    if (collapsedSections.has(sectionName)) collapsedSections.delete(sectionName);
    else collapsedSections.add(sectionName);
    storeCollapsedSections(collapsedSections);
    renderPanel();
}

async function confirmStreamlinedModeEnable(state) {
    if (state.chatSettings?.streamlinedModeWarningAccepted) return true;
    const confirmed = await callGenericPopup(
        '<h3>Enable Streamlined Mode?</h3><p>Streamlined Mode automatically accepts analyser changes that pass validation, lock checks, source freshness, conflict checks, and transaction simulation.</p><p>Use it only when you trust the current analysis setup. Revisions and checkpoints will still be created, and skipped or conflicted changes will remain for review.</p>',
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Enable', cancelButton: 'Cancel' },
    );
    if (confirmed) {
        state.chatSettings.streamlinedModeWarningAccepted = true;
    }
    return !!confirmed;
}

async function onPanelChange(event) {
    const context = getContext();
    const { state } = readChatState(context);
    if (event.target.id === 'dpm--enabled') {
        state.enabled = !!event.target.checked;
        writeChatState(context, state);
        refreshPromptInjection();
        renderPanel();
    }
    if (event.target.id === 'dpm--auto-analysis') {
        state.chatSettings.automaticAnalysis = !!event.target.checked;
        writeChatState(context, state);
        renderPanel();
    }
    if (event.target.id === 'dpm--streamlined-mode' || event.target.id === 'dpm--streamlined-mode-settings') {
        const enabled = !!event.target.checked;
        if (enabled && !await confirmStreamlinedModeEnable(state)) {
            event.target.checked = false;
            return;
        }
        state.chatSettings.streamlinedMode = enabled;
        writeChatState(context, state);
        renderPanel();
    }
    if (event.target.id === 'dpm--branch-state-sync') {
        state.chatSettings.branchStateSync = !!event.target.checked;
        writeChatState(context, state);
        if (state.chatSettings.branchStateSync) syncPersonaToActiveBranch('setting-enabled');
        renderPanel();
    }
    if (event.target.id === 'dpm--analysis-paused') {
        state.analysisState.paused = !!event.target.checked;
        state.analysisState.status = state.analysisState.paused ? 'paused' : 'idle';
        if (!state.analysisState.paused) {
            state.analysisState.failures = 0;
            state.analysisState.lastError = '';
        }
        writeChatState(context, state);
        refreshHandleState(state);
        renderPanel();
    }
}

function createBlankForChat() {
    const context = getContext();
    const { state } = ensureChatState(context);
    const before = cloneJson(state.persona);
    state.persona = createBlankPersona();
    state.enabled = true;
    state.revisionHistory = makeRevision(state, before, state.persona, 'Initialised blank persona');
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
    notify('Blank managed persona created.');
}

function savePersonaFromEditor() {
    const context = getContext();
    const { state } = readChatState(context);
    if (!state.persona) throw new Error('No persona exists to save.');

    const jsonText = document.getElementById('dpm--persona-json')?.value ?? '';
    let nextPersona;
    try {
        nextPersona = JSON.parse(jsonText);
    } catch (error) {
        throw new Error(`Persona JSON is invalid: ${error.message}`);
    }

    nextPersona.name = document.getElementById('dpm--name')?.value ?? nextPersona.name;
    nextPersona.summary = document.getElementById('dpm--summary')?.value ?? nextPersona.summary;
    const validation = validatePersona(nextPersona);
    if (!validation.ok) {
        throw new Error(`Persona failed validation: ${validation.errors.join(' ')}`);
    }

    const before = cloneJson(state.persona);
    state.persona = nextPersona;
    state.revisionHistory = makeRevision(state, before, nextPersona, 'Manual persona edit');
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
    notify('Persona saved.');
}

function getFieldValue(element) {
    if (element.type === 'checkbox') return element.checked;
    return element.value;
}

function setPathValue(target, path, value) {
    const parts = String(path).split('.');
    let cursor = target;

    for (let index = 0; index < parts.length - 1; index++) {
        const part = parts[index];
        const nextPart = parts[index + 1];
        if (cursor[part] === undefined || cursor[part] === null) {
            cursor[part] = /^\d+$/.test(nextPart) ? [] : {};
        }
        cursor = cursor[part];
    }

    cursor[parts.at(-1)] = value;
}

function collectPersonaFromSectionEditor(currentPersona) {
    const nextPersona = cloneJson(currentPersona);

    for (const field of document.querySelectorAll('#dpm--panel-body .dpm--field')) {
        const path = field.dataset.path;
        if (!path) continue;

        if (path === 'identity.affiliationsText') {
            const previous = Array.isArray(nextPersona.identity?.affiliations) ? nextPersona.identity.affiliations : [];
            nextPersona.identity.affiliations = textToList(field.value).map((name, index) => ({
                id: previous[index]?.id || createId('affiliation'),
                name,
                role: previous[index]?.role || '',
                status: previous[index]?.status || 'active',
                notes: previous[index]?.notes || '',
                promptPriority: previous[index]?.promptPriority ?? 50,
            }));
            continue;
        }

        const value = field.dataset.kind === 'list' ? textToList(field.value) : getFieldValue(field);
        setPathValue(nextPersona, path, value);
    }

    for (const field of document.querySelectorAll('#dpm--panel-body .dpm--collection-field')) {
        const path = field.dataset.path;
        const type = field.dataset.type || 'text';
        if (!path) continue;
        const currentValue = path.split('.').reduce((cursor, part) => cursor?.[part], nextPersona);
        const value = coerceEditorValue(getFieldValue(field), type, currentValue);
        setPathValue(nextPersona, path, value);
    }

    return nextPersona;
}

function savePersonaFromSectionEditor() {
    const context = getContext();
    const { state } = readChatState(context);
    if (!state.persona) throw new Error('No persona exists to save.');

    const nextPersona = collectPersonaFromSectionEditor(state.persona);
    const validation = validatePersona(nextPersona);
    if (!validation.ok) {
        throw new Error(`Persona failed validation: ${validation.errors.join(' ')}`);
    }

    const before = cloneJson(state.persona);
    state.persona = nextPersona;
    state.revisionHistory = makeRevision(state, before, nextPersona, 'Manual section editor save');
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
    notify('Character edits saved.');
}

function addCollectionEntry(collectionName) {
    if (!Object.hasOwn(COLLECTION_LABELS, collectionName)) return;
    const context = getContext();
    const { state } = readChatState(context);
    if (!state.persona) throw new Error('No persona exists to edit.');

    const before = cloneJson(state.persona);
    state.persona = collectPersonaFromSectionEditor(state.persona);
    const validation = validatePersona(state.persona);
    if (!validation.ok) {
        throw new Error(`Current edits must be valid before adding an entry: ${validation.errors.join(' ')}`);
    }
    if (!Array.isArray(state.persona[collectionName])) {
        state.persona[collectionName] = [];
    }
    state.persona[collectionName].push(createDefaultCollectionEntry(collectionName));
    state.revisionHistory = makeRevision(state, before, state.persona, `Added ${COLLECTION_LABELS[collectionName]} entry`);
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
}

async function removeCollectionEntry(collectionName, index) {
    if (!Object.hasOwn(COLLECTION_LABELS, collectionName) || !Number.isInteger(index)) return;
    const context = getContext();
    const { state } = readChatState(context);
    const originalEntries = state.persona?.[collectionName];
    if (!Array.isArray(originalEntries) || !originalEntries[index]) return;

    const title = getCollectionItemTitle(collectionName, originalEntries[index]);
    const confirmed = await callGenericPopup(`Remove ${escapeHtml(title)} from ${escapeHtml(COLLECTION_LABELS[collectionName])}?`, POPUP_TYPE.CONFIRM);
    if (!confirmed) return;

    const before = cloneJson(state.persona);
    state.persona = collectPersonaFromSectionEditor(state.persona);
    const validation = validatePersona(state.persona);
    if (!validation.ok) {
        throw new Error(`Current edits must be valid before removing an entry: ${validation.errors.join(' ')}`);
    }
    state.persona[collectionName].splice(index, 1);
    state.revisionHistory = makeRevision(state, before, state.persona, `Removed ${COLLECTION_LABELS[collectionName]} entry`);
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
}

function addLockFromControl(button) {
    const path = button.dataset.lockPath;
    const mode = button.dataset.lockMode || LOCK_MODES.proposalLocked;
    if (!path || !Object.values(LOCK_MODES).includes(mode)) {
        throw new Error('Invalid lock target or mode.');
    }

    const context = getContext();
    const { state } = readChatState(context);
    if (!state.persona) throw new Error('No persona exists to lock.');

    const before = cloneJson(state.persona);
    state.persona = collectPersonaFromSectionEditor(state.persona);
    state.persona.locks ??= [];
    const duplicate = state.persona.locks.some(lock => lock.path === path && lock.mode === mode);
    if (duplicate) {
        notify('That lock already exists.');
        renderPanel();
        return;
    }

    state.persona.locks.push({
        id: createId('lock'),
        path,
        mode,
        reason: '',
        createdAt: new Date().toISOString(),
        createdBy: 'user',
    });

    const validation = validatePersona(state.persona);
    if (!validation.ok) {
        throw new Error(`Persona failed validation: ${validation.errors.join(' ')}`);
    }

    state.revisionHistory = makeRevision(state, before, state.persona, `Added ${mode} lock at ${path}`);
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
}

function removeLock(lockId) {
    if (!lockId) return;
    const context = getContext();
    const { state } = readChatState(context);
    if (!state.persona) throw new Error('No persona exists to unlock.');

    const before = cloneJson(state.persona);
    state.persona = collectPersonaFromSectionEditor(state.persona);
    const lock = state.persona.locks.find(item => item.id === lockId);
    if (!lock) return;
    state.persona.locks = state.persona.locks.filter(item => item.id !== lockId);
    state.revisionHistory = makeRevision(state, before, state.persona, `Removed ${lock.mode} lock at ${lock.path}`);
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
}

function findPendingOperation(state, proposalId, operationId) {
    const proposal = state.pendingProposals.find(item => item.proposalId === proposalId);
    const operation = proposal?.operations?.find(item => item.operationId === operationId);
    if (!proposal || !operation) {
        throw new Error('Pending operation was not found.');
    }
    return { proposal, operation };
}

function pruneHandledProposals(state) {
    state.pendingProposals = state.pendingProposals.filter(proposalHasPendingOperations);
}

function getPendingTransactionOperations(proposal, operation) {
    if (!operation.transactionId) return [operation];
    return (proposal.operations || [])
        .filter(item => item.status !== 'accepted' && item.status !== 'rejected')
        .filter(item => item.transactionId === operation.transactionId);
}

function getConflictScope(state, proposal) {
    const proposals = state.pendingProposals || [];
    return proposals.some(item => item.proposalId === proposal.proposalId)
        ? proposals
        : [...proposals, proposal];
}

function commitProposalOperations(context, state, proposal, operations) {
    if (!state.persona) throw new Error('No persona exists to update.');
    const sourceState = getProposalSourceState(context.chat, proposal);
    if (sourceState.stale) {
        throw new Error(`Cannot accept stale proposal: ${sourceState.reason}`);
    }
    annotateOperationConflicts(getConflictScope(state, proposal));
    const pendingOperations = operations.filter(operation => operation.status !== 'accepted' && operation.status !== 'rejected');
    if (!pendingOperations.length) return 0;
    const conflicted = pendingOperations.find(operationHasConflicts);
    if (conflicted) {
        throw new Error(`Cannot accept conflicted operation at ${conflicted.path}. Resolve or reject the conflicting proposal first.`);
    }

    const before = cloneJson(state.persona);
    const simulation = simulateOperations(state.persona, pendingOperations);

    for (const operation of pendingOperations) {
        operation.status = 'accepted';
    }
    state.persona = simulation.persona;
    const transaction = pendingOperations.find(operation => operation.transactionId);
    const label = transaction?.transactionLabel || transaction?.transactionId || proposal.summary || pendingOperations[0]?.path;
    state.revisionHistory = makeRevision(
        state,
        before,
        state.persona,
        transaction ? `Accepted transaction: ${label}` : `Accepted proposal: ${label}`,
        {
            sourceType: 'proposal',
            sourceProposalId: proposal.proposalId,
            source: proposal.source,
            operations: pendingOperations,
        },
    );
    return pendingOperations.length;
}

function commitProposalOperation(context, state, proposal, operation) {
    return commitProposalOperations(context, state, proposal, getPendingTransactionOperations(proposal, operation));
}

function acceptPendingOperation(proposalId, operationId) {
    const context = getContext();
    const { state } = readChatState(context);
    const { proposal, operation } = findPendingOperation(state, proposalId, operationId);
    const acceptedCount = commitProposalOperation(context, state, proposal, operation);
    pruneHandledProposals(state);
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
    notify(acceptedCount > 1 ? `Accepted ${acceptedCount} transaction operations.` : 'Pending operation accepted.');
}

function getSelectedPendingOperationIds() {
    return [...document.querySelectorAll('#dpm--panel-body .dpm--operation-checkbox:checked')]
        .map(input => ({
            proposalId: input.dataset.proposalId,
            operationId: input.dataset.operationId,
        }))
        .filter(item => item.proposalId && item.operationId);
}

function acceptSelectedOperations() {
    const selected = getSelectedPendingOperationIds();
    if (!selected.length) throw new Error('Select one or more pending operations first.');

    const context = getContext();
    const { state } = readChatState(context);
    const failures = [];
    const handledKeys = new Set();
    for (const item of selected) {
        try {
            const { proposal, operation } = findPendingOperation(state, item.proposalId, item.operationId);
            const groupKey = operation.transactionId
                ? `${proposal.proposalId}:${operation.transactionId}`
                : `${proposal.proposalId}:${operation.operationId}`;
            if (handledKeys.has(groupKey)) continue;
            handledKeys.add(groupKey);
            commitProposalOperation(context, state, proposal, operation);
        } catch (error) {
            failures.push(error.message);
        }
    }
    pruneHandledProposals(state);
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
    if (failures.length) {
        notify(`Accepted selected operations with ${failures.length} failure(s).`, 'warning');
    } else {
        notify('Selected operations accepted.');
    }
}

function autoApproveProposalOperations(context, state, proposal) {
    const failures = [];
    for (const operation of proposal.operations || []) {
        if (operation.status === 'accepted' || operation.status === 'rejected') continue;
        try {
            commitProposalOperation(context, state, proposal, operation);
        } catch (error) {
            failures.push({ operationId: operation.operationId, message: error.message });
        }
    }
    pruneHandledProposals(state);
    return failures;
}

async function editPendingOperation(proposalId, operationId) {
    const context = getContext();
    const { state } = readChatState(context);
    const { operation } = findPendingOperation(state, proposalId, operationId);
    const input = await callGenericPopup(
        '<h3>Edit pending operation</h3><p>Adjust the operation JSON, then save it for review.</p>',
        POPUP_TYPE.INPUT,
        JSON.stringify(operation, null, 2),
        { rows: 14, wide: true },
    );
    if (!input) return;

    let parsed;
    try {
        parsed = JSON.parse(input);
    } catch (error) {
        throw new Error(`Edited operation is not valid JSON: ${error.message}`);
    }

    const edited = normalizeOperation({
        ...parsed,
        operationId,
        status: 'pending',
    });
    if (state.persona) {
        simulateOperations(state.persona, [edited]);
    }

    Object.assign(operation, edited);
    writeChatState(context, state, { immediate: true });
    renderPanel();
    notify('Pending operation updated.');
}

function rejectPendingOperation(proposalId, operationId) {
    const context = getContext();
    const { state } = readChatState(context);
    const { operation } = findPendingOperation(state, proposalId, operationId);
    operation.status = 'rejected';
    pruneHandledProposals(state);
    writeChatState(context, state, { immediate: true });
    renderPanel();
    notify('Pending operation rejected.');
}

function rejectSelectedOperations() {
    const selected = getSelectedPendingOperationIds();
    if (!selected.length) throw new Error('Select one or more pending operations first.');

    const context = getContext();
    const { state } = readChatState(context);
    for (const item of selected) {
        const { operation } = findPendingOperation(state, item.proposalId, item.operationId);
        operation.status = 'rejected';
    }
    pruneHandledProposals(state);
    writeChatState(context, state, { immediate: true });
    renderPanel();
    notify('Selected operations rejected.');
}

function rejectAllPendingOperations() {
    const context = getContext();
    const { state } = readChatState(context);
    let rejected = 0;
    for (const proposal of state.pendingProposals || []) {
        for (const operation of proposal.operations || []) {
            if (operation.status !== 'accepted' && operation.status !== 'rejected') {
                operation.status = 'rejected';
                rejected += 1;
            }
        }
    }
    pruneHandledProposals(state);
    writeChatState(context, state, { immediate: true });
    renderPanel();
    notify(`Rejected ${rejected} pending operation${rejected === 1 ? '' : 's'}.`);
}

function reanalyseLatestPair() {
    if (!forceReanalyseLatestPair(0)) throw new Error('No completed user/assistant pair is available to reanalyse.');
    notify('Reanalysis queued.');
}

function clearLatestPairAnalysisMemory(state, pair) {
    const fingerprint = fingerprintPair(pair);
    state.analysisState ??= {};
    state.analysisState.analysedFingerprints = (state.analysisState.analysedFingerprints || []).filter(item => item !== fingerprint);
    if (state.analysisState.lastAnalysedFingerprint === fingerprint) {
        state.analysisState.lastAnalysedFingerprint = '';
    }
    return fingerprint;
}

function forceReanalyseLatestPair(delay = 0) {
    const context = getContext();
    const { state } = readChatState(context);
    const pair = findLatestCompletedPair(context.chat);
    if (!pair) return false;
    clearLatestPairAnalysisMemory(state, pair);
    writeChatState(context, state, { immediate: true });
    scheduleLatestPairAnalysis(delay);
    return true;
}

async function restoreCheckpoint(checkpointId) {
    const context = getContext();
    const { state } = readChatState(context);
    const checkpoint = (state.checkpoints || []).find(item => item.checkpointId === checkpointId);
    if (!checkpoint?.persona) {
        throw new Error('Checkpoint snapshot was not found.');
    }

    const confirmed = await callGenericPopup(
        `<h3>Restore checkpoint #${escapeHtml(checkpoint.sequence)}</h3><p>This replaces the current managed persona with an exact saved snapshot from revision #${escapeHtml(checkpoint.sequence)}.</p><p>A new revision will be created for the restore, so you can audit the change afterwards.</p>`,
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Restore', cancelButton: 'Cancel' },
    );
    if (!confirmed) return;

    const before = cloneJson(state.persona);
    state.persona = cloneJson(checkpoint.persona);
    state.revisionHistory = makeRevision(
        state,
        before,
        state.persona,
        `Restored checkpoint #${checkpoint.sequence}`,
        { sourceType: 'restore', source: checkpoint.sourceAnchor },
    );
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
    notify('Checkpoint restored.');
}

async function revertRevision(revisionId) {
    const context = getContext();
    const { state } = readChatState(context);
    const revision = (state.revisionHistory || []).find(item => item.revisionId === revisionId);
    if (!revision) throw new Error('Revision was not found.');
    if (revision.revertedByRevisionId) throw new Error('Revision has already been reverted.');

    const confirmed = await callGenericPopup(
        `<h3>Revert revision #${escapeHtml(revision.sequence)}</h3><p>This applies the stored inverse operations for the selected revision and creates a new revision.</p><p>If affected sections have changed since then, the revert will fail closed instead of merging unpredictably. Use checkpoint Restore for an exact timeline rollback.</p>`,
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Revert', cancelButton: 'Cancel' },
    );
    if (!confirmed) return;

    const before = cloneJson(state.persona);
    const operations = Array.isArray(revision.inverseOperations) ? revision.inverseOperations : [];
    if (!operations.length) throw new Error('Revision has no inverse operations. Use checkpoint Restore instead.');
    const nextPersona = simulateOperations(state.persona, operations, { source: 'manual' }).persona;

    state.persona = nextPersona;
    state.revisionHistory = makeRevision(
        state,
        before,
        state.persona,
        `Reverted revision #${revision.sequence}`,
        {
            sourceType: 'revert',
            operations,
            source: revision.sourceAnchor,
        },
    );
    const revertRevisionRecord = state.revisionHistory.at(-1);
    const original = state.revisionHistory.find(item => item.revisionId === revision.revisionId);
    if (original && revertRevisionRecord) {
        original.revertedByRevisionId = revertRevisionRecord.revisionId;
    }
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
    notify('Revision reverted.');
}

function syncPersonaToActiveBranch(reason = 'branch-sync') {
    const context = getContext();
    const { state } = readChatState(context);
    if (!state.persona || state.chatSettings?.branchStateSync === false) return false;

    const activeAnchor = getRevisionSourceAnchor(context);
    const checkpoint = findNearestCheckpointForAnchor(state.checkpoints, activeAnchor, state.persona);
    if (!checkpoint?.persona) return false;

    return applyBranchCheckpointSync(context, state, checkpoint, activeAnchor, reason);
}

function syncPersonaToPreviousPairCheckpoint(reason = 'pair-edited') {
    const context = getContext();
    const { state } = readChatState(context);
    if (!state.persona || state.chatSettings?.branchStateSync === false) return false;

    const activeAnchor = getRevisionSourceAnchor(context);
    const checkpoint = findPreviousCheckpointBeforeAnchor(state.checkpoints, activeAnchor, state.persona);
    if (!checkpoint?.persona) return false;

    return applyBranchCheckpointSync(context, state, checkpoint, activeAnchor, reason);
}

function applyBranchCheckpointSync(context, state, checkpoint, activeAnchor, reason) {
    state.persona = cloneJson(checkpoint.persona);
    state.analysisState ??= {};
    state.analysisState.lastBranchSync = {
        checkpointId: checkpoint.checkpointId,
        sequence: checkpoint.sequence,
        reason,
        syncedAt: new Date().toISOString(),
        sourceAnchor: checkpoint.sourceAnchor,
        activeAnchor,
    };
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    refreshHandleState(state);
    if (panelOpen) renderPanel();
    if (getSettings().debugMode) {
        notify(`DPM restored persona state for ${renderSourceAnchor(checkpoint.sourceAnchor) || 'the active branch'}.`);
    }
    return true;
}

function dismissLockedSkipNotice() {
    const context = getContext();
    const { state } = readChatState(context);
    if (state.analysisState) {
        state.analysisState.lockedSkipNotice = null;
    }
    writeChatState(context, state, { immediate: true });
    renderPanel();
}

function createDemoProposal() {
    const context = getContext();
    const { state } = readChatState(context);
    if (!state.persona) throw new Error('Create a managed persona first.');

    const proposal = createProposal({
        personaId: state.persona.personaId,
        summary: 'Demo proposal: update temporary mood',
        source: { type: 'manual-demo' },
        operations: [{
            type: 'set',
            path: '/personality/temporaryMood',
            oldValue: state.persona.personality?.temporaryMood ?? '',
            value: 'alert and focused',
            reason: 'Demo proposal for testing accept, edit, and reject.',
            evidence: 'Manual demo proposal.',
            confidence: 1,
            importance: 'material',
        }],
    });
    state.pendingProposals.push(proposal);
    writeChatState(context, state, { immediate: true });
    renderPanel();
}

function cancelActiveAnalysis() {
    analysisRunId += 1;
    analysisAbortController?.abort?.();
    analysisAbortController = null;
}

function scheduleLatestPairAnalysis(delay = 150) {
    if (scheduledAnalysisTimer !== null) {
        clearTimeout(scheduledAnalysisTimer);
    }
    scheduledAnalysisTimer = setTimeout(() => {
        scheduledAnalysisTimer = null;
        runAnalysisForLatestPair();
    }, delay);
}

function shouldRunAnalysis(state) {
    return !!(
        state.enabled
        && state.persona
        && state.chatSettings?.automaticAnalysis
        && !state.analysisState?.paused
    );
}

async function runAnalysisForLatestPair() {
    const context = getContext();
    const settings = getSettings();
    let { state } = readChatState(context);
    if (!shouldRunAnalysis(state)) {
        refreshHandleState(state);
        return;
    }

    const pair = findLatestCompletedPair(context.chat);
    if (!pair) return;
    const fingerprint = fingerprintPair(pair);
    if (hasAnalysedFingerprint(state.analysisState, fingerprint)) {
        return;
    }

    const runId = analysisRunId + 1;
    analysisRunId = runId;
    analysisAbortController?.abort?.();
    analysisAbortController = typeof AbortController === 'function' ? new AbortController() : null;

    state.analysisState.status = 'analysing';
    state.analysisState.lastError = '';
    writeChatState(context, state);
    if (panelOpen) renderPanel();
    refreshHandleState(state);

    try {
        const result = await analysePair({
            context,
            persona: state.persona,
            pair,
            fingerprint,
            settings,
            signal: analysisAbortController?.signal,
            generateRaw: generateDpmRaw,
        });
        if (runId !== analysisRunId) return;

        ({ state } = readChatState(context));
        if (!shouldRunAnalysis(state)) return;

        state.analysisState.status = 'idle';
        state.analysisState.failures = 0;
        rememberAnalysedFingerprint(state.analysisState, fingerprint);
        state.analysisState.lastAnalysedAt = new Date().toISOString();
        state.analysisState.lastWarnings = result.warnings || [];
        state.analysisState.lastError = '';
        state.analysisState.lockedSkipNotice = result.lockedSkippedCount
            ? {
                count: result.lockedSkippedCount,
                fingerprint,
                createdAt: new Date().toISOString(),
            }
            : null;

        if (result.proposal) {
            const alreadyPending = state.pendingProposals.some(proposal => proposal?.source?.fingerprint === fingerprint);
            if (!alreadyPending) {
                if (state.chatSettings?.streamlinedMode) {
                    const failures = autoApproveProposalOperations(context, state, result.proposal);
                    if (failures.length) {
                        state.pendingProposals.push(result.proposal);
                        state.analysisState.lastWarnings = [
                            ...(state.analysisState.lastWarnings || []),
                            ...failures.map(failure => ({
                                code: 'streamlinedAutoApprovalFailed',
                                message: failure.message,
                                operationId: failure.operationId,
                            })),
                        ];
                        notify('DPM auto-approved some changes; remaining changes need review.', 'warning');
                    } else {
                        notify('DPM auto-approved valid persona changes.');
                    }
                } else {
                    state.pendingProposals.push(result.proposal);
                    notify('Dynamic Persona Manager found pending persona changes.');
                }
            }
        }

        writeChatState(context, state, { immediate: true });
        if (panelOpen) renderPanel();
        refreshHandleState(state);
    } catch (error) {
        if (runId !== analysisRunId || error?.name === 'AbortError') return;

        ({ state } = readChatState(context));
        state.analysisState.status = 'failed';
        state.analysisState.failures = Number(state.analysisState.failures || 0) + 1;
        state.analysisState.lastError = error.message;
        if (state.analysisState.failures >= Number(settings.failurePauseThreshold ?? 3)) {
            state.analysisState.paused = true;
            state.analysisState.status = 'paused';
        }
        writeChatState(context, state, { immediate: true });
        if (panelOpen) renderPanel();
        refreshHandleState(state);
        if (settings.debugMode) {
            notify(`DPM analysis failed: ${error.message}`, 'warning');
        }
    }
}

function exportFileBaseName(name) {
    return String(name || 'managed-persona')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 80) || 'managed-persona';
}

function exportPersonaText() {
    const { state } = readChatState(getContext());
    if (!state.persona) throw new Error('No managed persona is available to export.');
    const baseName = exportFileBaseName(state.persona.name);
    const text = buildPlainTextPersonaExport(state, { renderOptions: getPromptRenderOptions(state.persona) });
    download(text, `${baseName}.dpm-persona.txt`, 'text/plain');
}

function exportPersonaJson() {
    const { state } = readChatState(getContext());
    if (!state.persona) throw new Error('No managed persona is available to export.');
    const baseName = exportFileBaseName(state.persona.name);
    const payload = buildPersonaExport(state);
    download(JSON.stringify(payload, null, 2), `${baseName}.dpm-persona.json`, 'application/json');
}

function exportPromptText() {
    const { state } = readChatState(getContext());
    if (!state.persona) throw new Error('No managed persona is available to export.');
    const baseName = exportFileBaseName(state.persona.name);
    const text = buildPromptTextExport(state, { renderOptions: getPromptRenderOptions(state.persona) });
    download(text, `${baseName}.dpm-prompt.txt`, 'text/plain');
}

function exportNativeText() {
    const { state } = readChatState(getContext());
    if (!state.persona) throw new Error('No managed persona is available to export.');
    const baseName = exportFileBaseName(state.persona.name);
    const text = buildNativePersonaTextExport(state);
    download(text, `${baseName}.native-persona.txt`, 'text/plain');
}

function exportBackup() {
    const { state } = readChatState(getContext());
    const payload = buildFullBackupExport(state);
    download(JSON.stringify(payload, null, 2), 'dynamic-persona-manager-backup.json', 'application/json');
}

function buildNativePersonaTextFromCard(card, fallbackName = '') {
    const parts = [];
    const addPart = (label, value) => {
        const text = String(value || '').trim();
        if (text) parts.push(`${label}:\n${text}`);
    };

    addPart('Name', card?.name || fallbackName);
    addPart('Description', card?.description);
    addPart('Personality', card?.personality);
    addPart('Scenario', card?.scenario);
    addPart('First message', card?.first_mes || card?.firstMessage);
    addPart('Example dialogue', card?.mes_example || card?.message_example);
    addPart('System prompt', card?.system_prompt);
    addPart('Post-history instructions', card?.post_history_instructions);

    if (card?.character_book?.entries?.length) {
        addPart(
            'Embedded lorebook',
            card.character_book.entries
                .map(entry => [entry.name, entry.content || entry.comment].filter(Boolean).join(': '))
                .filter(Boolean)
                .join('\n'),
        );
    }

    return parts.join('\n\n');
}

function buildNativePersonaTextFromUserPersona(source) {
    const parts = [];
    const addPart = (label, value) => {
        const text = String(value || '').trim();
        if (text) parts.push(`${label}:\n${text}`);
    };
    const descriptor = source.descriptor && typeof source.descriptor === 'object' ? source.descriptor : {};
    const appendices = Array.isArray(descriptor.appendices) ? descriptor.appendices : [];

    addPart('Name', source.name);
    addPart('Avatar ID', source.avatarId);
    addPart('Title', descriptor.title);
    addPart('Description', descriptor.description);

    if (appendices.length) {
        addPart(
            'Persona appendices',
            appendices
                .map(appendix => {
                    const title = appendix?.title || appendix?.name || appendix?.id || 'Appendix';
                    const content = appendix?.content || appendix?.description || appendix?.text || '';
                    return [title, content].filter(Boolean).join(':\n');
                })
                .filter(Boolean)
                .join('\n\n'),
        );
    }

    addPart('Linked lorebook', descriptor.lorebook);
    return parts.join('\n\n');
}

function getActiveNativePersonaSource(context, state) {
    const character = Array.isArray(context?.characters) && context.characterId !== undefined
        ? context.characters[context.characterId]
        : null;
    const card = character?.data && typeof character.data === 'object' ? character.data : character;
    const name = card?.name || character?.name || state?.persona?.name || '';
    const text = buildNativePersonaTextFromCard(card, name) || state?.persona?.summary || '';
    return {
        kind: 'active',
        name,
        label: `Active character${name ? `: ${name}` : ''}`,
        text,
    };
}

function getSavedNativePersonaSources() {
    const personas = power_user?.personas && typeof power_user.personas === 'object' ? power_user.personas : {};
    const descriptions = power_user?.persona_descriptions && typeof power_user.persona_descriptions === 'object'
        ? power_user.persona_descriptions
        : {};

    return Object.entries(personas)
        .map(([avatarId, personaName]) => {
            const descriptor = descriptions[avatarId] && typeof descriptions[avatarId] === 'object' ? descriptions[avatarId] : {};
            const name = String(personaName || avatarId || '').trim();
            const title = String(descriptor.title || '').trim();
            const source = {
                kind: 'saved',
                avatarId,
                descriptor,
                name,
                title,
            };
            const text = buildNativePersonaTextFromUserPersona(source);
            if (!text) return null;
            const isCurrent = avatarId === user_avatar;
            const optionLabel = `${name || avatarId} - ${title || 'No title'}`;
            return {
                ...source,
                optionLabel,
                text,
                label: `SillyBunny persona${isCurrent ? ' (current)' : ''}: ${optionLabel}`,
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.avatarId === user_avatar) return -1;
            if (b.avatarId === user_avatar) return 1;
            return a.label.localeCompare(b.label);
        });
}

async function chooseNativePersonaSource(context, state) {
    const activeSource = getActiveNativePersonaSource(context, state);
    const savedSources = getSavedNativePersonaSources();
    const pasteSource = {
        kind: 'paste',
        name: state.persona?.name || activeSource.name || name1 || '',
        label: 'Paste raw',
        text: '',
    };

    let selectedAvatarId = '';
    const personaOptions = savedSources
        .map(source => `<option value="${escapeHtml(source.avatarId)}">${escapeHtml(source.optionLabel || source.label)}</option>`)
        .join('');
    const content = `
        <div class="dpm--native-source-popup">
            <h3>Analyse native persona</h3>
            <p>Choose where DPM should read the native persona from.</p>
            <label class="dpm--native-source-field" for="dpm--native-persona-source">
                <span>Import from SillyBunny</span>
                <select id="dpm--native-persona-source" class="text_pole" ${savedSources.length ? '' : 'disabled'}>
                    <option value="">Select a persona...</option>
                    ${personaOptions}
                </select>
            </label>
            ${savedSources.length ? '' : '<p class="dpm--muted">No saved SillyBunny personas are available.</p>'}
        </div>
    `;
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: 'Cancel',
        wider: true,
        customButtons: [
            {
                text: 'Import from SillyBunny',
                icon: 'fa-file-import',
                result: POPUP_RESULT.CUSTOM1,
                classes: ['dpm--native-source-import'],
            },
            {
                text: 'Paste raw',
                icon: 'fa-paste',
                result: POPUP_RESULT.CUSTOM2,
            },
            {
                text: 'Use active card',
                icon: 'fa-address-card',
                result: POPUP_RESULT.CUSTOM3,
            },
        ],
        onOpen: (openedPopup) => {
            const select = openedPopup.dlg.querySelector('#dpm--native-persona-source');
            const importButton = openedPopup.dlg.querySelector('.dpm--native-source-import');
            const refreshImportState = () => {
                selectedAvatarId = String(select?.value || '');
                importButton?.toggleAttribute('disabled', !selectedAvatarId);
                importButton?.classList.toggle('disabled', !selectedAvatarId);
                importButton?.setAttribute('aria-disabled', selectedAvatarId ? 'false' : 'true');
            };
            select?.addEventListener('change', refreshImportState);
            refreshImportState();
        },
        onClosing: (closingPopup) => {
            if (closingPopup.result === POPUP_RESULT.CUSTOM1 && !selectedAvatarId) {
                notify('Select a SillyBunny persona before importing.');
                return false;
            }
            return true;
        },
    });

    const result = await popup.show();
    if (result === POPUP_RESULT.CUSTOM1) {
        return savedSources.find(source => source.avatarId === selectedAvatarId) || null;
    }
    if (result === POPUP_RESULT.CUSTOM2) return pasteSource;
    if (result === POPUP_RESULT.CUSTOM3) return activeSource.text ? activeSource : null;
    return null;
}

async function importJson() {
    const input = await callGenericPopup('<h3>Import DPM JSON</h3><p>Paste a persona export or full backup.</p>', POPUP_TYPE.INPUT, '', { rows: 12, wide: true });
    if (!input) return;

    const imported = parseDpmImport(input);
    const context = getContext();
    const { state } = readChatState(context);
    const before = cloneJson(state.persona);
    const preview = imported.type === 'full-backup'
        ? `Full backup\nPersona: ${imported.persona?.name || 'Unnamed'}\nRevisions: ${imported.state?.revisionHistory?.length || 0}\nCheckpoints: ${imported.state?.checkpoints?.length || 0}`
        : `Persona JSON\nPersona: ${imported.persona?.name || 'Unnamed'}\nCurrent persona: ${state.persona?.name || 'None'}`;
    const modeInput = await callGenericPopup(
        `<h3>Preview import</h3><pre>${escapeHtml(preview)}</pre><p><b>replace</b> overwrites the current managed persona/state. <b>merge</b> combines persona fields and collections where possible.</p><p>A revision and checkpoint will be created, but review the preview carefully before proceeding.</p><p>Type <b>replace</b> or <b>merge</b>, or cancel to discard.</p>`,
        POPUP_TYPE.INPUT,
        'replace',
        { rows: 1, wide: false },
    );
    const mode = String(modeInput || '').trim().toLowerCase();
    if (!mode) return;
    if (mode !== 'replace' && mode !== 'merge') {
        notify('Import cancelled.');
        return;
    }

    if (imported.type === 'full-backup') {
        if (mode === 'merge') {
            state.persona = mergeImportedPersona(state.persona, imported.persona);
            state.enabled = true;
            state.revisionHistory = makeRevision(state, before, state.persona, 'Merged full DPM backup persona');
            writeChatState(context, state, { immediate: true });
        } else {
            imported.state.revisionHistory = makeRevision(imported.state, before, imported.state.persona, 'Imported full DPM backup');
            writeChatState(context, imported.state, { immediate: true });
        }
    } else {
        state.persona = mode === 'merge'
            ? mergeImportedPersona(state.persona, imported.persona)
            : imported.persona;
        state.enabled = true;
        state.revisionHistory = makeRevision(state, before, state.persona, mode === 'merge' ? 'Merged persona JSON' : 'Imported persona JSON');
        writeChatState(context, state, { immediate: true });
    }

    refreshPromptInjection();
    renderPanel();
    notify('Import completed.');
}

async function analyseNativePersonaImport() {
    const context = getContext();
    const settings = getSettings();
    const { state } = readChatState(context);
    const source = await chooseNativePersonaSource(context, state);
    if (!source) return;

    const nativeText = await callGenericPopup(
        `<h3>Analyse native persona</h3><p>Review or edit the selected source before DPM converts it into structured JSON.</p><p><b>Source:</b> ${escapeHtml(source.label)}</p>`,
        POPUP_TYPE.INPUT,
        source.text,
        { rows: 16, wide: true },
    );
    if (!nativeText) return;

    const suggestedName = await callGenericPopup(
        '<h3>Persona name</h3><p>Optional. Used if the source text does not clearly name the persona.</p>',
        POPUP_TYPE.INPUT,
        source.name || state.persona?.name || name1 || '',
        { rows: 1, wide: false },
    );
    notify('Analysing native persona...');
    const converted = await analyseNativePersona({
        context,
        nativeText,
        suggestedName,
        settings,
        generateRaw: generateDpmRaw,
    });
    const reviewedJson = await callGenericPopup(
        '<h3>Review converted persona</h3><p>Edit the generated DPM JSON before importing, or cancel to discard it.</p>',
        POPUP_TYPE.INPUT,
        JSON.stringify(converted, null, 2),
        { rows: 18, wide: true },
    );
    if (!reviewedJson) return;

    const imported = parseDpmImport(reviewedJson);
    if (imported.type !== 'persona') {
        throw new Error('Native persona conversion must produce a single persona JSON object.');
    }

    const before = cloneJson(state.persona);
    state.persona = imported.persona;
    state.enabled = true;
    state.revisionHistory = makeRevision(state, before, imported.persona, 'Analysed native persona import');
    writeChatState(context, state, { immediate: true });
    refreshPromptInjection();
    renderPanel();
    notify('Native persona converted and imported.');
}

async function resetCurrentChat() {
    const confirmed = await callGenericPopup(
        '<h3>Reset DPM data?</h3><p>This removes the managed persona, pending proposals, revisions, checkpoints, and chat-specific DPM settings for this chat.</p><p>Export a backup first if you may need this state later.</p>',
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Reset', cancelButton: 'Cancel' },
    );
    if (!confirmed) return;
    await resetChatState(getContext());
    refreshPromptInjection();
    renderPanel();
    notify('DPM chat data reset.');
}

function injectSettingsPanel() {
    const parent = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!parent || document.getElementById('dpm--settings-drawer')) return;
    const settings = getSettings();
    const profiles = getConnectionProfiles();
    const sectionOrderText = (Array.isArray(settings.promptSectionOrder) && settings.promptSectionOrder.length ? settings.promptSectionOrder : SECTION_ORDER).join('\n');

    parent.insertAdjacentHTML('beforeend', `
        <div id="dpm--settings-drawer" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${DISPLAY_NAME}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input id="dpm--global-auto" type="checkbox" ${settings.automaticAnalysisDefault ? 'checked' : ''}> Enable automatic analysis by default after chat activation</label>
                <label>Dedicated analysis connection
                    <select id="dpm--analysis-profile" class="text_pole">
                        <option value="">Use current chat connection</option>
                        ${profiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${settings.analysisProfileId === profile.id ? 'selected' : ''}>${escapeHtml(profile.name || profile.id)}</option>`).join('')}
                    </select>
                </label>
                <label>Analysis context limit <input id="dpm--analysis-context-limit" class="text_pole" type="number" min="1000" max="64000" step="500" value="${Number(settings.analysisContextLimit)}"></label>
                <label>Analysis output tokens <input id="dpm--analysis-output-tokens" class="text_pole" type="number" min="100" max="8000" step="50" value="${Number(settings.responseTokenAllowance)}"></label>
                <label>Malformed response retries <input id="dpm--analysis-malformed-retries" class="text_pole" type="number" min="0" max="5" step="1" value="${Number(settings.analysisMalformedRetryLimit ?? 1)}"></label>
                <label>Native conversion output tokens <input id="dpm--native-output-tokens" class="text_pole" type="number" min="500" max="12000" step="100" value="${Number(settings.nativeConversionTokenAllowance)}"></label>
                <label>Prompt mode
                    <select id="dpm--prompt-mode" class="text_pole">
                        ${Object.values(PROMPT_MODES).map(mode => `<option value="${escapeHtml(mode)}" ${settings.promptMode === mode ? 'selected' : ''}>${escapeHtml(mode)}</option>`).join('')}
                    </select>
                </label>
                <label>Prompt token budget <input id="dpm--global-budget" class="text_pole" type="number" min="100" max="8000" step="50" value="${Number(settings.promptTokenBudget)}"></label>
                <label>Prompt sorting
                    <select id="dpm--prompt-sort" class="text_pole">
                        <option value="sectionOrder" ${settings.promptSortMode !== 'priority' ? 'selected' : ''}>Configured section order</option>
                        <option value="priority" ${settings.promptSortMode === 'priority' ? 'selected' : ''}>Section priority</option>
                    </select>
                </label>
                <label>Prompt section order <textarea id="dpm--section-order" class="text_pole" rows="6" spellcheck="false">${escapeHtml(sectionOrderText)}</textarea></label>
                <label class="checkbox_label"><input id="dpm--debug" type="checkbox" ${settings.debugMode ? 'checked' : ''}> Debug logging</label>
            </div>
        </div>
    `);

    parent.querySelector('#dpm--global-auto')?.addEventListener('change', event => {
        getSettings().automaticAnalysisDefault = !!event.target.checked;
        saveSettingsDebounced();
    });
    parent.querySelector('#dpm--analysis-profile')?.addEventListener('change', event => {
        getSettings().analysisProfileId = String(event.target.value || '');
        saveSettingsDebounced();
    });
    parent.querySelector('#dpm--analysis-context-limit')?.addEventListener('change', event => {
        getSettings().analysisContextLimit = Math.max(1000, Number(event.target.value || 6000));
        saveSettingsDebounced();
    });
    parent.querySelector('#dpm--analysis-output-tokens')?.addEventListener('change', event => {
        getSettings().responseTokenAllowance = Math.max(100, Number(event.target.value || 800));
        saveSettingsDebounced();
    });
    parent.querySelector('#dpm--analysis-malformed-retries')?.addEventListener('change', event => {
        getSettings().analysisMalformedRetryLimit = Math.max(0, Math.min(5, Number(event.target.value || 0)));
        saveSettingsDebounced();
    });
    parent.querySelector('#dpm--native-output-tokens')?.addEventListener('change', event => {
        getSettings().nativeConversionTokenAllowance = Math.max(500, Number(event.target.value || 1800));
        saveSettingsDebounced();
    });
    parent.querySelector('#dpm--prompt-mode')?.addEventListener('change', event => {
        getSettings().promptMode = String(event.target.value || PROMPT_MODES.compact);
        saveSettingsDebounced();
        refreshPromptInjection();
        if (panelOpen) renderPanel();
    });
    parent.querySelector('#dpm--global-budget')?.addEventListener('change', event => {
        getSettings().promptTokenBudget = Math.max(100, Number(event.target.value || 1200));
        saveSettingsDebounced();
        refreshPromptInjection();
        if (panelOpen) renderPanel();
    });
    parent.querySelector('#dpm--prompt-sort')?.addEventListener('change', event => {
        getSettings().promptSortMode = String(event.target.value || 'sectionOrder');
        saveSettingsDebounced();
        refreshPromptInjection();
        if (panelOpen) renderPanel();
    });
    parent.querySelector('#dpm--section-order')?.addEventListener('change', event => {
        const allowed = new Set(SECTION_ORDER);
        getSettings().promptSectionOrder = String(event.target.value || '')
            .split(/\r?\n|,/)
            .map(item => item.trim())
            .filter(item => allowed.has(item));
        saveSettingsDebounced();
        refreshPromptInjection();
        if (panelOpen) renderPanel();
    });
    parent.querySelector('#dpm--debug')?.addEventListener('change', event => {
        getSettings().debugMode = !!event.target.checked;
        saveSettingsDebounced();
    });
}

function bindEvents() {
    const context = getContext();
    const events = context.eventTypes ?? {};
    context.eventSource?.on?.(events.CHAT_CHANGED, () => {
        cancelActiveAnalysis();
        ensureChatState(getContext());
        syncPersonaToActiveBranch('chat-changed');
        refreshPromptInjection();
        if (panelOpen) renderPanel();
    });
    context.eventSource?.on?.(events.CHAT_LOADED, () => {
        cancelActiveAnalysis();
        ensureChatState(getContext());
        syncPersonaToActiveBranch('chat-loaded');
        refreshPromptInjection();
        if (panelOpen) renderPanel();
    });
    context.eventSource?.on?.(events.GENERATION_STARTED, () => {
        cancelActiveAnalysis();
        syncPersonaToActiveBranch('generation-started');
    });
    context.eventSource?.on?.(events.GENERATION_ENDED, () => {
        syncPersonaToActiveBranch('generation-ended');
        refreshPromptInjection();
        scheduleLatestPairAnalysis(100);
    });
    context.eventSource?.on?.(events.MESSAGE_SWIPED, () => {
        cancelActiveAnalysis();
        syncPersonaToActiveBranch('message-swiped');
        refreshPromptInjection();
        if (panelOpen) renderPanel();
        scheduleLatestPairAnalysis(600);
    });
    context.eventSource?.on?.(events.MESSAGE_EDITED, () => {
        cancelActiveAnalysis();
        syncPersonaToPreviousPairCheckpoint('message-edited');
        forceReanalyseLatestPair(250);
        if (panelOpen) renderPanel();
    });
    context.eventSource?.on?.(events.MESSAGE_RECEIVED, () => {
        scheduleLatestPairAnalysis(150);
    });
    context.eventSource?.on?.(events.MESSAGE_DELETED, () => {
        cancelActiveAnalysis();
        syncPersonaToActiveBranch('message-deleted');
        refreshPromptInjection();
        if (panelOpen) renderPanel();
    });
    context.eventSource?.on?.(events.MESSAGE_SWIPE_DELETED, () => {
        cancelActiveAnalysis();
        syncPersonaToActiveBranch('message-swipe-deleted');
        refreshPromptInjection();
        if (panelOpen) renderPanel();
    });
}

function bootstrap() {
    if (initialized) return;
    initialized = true;
    getSettings();
    ensureChatState(getContext());
    ensurePanelDom();
    injectSettingsPanel();
    bindEvents();
    refreshPromptInjection();
}

jQuery(async () => {
    bootstrap();
});

export const __testing = {
    getPromptPosition,
    getPromptRole,
    renderCompactPrompt,
    cleanup: () => cleanupHandle?.(),
    createPersonaFromNativeText,
};
