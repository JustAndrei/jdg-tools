/* global PDFLib */
import { AppError } from '../errors.js';
import { splitToLines } from '../text-util.js';
import { definedOnly } from '../util.js';

// Ratio of the visible glyph height to font.heightAtSize(); used to centre text for valign 'middle'.
const FONT_HEIGHT_CORRECTION = 0.65;

/**
 * Draws (possibly multi-line) text on a page of a pdf-lib document.
 *
 * @param {PDFLib.PDFDocument} doc
 * @param {string} text  may contain '\n' for explicit line breaks. Case is not changed here
 *                       (see transformations.js)
 * @param {object} options
 *   page             page index or a PDFLib page
 *   x, y             coordinates, origin at the bottom-left corner of the page
 *   size             font size (default 10)
 *   color            default black
 *   font             a PDFLib font or the name of an embedded one; by default the first embedded font
 *   mode             'simple' (default)
 *                    'fit'  scale each line down so that it is at most `maxWidth` wide
 *                    'chars' one character per cell of a grid with cell width `step` (comb fields)
 *                    'chars-with-spacing' characters separated by `step` extra points
 *   maxWidth         max line width in points (all modes except 'fit' wrap on it, 'fit' scales to it)
 *   step             see modes 'chars' and 'chars-with-spacing'
 *   maxCharsPerLine  hard limit of characters per line
 *   maxCharsInTotal  hard limit of characters in all lines together
 *   maxLines         hard limit of lines
 *   breakMode        'word' (default) or 'char'
 *   lineHeight       distance between baselines (default: twice the font's height at `size`)
 *   align            'left' (default), 'center' or 'right': what `x` refers to
 *   valign           'bottom' (default, `y` is the baseline) or 'middle'
 *   ellipsis         end the last line with '…' when the text does not fit (default true)
 *   debug            mark the anchor point and `maxWidth` on the page (calibrating coordinates)
 *
 * @returns {boolean} true if the whole text fits the limits, false if it had to be cut
 */
export function drawText(doc, text, options = {}) {
    const opt = {
        mode: 'simple',
        align: 'left',
        valign: 'bottom',
        size: 10,
        color: PDFLib.rgb(0, 0, 0),
        maxCharsPerLine: 100000,
        maxCharsInTotal: Infinity,
        maxLines: Infinity,
        ellipsis: true,
        breakMode: 'word',
        ...definedOnly(options)
    };
    const font = resolveFont(doc, opt.font);
    const page = typeof opt.page === 'number' ? doc.getPage(opt.page) : opt.page;

    const cutByTotal = text.length > opt.maxCharsInTotal;
    const source = cutByTotal ? text.slice(0, opt.maxCharsInTotal) : text;

    const splitOptions = { ellipsis: opt.ellipsis, wordMode: opt.breakMode === 'word' };
    if (opt.mode !== 'fit' && opt.maxWidth) {
        splitOptions.measureTextWidth = (part) => font.widthOfTextAtSize(part, opt.size);
        splitOptions.checkTextWidth = (width) => width <= opt.maxWidth;
    }
    const { lines, fit } = splitToLines(source, opt.maxCharsPerLine, opt.maxLines, splitOptions);

    const lineHeight = opt.lineHeight ?? font.heightAtSize(opt.size) * 2;
    lines.forEach((line, index) => {
        drawLine(page, line, { ...opt, font, y: opt.y - index * lineHeight });
    });

    return fit && !cutByTotal;
}

function resolveFont(doc, requested) {
    if (typeof requested !== 'string' && requested) return requested;
    if (typeof requested === 'string') {
        const font = doc.fonts.find((f) => f.name === requested);
        if (!font) {
            throw new AppError(`Could not find font ${requested}. Available fonts: ${doc.fonts.map((f) => f.name).join(', ')}`);
        }
        return font;
    }
    if (!doc.fonts[0]) {
        throw new AppError('No font is embedded: specify global.fonts in the metadata file');
    }
    return doc.fonts[0];
}

function drawLine(page, line, o) {
    const { font } = o;
    let size = o.size;
    if (o.mode === 'fit' && font.widthOfTextAtSize(line, size) > o.maxWidth) {
        size = (100 / font.widthOfTextAtSize(line, 100)) * o.maxWidth;
    }

    const y = o.valign === 'middle' ? o.y - (FONT_HEIGHT_CORRECTION * font.heightAtSize(size)) / 2 : o.y;
    const glyphOptions = { font, size, color: o.color, y };
    const widthOf = (str) => font.widthOfTextAtSize(str, size);

    switch (o.mode) {
        case 'chars':
            [...line].forEach((char, index) => {
                page.drawText(char, { ...glyphOptions, x: o.x + o.step * index - widthOf(char) / 2 });
            });
            break;

        case 'chars-with-spacing': {
            const chars = [...line];
            const totalWidth = chars.reduce((sum, char) => sum + widthOf(char), 0) + o.step * (chars.length - 1);
            let x = alignedX(o.x, o.align, totalWidth);
            for (const char of chars) {
                page.drawText(char, { ...glyphOptions, x });
                x += widthOf(char) + o.step;
            }
            break;
        }

        default:
            page.drawText(line, { ...glyphOptions, x: alignedX(o.x, o.align, widthOf(line)) });
    }

    if (o.debug) drawDebugMarkers(page, o, size);
}

function alignedX(x, align, width) {
    if (align === 'center') return x - width / 2;
    if (align === 'left') return x;
    return x - width;
}

function drawDebugMarkers(page, { x, y, maxWidth, align, font }, size) {
    const red = PDFLib.rgb(1, 0, 0);
    const green = PDFLib.rgb(0, 0.5, 0);
    const segment = (x1, y1, x2, y2, color) =>
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color });

    segment(x, y - 10, x, y + 20, red);
    segment(x - 15, y, x + 15, y, red);

    if (maxWidth) {
        const left = alignedX(x, align, maxWidth);
        const height = font.heightAtSize(size);
        segment(left, y, left, y + height, green);
        segment(left + maxWidth, y, left + maxWidth, y + height, green);
    }
}

export async function embedFonts(doc, fontBytes) {
    for (const bytes of fontBytes) {
        await doc.embedFont(bytes);
    }
}
