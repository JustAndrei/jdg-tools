import { AppError } from './errors.js';
import { cloneWithLines } from './loader.js';

/*
 * Interface language: the languages that exist, the one the person chose (kept in localStorage),
 * the strings of the interface itself, and picking one language out of a metadata file.
 *
 * A metadata file keeps the texts of all languages under `local`:
 *   { global: {...}, local: { ru: { title, annotations }, en: { title, annotations }, ... } }
 * A file without `local` (`title` and `annotations` at the top level) is the old Russian-only format.
 */

export const DEFAULT_LANGUAGE = 'ru';

/**
 * `code` is the key in the metadata's `local`, `htmlLang` the BCP 47 tag for <html lang>,
 * `flag` a country code of the flag-icons library (https://flagicons.lipis.dev).
 */
export const LANGUAGES = [
    { code: 'ru', htmlLang: 'ru', name: 'Русский', flag: 'ru' },
    { code: 'en', htmlLang: 'en', name: 'English', flag: 'gb' },
    { code: 'be', htmlLang: 'be', name: 'Беларуская', flag: 'by' },
    { code: 'ua', htmlLang: 'uk', name: 'Українська', flag: 'ua' }
];

const STORAGE_KEY = 'pdfForm.language';

// The strings of the interface itself (not of the form: those live in the metadata file)
const STRINGS = {
    ru: {
        defaultTitle: 'Форма для заполнения PDF',
        generate: 'Заполнить PDF',
        addRow: 'Добавить строку',
        rowTitle: 'Строка {row-number}',
        language: 'Язык',
        noTranslation: 'Для этой формы нет перевода',
        confirmLanguageChange: 'Введённые данные будут потеряны при смене языка. Продолжить?'
    },
    en: {
        defaultTitle: 'PDF form',
        generate: 'Fill in the PDF',
        addRow: 'Add a row',
        rowTitle: 'Row {row-number}',
        language: 'Language',
        noTranslation: 'This form is not translated into this language',
        confirmLanguageChange: 'The data you entered will be lost when the language is changed. Continue?'
    },
    be: {
        defaultTitle: 'Форма для запаўнення PDF',
        generate: 'Запоўніць PDF',
        addRow: 'Дадаць радок',
        rowTitle: 'Радок {row-number}',
        language: 'Мова',
        noTranslation: 'Для гэтай формы няма перакладу',
        confirmLanguageChange: 'Уведзеныя даныя будуць страчаны пры змене мовы. Працягнуць?'
    },
    ua: {
        defaultTitle: 'Форма для заповнення PDF',
        generate: 'Заповнити PDF',
        addRow: 'Додати рядок',
        rowTitle: 'Рядок {row-number}',
        language: 'Мова',
        noTranslation: 'Для цієї форми немає перекладу',
        confirmLanguageChange: 'Введені дані буде втрачено під час зміни мови. Продовжити?'
    }
};

// What navigator.languages calls the languages above
const BROWSER_LANGUAGE_TO_CODE = { ru: 'ru', en: 'en', be: 'be', uk: 'ua' };

const isKnown = (code) => LANGUAGES.some((language) => language.code === code);

let activeLanguage = DEFAULT_LANGUAGE;

// ---- the person's choice -------------------------------------------------------------------------

function readStoredLanguage() {
    try {
        const code = localStorage.getItem(STORAGE_KEY);
        return isKnown(code) ? code : undefined;
    } catch {
        return undefined;   // localStorage can be unavailable (privacy mode, blocked cookies)
    }
}

function detectBrowserLanguage() {
    for (const tag of navigator.languages ?? [navigator.language]) {
        const code = BROWSER_LANGUAGE_TO_CODE[String(tag).toLowerCase().split('-')[0]];
        if (code) return code;
    }
    return undefined;
}

/** The saved choice; for a first-time visitor the browser's language; Russian as the last resort. */
export function getPreferredLanguage() {
    return readStoredLanguage() ?? detectBrowserLanguage() ?? DEFAULT_LANGUAGE;
}

export function saveLanguage(code) {
    try {
        localStorage.setItem(STORAGE_KEY, code);
    } catch {
        // not remembered, but the language still switches
    }
}

// ---- the language that is on the screen ------------------------------------------------------------

/** Makes `code` the language of the interface strings (see t()). The saved choice is not touched. */
export function setActiveLanguage(code) {
    activeLanguage = isKnown(code) ? code : DEFAULT_LANGUAGE;
    document.documentElement.lang = LANGUAGES.find((language) => language.code === activeLanguage).htmlLang;
}

export function getActiveLanguage() {
    return activeLanguage;
}

/** A string of the interface in the active language. */
export function t(key) {
    return STRINGS[activeLanguage]?.[key] ?? STRINGS[DEFAULT_LANGUAGE][key];
}

// ---- multilingual metadata -------------------------------------------------------------------------

/** The languages that the metadata has a non-empty form for. An empty list means there is no usable form. */
export function availableLanguages(metadata) {
    if (!metadata) return [];
    if (metadata.local) {
        return LANGUAGES.map(({ code }) => code).filter((code) => metadata.local[code]?.annotations?.length);
    }
    return metadata.annotations ? [DEFAULT_LANGUAGE] : [];   // the old format is Russian
}

/** The preferred language if the form has it, else Russian, else whatever the form has. */
export function pickLanguage(available, preferred) {
    if (available.includes(preferred)) return preferred;
    return available.includes(DEFAULT_LANGUAGE) ? DEFAULT_LANGUAGE : available[0];
}

/**
 * The metadata of one language, in the shape the rest of the code expects:
 * `{ global, title, annotations }`. The result is a copy: binding mutates its annotations.
 */
export function localizeMetadata(metadata, code) {
    if (!metadata.local) return metadata;

    const { local, ...common } = metadata;
    const texts = local[code];
    if (!texts?.annotations?.length) {
        throw new AppError(`The metadata file has no annotations for the language '${code}' in 'local'`);
    }
    return { ...common, ...cloneWithLines(texts) };
}
