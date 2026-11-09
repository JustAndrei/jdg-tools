/* global $, PDFLib */
import { collectDrawInstructions } from './form/collect.js';
import { buildForm } from './form/form-builder.js';
import { AppError, userMessageFor } from './errors.js';
import {
    availableLanguages, getActiveLanguage, getPreferredLanguage, localizeMetadata,
    pickLanguage, saveLanguage, setActiveLanguage, t
} from './i18n.js';
import { downloadBytes, resourceUrl } from './io.js';
import { createLanguagePicker } from './language-picker.js';
import { loadProject } from './loader.js';
import { bindAnnotations, downloadDefaultMetadata, readPdfAnnotations } from './pdf/annotations.js';
import { renderPdf } from './pdf/render.js';
import { displayError, displayInfo, setStatus, showPdf } from './ui.js';

// `index.html?debug` marks the anchor point of every text on the output, which helps calibrate coordinates
const DEBUG = new URLSearchParams(location.search).has('debug');

/** The language drop-down; created when the page is ready. */
let picker;

/** The form on the screen: `show(language)` rebuilds it in another language without reloading the PDF. */
let openForm = null;

/** Whether anything was typed into the form since it was built: switching the language would discard it. */
let hasUnsavedInput = false;

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

    openForm = {
        show(language) {
            activate(language);
            project.metadata = localizeMetadata(metadataOfAllLanguages, language);
            bindAnnotations(project.metadata.annotations, texts);
            buildForm(project, { onGenerate: () => generate(project) });
            hasUnsavedInput = false;
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
    // The form is rebuilt from scratch, so what the person has typed in would be lost
    if (openForm && hasUnsavedInput && !confirm(t('confirmLanguageChange'))) return;

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
    picker = createLanguagePicker({ onSelect: onLanguageSelected });
    activate(getPreferredLanguage());
    $(document).on('input change', 'input, select, textarea', () => {
        if (openForm) hasUnsavedInput = true;
    });

    const baseName = location.hash.replace(/^#/, '');
    if (baseName) {
        guarded(() => openServerPdf(decodeURIComponent(baseName)));
    }
});
