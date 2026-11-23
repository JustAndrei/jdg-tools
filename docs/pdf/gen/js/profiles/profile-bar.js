/* global $ */
import { t } from '../i18n.js';

/**
 * The profile controls of the top bar: the drop-down of saved profiles and the buttons that work with them.
 * They are put before whatever the bar already holds (the language picker), and stay when the form is rebuilt.
 * They are always shown: while the form has no saved profiles only "Load from file" works
 * (a profile can come from another device).
 *
 * @param {{container: object, onSelect: (name: string) => void, onSave: () => void,
 *          onLoad: () => void, onReset: () => void}} callbacks
 * @returns {{setProfiles: (names: string[], current: string|null) => void, refreshLabels: () => void}}
 */
export function createProfileBar({ container, onSelect, onSave, onLoad, onReset }) {
    const $bar = $('<div class="profile-bar">');
    const $label = $('<label class="profile-bar__label">').appendTo($bar);
    const $select = $('<select class="profile-bar__select">').appendTo($label);
    const $save = $('<button type="button">').on('click', onSave).appendTo($bar);
    const $load = $('<button type="button">').on('click', onLoad).appendTo($bar);
    const $reset = $('<button type="button" class="profile-bar__reset">').on('click', onReset).appendTo($bar);

    $select.on('change', () => onSelect($select.val()));

    function refreshLabels() {
        $label.contents().filter((_, node) => node.nodeType === Node.TEXT_NODE).remove();
        $label.prepend(document.createTextNode(`${t('profile')} `));
        $save.text(t('saveToFile'));
        $load.text(t('loadFromFile'));
        $reset.text(t('resetProfiles'));
    }

    $bar.prependTo(container);
    refreshLabels();

    return {
        setProfiles(names, current) {
            const empty = names.length === 0;
            $select.empty();
            if (empty) $('<option>').text('—').appendTo($select);
            for (const name of names) $('<option>').val(name).text(name).appendTo($select);
            if (current !== null && names.includes(current)) $select.val(current);
            $select.add($save).add($reset).prop('disabled', empty);
        },
        refreshLabels
    };
}
