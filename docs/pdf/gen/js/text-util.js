import { definedOnly } from './util.js';

const ELLIPSIS = '…';

/**
 * Splits `text` into lines no wider than `maxCharsPerLine` characters (or whatever
 * `options.checkTextWidth` accepts), honouring '\n' and stopping after `maxLines` lines.
 *
 * Options:
 *   wordMode          break at word boundaries (default) instead of at any character
 *   ellipsis          when the text does not fit, end the last line with '…' (default true)
 *   measureTextWidth  (text) => width; by default the number of characters. Pass e.g. a font
 *                     metric to measure real widths
 *   checkTextWidth    (width) => boolean; by default `width <= maxCharsPerLine`. Keep
 *                     maxCharsPerLine as the upper bound for breaking very long words
 *
 * @returns {{lines: string[], fit: boolean}} `fit` is false when the text had to be cut
 */
export function splitToLines(text, maxCharsPerLine, maxLines = Infinity, options = {}) {
    const { wordMode, ellipsis, measureTextWidth, checkTextWidth } = {
        wordMode: true,
        ellipsis: true,
        measureTextWidth: (part) => part.length,
        checkTextWidth: (width) => width <= maxCharsPerLine,
        ...definedOnly(options)
    };

    // Tokens: a newline, or (word mode) a run ending right before a non-word character, or any run.
    // \p{L}/\p{N} (rather than a hand-written a-z list) keep every letter of every alphabet inside a word.
    const tokenPattern = [
        '\\n',
        wordMode ? `.{1,${maxCharsPerLine}}?(?=[^\\p{L}\\p{N}.,:;?!])` : null,
        `.{1,${maxCharsPerLine}}`
    ].filter(Boolean).join('|');
    const tokenizer = new RegExp(tokenPattern, 'giu');

    const tokens = text.match(tokenizer);
    if (!tokens) return { lines: [''], fit: true };

    const measure = (token) => (token === '\n' ? 0 : measureTextWidth(token));
    const lines = [];
    let lineStart = 0;
    let lineWidth = 0;
    let linesLeft = maxLines;
    let i = 0;

    for (; i < tokens.length; ++i) {
        let width = measure(tokens[i]);
        const afterNewline = i > 0 && tokens[i - 1].endsWith('\n');

        if (afterNewline || !checkTextWidth(lineWidth + width)) {
            lines.push(tokens.slice(lineStart, i).join('').trimEnd());
            if (--linesLeft === 0) break;
            if (!afterNewline) {
                tokens[i] = tokens[i].trimStart();
                width = measure(tokens[i]);
            }
            lineStart = i;
            lineWidth = 0;
        }
        lineWidth += width;
    }

    if (lineStart < tokens.length && linesLeft > 0) {
        lines.push(tokens.slice(lineStart).join('').trimEnd());
    }

    const fit = i >= tokens.length;
    if (!fit && ellipsis && lines.length > 0) {
        let lastLine = lines.pop().trimEnd();
        const ellipsisWidth = measureTextWidth(ELLIPSIS);
        while (lastLine && !checkTextWidth(measureTextWidth(lastLine) + ellipsisWidth)) {
            lastLine = wordMode
                ? (lastLine.match(tokenizer) ?? []).slice(0, -1).join('')
                : lastLine.slice(0, -1);
        }
        lines.push(lastLine + ELLIPSIS);
    }

    return { lines, fit };
}
