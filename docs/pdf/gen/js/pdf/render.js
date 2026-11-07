/* global PDFLib, fontkit */
import { drawText, embedFonts } from './draw-text.js';

const ANNOTATIONS_KEY = PDFLib.PDFName.of('Annots');

/** The annotations only describe the form: they must not end up in the output. */
function removeAnnotations(pdfDoc) {
    for (const page of pdfDoc.getPages()) {
        const annots = page.node.Annots();
        if (!annots) continue;
        for (let i = 0; i < annots.size(); ++i) {
            pdfDoc.context.delete(annots.get(i));
        }
        page.node.delete(ANNOTATIONS_KEY);
    }
}

function drawRects(pdfDoc, rects) {
    for (const rect of rects) {
        pdfDoc.getPage(rect.page).drawRectangle({
            x: rect.x1,
            y: rect.y1,
            width: rect.x2 - rect.x1,
            height: rect.y2 - rect.y1,
            borderWidth: 1,
            borderColor: rect.borderColor,
            color: rect.color
        });
    }
}

/**
 * Produces the filled PDF.
 * @param {{pdfBytes: Uint8Array, fontBytes: Uint8Array[], rects: object[]}} project
 * @param {object[]} instructions  `{text, ...drawText options}` items from collectDrawInstructions()
 * @returns {Promise<Uint8Array>}
 */
export async function renderPdf({ pdfBytes, fontBytes, rects }, instructions) {
    const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
    removeAnnotations(pdfDoc);
    pdfDoc.registerFontkit(fontkit);
    await embedFonts(pdfDoc, fontBytes);
    drawRects(pdfDoc, rects);

    for (const { text, ...options } of instructions) {
        drawText(pdfDoc, text, options);
    }

    return pdfDoc.save();
}
