import { renderCompactPrompt } from '../prompting/renderer.js';
import { LOCK_MODES } from '../state/locks.js';
import { buildValidatedProposal } from './validator.js';
import { generateParsedAnalysis } from './analyser.js';

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

For edits to existing array entries, target the exact JSON pointer index from the current persona, such as /relationships/0/trust.
When changing numeric relationship values such as trust, affection, respect, or fear, preserve numeric meaning and keep values between 0 and 100 unless the existing value clearly uses another scale.
For relative changes, calculate the new value from the current persona. Example: "double the trust with Mary" changes trust 25 to 50.
For new collection entries, do not invent IDs. The extension assigns stable IDs.
If the instruction is ambiguous or unsafe, return an empty operations array.

Current canonical persona:
${renderCompactPrompt(persona, { hiddenMode: LOCK_MODES.analysisHidden, maximumTokens: 0 }) || '(none)'}

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
