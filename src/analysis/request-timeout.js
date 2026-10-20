export function runTimedRequest({ request, signal, timeoutMs, onProgress = () => {}, timers = globalThis, now = Date.now }) {
    const controller = new AbortController();
    const abortError = () => Object.assign(new Error('DPM request cancelled.'), { name: 'AbortError' });
    if (signal?.aborted) return Promise.reject(abortError());
    const startedAt = now();
    return new Promise((resolve, reject) => {
        let settled = false;
        let timeout;
        let heartbeat;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            timers.clearTimeout(timeout);
            timers.clearInterval(heartbeat);
            signal?.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve(value);
        };
        const onAbort = () => {
            const error = abortError();
            finish(error);
            controller.abort(error);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        timeout = timers.setTimeout(() => {
            const error = Object.assign(new Error(`DPM request timed out after ${Math.round(timeoutMs / 1000)} seconds without a complete response. The provider or connection may still be processing the request. Try a lower output token allowance or another analysis connection, or increase Request timeout in DPM settings for slow reasoning models. Scan latest pair to retry.`), { name: 'TimeoutError' });
            finish(error);
            controller.abort(error);
        }, timeoutMs);
        heartbeat = timers.setInterval(() => onProgress({ durationMs: now() - startedAt }), 15000);
        // Both handlers remain attached after cancellation/timeout, so late provider
        // completions are discarded and late rejections cannot become unhandled.
        Promise.resolve().then(() => settled ? undefined : request(controller.signal))
            .then(value => finish(null, value), error => finish(error));
    });
}
