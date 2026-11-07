/* global $ */

/** Replaces the whole page with a message (fatal problems). */
export function displayError(message) {
    $('body').empty().append($('<div class="message error">').text(message));
}

export function displayInfo(message) {
    $('body').empty().append($('<div class="message">').text(message));
}

/** Shows a non-fatal message next to the "fill" button, keeping the form (and what was typed) intact. */
export function setStatus(message) {
    $('#status').text(message);
}

let currentPdfUrl;

export function showPdf(bytes) {
    if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
    currentPdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    $('#pdf').attr('data', currentPdfUrl);
}
