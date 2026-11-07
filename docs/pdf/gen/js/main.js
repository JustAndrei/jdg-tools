/* global PDFLib */
import { collectDrawInstructions } from './form/collect.js';
import { buildForm } from './form/form-builder.js';
import { AppError, userMessageFor } from './errors.js';
import { downloadBytes, resourceUrl } from './io.js';
import { loadProject } from './loader.js';
import { bindAnnotations, downloadDefaultMetadata, readPdfAnnotations } from './pdf/annotations.js';
import { renderPdf } from './pdf/render.js';
import { displayError, displayInfo, setStatus, showPdf } from './ui.js';

// `index.html?debug` marks the anchor point of every text on the output, which helps calibrate coordinates
const DEBUG = new URLSearchParams(location.search).has('debug');

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

async function openProject(baseName, pdfBytes) {
    const project = await loadProject(baseName, pdfBytes);
    const { texts, rects } = readPdfAnnotations(await PDFLib.PDFDocument.load(pdfBytes));

    if (!project.metadata?.annotations) {
        downloadDefaultMetadata(texts, project.metadataFileName);
        displayInfo(`Файл ${project.metadataFileName} не найден или не содержит annotations. Скачан файл-заготовка: заполните его и положите рядом с index.html.`);
        return;
    }

    bindAnnotations(project.metadata.annotations, texts);
    project.rects = rects;
    buildForm(project, { onGenerate: () => generate(project) });
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

$(() => {
    const baseName = location.hash.replace(/^#/, '');
    if (baseName) {
        guarded(() => openServerPdf(decodeURIComponent(baseName)));
    }
});
