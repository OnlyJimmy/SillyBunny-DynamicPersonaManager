function normalizeEvidenceText(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function validateOperationEvidence(operation, pair, { maximumLength = 200 } = {}) {
    const evidence = String(operation?.evidence ?? '').trim();
    if (!evidence) {
        return { ok: false, message: 'Operation evidence is required.' };
    }
    if (evidence.length > maximumLength) {
        return { ok: false, message: `Operation evidence exceeds ${maximumLength} characters.` };
    }

    const normalizedEvidence = normalizeEvidenceText(evidence);
    const sourceText = normalizeEvidenceText(`${pair?.userText ?? ''}\n${pair?.assistantText ?? ''}`);
    if (!sourceText.includes(normalizedEvidence)) {
        return { ok: false, message: 'Operation evidence was not found in the source message pair.' };
    }

    return { ok: true, message: '' };
}
