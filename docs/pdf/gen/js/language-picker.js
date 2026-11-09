/* global $ */
import { LANGUAGES, t } from './i18n.js';

/**
 * The language drop-down in the top-right corner of the page.
 * It has `data-persistent`, so rebuilding the page content (see buildForm) leaves it in place.
 * The languages that the opened form is not translated into are shown, but cannot be chosen.
 *
 * @param {{onSelect: (code: string) => void}} callbacks
 * @returns {{setActive: (code: string) => void, setAvailable: (codes: string[]|null) => void}}
 *          `setAvailable(null)` enables all the languages
 */
export function createLanguagePicker({ onSelect }) {
    const $root = $('<div class="language-picker" data-persistent>');
    const $toggle = $('<button type="button" class="language-picker__toggle" aria-haspopup="true" aria-expanded="false">').appendTo($root);
    const $menu = $('<ul class="language-picker__menu" hidden>').appendTo($root);
    const items = new Map();   // language code -> its button

    let active = null;
    let available = null;

    const flag = ({ flag: country }) => $('<span class="fi" aria-hidden="true">').addClass(`fi-${country}`);

    const isOpen = () => !$menu.prop('hidden');
    function setOpen(open) {
        $menu.prop('hidden', !open);
        $toggle.attr('aria-expanded', String(open));
    }

    for (const language of LANGUAGES) {
        const $item = $('<button type="button" class="language-picker__item">')
            .append(flag(language), $('<span>').text(language.name))
            // aria-disabled rather than disabled: a disabled button shows no tooltip in some browsers
            .on('click', () => {
                if ($item.attr('aria-disabled') === 'true') return;
                setOpen(false);
                onSelect(language.code);
            });
        items.set(language.code, $item);
        $('<li>').append($item).appendTo($menu);
    }

    function refresh() {
        const current = LANGUAGES.find(({ code }) => code === active);
        if (current) {
            $toggle.empty().append(flag(current), $('<span>').text(current.code.toUpperCase()));
        }
        $toggle.attr('aria-label', t('language'));

        for (const [code, $item] of items) {
            const enabled = available === null || available.includes(code);
            $item
                .attr('aria-disabled', String(!enabled))
                .attr('aria-current', code === active ? 'true' : null)
                .attr('title', enabled ? null : t('noTranslation'));
        }
    }

    $toggle.on('click', () => setOpen(!isOpen()));
    $(document)
        .on('click', (event) => {
            if (isOpen() && !$root.has(event.target).length) setOpen(false);
        })
        .on('keydown', (event) => {
            if (event.key === 'Escape' && isOpen()) {
                setOpen(false);
                $toggle.trigger('focus');
            }
        });

    $root.appendTo('body');
    refresh();

    return {
        setActive(code) {
            active = code;
            refresh();
        },
        setAvailable(codes) {
            available = codes;
            refresh();
        }
    };
}
