/* global $, PDFLib */
import { collectDrawInstructions } from './form/collect.js';
import { buildForm } from './form/form-builder.js';
import { AppError, userMessageFor } from './errors.js';
import {
    availableLanguages, getActiveLanguage, getPreferredLanguage, localizeMetadata,
    pickLanguage, saveLanguage, setActiveLanguage, t
} from './i18n.js';
import { downloadBytes, pickLocalFile, resourceUrl, saveTextFile } from './io.js';
import { createLanguagePicker } from './language-picker.js';
import { loadProject } from './loader.js';
import { bindAnnotations, downloadDefaultMetadata, readPdfAnnotations } from './pdf/annotations.js';
import { renderPdf } from './pdf/render.js';
import { createProfileBar } from './profiles/profile-bar.js';
import {
    isFormState, nameParts, profileNameOf, restoreForm, serializeForm, withDefaults
} from './profiles/form-state.js';
import {
    clearProfiles, getCurrentProfile, hasProfile, listProfiles, loadProfile, saveProfile, setCurrentProfile
} from './profiles/profile-store.js';
import { displayError, displayInfo, setStatus, showPdf } from './ui.js';

// `index.html?debug` marks the anchor point of every text on the output, which helps calibrate coordinates
const DEBUG = new URLSearchParams(location.search).has('debug');

/** The bar that stays at the top of the page: the profile controls (once a form is open) and the language picker. */
let $topBar;

/** The language drop-down; created when the page is ready. */
let picker;

/** The form on the screen: `show(language)` rebuilds it in another language without reloading the PDF. */
let openForm = null;

/** The bar with the saved profiles of the open form; created together with the form. */
let profileBar;

function reportable(error) {
    console.error(error);
    return userMessageFor(error);
}

async function generate(project) {
    setStatus('');
    try {
        const instructions = collectDrawInstructions(project, { debug: DEBUG });
        showPdf(await renderPdf(project, instructions));
    } catch (error) {
        setStatus(reportable(error));
    }
}

/** Switches the language of the interface strings and of the picker (the saved choice is not touched). */
function activate(language) {
    setActiveLanguage(language);
    picker.setActive(language);
    profileBar?.refreshLabels();
}

async function openProject(baseName, pdfBytes) {
    const project = await loadProject(baseName, pdfBytes);
    const { texts, rects } = readPdfAnnotations(await PDFLib.PDFDocument.load(pdfBytes));

    const languages = availableLanguages(project.metadata);
    if (languages.length === 0) {
        downloadDefaultMetadata(texts, project.metadataFileName);
        displayInfo(`Файл ${project.metadataFileName} не найден или не содержит annotations. Скачан файл-заготовка: заполните его и положите рядом с index.html.`);
        return;
    }

    const metadataOfAllLanguages = project.metadata;   // the form is built from one language of it
    project.rects = rects;
    picker.setAvailable(languages);

    const form = project.baseName;   // profiles are kept in localStorage under the name of the form
    let defaults;                    // the state of the freshly built form
    let nameFields;                  // the controls the profile name is made of

    const showProfiles = () => {
        const current = getCurrentProfile(form);
        profileBar.setProfiles(listProfiles(form), current);
    };

    /** Saves the state under `name`, makes the profile the current one and updates the bar. */
    const keepProfile = (name, state) => {
        saveProfile(form, name, state);
        setCurrentProfile(form, name);
        showProfiles();
    };

    const applyProfile = (state) => restoreForm(withDefaults(defaults, state));

    const switchProfile = (name) => {
        const state = loadProfile(form, name);
        if (!isFormState(state)) {
            alert(t('invalidProfileFile'));
            showProfiles();
            return;
        }
        setCurrentProfile(form, name);
        applyProfile(state);
        showProfiles();
    };

    /** Called by "Fill PDF": the form goes to the profile named after its fields (a new one if they changed). */
    const saveForm = () => {
        const state = serializeForm();
        keepProfile(profileNameOf(state, nameFields) || t('unnamedProfile'), state);
    };

    const exportProfile = () => {
        const state = serializeForm();
        const name = profileNameOf(state, nameFields) || t('unnamedProfile');
        const filename = `${form} ${name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
        saveTextFile(filename, 'application/json', JSON.stringify({ form, ...state }, null, 2));
    };

    const importProfile = async () => {
        const file = await pickLocalFile('.json,application/json');
        if (!file) return;

        let data;
        try {
            data = JSON.parse(await file.text());
        } catch {
            alert(t('invalidProfileFile'));
            return;
        }
        if (!isFormState(data)) {
            alert(t('invalidProfileFile'));
            return;
        }
        if (data.form !== undefined && data.form !== form) {
            alert(t('wrongFormFile'));
            return;
        }

        const state = { version: data.version, fields: data.fields, tables: Array.isArray(data.tables) ? data.tables : [] };
        const name = profileNameOf(state, nameFields) || file.name.replace(/\.json$/i, '') || t('unnamedProfile');
        if (hasProfile(form, name) && !confirm(t('confirmOverwrite').replace('{name}', name))) return;

        keepProfile(name, state);
        applyProfile(state);
    };

    const resetProfiles = () => {
        if (!confirm(t('confirmReset'))) return;
        clearProfiles(form);
        restoreForm(defaults);
        showProfiles();
    };

    profileBar = createProfileBar({
        container: $topBar,
        onSelect: switchProfile,
        onSave: exportProfile,
        onLoad: () => guarded(importProfile),
        onReset: resetProfiles
    });

    openForm = {
        built: false,
        show(language) {
            // Rebuilding the form for another language must not lose what has been typed in
            const typedIn = this.built ? serializeForm() : null;

            activate(language);
            project.metadata = localizeMetadata(metadataOfAllLanguages, language);
            bindAnnotations(project.metadata.annotations, texts);
            buildForm(project, { onGenerate: () => { saveForm(); generate(project); } });
            defaults = serializeForm();
            nameFields = nameParts();
            this.built = true;

            if (typedIn) {
                applyProfile(typedIn);
            } else {
                // Opening the form: the current profile, or the first saved one if it has disappeared
                const names = listProfiles(form);
                const current = names.includes(getCurrentProfile(form)) ? getCurrentProfile(form) : names[0];
                const state = current === undefined ? null : loadProfile(form, current);
                if (isFormState(state)) {
                    setCurrentProfile(form, current);
                    applyProfile(state);
                }
            }
            showProfiles();
        }
    };
    openForm.show(pickLanguage(languages, getPreferredLanguage()));
}

/** The PDF lives on the server next to index.html; its name (without extension) comes from the URL hash. */
async function openServerPdf(baseName) {
    let pdfBytes;
    try {
        pdfBytes = await downloadBytes(resourceUrl(baseName, '.pdf'));
    } catch (error) {
        throw new AppError(error.message, `Неправильная ссылка, файл ${baseName}.pdf не существует`);
    }
    await openProject(baseName, pdfBytes);
}

async function guarded(action) {
    try {
        await action();
    } catch (error) {
        displayError(reportable(error));
    }
}

function onLanguageSelected(language) {
    if (language === getActiveLanguage()) return;
    saveLanguage(language);
    if (!openForm) {
        activate(language);
        return;
    }
    try {
        openForm.show(language);
    } catch (error) {
        displayError(reportable(error));
    }
}

$(() => {
    $topBar = $('<div class="top-bar" data-persistent>').appendTo('body');
    picker = createLanguagePicker({ onSelect: onLanguageSelected, container: $topBar });
    activate(getPreferredLanguage());

    const baseName = location.hash.replace(/^#/, '');
    if (baseName) {
        guarded(() => openServerPdf(decodeURIComponent(baseName)));
    }
});
