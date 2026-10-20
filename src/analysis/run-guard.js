export function isAuxiliaryGeneration(type, options = {}, dryRun = false) {
    return !!(dryRun || type === 'quiet' || options?.isAuxiliaryGeneration || options?.cacheScope === 'auxiliary');
}

// Cancellation can invalidate a result before the underlying provider settles.
// Keep the slot occupied until that request actually finishes.
export function createAnalysisRunGuard() {
    let active = null;
    return {
        get busy() { return active !== null; },
        acquire() {
            if (active !== null) return null;
            active = Symbol('analysis');
            return active;
        },
        release(token) {
            if (token === active) active = null;
        },
    };
}

export function hasAttemptedPair(analysisState, fingerprint) {
    return analysisState?.lastAttemptedFingerprint === fingerprint;
}
