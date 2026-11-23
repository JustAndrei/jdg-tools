/* global $ */
import { addTableRow } from '../form/table.js';

/*
 * Serialization of the form on the screen: a universal mechanism that knows nothing about the
 * particular form. It walks the controls the person can edit (the hidden inputs `static`, `copy` and
 * `row-number` are derived, so they are skipped) and produces
 *
 *   { version: 1,
 *     fields: { <key>: value, ... },             // controls outside tables
 *     tables: [ [ { <key>: value, ... }, ... ], ... ] }   // per table: rows, each row like `fields`
 *
 * - `key` is the annotation's `name`, or `annotation<N>` (N: its index in `annotations`) while it has none;
 *   form-builder.js puts the key on the control as data `stateKey`;
 * - a select is stored as the `value` of the chosen option (a `check` group: the `optionId` of the annotation),
 *   which is the same in every language, so a profile saved in one language restores in another;
 * - a checkbox is a boolean, everything else is a string.
 *
 * Unnamed annotations are matched by index, so inserting or removing annotations in the metadata shifts
 * them: give the annotations names to keep old profiles valid.
 */

const STATE_VERSION = 1;

/** The controls the person edits, in document order; the language picker and the profile bar are not part of the form. */
function editableControls() {
    return $('body').find('input, select, textarea').filter((_, el) => (
        el.type !== 'hidden' && !el.closest('[data-persistent]') && !el.closest('.template')
    ));
}

const isInTable = (el) => el.closest('.table') !== null;

function readControl(el) {
    if (el.type === 'checkbox') return el.checked;
    return el.value;   // a select: the value of the chosen option
}

/**
 * Sets a control to a saved value and fires the events that the form listens to (groups, 'same as' checkboxes).
 * A value of the wrong type is ignored, so a damaged file can not put garbage into a control.
 */
function writeControl(el, value) {
    const $el = $(el);
    if (el.type === 'checkbox') {
        if (typeof value !== 'boolean') return;
        el.checked = value;
    } else if (el.tagName === 'SELECT') {
        // An option that does not exist (the form changed since the profile was saved) leaves the control as it is
        if (typeof value !== 'string' || ![...el.options].some((option) => option.value === value)) return;
        el.value = value;
    } else {
        if (typeof value !== 'string') return;
        el.value = value;
    }
    $el.trigger('input').trigger('change');
}

const keyOf = (el) => $(el).data('stateKey');

/** Controls outside tables with their keys, in document order. */
function topLevelControls() {
    return editableControls().toArray()
        .filter((el) => !isInTable(el))
        .map((el) => ({ el, key: keyOf(el) }));
}

/** Controls of a table row with their keys. */
function rowControls(row) {
    return $(row).find('input, select, textarea').toArray()
        .filter((el) => el.type !== 'hidden')
        .map((el) => ({ el, key: keyOf(el) }));
}

/** The state of the form on the screen. */
export function serializeForm() {
    const fields = {};
    for (const { el, key } of topLevelControls()) fields[key] = readControl(el);

    const tables = $('div.table').toArray().map((table) => (
        $(table).find('.table-row').toArray().map((row) => (
            Object.fromEntries(rowControls(row).map(({ el, key }) => [key, readControl(el)]))
        ))
    ));
    return { version: STATE_VERSION, fields, tables };
}

/** Is `state` something that can be restored? (a profile loaded from a file may be anything) */
export function isFormState(state) {
    return state !== null && typeof state === 'object' && !Array.isArray(state)
        && state.fields !== null && typeof state.fields === 'object' && !Array.isArray(state.fields);
}

/**
 * Puts a state into the form. Controls the state knows nothing about are left as they are,
 * so pass a state merged over the defaults (see withDefaults) to reset them.
 */
export function restoreForm(state) {
    if (!isFormState(state)) return;

    for (const { el, key } of topLevelControls()) {
        if (Object.hasOwn(state.fields, key)) writeControl(el, state.fields[key]);
    }

    $('div.table').each((tableIndex, table) => {
        const $table = $(table);
        const rows = state.tables?.[tableIndex];
        if (!Array.isArray(rows)) return;

        $table.find('.table-row').remove();
        const { rowCount } = $table.data();
        rows.slice(0, rowCount).forEach((values) => {
            addTableRow($table);
            if (values === null || typeof values !== 'object') return;
            for (const { el, key } of rowControls($table.find('.table-row').last())) {
                if (Object.hasOwn(values, key)) writeControl(el, values[key]);
            }
        });
    });
}

/** `state` over `defaults`: what the state does not mention is as in a freshly built form. */
export function withDefaults(defaults, state) {
    return {
        version: STATE_VERSION,
        fields: { ...defaults.fields, ...state.fields },
        tables: defaults.tables.map((rows, i) => state.tables?.[i] ?? rows)
    };
}

/**
 * Name of a profile: the values of the controls marked `profile-name-part` in the metadata,
 * glued with a space in the order of their numbers; empty values are skipped.
 * @param {object} state
 * @param {{part: number, key: string}[]} parts  see nameParts()
 */
export function profileNameOf(state, parts) {
    return [...parts]
        .sort((a, b) => a.part - b.part)
        .map(({ key }) => String(state.fields?.[key] ?? '').trim())
        .filter(Boolean)
        .join(' ');
}

/** The controls marked `profile-name-part` and the keys under which a state holds their values. */
export function nameParts() {
    return topLevelControls()
        .map(({ el, key }) => ({ part: $(el).data('profileNamePart'), key }))
        .filter(({ part }) => part !== undefined);
}
