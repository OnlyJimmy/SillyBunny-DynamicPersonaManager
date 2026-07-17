const PROTECTED_ROOT_FIELDS = new Set(['$schema', 'schemaVersion', 'personaId']);

export function parseJsonPointer(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
        throw new Error('Path must be a JSON pointer beginning with /.');
    }

    return path
        .slice(1)
        .split('/')
        .filter(part => part.length > 0)
        .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function isProtectedPersonaPath(path) {
    const [root] = parseJsonPointer(path);
    return PROTECTED_ROOT_FIELDS.has(root);
}

export function resolveParent(root, path) {
    const parts = parseJsonPointer(path);
    if (!parts.length) throw new Error('Path must target a persona field.');
    const key = parts.at(-1);
    let parent = root;

    for (const part of parts.slice(0, -1)) {
        if (parent === null || parent === undefined || typeof parent !== 'object') {
            throw new Error(`Path parent does not exist: /${parts.join('/')}`);
        }
        parent = parent[part];
    }

    return { parent, key, parts };
}

export function getPathValue(root, path) {
    const parts = parseJsonPointer(path);
    return parts.reduce((cursor, part) => cursor?.[part], root);
}

export function setPathValue(root, path, value) {
    const { parent, key } = resolveParent(root, path);
    if (parent === null || parent === undefined || typeof parent !== 'object') {
        throw new Error(`Path parent is not editable: ${path}`);
    }
    parent[key] = value;
}

export function removePathValue(root, path) {
    const { parent, key } = resolveParent(root, path);
    if (Array.isArray(parent)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
            throw new Error(`Array index is invalid: ${path}`);
        }
        return parent.splice(index, 1)[0];
    }
    if (parent === null || parent === undefined || typeof parent !== 'object' || !(key in parent)) {
        throw new Error(`Path does not exist: ${path}`);
    }
    const previous = parent[key];
    delete parent[key];
    return previous;
}
