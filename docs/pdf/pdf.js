// Общий код для merger.js и passport.js. Подключать до них: <script src="pdf.js"></script>
var PdfTools = (function() {
    // сантиметры -> пункты PDF (1 pt = 1/72 дюйма)
    function cm(value) {
        return value / 2.54 * 72;
    }

    // Размер A4 в пунктах (портрет)
    var A4 = { w: 595.28, h: 841.89 };

    // Открывает системный диалог выбора файлов.
    // Возвращает Promise<[{name, type, buffer}]> в порядке выбора; при отмене - пустой массив.
    function pickFiles(options) {
        return new Promise(function(resolve) {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = options.accept || '';
            input.multiple = !!options.multiple;
            input.style.display = 'none';
            var done = function(files) {
                input.remove();
                resolve(files);
            };
            input.addEventListener('change', function() {
                var files = Array.prototype.slice.call(input.files);
                Promise.all(files.map(function(file) {
                    return file.arrayBuffer().then(function(buffer) {
                        return { name: file.name, type: file.type, buffer: buffer };
                    });
                })).then(done);
            });
            input.addEventListener('cancel', function() { done([]); });
            document.body.appendChild(input);
            input.click();
        });
    }

    // Читает EXIF-ориентацию JPEG (1..8); 1 - если тега нет или файл нестандартный.
    function exifOrientation(buffer) {
        try {
            var v = new DataView(buffer);
            if (v.getUint16(0) !== 0xFFD8) return 1;
            var off = 2;
            while (off + 4 < v.byteLength) {
                var marker = v.getUint16(off);
                if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) return 1;
                if (marker === 0xFFE1) {
                    if (v.getUint32(off + 4) !== 0x45786966) return 1; // "Exif"
                    var tiff = off + 10;
                    var little = v.getUint16(tiff) === 0x4949;
                    var ifd = tiff + v.getUint32(tiff + 4, little);
                    var count = v.getUint16(ifd, little);
                    for (var i = 0; i < count; ++i) {
                        var entry = ifd + 2 + i * 12;
                        if (v.getUint16(entry, little) === 0x0112) return v.getUint16(entry + 8, little);
                    }
                    return 1;
                }
                off += 2 + v.getUint16(off + 2);
            }
        } catch (e) {}
        return 1;
    }

    // pdf-lib игнорирует EXIF-ориентацию, а браузер её учитывает, поэтому фото со смартфона
    // в PDF оказалось бы повёрнутым. Если ориентация не 1, перерисовываем картинку через canvas
    // уже в правильном положении (JPEG, качество 0.95). Возвращает Promise<ArrayBuffer>.
    function normalizeJpeg(buffer) {
        if (exifOrientation(buffer) <= 1) return Promise.resolve(buffer);
        var url = URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' }));
        return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() { resolve(img); };
            img.onerror = function() { reject(new Error('не удалось открыть изображение')); };
            img.src = url;
        }).then(function(img) {
            var canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            return new Promise(function(resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.95); });
        }).then(function(blob) {
            return blob.arrayBuffer();
        }).then(function(result) {
            URL.revokeObjectURL(url);
            return result;
        }, function(err) {
            URL.revokeObjectURL(url);
            throw err;
        });
    }

    // Хэш содержимого файла (hex-строка), чтобы отличать одинаковые файлы независимо от имени и папки.
    // SHA-256 доступен только в защищённом контексте (https, localhost, file://); на обычном http
    // используется запасной 53-битный хэш (cyrb53) плюс длина файла: для десятка сканов этого достаточно.
    function hashBuffer(buffer) {
        if (window.crypto && crypto.subtle) {
            return crypto.subtle.digest('SHA-256', buffer).then(function(digest) {
                return Array.prototype.map.call(new Uint8Array(digest), function(b) {
                    return ('0' + b.toString(16)).slice(-2);
                }).join('');
            });
        }
        var bytes = new Uint8Array(buffer);
        var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (var i = 0; i < bytes.length; ++i) {
            h1 = Math.imul(h1 ^ bytes[i], 2654435761);
            h2 = Math.imul(h2 ^ bytes[i], 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return Promise.resolve('f' + (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16) + '-' + bytes.length);
    }

    return { cm: cm, A4: A4, pickFiles: pickFiles, exifOrientation: exifOrientation, normalizeJpeg: normalizeJpeg, hashBuffer: hashBuffer };
})();
