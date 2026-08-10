import { renderCompactPrompt } from '../prompting/renderer.js';
import { LOCK_MODES } from '../state/locks.js';
import { buildValidatedProposal } from './validator.js';
import { generateParsedAnalysis } from './analyser.js';

function buildPersonaJsonSnapshot(persona) {
    return JSON.stringify(persona ?? null, null, 2);
}

export function buildManualInstructionPrompt({ persona, instruction }) {
    return `You are the Dynamic Persona Manager manual editor.
Convert the user's explicit instruction into safe pending persona operations.
Return JSON only in this shape:
{
  "proposalVersion": 1,
  "summary": "brief summary",
  "operations": []
}

Supported operation types:
- set: {"type":"set","path":"/summary","oldValue":"","value":"Updated concise summary","category":"overview","targetLabel":"Summary","changeType":"manual edit","reason":"","evidence":"","confidence":1,"importance":"material","severity":"normal"}
- add: {"type":"add","path":"/inventory","value":{"name":"Gold piece","quantity":2},"category":"inventory","targetLabel":"Gold pieces","changeType":"manual addition","reason":"","evidence":"","confidence":1,"importance":"material","severity":"normal"}
- add skill: {"type":"add","path":"/skills","value":{"name":"Basic ritual magic","rank":"basic","status":"active"},"category":"skills","targetLabel":"Basic ritual magic","changeType":"manual addition","reason":"","evidence":"","confidence":1,"importance":"material","severity":"normal"}
- remove: {"type":"remove","path":"/conditions/0","oldValue":{...},"category":"conditions","targetLabel":"Condition","changeType":"manual removal","reason":"","evidence":"","confidence":1,"importance":"material","severity":"normal"}

Editing rules:
- Use "add" only for genuinely new collection entries.
- If the named item, skill, relationship, quest, condition, knowledge, currency, or custom section already exists, use "set" to edit its existing field instead of adding a duplicate.
- Match existing entries by case-insensitive name, title, subject, entityName, slot, or clear description.
- For edits to existing array entries, target the exact JSON pointer index from the JSON snapshot, such as /relationships/0/trust.
- Include "oldValue" for every set or remove operation whenever the current value is visible in the JSON snapshot.
- For count reductions, use "set" on the existing quantity or amount field. Example: if /inventory/0/quantity is 5 and the instruction is "remove two arrows", return value 3 and oldValue 5.
- If reducing an item quantity to 0 or less, use remove on the whole entry and include oldValue as the full current entry object.
- For currency changes, edit /currencies/{index}/amount when the currency exists. Add a currency only when no matching currency exists.
When changing numeric relationship values such as trust, affection, respect, or fear, preserve numeric meaning and keep values between 0 and 100 unless the existing value clearly uses another scale.
For relative changes, calculate the new value from the current persona. Example: "double the trust with Mary" changes trust 25 to 50.
For new collection entries, do not invent IDs. The extension assigns stable IDs.
If the instruction is ambiguous or unsafe, return an empty operations array.

Examples:
- "Add two gold pieces" when gold already exists at /currencies/0 with amount 4: {"type":"set","path":"/currencies/0/amount","oldValue":4,"value":6,"category":"currencies","targetLabel":"Gold","changeType":"manual currency update","reason":"User requested adding two gold pieces.","evidence":"manual instruction","confidence":1,"importance":"material"}
- "Add two gold pieces" when no gold currency exists: {"type":"add","path":"/currencies","value":{"name":"Gold","amount":2,"unit":"pieces"},"category":"currencies","targetLabel":"Gold","changeType":"manual currency addition","reason":"User requested adding two gold pieces.","evidence":"manual instruction","confidence":1,"importance":"material"}
- "Use one torch" when a torch exists at /inventory/2 with quantity 3: {"type":"set","path":"/inventory/2/quantity","oldValue":3,"value":2,"category":"inventory","targetLabel":"Torch","changeType":"manual quantity update","reason":"User requested using one torch.","evidence":"manual instruction","confidence":1,"importance":"material"}
- "Double the trust with Mary" when Mary is /relationships/1 and trust is 25: {"type":"set","path":"/relationships/1/trust","oldValue":25,"value":50,"category":"relationships","targetLabel":"Mary","changeType":"manual relationship update","reason":"User requested doubling Mary's trust.","evidence":"manual instruction","confidence":1,"importance":"material"}
- "Improve ritual magic to intermediate" when the skill is /skills/0: {"type":"set","path":"/skills/0/rank","oldValue":"basic","value":"intermediate","category":"skills","targetLabel":"Ritual magic","changeType":"manual skill update","reason":"User requested improving ritual magic.","evidence":"manual instruction","confidence":1,"importance":"material"}

Current canonical persona:
${renderCompactPrompt(persona, { hiddenMode: LOCK_MODES.analysisHidden, maximumTokens: 0 }) || '(none)'}

Exact JSON snapshot for paths and oldValue:
${buildPersonaJsonSnapshot(persona)}

User instruction:
${String(instruction || '').trim()}

Return JSON only.`;
}

export async function analyseManualInstruction({ context, persona, instruction, settings = {}, signal, generateRaw = null }) {
    const generate = generateRaw || context.generateRaw;
    if (typeof generate !== 'function') {
        throw new Error('No manual edit generation function is available.');
    }

    const prompt = buildManualInstructionPrompt({ persona, instruction });
    const retryLimit = Math.max(0, Math.min(5, Number(settings.analysisMalformedRetryLimit ?? 1)));
    const { parsedResponse, warnings: retryWarnings } = await generateParsedAnalysis({
        generate,
        prompt,
        responseLength: Number(settings.responseTokenAllowance ?? 800),
        signal,
        retryLimit,
    });

    const result = buildValidatedProposal({
        persona,
        parsedResponse,
        source: {
            type: 'manual-instruction',
            instruction: String(instruction || '').trim(),
        },
        analysis: {
            rawStored: false,
            manualInstruction: true,
            analysedAt: new Date().toISOString(),
            instruction: String(instruction || '').trim(),
        },
        minimumConfidence: 0,
        requireEvidence: false,
    });

    return {
        ...result,
        warnings: [
            ...retryWarnings,
            ...(result.warnings || []),
        ],
    };
}
