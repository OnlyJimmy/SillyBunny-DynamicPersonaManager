export function checkAnalysisContext(prompt, contextLimit = 6000) {
    const text = String(prompt || '');
    const limit = Math.max(1000, Number(contextLimit) || 6000);
    if (text.length > limit * 4) {
        throw new Error(`DPM analysis prompt exceeds the configured analysis context limit (${limit} estimated tokens). Increase the Analysis context limit in DPM settings to at least ${Math.ceil(text.length / 4)}. No analysis was sent; section templates, persona state, and message evidence must remain intact.`);
    }
    return text;
}
