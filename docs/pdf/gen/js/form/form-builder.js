/* global $, moment */
import { standardSelectOptions } from '../constants.js';
import { AppError } from '../errors.js';
import { createTransformer } from '../transformations.js';
import { byName } from '../util.js';
import { comparators } from './conditions.js';
import { addTableRow } from './table.js';

const DEFAULT_TITLE = 'Форма для заполнения PDF';

/*
 * The form is generated from the metadata's `annotations`. Every annotation type has a handler below.
 * A handler appends its markup to `ctx.$target` and may return the control that holds the value to
 * draw; the builder then attaches to that control what collect.js needs (name, page, x, y, style).
 * Handlers receive (annotation, ctx, index); controls that are drawn carry the CSS class `render`.
 */
const handlers = {
    break(annot, ctx) {
        $('<span class="line-break">').appendTo(ctx.$target);
    },

    section(annot, ctx) {
        $('<h3>').text(annot.title).appendTo(ctx.$target);
    },

    // The only place where metadata is trusted as HTML (links, lists), because the file is authored by the site owner.
    comment(annot, ctx) {
        $('<span class="comment">').html(annot.text).appendTo(ctx.$target);
    },

    text(annot, ctx) {
        const $control = $(annot.multiline ? '<textarea>' : '<input>')
            .addClass('render')
            .val(initialValue(annot));
        appendLabeled(ctx, annot.title, $control);

        const style = annot.style ?? {};
        $control.data({
            maxCharsPerLine: annot.maxCharsPerLine,
            lineHeight: annot.maxCharsPerLine ? (style.line_height ?? style.font_size ?? 20) : style.line_height,
            mode: annot.mode,
            maxWidth: annot.maxWidth,
            transform: annot.transform
        });
        return $control;
    },

    date(annot, ctx) {
        const value = initialValue(annot);
        const $control = $('<input type="date">')
            .addClass('render')
            .val(value ? moment(value, annot.format).format('YYYY-MM-DD') : '')
            .data('format', annot.format);
        appendLabeled(ctx, annot.title, $control);
        return $control;
    },


    // Annotations of this type with the same title form ONE drop-down (a group of mutually exclusive
    // check marks): each annotation is an option that carries the position of its own mark.
    check(annot, ctx) {
        let $select = ctx.checkGroups.get(annot.title);
        if (!$select) {
            $select = $('<select class="render">');
            ctx.checkGroups.set(annot.title, $select);
            appendLabeled(ctx, annot.title, $select);
        }
        // attr() rather than prop(): the state must survive cloning of table rows
        const $option = $('<option>').val(annot.option).text(annot.option).appendTo($select);
        $option.data('realValue', initialValue(annot));
        if (annot.default) $option.attr('selected', 'selected');
        return $option;
    },

    select(annot, ctx, index) {
        const options = resolveSelectOptions(annot, index);
        const $control = $('<select class="render">').data('transform', annot.transform);
        if (annot.indexer) {
            $control.data({ indexer: annot.indexer, indices: annot.indices });
        }

        const value = initialValue(annot);
        for (const [optionValue, optionText] of Object.entries(options)) {
            const $option = $('<option>').val(optionValue).text(optionText).appendTo($control);
            // With an indexer an option key lists variants ("ŻONATY|ZAMĘŻNA"); the sample value is one of them
            const variants = annot.indexer ? optionValue.split('|') : [optionValue];
            if (variants.some((variant) => ctx.transform(variant, annot.transform) === value)) {
                $option.attr('selected', 'selected');
            }
        }
        appendLabeled(ctx, annot.title, $control);
        return $control;
    },

    // A fixed text, drawn unless its `dependsOn` condition is not met
    static(annot, ctx) {
        const $control = hiddenControl(initialValue(annot));
        if (annot.dependsOn) {
            if (!Object.hasOwn(comparators, annot.comparison)) {
                throw new AppError(`Unknown comparison '${annot.comparison}'. Available: ${Object.keys(comparators).join(', ')}`);
            }
            $control.data({ dependsOn: annot.dependsOn, comparison: annot.comparison, argument: annot.argument });
        }
        ctx.$target.append($control);
        return $control;
    },

    // A text repeated from another field. The metadata key is called `from` (existing files rely on it).
    copy(annot, ctx) {
        if (!annot.from) {
            throw new AppError("An annotation of type 'copy' must define 'from' referencing a named input");
        }
        const $control = hiddenControl('').data({
            ifEmpty: annot.from,
            format: annot.format,
            transform: annot.transform
        });
        ctx.$target.append($control);
        return $control;
    },

    // The checkbox is UI only: it draws nothing itself. While it is checked, the target mirrors the
    // source and is disabled; unticking it enables the target for editing.
    sameAs(annot, ctx) {
        if (!annot.source || !annot.target) {
            throw new AppError("An annotation of type 'sameAs' must define 'source' and 'target' referencing named inputs");
        }
        const $source = byName(annot.source);
        const $target = byName(annot.target);
        if (!$source.length || !$target.length) {
            throw new AppError(`'sameAs': '${annot.source}' and '${annot.target}' must be defined before this annotation`);
        }

        const $checkbox = $('<input type="checkbox" checked="checked">');
        const syncTarget = () => {
            if ($checkbox.prop('checked')) $target.val($source.val());
        };

        $checkbox.on('change', () => {
            $target.prop('disabled', $checkbox.prop('checked'));
            syncTarget();
        });
        $source.on('input change', syncTarget);

        $('<label class="same-as">')
            .append($checkbox, document.createTextNode(` ${annot.title ?? ''}`))
            .insertAfter($target);
        $('<br>').insertAfter($target);   // keeps the checkbox on its own line under the input

        $target.prop('disabled', true);
        syncTarget();
        // no return value: nothing to draw
    },

    table(annot, ctx) {
        $('<h4>').text(annot.title).appendTo(ctx.$target);
        const $table = $('<div class="table">').appendTo(ctx.$target);
        ctx.$target = $('<div class="template"><div class="delete-row">×</div></div>').appendTo($table);
    },

    'row-number'(annot, ctx) {
        $('<h5 class="calculate">').data('calcText', annot.title ?? 'Строка {row-number}').appendTo(ctx.$target);
        const $control = hiddenControl('')
            .addClass('row-number calculate')
            .data('calcValue', '{row-number}')
            .appendTo(ctx.$target);
        if (annot.render === false) $control.removeClass('render');
        return $control;
    },

    // The annotation holding the number of the LAST row; its position defines the row spacing.
    'last-row-number'(annot, ctx) {
        const $table = ctx.$target.closest('div.table');
        const firstRowNumber = $table.find('.row-number').first().data();
        if (!firstRowNumber) throw new AppError("'last-row-number' is used without 'row-number' in a table");

        const rowCount = Number(initialValue(annot));
        const lastY = annot.y + ctx.correction.y;
        $table.data({
            rowCount,
            rowStep: rowCount > 1 ? (lastY - firstRowNumber.y) / (rowCount - 1) : 0
        });
    },

    'end-of-table'(annot, ctx) {
        const $table = ctx.$target.closest('div.table');
        if (!$table.data('rowCount')) {
            throw new AppError("A table needs 'last-row-number' to specify its size and row spacing");
        }
        $('<button type="button" class="add-row">')
            .text(annot.add ?? 'Добавить строку')
            .on('click', () => addTableRow($table))
            .appendTo($table);
        ctx.$target = ctx.$body;
    }
};

/** `newValue` (the value to pre-fill the form with) wins over `value` (the sample text from the PDF). */
function initialValue(annot) {
    return ('newValue' in annot ? annot.newValue : annot.value) ?? '';
}

function hiddenControl(value) {
    return $('<input type="hidden" class="render">').val(value);
}

/** `<label>Title<br>[control]</label>` followed by a blank line; the line breaks matter inside table rows. */
function appendLabeled(ctx, title, $control) {
    $('<label>').text(title ?? '').append('<br>', $control).appendTo(ctx.$target);
    ctx.$target.append('<br><br>');
}

function resolveSelectOptions(annot, index) {
    const { options } = annot;
    if (options && typeof options === 'object') return options;

    const standardPrefix = 'standard.';
    if (typeof options === 'string' && options.startsWith(standardPrefix)) {
        const setName = options.slice(standardPrefix.length);
        if (Object.hasOwn(standardSelectOptions, setName)) return standardSelectOptions[setName];
        throw new AppError(`Annotation #${index} of type 'select' refers to undefined standard set of options '${setName}'. Available standard sets: ${Object.keys(standardSelectOptions).join(', ')}`);
    }
    throw new AppError(`Annotation #${index} of type 'select' must have 'options': an object, or 'standard.<standard-option-set-name>'`);
}

/** Attaches to a control the data that collect.js needs to draw its value. */
function attachDrawingData($control, annot, correction) {
    if (annot.name) $control.attr('name', annot.name);
    if (annot.ifEmpty) $control.data('ifEmpty', annot.ifEmpty);
    $control.data({
        page: annot.page,
        x: annot.x + correction.x,
        y: annot.y + correction.y,
        style: annot.style
    });
}

/** Names used by `ifEmpty`, `dependsOn` and `indexer` must belong to existing controls. */
function assertReferencesExist() {
    $('.render').each((_, el) => {
        const data = $(el).data();
        for (const attribute of ['ifEmpty', 'dependsOn', 'indexer']) {
            if (data[attribute] && byName(data[attribute]).length === 0) {
                throw new AppError(`'${attribute}' refers to '${data[attribute]}', but no annotation has that name`);
            }
        }
    });
}

/**
 * Replaces the page content with the form generated from `project.metadata`.
 * @param {object} project  see loadProject()
 * @param {{onGenerate: () => void}} callbacks
 * @throws {AppError} when the metadata is inconsistent
 */
export function buildForm(project, { onGenerate }) {
    const { metadata } = project;
    const $body = $('body').empty();
    $('<h2>').text(metadata.title ?? DEFAULT_TITLE).appendTo($body);

    const ctx = {
        $body,
        $target: $body,
        checkGroups: new Map(),
        correction: { x: 0, y: 0, ...metadata.global?.coordinateCorrection },
        transform: createTransformer({ defaultTransform: metadata.global?.defaultTransform, script: project.script })
    };

    metadata.annotations.forEach((annot, index) => {
        const handler = handlers[annot.type];
        if (!handler) throw new AppError(`Annotation #${index}: unexpected type '${annot.type}'`);

        const $control = handler(annot, ctx, index);
        if ($control) attachDrawingData($control, annot, ctx.correction);
    });
    assertReferencesExist();

    $('<div class="actions"><button id="bGenerate" type="button">Заполнить PDF</button><span id="status" class="error"></span></div>')
        .appendTo($body)
        .find('button')
        .on('click', onGenerate);
    $('<object id="pdf" type="application/pdf"></object>').appendTo($body);
}
