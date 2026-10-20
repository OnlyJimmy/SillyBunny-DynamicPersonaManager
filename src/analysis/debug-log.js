const STORAGE_KEY = 'dpm--debug-log-v1';
const FIELDS = new Set(['runId', 'requestId', 'attempt', 'retryLimit', 'delay', 'durationMs', 'promptCharacters', 'responseCharacters', 'responseLength', 'contextLimit', 'route', 'reason', 'errorName', 'errorKind', 'position', 'line', 'column', 'operations', 'warnings', 'failures', 'busy', 'activeOperations', 'userIndex', 'assistantIndex', 'swipeId', 'generationType', 'ignored', 'automaticAnalysis', 'paused', 'streamlinedMode', 'confidenceThreshold', 'timeoutSeconds']);

function safeDetails(details = {}) {
    return Object.fromEntries(Object.entries(details).filter(([key, value]) => FIELDS.has(key)
        && (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
            || (typeof value === 'string' && /^[a-zA-Z0-9_. -]{0,100}$/.test(value)))));
}

// Error messages can contain excerpts of model output, URLs, or credentials.
// Export classifications and positions rather than arbitrary exception text.
export function describeDebugError(error) {
    const message = String(error?.message || '');
    const details = {
        errorName: ['AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error',
        errorKind: error?.name === 'TimeoutError' ? 'request-timeout'
            : /context limit/i.test(message) ? 'context-limit'
            : /JSON|malformed|proposal version|operations must/i.test(message) ? 'invalid-json-response'
                : /abort|cancel/i.test(message) ? 'cancelled' : 'request-or-validation-error',
    };
    for (const field of ['position', 'line', 'column']) {
        const match = message.match(new RegExp(`${field} (\\d+)`, 'i'));
        if (match) details[field] = Number(match[1]);
    }
    return details;
}

export function createDebugLog({ isEnabled, storage = null, limit = 200, now = () => new Date().toISOString() }) {
    let entries = [];
    try {
        const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
        if (Array.isArray(saved)) entries = saved.slice(-limit).filter(entry =>
            typeof entry?.event === 'string' && /^[a-z.-]{1,80}$/.test(entry.event)
            && typeof entry.time === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(entry.time)
        ).map(({ time, event, details }) => ({ time, event, details: safeDetails(details) }));
    } catch { /* Logging must never prevent extension startup. */ }
    const persist = () => {
        try { storage?.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* Memory log remains available. */ }
    };
    return {
        record(event, details = {}) {
            if (!isEnabled() || !/^[a-z.-]{1,80}$/.test(event)) return;
            entries.push({ time: now(), event, details: safeDetails(details) });
            entries = entries.slice(-limit);
            persist();
        },
        clear() { entries = []; persist(); },
        report(context = {}) {
            return JSON.stringify({
                product: 'Dynamic Persona Manager', logFormat: 1,
                generatedAt: now(), debugEnabled: !!isEnabled(),
                contentPolicy: 'No message text, persona values, prompts, raw responses, credentials, or connection URLs are collected.',
                context: safeDetails(context), entries,
            }, null, 2);
        },
    };
}
