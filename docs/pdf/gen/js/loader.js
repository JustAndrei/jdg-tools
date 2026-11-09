import { AppError } from './errors.js';
import { downloadBytes, downloadText, HttpError, resourceUrl } from './io.js';
const { parse } = JsonSourceMap;

const escapePointer = (key) => key.replace(/~/g, '~0').replace(/\//g, '~1');

/** Non-enumerable, so that Object.keys / spread / JSON.stringify do not see it. */
function define(node, name, value) {
    Object.defineProperty(node, name, { value, enumerable: false, configurable: true });
}

/** A deep copy of parsed JSON that keeps the line metadata (structuredClone drops non-enumerable properties). */
export function cloneWithLines(node) {
    if (node === null || typeof node !== 'object') return node;
    const copy = Array.isArray(node) ? [] : {};
    for (const [key, child] of Object.entries(node)) copy[key] = cloneWithLines(child);
    if (node.__line !== undefined) define(copy, '__line', node.__line);
    if (node.__lines !== undefined) define(copy, '__lines', node.__lines);   // never mutated, safe to share
    return copy;
}

/** Line (from 1) of a property's key; an array element has no key, so its value's line is used. */
function lineOfProperty(pointers, pointer, key, isArray) {
    const entry = pointers[`${pointer}/${escapePointer(key)}`];
    return (isArray ? entry.value : entry.key).line + 1;
}

function attachLines(node, pointer, pointers) {
    if (node === null || typeof node !== 'object') return;
    const isArray = Array.isArray(node);

    // json-source-map counts lines from 0
    define(node, '__line', pointers[pointer].value.line + 1);
    // Lines of the individual properties: primitives cannot carry metadata themselves
    define(node, '__lines', Object.fromEntries(
        Object.keys(node).map((key) => [key, lineOfProperty(pointers, pointer, key, isArray)])
    ));

    for (const [key, child] of Object.entries(node)) {
        attachLines(child, `${pointer}/${escapePointer(key)}`, pointers);
    }
}

export function parseJsonWithLines(text) {
    const { data, pointers } = parse(text);   // throws on a syntax error, with the position in the message
    attachLines(data, '', pointers);
    return data;
}

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
        return parseJsonWithLines(json);
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
