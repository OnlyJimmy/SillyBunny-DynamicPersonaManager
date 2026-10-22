export function syncConnectionSettingsVisibility(root, mode) {
    const independent = mode === 'independent';
    const entries = [
        ['#dpm--independent-connection', independent, 'grid'],
        ['#dpm--profile-label', !independent, 'grid'],
    ];
    for (const [selector, visible, display] of entries) {
        const element = root.querySelector(selector);
        if (!element) continue;
        element.hidden = !visible;
        element.setAttribute('aria-hidden', String(!visible));
        // Host themes can override the browser's default hidden/fieldset styles.
        element.style.setProperty('display', visible ? display : 'none', 'important');
    }
}
