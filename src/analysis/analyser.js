import { buildAnalysisPrompt } from './prompt-builder.js';
import { parseAnalysisResponse } from './response-parser.js';
import { buildValidatedProposal } from './validator.js';

const JSON_OUTPUT_RULES = `OUTPUT REQUIREMENT: Return ONLY one complete, valid JSON object. No markdown fences, commentary, reasoning, XML, or text before or after it.
Use double quotes for every key and string. Escape double quotes, backslashes, and line breaks inside strings (\\\", \\\\, \\n). Use commas between properties and array elements; no trailing commas, comments, ellipses, undefined, NaN, or Infinity.
Required keys: "proposalVersion":1, "summary":string, "operations":array. Each operation must use the specified operation schema.
Keep the response concise enough to finish within the output token allowance. Prefer fewer complete, high-confidence operations over truncated JSON. Close every string, array, and object. Check JSON syntax before returning. If no safe changes exist, return {"proposalVersion":1,"summary":"","operations":[]}.`;

function buildRetryPrompt(prompt, error, attempt) {
    return `${prompt}

The previous Dynamic Persona Manager analysis response was malformed and could not be used.
Retry attempt ${attempt}. Return only one valid JSON object, with no prose and no markdown fences.
Required shape:
{
  "proposalVersion": 1,
  "summary": "brief summary",
  "operations": []
}
If there are no safe persona changes, return the same object with an empty operations array.
Previous error: ${error.message}`;
}

export async function generateParsedAnalysis({ generate, prompt, responseLength, signal, retryLimit }) {
    const warnings = [];
    const malformedResponses = [];
    let lastError = null;

    const strictPrompt = `${JSON_OUTPUT_RULES}\n\n${prompt}\n\n${JSON_OUTPUT_RULES}`;

    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
        const raw = await generate({
            prompt: attempt === 0 ? strictPrompt : buildRetryPrompt(strictPrompt, lastError, attempt),
            responseLength,
            trimNames: true,
            cacheScope: 'auxiliary',
            signal,
        });

        try {
            const parsedResponse = parseAnalysisResponse(raw);
            if (attempt > 0) {
                warnings.push({
                    code: 'analysisResponseRetrySucceeded',
                    message: `Malformed analysis response recovered after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}.`,
                });
            }
            return { parsedResponse, warnings, malformedResponses };
        } catch (error) {
            lastError = error;
            malformedResponses.push({ attempt: attempt + 1, rawResponse: String(raw ?? ''), error: error.message });
            if (attempt < retryLimit) {
                warnings.push({
                    code: 'analysisResponseMalformed',
                    message: `Malformed analysis response on attempt ${attempt + 1}: ${error.message}`,
                });
            }
        }
    }

    const error = new Error(`Analysis response remained malformed after ${retryLimit + 1} attempt${retryLimit === 0 ? '' : 's'}: ${lastError?.message || 'unknown parse error'}`);
    error.malformedResponses = malformedResponses;
    throw error;
}

export async function analysePair({ context, persona, pair, fingerprint, settings = {}, signal, generateRaw = null }) {
    const generate = generateRaw || context.generateRaw;
    if (typeof generate !== 'function') {
        throw new Error('No analysis generation function is available.');
    }

    const prompt = buildAnalysisPrompt({
        persona,
        pair,
        customPrompt: settings.analyserPrompt,
    });
    const retryLimit = Math.max(0, Math.min(5, Number(settings.analysisMalformedRetryLimit ?? 1)));
    const { parsedResponse, warnings: retryWarnings, malformedResponses } = await generateParsedAnalysis({
        generate,
        prompt,
        responseLength: Number(settings.responseTokenAllowance ?? 800),
        signal,
        retryLimit,
    });
    const source = {
        type: 'latest-pair',
        fingerprint,
        userMessageId: String(pair.userIndex),
        assistantMessageId: String(pair.assistantIndex),
        assistantSwipeId: pair.assistantSwipeId,
    };

    const result = buildValidatedProposal({
        persona,
        parsedResponse,
        source,
        analysis: {
            rawStored: false,
            analysedAt: new Date().toISOString(),
        },
        minimumConfidence: Number(settings.confidenceThreshold ?? 0.7),
        pair,
        evidenceMaximumLength: Number(settings.evidenceExcerptMaximum ?? 200),
    });
    return {
        ...result,
        malformedResponses,
        warnings: [
            ...retryWarnings,
            ...(result.warnings || []),
        ],
    };
}
