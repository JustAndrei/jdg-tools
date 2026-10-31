$(function() {
    // qpdf (WASM) подключается скриптом из merger.html и создаёт глобальную функцию Module.
    // Файл .wasm лежит рядом с qpdf.js на том же CDN, версии должны совпадать.
    var QPDF_WASM_URL = 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm';

    // Снимает шифрование (в т.ч. с пустым пользовательским паролем и owner-ограничениями),
    // которое pdf-lib не умеет обрабатывать. Возвращает Promise<Uint8Array>.
    function decryptWithQpdf(arrayBuffer) {
        var messages = [];
        return window.Module({
            locateFile: () => QPDF_WASM_URL,
            print: m => messages.push(m),
            printErr: m => messages.push(m)
        }).then(qpdf => {
            qpdf.FS.writeFile('/in.pdf', new Uint8Array(arrayBuffer));
            var code = qpdf.callMain(['--decrypt', '/in.pdf', '/out.pdf']);
            var out;
            try { out = qpdf.FS.readFile('/out.pdf'); } catch (e) {}
            if (!out) {
                throw new Error('qpdf: ' + (messages.join(' ') || 'код выхода ' + code));
            }
            return out;
        });
    }

    // Сначала пробуем открыть файл как есть; если pdf-lib не справился
    // (зашифрован и т.п.), прогоняем через qpdf и пробуем ещё раз.
    // Проверять тип ошибки через instanceof EncryptedPDFError нельзя: в pdf-lib 1.17.1 это не работает.
    function loadPdf(arrayBuffer) {
        return PDFLib.PDFDocument.load(arrayBuffer).catch(err => {
            console.info('pdf-lib не открыл файл (' + err.message + '), пробую расшифровать через qpdf');
            return decryptWithQpdf(arrayBuffer).then(
                bytes => PDFLib.PDFDocument.load(bytes),
                qpdfErr => { throw new Error(err.message + ' | ' + qpdfErr.message); }
            );
        });
    }

    function readFiles(multiple, callback) {
        var $i = $('#readFilesProxy');
        if ($i.length == 0) {
            $i = $('<input id="readFilesProxy" type="file" accept="application/pdf, image/jpeg"' + ( multiple ? ' multiple="multiple"' : '' ) + ' style="display: none" />');
            $i.change(function() {
                var files = $i.prop('files');
                if (files && files.length) {
                    var results = [];
                    var fileCount = files.length;
                    var resultsCounter = fileCount;
                    var r = -1;
                    var next = function () {
                        if (++r < fileCount) {
                            callback(results[r].buffer, results[r].type, r == fileCount - 1, next);
                        }
                    };
                    for (var f = 0; f < files.length; ++f) {
                        results.push(null);
                        var reader = new FileReader();
                        reader.onload = function(fileIndex, mimeType) {
                            return e => {
                                results[fileIndex] = { buffer: e.target.result, type: mimeType };
                                if (--resultsCounter <= 0) {
                                    next();
                                }
                            };
                        }(f, files[f].type);
                        reader.readAsArrayBuffer(files[f]);
                    }
                    $i.val('');
                }
            });
            $('body').append($i);
        }
        $i.click();
    }

    var undoBuffer = [];
    
    function reset() {
        undoBuffer.length = 0;
        PDFLib.PDFDocument.create().then(doc => {
            window.doc = doc;
            $('#pdf').attr('data', '');
            $('#hint').hide();
            $('.help').show();
        });
    }

    function undo() {
        undoBuffer.pop();
        if (!undoBuffer.length) {
            reset();
            return;
        }

        var bytes = undoBuffer[undoBuffer.length - 1];

        PDFLib.PDFDocument.load(bytes, {ignoreEncryption: true}).then(newDoc => {
            doc = newDoc;
            var nextPage = doc.getPages().length + 1;
            displayPdf(doc, nextPage);
            undoBuffer.pop();
        });
    }

    function displayPdf(doc, page) {
        doc.save().then(bytes => {
            undoBuffer.push(bytes);
            if (window.lastUrl) {
                URL.revokeObjectURL(window.lastUrl);
            }
            window.lastUrl = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}));
            $('#pdf').attr('data', lastUrl + '#page=' + (page ? page : ''));
            $('.help').hide();
            $('#hint').show();
        });
    }

    function addJpg(imageArrayBuffer, doc, autoRotate, scale) {
        var next = () => {};
        doc.embedJpg(imageArrayBuffer).then(embeddedImage => {
            var pageSize = PDFLib.PageSizes.A4;
            if (autoRotate && embeddedImage.height < embeddedImage.width) {
                pageSize = [pageSize[1], pageSize[0]];
            }
            var page = doc.addPage(pageSize);
            var imageDims;
            if (scale === '') {
                imageDims = embeddedImage.scaleToFit(pageSize[0] - 20, pageSize[1] - 20);
            } else {
                var factor = 72 / scale;
                imageDims = {
                    width: embeddedImage.width * factor,
                    height: embeddedImage.height * factor
                };
            }
            page.drawImage(embeddedImage, {
                x: page.getWidth() / 2 - imageDims.width / 2,
                y: page.getHeight() / 2 - imageDims.height / 2,
                width: imageDims.width,
                height: imageDims.height
            });
            next();
        });
        return {
            then: function(continuation) {
                next = continuation;
            }
        }
    }

    $('#appendFile').click(e => {
        readFiles(true, (newFileArrayBuffer, mimeType, isLastFile, next) => {
            var nextPage = doc.getPages().length + 1;
            if (mimeType == 'application/pdf') {
                loadPdf(newFileArrayBuffer).then(newDoc => {
                    return doc.copyPages(newDoc, newDoc.getPages().map((e, i, a) => i)).then(newPages => {
                        $.each(newPages, (i, p) => { doc.addPage(p); });
                        if (isLastFile) {
                            displayPdf(doc, nextPage);
                        }
                        else next();
                    });
                }).catch(err => {
                    alert('Не удалось прочитать PDF-файл: ' + err.message);
                    if (isLastFile) {
                        if (doc.getPages().length) displayPdf(doc, nextPage);
                    }
                    else next();
                });
            }
            else if (mimeType == 'image/jpeg') {
                addJpg(newFileArrayBuffer, doc, $('#autoRotate').prop('checked'), $('#scale').val()).then(() => {
                    if (isLastFile) {
                        displayPdf(doc, nextPage);
                    }
                    else next();
                });
            }
            else {
                alert('Тип ' + mimeType + ' не поддерживается');
                next();
            }
        });
    });

    $('#addBlankPage').click(e => {
        var nextPage = doc.getPages().length + 1;
        doc.addPage();
        displayPdf(doc, nextPage);
    });

    $('#reset').click(reset).click();
    $('#undo').click(undo).click();
});
