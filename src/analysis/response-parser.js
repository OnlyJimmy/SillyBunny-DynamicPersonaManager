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
    return text
        .replace(/,\s*([}\]])/g, '$1')
        .trim();
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
