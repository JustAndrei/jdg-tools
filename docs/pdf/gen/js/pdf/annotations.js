/* global PDFLib */
import { AppError } from '../errors.js';
import { saveTextFile } from '../io.js';

const { PDFName, PDFDict, PDFArray, PDFNumber } = PDFLib;

const KEY = {
    subtype: PDFName.of('Subtype'),
    rect: PDFName.of('Rect'),
    richContents: PDFName.of('RC'),
    interiorColor: PDFName.of('IC'),
    color: PDFName.of('C')
};

/** A number where the text is one, the text otherwise ("12pt" -> 12, "center" -> "center"). */
function numberOrText(value) {
    return value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;
}

/** "font-size:12pt;text-align:center" -> { font_size: 12, text_align: 'center' } */
function parseStyle(styleAttribute) {
    const style = {};
    for (const declaration of styleAttribute.split(';')) {
        const [property, ...valueParts] = declaration.split(':');
        if (!property.trim() || valueParts.length === 0) continue;
        style[property.trim().replace(/-/g, '_')] = numberOrText(valueParts.join(':').trim().replace(/pt$/, ''));
    }
    return style;
}

/**
 * Text and style from the annotation's rich contents (/RC, an XHTML fragment).
 * Assumption: one style is applied to the whole text, although the format allows mixing styles.
 */
function parseRichText(annotDict) {
    const richContents = annotDict.get(KEY.richContents);
    if (!richContents) return null;

    const xml = new DOMParser().parseFromString(richContents.decodeText(), 'application/xml');
    const paragraphs = [...xml.querySelectorAll('p')];
    const text = paragraphs
        .map((p) => [...p.querySelectorAll('span')].map((span) => span.textContent).join('').replace(/\r$/, ''))
        .join('\n');
    const firstSpan = paragraphs[0]?.querySelector('span');
    const style = firstSpan ? parseStyle(firstSpan.getAttribute('style') ?? '') : {};

    return { text, style };
}

function readRect(annotDict) {
    const rect = annotDict.lookupMaybe(KEY.rect, PDFArray);
    return rect ? [0, 1, 2, 3].map((i) => rect.lookup(i, PDFNumber).asNumber()) : [0, 0, 0, 0];
}

function readColor(annotDict, key) {
    const components = annotDict.lookupMaybe(key, PDFArray)?.asArray().map((n) => n.asNumber());
    return components?.length === 3 ? PDFLib.rgb(...components) : undefined;
}

/** The point of the annotation's rectangle that the text is aligned to. */
function anchorPoint([left, bottom, right, top], textAlign = 'left', useTopEdge) {
    const y = useTopEdge ? top : bottom;
    switch (textAlign) {
        case 'left': return { x: left, y };
        case 'right': return { x: right, y };
        case 'center': return { x: (left + right) / 2, y };
        default: throw new AppError(`Unexpected text-align value '${textAlign}'`);
    }
}

function readFreeText(annotDict, page) {
    const richText = parseRichText(annotDict);
    if (!richText) {
        console.warn(`Skipping a FreeText annotation without rich contents on page ${page + 1}`);
        return null;
    }
    const { text, style } = richText;
    // The coordinates of a multiline text are counted from the TOP left corner of the rectangle,
    // those of a single line from the bottom one.
    const isMultiline = text.includes('\n');
    const { x, y: anchorY } = anchorPoint(readRect(annotDict), style.text_align, isMultiline);

    return { value: text, style, x, y: anchorY - (isMultiline ? style.font_size : 0), page, anchorY };
}

function readSquare(annotDict, page) {
    const [x1, y1, x2, y2] = readRect(annotDict);
    return {
        x1, y1, x2, y2, page,
        color: readColor(annotDict, KEY.interiorColor),
        borderColor: readColor(annotDict, KEY.color)
    };
}

/**
 * Reads the annotations that describe the form:
 *   FreeText -> `texts`: the sample text, its style and position
 *   Square   -> `rects`: rectangles to be drawn on the output (e.g. to white out printed text)
 * `texts` are sorted in reading order: page, then top to bottom (in 10pt bands), then left to right.
 */
export function readPdfAnnotations(pdfDoc) {
    const texts = [];
    const rects = [];

    pdfDoc.getPages().forEach((pdfPage, page) => {
        for (const ref of pdfPage.node.Annots()?.asArray() ?? []) {
            const annotDict = pdfDoc.context.lookupMaybe(ref, PDFDict);
            if (!annotDict) continue;

            const subtype = annotDict.get(KEY.subtype)?.decodeText();
            if (subtype === 'FreeText') {
                const text = readFreeText(annotDict, page);
                if (text) texts.push(text);
            } else if (subtype === 'Square') {
                rects.push(readSquare(annotDict, page));
            }
        }
    });

    const band = (text) => Math.round(text.anchorY / 10);
    texts.sort((a, b) => a.page - b.page || band(b) - band(a) || Math.round(a.x) - Math.round(b.x));

    return { texts, rects };
}

function valuesMatch(metaAnnotation, pdfText) {
    if (metaAnnotation.value === pdfText.value) return true;
    // Multiline PDF text that the metadata file keeps on one line (it is wrapped by maxCharsPerLine)
    return Boolean(metaAnnotation.maxCharsPerLine) && metaAnnotation.value === pdfText.value.replace(/\n/g, '');
}

/**
 * Pairs each metadata annotation that has a sample `value` with the PDF's FreeText annotation in
 * the same reading order and copies the position, page and style into the metadata annotation.
 * @throws {AppError} when a pair disagrees on the text, i.e. the metadata does not belong to this PDF
 */
export function bindAnnotations(metaAnnotations, pdfTexts) {
    const valued = metaAnnotations.filter((annotation) => annotation.value);
    if (pdfTexts.length !== valued.length) {
        console.warn(`The metadata file has ${valued.length} annotations with values, while the PDF file has ${pdfTexts.length} FreeText annotations`);
    }

    const pairCount = Math.min(pdfTexts.length, valued.length);
    for (let i = 0; i < pairCount; ++i) {
        const metaAnnotation = valued[i];
        const pdfText = pdfTexts[i];
        if (!valuesMatch(metaAnnotation, pdfText)) {
            throw new AppError(`Annotation #${i + 1} from the metadata file has value '${metaAnnotation.value}', while FreeText annotation #${i + 1} from the PDF file has value '${pdfText.value}'`);
        }
        const { x, y, page, style } = pdfText;
        Object.assign(metaAnnotation, { x, y, page, style });
    }
}

/** Offers a starting-point metadata file (one text field per FreeText annotation) for download. */
export function downloadDefaultMetadata(pdfTexts, fileName) {
    const metadata = {
        global: {
            fonts: { '*': 'CourierPrime-Regular.ttf' },
            coordinateCorrection: { y: 3 },
            defaultTransform: 'caps'
        },
        title: 'Форма для заполнения PDF',
        annotations: pdfTexts.map((text, index) => ({ value: text.value, type: 'text', title: `Text ${index + 1}` }))
    };
    saveTextFile(fileName, 'application/json', JSON.stringify(metadata, null, 4));
}
