$(function() {
    function readFile(callback) {
        var $i = $('#readFileProxy');
        if ($i.length == 0) {
            $i = $('<input id="readFileProxy" type="file" style="display: none" />');
            $i.change(function() {
                var files = $i.prop('files');
                if (files && files[0]) {
                    var mimeType = files[0].type;
                    var reader = new FileReader();
                    reader.onload = e => callback(e.target.result, mimeType);
                    reader.readAsArrayBuffer(files[0]);
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
        readFile((newFileArrayBuffer, mimeType) => {
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
