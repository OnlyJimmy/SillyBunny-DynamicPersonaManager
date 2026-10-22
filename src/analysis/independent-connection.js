export function normalizeConnectionUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter a valid DPM API base URL.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('DPM API base URL must be HTTP(S), without embedded credentials, query parameters, or fragments.');
    }
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
}

export function buildIndependentRequest({ settings, apiKey, prompt, responseLength }) {
    const baseUrl = normalizeConnectionUrl(settings.independentBaseUrl);
    const model = String(settings.independentModel || '').trim();
    if (!model) throw new Error('Enter a model ID for the independent DPM connection.');
    return {
        type: 'quiet', cacheScope: 'auxiliary', stream: false,
        chat_completion_source: 'openai', reverse_proxy: baseUrl, proxy_password: String(apiKey || ''),
        model, messages: [{ role: 'user', content: String(prompt || '') }],
        max_tokens: Number(responseLength || settings.responseTokenAllowance || 800),
        // Explicit request settings; no active profile or preset is consulted.
        temperature: 0.2, top_p: 1, frequency_penalty: 0, presence_penalty: 0,
        n: 1, use_sysprompt: false,
    };
}

export async function sendIndependentRequest({ settings, apiKey, prompt, responseLength, signal, headers, fetchImpl = fetch, onDebug = () => {} }) {
    const payload = buildIndependentRequest({ settings, apiKey, prompt, responseLength });
    const response = await fetchImpl('/api/backends/chat-completions/generate', {
        method: 'POST', headers, body: JSON.stringify(payload), signal,
    });
    onDebug('request.independent-status', { httpStatus: response.status });
    if (!response.ok) throw new Error(`Independent DPM connection returned HTTP ${response.status}. Check the base URL, model ID, and API key. No profile or preset was used.`);
    let data;
    try { data = await response.json(); } catch { throw new Error('Independent DPM connection returned a non-JSON HTTP response. Check the API base URL.'); }
    if (data.error) throw new Error('Independent DPM provider returned an error. Check the server console for the provider error.');
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content)
        ? content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') : '';
    onDebug('request.independent-response', {
        responseCharacters: text.length, reasoningCharacters: String(choice?.message?.reasoning_content || choice?.message?.reasoning || '').length,
        finishReason: ['stop', 'length', 'content_filter', 'tool_calls'].includes(choice?.finish_reason) ? choice.finish_reason : 'other',
    });
    if (!text.trim()) throw new Error(`Independent DPM provider returned no assistant text${choice?.finish_reason === 'length' ? ' before reaching its token limit' : ''}. A reasoning-only response cannot be analysed; check the model and output allowance.`);
    return text.trim();
}
