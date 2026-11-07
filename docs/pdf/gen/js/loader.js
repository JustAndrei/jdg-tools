import { AppError } from './errors.js';
import { downloadBytes, downloadText, HttpError, resourceUrl } from './io.js';

/** Metadata file `<baseName>.json`; null when there is none (then a starting-point file is offered). */
async function loadMetadata(baseName) {
    const url = resourceUrl(baseName, '.json');
    let json;
    try {
        json = await downloadText(url);
    } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
    }
    try {
        return JSON.parse(json);
    } catch (error) {
        throw new AppError(`${baseName}.json is not valid JSON: ${error.message}`);
    }
}

/** Font files listed in `global.fonts`, in the order they are embedded (the keys are only labels). */
function loadFonts(fonts = {}) {
    return Promise.all(Object.values(fonts).map((fontUrl) => downloadBytes(fontUrl)));
}

/** Optional PDF-specific module `<baseName>.js` exporting extra transformations. */
async function loadScript(baseName) {
    try {
        return await import(resourceUrl(baseName, '.js'));
    } catch (error) {
        console.info(`No custom script for ${baseName}: ${error.message}`);
        return null;
    }
}

/**
 * Everything needed to work with a PDF, besides the PDF itself: its metadata, fonts and script.
 * @returns {Promise<{baseName: string, metadataFileName: string, pdfBytes: Uint8Array,
 *                    metadata: object|null, fontBytes: Uint8Array[], script: object|null}>}
 */
export async function loadProject(baseName, pdfBytes) {
    const metadata = await loadMetadata(baseName);
    const fontBytes = metadata ? await loadFonts(metadata.global?.fonts) : [];
    const script = await loadScript(baseName);
    return { baseName, metadataFileName: `${baseName}.json`, pdfBytes, metadata, fontBytes, script };
}
