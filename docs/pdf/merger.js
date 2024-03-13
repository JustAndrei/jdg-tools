$(function() {
    function readFiles(multiple, callback) {
        var results = [];
        var resultsCounter = 0;
        var $i = $('#readFilesProxy');
        if ($i.length == 0) {
            $i = $('<input id="readFilesProxy" type="file"' + ( multiple ? ' multiple="multiple"' : '' ) + ' style="display: none" />');
            $i.change(function() {
                var files = $i.prop('files');
                if (files && files.length) {
                    results = [];
                    resultsCounter = files.length;
                    for (var f = 0; f < files.length; ++f) {
                        var mimeType = files[f].type;
                        var reader = new FileReader();
                        reader.fileIndex = f;
                        reader.onload = function(fileIndex, fileCount) {
                            return e => {
                                results[fileIndex] = { buffer: e.target.result, type: mimeType };
                                if (--resultsCounter <= 0) {
                                    for (var r = 0; r < fileCount; ++r) {
                                        callback(results[r].buffer, results[r].type);
                                    }
                                }
                            };
                        }(f, files.length);
                        reader.readAsArrayBuffer(files[f]);
                    }
                    $i.val('');
                }
            });
            $('body').append($i);
        }
        $i.click();
    }

    function displayPdf(doc, page) {
        doc.save().then(bytes => {
            if (window.lastUrl) {
                URL.revokeObjectURL(window.lastUrl);
            }
            window.lastUrl = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}));
            $('#pdf').attr('data', lastUrl + '#page=' + (page ? page : ''));
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
        readFiles(true, (newFileArrayBuffer, mimeType) => {
            var nextPage = doc.getPages().length + 1;
            if (mimeType == 'application/pdf') {
                PDFLib.PDFDocument.load(newFileArrayBuffer).then(newDoc => {
                    doc.copyPages(newDoc, newDoc.getPages().map((e, i, a) => i)).then(newPages => {
                        $.each(newPages, (i, p) => { doc.addPage(p); });
                        displayPdf(doc, nextPage);
                    });
                });
            }
            else if (mimeType == 'image/jpeg') {
                addJpg(newFileArrayBuffer, doc, $('#autoRotate').prop('checked'), $('#scale').val()).then(() => { displayPdf(doc, nextPage); });
            }
            else {
                alert('Тип ' + mimeType + ' не поддерживается');
            }
        });
    });

    $('#addBlankPage').click(e => {
        var nextPage = doc.getPages().length + 1;
        doc.addPage();
        displayPdf(doc, nextPage);
    });

    $('#reset').click(e => {
        PDFLib.PDFDocument.create().then(doc => {
            window.doc = doc;
            $('#pdf').attr('data', '');
            $('#hint').hide();
        });
    }).click();
});
