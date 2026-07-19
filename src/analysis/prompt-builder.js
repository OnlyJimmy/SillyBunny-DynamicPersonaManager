import { renderCompactPrompt } from '../prompting/renderer.js';
import { LOCK_MODES } from '../state/locks.js';

const DEFAULT_ANALYSER_PROMPT = `You are the Dynamic Persona Manager analyser.
Inspect only the latest user/assistant message pair.
Return JSON only in this shape:
{
  "proposalVersion": 1,
  "summary": "short summary or empty string",
  "operations": []
}

Operations must be conservative and evidence-grounded.
Every operation must include an "evidence" string that is an exact short excerpt copied from the latest user or assistant message. Maximum evidence length: 200 characters.
Supported operation types:
- set: {"type":"set","path":"/summary","oldValue":"","value":"Updated concise summary","category":"overview","targetLabel":"Summary","changeType":"state update","reason":"","evidence":"","confidence":0.8,"importance":"material","severity":"normal"}
- add: {"type":"add","path":"/inventory","value":{"name":"Iron key","quantity":1},"category":"inventory","targetLabel":"Iron key","changeType":"acquisition","reason":"","evidence":"","confidence":0.8,"importance":"material","severity":"normal"}
- add relationship: {"type":"add","path":"/relationships","value":{"entityName":"Dain","entityType":"character","summary":"trusted ally","attitude":"warm","trust":70,"affection":40,"respect":60,"fear":0},"category":"relationships","targetLabel":"Dain","changeType":"relationship update","reason":"","evidence":"","confidence":0.8,"importance":"material","severity":"normal"}
- remove: {"type":"remove","path":"/conditions/0","oldValue":{...},"category":"conditions","targetLabel":"Sprained wrist","changeType":"resolution","reason":"","evidence":"","confidence":0.8,"importance":"material","severity":"normal"}

Optional operation metadata may include "category", "targetLabel", "changeType", "severity", "tags", "transactionId", and "transactionLabel".
Use transaction metadata only when multiple operations must be accepted or rejected together.

Never invent IDs. The extension assigns stable IDs for new collection entries.
Do not propose changes for jokes, dreams, figurative language, offers not accepted, unperceived facts, or unsupported guesses.
Do not paraphrase evidence. If you cannot quote exact source evidence, do not propose the operation.
If there are no material changes, return an empty operations array.`;

export function buildAnalysisPrompt({ persona, pair, customPrompt = '' }) {
    const instructions = String(customPrompt || '').trim() || DEFAULT_ANALYSER_PROMPT;
    return `${instructions}

Current canonical persona:
${renderCompactPrompt(persona, { hiddenMode: LOCK_MODES.analysisHidden }) || '(none)'}

Latest user message [${pair.userIndex}]:
${pair.userText}

Latest assistant message [${pair.assistantIndex}]:
${pair.assistantText}

Return JSON only.`;
}
