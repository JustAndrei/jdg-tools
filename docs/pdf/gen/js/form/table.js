/* global $ */

/*
 * A "table" in the form is a template row (hidden) plus the rows the person has added by cloning it.
 * The template's fields carry the coordinates of the FIRST row; every following row is shifted
 * down by `rowStep`, which the builder derives from the position of the last row's number.
 */

function renumberRows($table) {
    const $templateFields = $table.find('.template .render');
    const { rowStep, rowCount } = $table.data();

    $table.find('.table-row').each((rowIndex, row) => {
        const rowNumber = String(rowIndex + 1);

        $(row).find('.calculate').each((_, el) => {
            const data = $(el).data();
            if ('calcText' in data) $(el).text(data.calcText.replaceAll('{row-number}', rowNumber));
            if ('calcValue' in data) $(el).val(data.calcValue.replaceAll('{row-number}', rowNumber));
        });

        $(row).find('.render').each((fieldIndex, el) => {
            $(el).data('y', $($templateFields[fieldIndex]).data('y') + rowIndex * rowStep);
        });
    });

    $table.find('button.add-row').prop('disabled', rowCount <= $table.find('.table-row').length);
}

export function addTableRow($table) {
    const $row = $table.find('div.template')
        .clone(true)
        .removeClass('template')
        .addClass('table-row')
        .insertBefore($table.find('button.add-row'));

    $row.find('.delete-row').on('click', () => {
        $row.remove();
        renumberRows($table);
    });
    renumberRows($table);
}
