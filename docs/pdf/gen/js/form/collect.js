/* global $, moment */
import { AppError } from '../errors.js';
import { createTransformer } from '../transformations.js';
import { byName } from '../util.js';
import { comparators } from './conditions.js';

/** Value of the control that `el` copies from when it is empty, together with the source's type. */
function resolveValue($el) {
    const { ifEmpty } = $el.data();
    if ($el.val() === '' && ifEmpty) {
        const $source = byName(ifEmpty);
        return { value: $source.val(), type: $source.prop('type') };
    }
    return { value: $el.val(), type: $el.prop('type') };
}

/** Picks the variant of a 'A|B|C' value that corresponds to the current value of the `indexer` control. */
function pickVariant(value, { indexer, indices }) {
    const selected = byName(indexer).val();
    return value.split('|')[indices.split('|').indexOf(selected)];
}

/**
 * What to draw for one control, or null if nothing.
 * Returns `{text, ...drawText options}`.
 */
function readControl($el, transform) {
    const data = { ...$el.data() };
    let { value, type } = resolveValue($el);

    if (data.dependsOn) {
        const compare = comparators[data.comparison];
        if (!compare(byName(data.dependsOn).val(), data.argument)) return null;
    }

    if (data.indexer) {
        value = pickVariant(value, data);
    }

    if (type === 'date') {
        value = value ? moment(value).format(data.format) : '';
    } else {
        if (type === 'select-one') {
            // The selected option may carry its own position/style and the text to draw
            // (that is how groups of check marks work)
            Object.assign(data, $el.find('option:selected').data());
            if ('realValue' in data) value = data.realValue;
        }
        value = transform(value, data.transform);
    }

    if (!value) return null;
    if (!data.style) {
        throw new AppError(`Control '${$el.attr('name') ?? value}' has no position and style: it is not matched to an annotation of the PDF file`);
    }

    const { font_size, text_align, letter_spacing } = data.style;
    return {
        text: value,
        page: data.page,
        x: data.x,
        y: data.y,
        size: font_size,
        align: text_align,
        mode: data.mode ?? (letter_spacing > 0 ? 'chars-with-spacing' : 'simple'),
        step: letter_spacing,
        maxCharsPerLine: data.maxCharsPerLine,
        maxWidth: data.maxWidth,
        lineHeight: data.lineHeight
    };
}

/**
 * Reads the form and returns the list of texts to put on the PDF.
 * @param {object} project  see loadProject()
 * @param {{debug?: boolean}} options  `debug` marks the anchor point of every text (see drawText)
 */
export function collectDrawInstructions({ metadata, script }, { debug = false } = {}) {
    const transform = createTransformer({ defaultTransform: metadata.global?.defaultTransform, script });
    const instructions = [];

    $('.render').each((_, el) => {
        if ($(el).closest('.template').length) return; // the hidden template row is not part of the output
        const instruction = readControl($(el), transform);
        if (instruction) instructions.push({ ...instruction, debug });
    });

    return instructions;
}
