// Сборка отсканированных разворотов паспорта в PDF: два разворота на страницу A4.
// Требует pdf-lib и pdf.js (PdfTools).
(function() {
    var cm = PdfTools.cm;
    var A4 = PdfTools.A4;

    var MARGIN = cm(1.5);       // поля со всех сторон
    var MIN_GAP = cm(0.5);      // минимальное расстояние между разворотами
    var PREFERRED_GAP = cm(1);  // желаемое расстояние, если хватает места
    var PER_SHEET = 2;          // разворотов на странице

    // Сжатие при сохранении
    var maxBytes = 10000000;      // жёсткий предел размера итогового PDF (Infinity - без сжатия), меняется кнопками
    var ACCEPT = 0.97;            // результат не меньше 97% от предела считаем достаточно близким
    var AIM = 0.985;              // в какую точку целимся при подборе
    var MAX_ITER = 12;            // максимум итераций подбора (кроме двух пробных)
    var DPI_START = 600;          // разрешение на странице при лучшем качестве (картинки с меньшим dpi не увеличиваются)
    var DPI_MID = 200;            // разрешение, до которого можно спокойно опускаться без потери качества JPEG
    var DPI_MIN = 120;            // нижний предел разрешения
    var Q_TOP = 0.89;             // ВАЖНО: строго меньше 0.90, см. комментарий у levelParams

    // Кэш картинок в памяти: из него каждый раз заново собираются и PDF, и предпросмотр.
    // Поэтому страница, на которой был один разворот, сам "переделывается" при добавлении второго.
    // Элемент: { name, hash, bytes: ArrayBuffer, isPng, url, width, height, rotation }
    var items = [];
    var history = [];           // сколько картинок добавлено каждым нажатием, для отмены
    var pdfUrl = null;
    var buildId = 0;
    var version = 0;            // растёт при любом изменении списка/поворотов
    var pdfSize = Infinity;     // размер несжатого PDF текущей версии
    var compressedUrl = null;   // сжатый PDF и версия, для которой он собран
    var compressedVersion = -1;
    var autoClick = false;

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

    // sources - необязательный массив { bytes, isPng } вместо оригиналов (для сжатых копий)
    function buildPdf(sources) {
        sources = sources || items;
        var doc;
        return PDFLib.PDFDocument.create().then(function(d) {
            doc = d;
            return sources.reduce(function(chain, item) {
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
        ++version;
        if (compressedUrl) {
            URL.revokeObjectURL(compressedUrl);
            compressedUrl = null;
        }
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
            pdfSize = bytes.length;
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


    // ---------- Сжатие до maxBytes ----------
    // Оригиналы (item.url / item.bytes) никогда не меняются: на каждой итерации картинки
    // заново кодируются из оригинала, поэтому потери не накапливаются.
    //
    // Подбор идёт по одному параметру t от 0 (лучшее качество) до 1 (худшее).
    //  1) t 0..0.25:   качество JPEG постоянное, разрешение на странице 600 -> 200 dpi
    //  2) t 0.25..0.55: 200 dpi, качество JPEG Q_TOP -> 0.70
    //  3) t 0.55..1:   разрешение 200 -> 120 dpi, качество 0.70 -> 0.60
    // Качество Q_TOP намеренно ниже 0.90: браузеры (Chrome/Skia) при quality >= 0.90 переключают
    // JPEG с цветовой субдискретизации 4:2:0 на 4:4:4, и размер файла скачком вырастает
    // примерно на треть. Из-за такого разрыва зависимость размера от t перестаёт быть
    // непрерывной, и подбор "упирается" в разрыв и останавливается далеко от лимита.
    function levelParams(t) {
        if (t <= 0.25) {
            var u0 = t / 0.25;
            return { dpi: DPI_START * Math.pow(DPI_MID / DPI_START, u0), quality: Q_TOP };
        }
        if (t <= 0.55) {
            var u1 = (t - 0.25) / 0.30;
            return { dpi: DPI_MID, quality: Q_TOP - (Q_TOP - 0.70) * u1 };
        }
        var u2 = (t - 0.55) / 0.45;
        return { dpi: DPI_MID * Math.pow(DPI_MIN / DPI_MID, u2), quality: 0.70 - 0.10 * u2 };
    }

    // Для каждой картинки: сколько пикселей на дюйм она имеет на странице в исходном виде
    function nativeDpis() {
        var list = [];
        sheets().forEach(function(sheetItems) {
            layoutSheet(sheetItems).forEach(function(r, i) {
                var item = sheetItems[i];
                var sideways = item.rotation % 180 !== 0;
                var pixelsAcross = sideways ? item.height : item.width; // ширина после поворота
                list.push(pixelsAcross / (r.w / 72));
            });
        });
        return list;
    }

    function loadImage(url) {
        return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() { resolve(img); };
            img.onerror = function() { reject(new Error('не удалось открыть изображение')); };
            img.src = url;
        });
    }

    function encodeJpeg(img, w, h, quality) {
        return new Promise(function(resolve, reject) {
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff'; // для PNG с прозрачностью
            ctx.fillRect(0, 0, w, h);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(function(blob) {
                canvas.width = canvas.height = 0; // освобождаем память (важно для iOS)
                if (!blob) return reject(new Error('браузер не смог сжать изображение'));
                blob.arrayBuffer().then(resolve, reject);
            }, 'image/jpeg', quality);
        });
    }

    function compress(onAttempt) {
        var dpis = nativeDpis();
        var images;
        var attempt = 0;

        // Одна попытка: кодируем все картинки с параметрами уровня t, собираем PDF, меряем размер.
        // Картинки кодируются по очереди, чтобы не раздувать память на телефоне.
        function tryLevel(t) {
            var p = levelParams(t);
            return items.reduce(function(chain, item, i) {
                return chain.then(function(list) {
                    var f = Math.min(1, p.dpi / dpis[i]); // увеличивать картинку не имеет смысла
                    var w = Math.max(1, Math.round(item.width * f));
                    var h = Math.max(1, Math.round(item.height * f));
                    return encodeJpeg(images[i], w, h, p.quality).then(function(bytes) {
                        list.push({ bytes: bytes, isPng: false });
                        return list;
                    });
                });
            }, Promise.resolve([])).then(function(sources) {
                return buildPdf(sources);
            }).then(function(pdf) {
                onAttempt(++attempt, pdf.length);
                console.log('PDF compress: t=' + t.toFixed(3) + ', dpi=' + Math.round(p.dpi) +
                    ', quality=' + p.quality.toFixed(2) + ', size=' + pdf.length);
                return { t: t, bytes: pdf, size: pdf.length };
            });
        }

        // Размер примерно экспоненциально зависит от t, поэтому следующую точку ищем
        // интерполяцией по логарифму размера (быстрее, чем деление пополам).
        function nextT(lo, hi) {
            var a = Math.log(lo.size);
            var b = Math.log(hi.size);
            var k = b === a ? 0.5 : (Math.log(maxBytes * AIM) - a) / (b - a);
            k = Math.min(0.95, Math.max(0.05, k));
            return lo.t + (hi.t - lo.t) * k;
        }

        return Promise.all(items.map(function(item) { return loadImage(item.url); })).then(function(loaded) {
            images = loaded;
            return tryLevel(0);
        }).then(function(lo) {
            if (lo.size <= maxBytes) return lo; // уже влезло с лучшим качеством
            return tryLevel(1).then(function(hi) {
                if (hi.size > maxBytes) return hi; // даже худший вариант не влез: отдаём его
                var lastSide = null;   // с какой стороны вилки оказался прошлый результат
                var repeats = 0;       // сколько раз подряд с одной и той же
                function step(n) {
                    if (n >= MAX_ITER || hi.t - lo.t < 0.003) return hi;
                    // Зависимость размера от t кусочная (качество, потом пиксели), и интерполяция
                    // может "застрять" с одной стороны. Тогда делим вилку пополам.
                    var t = repeats >= 2 ? (lo.t + hi.t) / 2 : nextT(lo, hi);
                    return tryLevel(t).then(function(r) {
                        var side = r.size <= maxBytes ? 'hi' : 'lo';
                        repeats = side === lastSide ? repeats + 1 : 1;
                        lastSide = side;
                        if (side === 'hi') {
                            hi = r;
                            if (r.size >= maxBytes * ACCEPT) return r;
                        } else {
                            lo = r;
                        }
                        return step(n + 1);
                    });
                }
                return step(0);
            });
        });
    }

    function megabytes(n) { return (n / 1000000).toFixed(1).replace('.', ',') + ' МБ'; }

    // ---------- Сохранение: выбор предела размера, сжатие и скачивание ----------
    var picker = $('picker');
    var sizeButtons = Array.prototype.slice.call(picker.querySelectorAll('.seg'));
    var compressedLimit = null; // предел, под который собран compressedUrl

    function limitOf(mb) { return mb === 'inf' ? Infinity : Math.round(parseFloat(mb) * 1000000); }

    function markLimit(mb) {
        sizeButtons.forEach(function(b) {
            b.setAttribute('aria-pressed', b.getAttribute('data-mb') === mb ? 'true' : 'false');
        });
    }

    function openPicker() {
        picker.hidden = false;
        var current = sizeButtons.filter(function(b) { return b.getAttribute('aria-pressed') === 'true'; })[0];
        (current || sizeButtons[0]).focus();
    }

    function closePicker() { picker.hidden = true; }

    // Скачивание через программный клик по ссылке "Сохранить PDF"
    function download(url) {
        $('save').href = url;
        autoClick = true;
        $('save').click();
        autoClick = false;
    }

    function saveWithLimit(mb) {
        closePicker();
        maxBytes = limitOf(mb);
        markLimit(mb);
        try { localStorage.setItem('passportPdfMaxMb', mb); } catch (e) { /* не страшно */ }

        if (pdfSize <= maxBytes) { // влезает без сжатия (или без ограничений)
            download(pdfUrl);
            return;
        }
        if (compressedUrl && compressedVersion === version && compressedLimit === maxBytes) {
            download(compressedUrl); // уже сжато под этот предел
            return;
        }

        var v = version;
        var loader = $('loader');
        $('loader-title').textContent = 'Сжимаем PDF, чтобы он уместился в ' + megabytes(maxBytes);
        $('loader-text').textContent = 'Исходный размер: ' + megabytes(pdfSize);
        loader.hidden = false;

        compress(function(n, size) {
            $('loader-text').textContent = 'Исходный размер: ' + megabytes(pdfSize) +
                '. Оптимизируем, итерация ' + n;
        }).then(function(best) {
            loader.hidden = true;
            if (v !== version) return; // на всякий случай: за это время всё изменилось
            if (compressedUrl) URL.revokeObjectURL(compressedUrl);
            compressedUrl = URL.createObjectURL(new Blob([best.bytes], { type: 'application/pdf' }));
            compressedVersion = v;
            compressedLimit = maxBytes;
            if (best.size > maxBytes) {
                alert('Не удалось уложиться в ' + megabytes(maxBytes) + ' даже при максимальном сжатии: ' + megabytes(best.size));
            }
            // Если браузер заблокирует скачивание без прямого клика, повторное нажатие
            // "Сохранить PDF" и выбор того же предела сразу отдадут уже готовый файл
            download(compressedUrl);
        }).catch(function(err) {
            loader.hidden = true;
            alert('Не удалось сжать PDF: ' + err.message);
        });
    }

    $('save').addEventListener('click', function(e) {
        if (autoClick) { autoClick = false; return; } // программный клик из download()
        e.preventDefault();
        openPicker();
    });

    sizeButtons.forEach(function(b) {
        b.addEventListener('click', function() { saveWithLimit(b.getAttribute('data-mb')); });
    });
    $('picker-cancel').addEventListener('click', closePicker);
    picker.addEventListener('click', function(e) { if (e.target === picker) closePicker(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && !picker.hidden) closePicker(); });

    // Последний выбранный предел запоминаем (и подсвечиваем в окне)
    try {
        var savedMb = localStorage.getItem('passportPdfMaxMb');
        if (savedMb && sizeButtons.some(function(b) { return b.getAttribute('data-mb') === savedMb; })) {
            maxBytes = limitOf(savedMb);
            markLimit(savedMb);
        }
    } catch (e) { /* localStorage недоступен */ }

    render();
})();
