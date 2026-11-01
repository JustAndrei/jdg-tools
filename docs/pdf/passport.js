// Сборка отсканированных разворотов паспорта в PDF: два разворота на страницу A4.
// Требует pdf-lib и pdf.js (PdfTools).
(function() {
    var cm = PdfTools.cm;
    var A4 = PdfTools.A4;

    var MARGIN = cm(1.5);       // поля со всех сторон
    var MIN_GAP = cm(0.5);      // минимальное расстояние между разворотами
    var PREFERRED_GAP = cm(1);  // желаемое расстояние, если хватает места
    var PER_SHEET = 2;          // разворотов на странице

    // Кэш картинок в памяти: из него каждый раз заново собираются и PDF, и предпросмотр.
    // Поэтому страница, на которой был один разворот, сам "переделывается" при добавлении второго.
    // Элемент: { name, hash, bytes: ArrayBuffer, isPng, url, width, height, rotation }
    var items = [];
    var history = [];           // сколько картинок добавлено каждым нажатием, для отмены
    var pdfUrl = null;
    var buildId = 0;

    // Круговая стрелка (иконка rotate-cw из набора Lucide)
    var FLIP_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>';

    function $(id) { return document.getElementById(id); }

    function isJpeg(bytes) { return bytes[0] === 0xFF && bytes[1] === 0xD8; }
    function isPngFile(bytes) { return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47; }

    function loadItem(file) {
        var head = new Uint8Array(file.buffer, 0, 4);
        var png = isPngFile(head);
        if (!png && !isJpeg(head)) {
            return Promise.reject(new Error('поддерживаются только JPG и PNG'));
        }
        return (png ? Promise.resolve(file.buffer) : PdfTools.normalizeJpeg(file.buffer)).then(function(bytes) {
            var url = URL.createObjectURL(new Blob([bytes], { type: png ? 'image/png' : 'image/jpeg' }));
            return new Promise(function(resolve, reject) {
                var img = new Image();
                img.onload = function() {
                    resolve({
                        name: file.name, bytes: bytes, isPng: png, url: url,
                        width: img.naturalWidth, height: img.naturalHeight,
                        // Разворот паспорта всегда шире, чем выше: вертикальную картинку
                        // поворачиваем по часовой стрелке на 90 градусов
                        rotation: img.naturalHeight > img.naturalWidth ? 90 : 0
                    });
                };
                img.onerror = function() {
                    URL.revokeObjectURL(url);
                    reject(new Error('не удалось открыть изображение'));
                };
                img.src = url;
            });
        });
    }

    // Раскладка одной страницы. Координаты в пунктах, начало - левый верхний угол страницы.
    // Размер каждого разворота считается как для полной страницы (из двух), поэтому одиночный
    // разворот имеет тот же масштаб и позже не "прыгает" при добавлении второго.
    function layoutSheet(sheetItems) {
        var availW = A4.w - 2 * MARGIN;
        var availH = A4.h - 2 * MARGIN;
        var boxH = (availH - MIN_GAP) / PER_SHEET;
        var sizes = sheetItems.map(function(item) {
            var sideways = item.rotation % 180 !== 0;
            var width = sideways ? item.height : item.width;   // размеры после поворота
            var height = sideways ? item.width : item.height;
            var scale = Math.min(availW / width, boxH / height);
            return { w: width * scale, h: height * scale };
        });
        var used = sizes.reduce(function(sum, s) { return sum + s.h; }, 0);
        // Гарантированно >= MIN_GAP, т.к. каждая картинка не выше boxH
        var gap = sizes.length > 1 ? Math.min(PREFERRED_GAP, availH - used) : 0;
        var y = MARGIN;
        return sizes.map(function(s) {
            var rect = { x: MARGIN + (availW - s.w) / 2, y: y, w: s.w, h: s.h };
            y += s.h + gap;
            return rect;
        });
    }

    function sheets() {
        var result = [];
        for (var i = 0; i < items.length; i += PER_SHEET) {
            result.push(items.slice(i, i + PER_SHEET));
        }
        return result;
    }

    function buildPdf() {
        var doc;
        return PDFLib.PDFDocument.create().then(function(d) {
            doc = d;
            return items.reduce(function(chain, item) {
                return chain.then(function(list) {
                    return (item.isPng ? doc.embedPng(item.bytes) : doc.embedJpg(item.bytes)).then(function(img) {
                        list.push(img);
                        return list;
                    });
                });
            }, Promise.resolve([]));
        }).then(function(embedded) {
            sheets().forEach(function(sheetItems, s) {
                var page = doc.addPage([A4.w, A4.h]);
                layoutSheet(sheetItems).forEach(function(r, i) {
                    var rotation = sheetItems[i].rotation;
                    var left = r.x;
                    var bottom = A4.h - r.y - r.h; // в PDF ось Y направлена вверх
                    var sideways = rotation % 180 !== 0;
                    // Размер картинки до поворота
                    var w = sideways ? r.h : r.w;
                    var h = sideways ? r.w : r.h;
                    // pdf-lib поворачивает вокруг левого нижнего угла картинки против часовой
                    // стрелки, поэтому для поворота по часовой передаём отрицательный угол
                    // и сдвигаем точку привязки так, чтобы результат лёг ровно в прямоугольник r
                    var origin = {
                        0: { x: left, y: bottom },
                        90: { x: left, y: bottom + r.h },
                        180: { x: left + r.w, y: bottom + r.h },
                        270: { x: left + r.w, y: bottom }
                    }[rotation];
                    page.drawImage(embedded[s * PER_SHEET + i], {
                        x: origin.x,
                        y: origin.y,
                        width: w,
                        height: h,
                        rotate: PDFLib.degrees(-rotation)
                    });
                });
            });
            return doc.save();
        });
    }

    function renderPreview() {
        var container = $('sheets');
        container.textContent = '';
        sheets().forEach(function(sheetItems, s) {
            var sheet = document.createElement('div');
            sheet.className = 'sheet';
            layoutSheet(sheetItems).forEach(function(r, i) {
                var item = sheetItems[i];
                var sideways = item.rotation % 180 !== 0;
                // Картинка рисуется в исходных размерах и поворачивается вокруг центра,
                // поэтому для 90/270 ширина и высота меняются местами
                var w = sideways ? r.h : r.w;
                var h = sideways ? r.w : r.h;
                var cx = r.x + r.w / 2;
                var cy = r.y + r.h / 2;
                var img = document.createElement('img');
                img.src = item.url;
                img.alt = 'Разворот ' + (s * PER_SHEET + i + 1);
                img.style.left = ((cx - w / 2) / A4.w * 100) + '%';
                img.style.top = ((cy - h / 2) / A4.h * 100) + '%';
                img.style.width = (w / A4.w * 100) + '%';
                img.style.height = (h / A4.h * 100) + '%';
                img.style.transform = 'rotate(' + item.rotation + 'deg)';
                sheet.appendChild(img);

                // Круглая кнопка по центру разворота. Переворачивать нажатием на саму картинку
                // нельзя: на смартфоне это срабатывало бы случайно при прокрутке страницы
                var flip = document.createElement('button');
                flip.type = 'button';
                flip.className = 'flip';
                flip.title = 'Перевернуть разворот на 180°';
                flip.setAttribute('aria-label', 'Перевернуть разворот ' + (s * PER_SHEET + i + 1) + ' на 180°');
                flip.innerHTML = FLIP_ICON;
                flip.style.left = (cx / A4.w * 100) + '%';
                flip.style.top = (cy / A4.h * 100) + '%';
                flip.addEventListener('click', function() {
                    item.rotation = (item.rotation + 180) % 360;
                    render();
                });
                sheet.appendChild(flip);
            });
            container.appendChild(sheet);
        });
    }

    function render() {
        var has = items.length > 0;
        $('intro').hidden = has;
        $('result').hidden = !has;
        $('actions').hidden = !has;
        renderPreview();
        if (!has) {
            ++buildId;
            return;
        }
        var count = sheets().length;
        $('status').textContent = 'Разворотов: ' + items.length + ', страниц A4: ' + count +
            (items.length % PER_SHEET ? '. На последней странице есть место ещё для одного разворота' : '');

        $('actions').classList.add('busy');
        var id = ++buildId;
        buildPdf().then(function(bytes) {
            if (id !== buildId) return; // за это время список изменился, результат устарел
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
            pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            $('save').href = pdfUrl;
            $('open').href = pdfUrl;
            $('actions').classList.remove('busy');
        }).catch(function(err) {
            alert('Не удалось собрать PDF: ' + err.message);
        });
    }

    function releaseItems(list) {
        list.forEach(function(item) { URL.revokeObjectURL(item.url); });
    }

    $('add').addEventListener('click', function() {
        PdfTools.pickFiles({ accept: 'image/jpeg,image/png', multiple: true }).then(function(files) {
            var added = 0;
            var skipped = 0;
            return files.reduce(function(chain, file) {
                return chain.then(function() {
                    // Сравниваем хэш исходного файла (до поворота и перекодирования), а не имя:
                    // одинаковые файлы могут лежать в разных папках под разными именами
                    return PdfTools.hashBuffer(file.buffer).then(function(hash) {
                        if (items.some(function(item) { return item.hash === hash; })) {
                            ++skipped;
                            return;
                        }
                        return loadItem(file).then(function(item) {
                            item.hash = hash;
                            items.push(item);
                            ++added;
                        }, function(err) {
                            alert(file.name + ': ' + err.message);
                        });
                    });
                });
            }, Promise.resolve()).then(function() {
                if (added) history.push(added);
                // Ошибка только если ничего нового нет; если среди выбранных есть новые,
                // повторы молча отбрасываются
                if (!added && skipped === files.length) {
                    alert(files.length === 1 ? 'Этот файл уже добавлен' : 'Все выбранные файлы уже добавлены');
                }
                render();
            });
        });
    });

    $('undo').addEventListener('click', function() {
        var n = history.pop();
        if (!n) return;
        releaseItems(items.splice(items.length - n, n));
        render();
    });

    $('reset').addEventListener('click', function() {
        if (items.length && !confirm('Удалить все добавленные развороты?')) return;
        releaseItems(items);
        items = [];
        history = [];
        render();
    });

    render();
})();
