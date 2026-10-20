function extractJsonText(text) {
    const raw = String(text ?? '').trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();

    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
        return raw.slice(first, last + 1);
    }

    return raw;
}

function repairJsonText(text) {
    let result = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
        } else if (character === '"') {
            inString = true;
        } else if (character === ',' && /^\s*[}\]]/.test(text.slice(index + 1))) {
            continue;
        }
        result += character;
    }
    return result.trim();
}

export function parseAnalysisResponse(text) {
    const jsonText = repairJsonText(extractJsonText(text));
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error) {
        throw new Error(`Analysis response was not valid JSON: ${error.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Analysis response must be a JSON object.');
    }
    if (Number(parsed.proposalVersion) !== 1) {
        throw new Error(`Unsupported proposal version: ${parsed.proposalVersion ?? 'missing'}.`);
    }
    if (!Array.isArray(parsed.operations)) {
        throw new Error('Analysis response operations must be an array.');
    }

    return {
        proposalVersion: 1,
        summary: String(parsed.summary ?? '').trim(),
        operations: parsed.operations,
    };
}
