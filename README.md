# Dynamic Persona Manager

Dynamic Persona Manager, or DPM, is a third-party SillyBunny extension for maintaining a structured, chat-bound player-character state. It is designed for roleplay chats where the user character changes over time: inventory, conditions, mood, goals, knowledge, relationships, quests, equipment, and other mutable details.

DPM keeps this managed state separate from the native SillyBunny persona. The native persona can remain the stable character foundation, while DPM owns accepted, current, mutable state and injects that state into prompts.

## Core Invariant

Canonical persona state changes only through:

- validated manual edits,
- validated imports reviewed by the user,
- accepted analyser proposals,
- Streamlined Mode auto-approval after validation, if explicitly enabled.

Pending proposals are never injected into prompts. Invalid, stale, locked, conflicted, or malformed analyser output fails closed.

## Main Features

- Chat-bound DPM metadata under `dynamicPersonaManager`.
- Companion-style dockable handle and right-side drawer.
- Tabs for Character, Pending, History, Prompt, and Settings.
- Section-specific persona editor with collapsible sections.
- Add, edit, remove, and lock controls for supported persona sections.
- Prompt rendering and injection from accepted canonical state only.
- Full, compact, minimal, ordered, and token-budgeted prompt behavior.
- Automatic latest-pair analysis after generation.
- Dedicated analysis connection support through Connection Manager profiles.
- Pending proposal review with accept, edit, reject, batch actions, and source navigation.
- Swipe-aware proposals and branch/checkpoint sync.
- Evidence validation against the latest user/assistant pair.
- Lock enforcement for proposal, prompt, analysis, confirmation, and immutable locks.
- Conflict detection and transaction-group acceptance.
- Streamlined Mode for opt-in automatic approval of valid proposals.
- Revision history, inverse revert, and checkpoint restore.
- JSON, prompt text, readable text, native text, and full backup export.
- DPM JSON/full-backup import with replace or merge behavior.
- Native persona analysis/import workflow.

## Drawer Tabs

### Character

Edit the current managed persona. Core sections include overview, identity, appearance, personality, attributes, skills, inventory, equipment, conditions, relationships, quests, goals, knowledge, currencies, custom sections, locks, and advanced JSON.

Manual saves create revisions and checkpoints.

### Pending

Shows analyser proposals that have not yet been handled. Each operation includes source evidence, proposed values, metadata, conflict warnings, transaction information, and action buttons.

Use the Source button to jump to the message or swipe that produced a proposal.

### History

Shows revisions, source information, operation summaries, checkpoint restore actions, and inverse revert actions.

Revert uses stored inverse operations and fails closed if affected state has changed since the original revision. Restore replaces the current persona with an exact checkpoint snapshot.

### Prompt

Shows the exact prompt text DPM will inject. This tab only reflects accepted canonical state.

### Settings

Chat-specific controls for automatic analysis, Streamlined Mode, branch state sync, analysis pause, and reset.

## Global Settings

The SillyBunny extension settings panel includes:

- automatic analysis default,
- dedicated analysis connection profile,
- analysis context limit,
- analysis output token allowance,
- malformed response retry count,
- native conversion output token allowance,
- prompt mode,
- prompt token budget,
- prompt sorting,
- prompt section order,
- debug logging.

## Analysis Pipeline

When automatic analysis is enabled, DPM inspects the latest completed user/assistant pair after generation. The analyser must return JSON operations, not a replacement persona.

DPM then:

1. Parses the response, retrying malformed output if configured.
2. Validates operation shape and paths.
3. Checks confidence thresholds.
4. Verifies exact evidence against the source pair.
5. Enforces locks.
6. Simulates operations on a clone.
7. Detects stale swipe/source state.
8. Detects unresolved conflicts.
9. Presents proposals for review, or auto-approves only if Streamlined Mode is enabled.

Malformed output, fabricated evidence, stale proposals, protected paths, lock violations, invalid results, and failed transaction simulation do not mutate canonical state.

## Streamlined Mode

Streamlined Mode automatically approves valid analyser proposals. It is off by default and shows a one-time per-chat warning before enabling.

Even in Streamlined Mode, DPM still requires:

- valid JSON,
- valid evidence,
- fresh source messages/swipes,
- passing locks,
- passing conflict checks,
- passing transaction simulation,
- valid resulting persona state.

Skipped, conflicted, stale, or invalid changes remain visible for manual review where appropriate.

## Locks

Supported lock modes:

- `proposalLocked`: analyser proposals cannot change this path.
- `confirmationLocked`: proposals may be created but require explicit acceptance.
- `promptHidden`: value is omitted from prompt injection.
- `analysisHidden`: value is omitted from analysis context.
- `immutable`: operation application is blocked until unlocked.

Parent-path locks apply to descendants.

## Source, Swipe, and Branch Behavior

Proposals are linked to the source message pair and assistant swipe that produced them. If the active swipe changes, proposals from other swipes become stale.

DPM can sync persona state to the active branch using checkpoints. This supports workflows where different swipes lead to different accepted persona states.

Source navigation can switch to the recorded assistant swipe before scrolling to the relevant message.

## Import and Export

Exports include:

- readable persona text,
- DPM persona JSON,
- prompt text,
- native persona text,
- full backup JSON.

Imports support:

- persona JSON,
- full backup JSON,
- merge or replace mode,
- native persona analysis and conversion.

Imports create revisions and checkpoints. Resetting DPM data removes the persona, proposals, revisions, checkpoints, and chat-specific settings for the current chat, so export a backup first if needed.

## Recovery Model

DPM uses two recovery paths:

- Revert: applies inverse operations for a specific revision when safe.
- Restore: replaces the current persona with an exact checkpoint snapshot.

Proposal accepts use precise inverse operations. Manual edits and imports use conservative root-level snapshot diff operations, which are reversible when affected roots have not drifted.

## Development Notes

The extension is implemented under:

```text
public/scripts/extensions/third-party/dynamic-persona-manager
```

Useful local checks:

```powershell
node --check public/scripts/extensions/third-party/dynamic-persona-manager/index.js
node --test public/scripts/extensions/third-party/dynamic-persona-manager/tests/*.test.js
```

The extension directory may appear as ignored in the upstream SillyBunny repository because third-party extensions are ignored by default.

## Known Limits

- Version 1 manages one player persona per chat.
- Automatic analysis normally covers only the latest completed user/assistant pair.
- Custom-section analysis is disabled by default.
- DPM does not rewrite native SillyBunny personas automatically.
- DPM is conservative by design; ambiguous or unsupported changes should remain manual.
