export class HttpError extends Error {
    constructor(url, status, statusText) {
        super(`Error ${status}: ${statusText} (${url})`);
        this.name = 'HttpError';
        this.status = status;
    }
}

async function request(url) {
    const response = await fetch(url);
    if (!response.ok) throw new HttpError(url, response.status, response.statusText);
    return response;
}

export async function downloadBytes(url) {
    return new Uint8Array(await (await request(url)).arrayBuffer());
}

export async function downloadText(url) {
    return (await request(url)).text();
}

/**
 * URL of a project resource (`<baseName>.pdf`, `.json`, `.js`) next to index.html.
 * The name is percent-encoded so that a crafted value (e.g. from location.hash) can never turn
 * into another origin ('//host/x'), a scheme or a path traversal.
 */
export function resourceUrl(baseName, extension) {
    return new URL(encodeURIComponent(baseName) + extension, document.baseURI).href;
}

export function saveTextFile(filename, mimeType, content) {
    const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

/** Opens the native file picker. Resolves with the chosen File, or null when the dialog is cancelled. */
export function pickLocalFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.addEventListener('change', () => resolve(input.files[0] ?? null), { once: true });
        input.addEventListener('cancel', () => resolve(null), { once: true });
        input.click();
    });
}
