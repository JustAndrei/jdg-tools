// Страница делится на две части:
//   checklist-data.js — только содержание (CHECKLIST, DIFFICULTY, POPUPS; формат описан в начале файла);
//   этот скрипт — превращает данные в таблицу и модальные окна.
// Обе таблицы (full и updates) перерисовываются целиком при смене роли.

var ROLES = {
    g: {key: 'jdg', title: 'Владелец JDG'},
    s: {key: 'spouse', title: 'Супруг владельца JDG'},
    r: {key: 'child', title: 'Ребёнок владельца JDG'}
};
var WHO = {jdg: 'владельца JDG', spouse: 'супруга', child: 'ребёнка (детей)'};
var currentRole = 'g';

// состояние необязательных документов и «флагов» внутри окон: ключ -> включено ли
var flags = {};
// ключ -> массив ключей, которые выключаются, когда этот включают
var inverts = {};

/* ---------- разбор данных ---------- */

function parseAttrs(str) {
    var attrs = {};
    str.replace(/([\w-]+)(?:=("[^"]*"|[^\s>]+))?/g, function(all, name, value) {
        attrs[name] = value === undefined ? true : value.replace(/^"|"$/g, '');
        return all;
    });
    return attrs;
}

// "jdg,spouse=jdg,child=jdg+spouse?" -> {jdg: {owners: [], situational: false}, spouse: {owners: ['jdg'], ...}, ...}
function parseFor(str) {
    var res = {};
    $.each((str || '').split(','), function(i, token) {
        token = token.trim();
        if (!token) return;
        var situational = /\?$/.test(token);
        var parts = token.replace(/\?$/, '').split('=');
        res[parts[0]] = {owners: parts[1] ? parts[1].split('+') : [], situational: situational};
    });
    return res;
}

function isItem(entry) {
    return !entry.type;
}

// ключ чекбокса документа (null, если документ не необязательный)
function itemKey(item) {
    if (!item.optional) return null;
    return typeof item.optional == 'string' ? item.optional : item.id;
}

function eachHtml(fn) {
    $.each(POPUPS, function(key, html) { fn(html); });
    $.each(CHECKLIST, function(i, entry) {
        if (!isItem(entry)) return;
        if (entry.description) fn(entry.description);
        $.each(entry.popups || {}, function(key, html) { fn(html); });
    });
}

// "a" + "b,c" -> группа a, b, c: включение любого выключает остальных
function addInverts(key, list) {
    var group = [key];
    $.each(String(list).split(','), function(i, id) {
        id = $.trim(id);
        if (id) group.push(id);
    });
    $.each(group, function(i, a) {
        inverts[a] = inverts[a] || [];
        $.each(group, function(j, b) {
            if (a != b && $.inArray(b, inverts[a]) < 0) inverts[a].push(b);
        });
    });
}

function initData() {
    $.each(CHECKLIST, function(i, entry) {
        if (!isItem(entry)) return;
        entry._for = parseFor(entry['for']);
        var key = itemKey(entry);
        if (!key) return;
        if (!(key in flags)) flags[key] = entry.checked !== false;
        if (entry.inverts) addInverts(key, entry.inverts);
    });
    // флаги, у которых нет своей строки (например, «в моём воеводстве нужны копии всех страниц»)
    eachHtml(function(html) {
        html.replace(/<checkbox\b([^>]*)>/g, function(all, str) {
            var attrs = parseAttrs(str);
            if (!attrs.name) return all;
            if (!(attrs.name in flags)) flags[attrs.name] = 'checked' in attrs;
            if (attrs.inverts) addInverts(attrs.name, attrs.inverts);
            return all;
        });
    });
}

/* ---------- разметка из данных -> html ---------- */

function checkboxHtml(attrs, ctx) {
    var key = attrs.name || ctx.key;
    var id = 'ch-' + key + '-comment';
    return '<input class="optional-check-in-comment" id="' + id + '" name="ch-' + key + '" data-key="' + key
        + '" type="checkbox"' + (flags[key] ? ' checked="checked"' : '') + ' /><label for="' + id + '">';
}

function conditionHolds(attrs, ctx) {
    if (attrs.list && attrs.list != ctx.list) return false;
    return true;
}

// раскрывает <link>, <checkbox>, <for>, <if> (формат описан в начале checklist-data.js)
function expand(html, ctx) {
    var out = '', stack = [], skip = 0, last = 0, m;
    var re = /<(\/?)(link|if|for|checkbox)\b([^>]*)>/g;
    while ((m = re.exec(html)) !== null) {
        if (!skip) out += html.slice(last, m.index);
        last = re.lastIndex;
        var closing = m[1] == '/', name = m[2];
        if (name == 'checkbox') {
            if (!skip) out += closing ? '</label>' : checkboxHtml(parseAttrs(m[3]), ctx);
            continue;
        }
        if (closing) {
            var top = stack.pop();
            if (top.skipped) skip--; else out += top.close;
            continue;
        }
        if (skip) {
            stack.push({skipped: true});
            skip++;
            continue;
        }
        var attrs = parseAttrs(m[3]), entry = {skipped: false, close: ''};
        if (name == 'link') {
            out += '<a rel="modal:open" href="#c-' + (attrs.to == 'description' ? ctx.id : attrs.to) + '">';
            entry.close = '</a>';
        }
        else if (name == 'for') {
            entry.skipped = $.inArray(ctx.role, String(attrs.role).split(',')) < 0;
        }
        else if (attrs.checked) {
            // зависит от чекбокса: переключается в applyFlags без перерисовки таблицы
            out += '<span class="check-specific" data-key="' + attrs.checked + '">';
            entry.close = '</span>';
        }
        else {
            entry.skipped = !conditionHolds(attrs, ctx);
        }
        stack.push(entry);
        if (entry.skipped) skip++;
    }
    if (!skip) out += html.slice(last);
    return out;
}

/* ---------- модальные окна (строятся один раз) ---------- */

function buildPopups() {
    var html = '';
    function add(id, body, ctx) {
        html += '<div class="modal" id="c-' + id + '">' + expand(body, ctx) + '</div>\n';
    }
    $.each(DIFFICULTY, function(key, d) { add('diff-' + key, d.text, {}); });
    $.each(POPUPS, function(key, body) { add(key, body, {}); });
    $.each(CHECKLIST, function(i, entry) {
        if (!isItem(entry)) return;
        var ctx = {id: entry.id, key: itemKey(entry)};
        if (entry.description) add(entry.id, entry.description, ctx);
        $.each(entry.popups || {}, function(key, body) { add(key, body, ctx); });
    });
    $('#comments').html(html);
}

/* ---------- таблица ---------- */

function setRole(role) {
    if (!ROLES[role]) {
        role = 'g';
    }
    currentRole = role;
    $('body').attr('data-role', role);
    $('.role-btn').removeClass('active').filter('[data-role="' + role + '"]').addClass('active');
    $('.role-title').text(ROLES[role].title);
    render();
}

function inList(entry, listType) {
    return $.inArray(listType, (entry.lists || 'full').split(',')) >= 0;
}

function entryKind(entry) {
    if (entry.type == 'ad') return 'neutral';
    if (entry.type == 'group' || entry.type == 'subgroup') return entry.text ? 'text' : entry.type;
    return 'content';
}

function roleVisible(item, ctx) {
    return ctx.role in item._for;
}

function roleNoteHtml(item, ctx) {
    if (item.autoNote === false) {
        return '';
    }
    var cell = item._for[ctx.role];
    var others = [], parts = [];
    $.each(cell.owners, function(i, owner) {
        if (owner == ctx.role || $.inArray(owner, others) >= 0) return;
        others.push(owner);
    });
    if (others.length) {
        var names = $.map(others, function(owner) { return WHO[owner]; });
        parts.push('<a rel="modal:open" href="#c-role-note">на имя</a>: ' + names.join(' и '));
    }
    if (cell.situational) {
        parts.push('по ситуации');
    }
    return parts.length ? ' <span class="role-note">(' + parts.join('; ') + ')</span>' : '';
}

function rowHtml(entry, kind, ctx) {
    if (kind == 'neutral') {
        return '<tr class="group neutral"><td class="non-printable ad" colspan="5">' + entry.html + '</td></tr>';
    }
    if (kind != 'content') {
        return '<tr class="' + entry.type + '"><th></th><th colspan="4">' + expand(entry.title, ctx) + '</th></tr>';
    }
    var key = itemKey(entry);
    var diff = DIFFICULTY[entry.difficulty];
    var html = '<tr data-id="' + entry.id + '"' + (key ? ' data-key="' + key + '"' : '') + '>';
    html += '<th>' + (key ? '<input class="optional-check" name="ch-' + key + '" data-key="' + key + '" type="checkbox" />' : '') + '</th>';
    html += '<td class="diff-cell"><a class="diff-square diff-' + diff.color + '" rel="modal:open" href="#c-diff-' + entry.difficulty + '"></a></td>';
    html += '<th>' + expand(entry.title, {id: entry.id, key: key, role: ctx.role, list: ctx.list}) + roleNoteHtml(entry, ctx) + '</th>';
    html += '<td></td><td></td></tr>';
    return html;
}

function fixColspans() {
    $('table.checklist').each(function() {
        var $t = $(this);
        // число реально видимых колонок зависит от ширины экрана
        var n = $t.find('tr.head-row > td').filter(function() {
            return $(this).css('display') != 'none';
        }).length;
        $t.find('tr.group > th:nth-child(2), tr.subgroup > th:nth-child(2)').attr('colspan', n + 1);
        $t.find('td.ad').attr('colspan', n + 2);
    });
}

// чекбоксы, зачёркивание строк и тексты, зависящие от чекбоксов
function applyFlags() {
    $('input.optional-check, input.optional-check-in-comment').each(function() {
        this.checked = !!flags[$(this).attr('data-key')];
    });
    $('table.checklist tr[data-key]').each(function() {
        $(this).toggleClass('non-printable', !flags[$(this).attr('data-key')]);
    });
    $('span.check-specific').each(function() {
        $(this).toggle(!!flags[$(this).attr('data-key')]);
    });
}

function setFlag(key, value) {
    flags[key] = value;
    var others = inverts[key] || [];
    if (value) {
        $.each(others, function(i, id) { flags[id] = false; });
    }
    else if (others.length == 1) {
        flags[others[0]] = true;   // пара: поведение как раньше
    }
    applyFlags();
}

function render() {
    $('table.checklist').each(function() {
        renderTable($(this), $(this).attr('data-list'));
    });
    applyFlags();
    fixColspans();
}

function renderTable($table, listType) {
    var ctx = {
        role: ROLES[currentRole].key,
        list: listType
    };

    // 1. видимость по типу списка и роли
    var info = [];
    $.each(CHECKLIST, function(i, entry) {
        var kind = entryKind(entry);
        var vis = inList(entry, listType);
        if (vis && kind == 'content') {
            vis = roleVisible(entry, ctx);
        }
        info.push({entry: entry, kind: kind, vis: vis, show: vis});
    });

    // 2. группируем по reason: порядок групп = порядок ключей REASONS,
    //    внутри группы порядок строк как в CHECKLIST
    var groups = {}, tail = [], caption = null;
    function bucket(reason) {
        var key = reason in REASONS ? reason : '';
        return groups[key] || (groups[key] = {items: [], texts: []});
    }
    $.each(info, function(i, it) {
        if (!it.vis) return;
        if (it.kind == 'content') {
            bucket(it.entry.reason).items.push({entry: it.entry, caption: caption});
        }
        else if (it.kind == 'subgroup' && it.entry.lists == 'updates') {
            // подпись «когда донести» (только для списка updates):
            // относится ко всем следующим документам, пока не встретится другая
            caption = it;
        }
        else if (it.kind == 'group') {
            caption = null;
        }
        else if (it.kind == 'text' && it.entry.reason) {
            bucket(it.entry.reason).texts.push(it);
        }
        else if (it.kind == 'text' || it.kind == 'neutral') {
            tail.push(it);
        }
        // остальные group/subgroup — старая группировка, вместо неё названия из REASONS
    });

    // 3. рисуем
    var html = '';
    function groupHtml(key) {
        var g = groups[key];
        if (!g) return;
        if (key) html += rowHtml({type: 'group', title: REASONS[key]}, 'group', ctx);
        $.each(g.texts, function(i, it) { html += rowHtml(it.entry, it.kind, ctx); });
        var shown = null;
        $.each(g.items, function(i, item) {
            if (item.caption && item.caption !== shown) {
                html += rowHtml(item.caption.entry, 'subgroup', ctx);
                shown = item.caption;
            }
            html += rowHtml(item.entry, 'content', ctx);
        });
    }
    $.each(REASONS, function(key) { groupHtml(key); });
    groupHtml('');   // документы без известного reason
    $.each(tail, function(i, it) { html += rowHtml(it.entry, it.kind, ctx); });
    $table.find('tr').not('.head-row').remove();
    $table.children('tbody').append(html);
    // если для этой роли в списке нет ни одной строки, страницу не показываем и не печатаем
    $table.closest('.page').toggle(html != '');
}

/* ---------- адресная строка и модальные окна ---------- */

function removeHash() {
    history.pushState("", document.title, window.location.pathname + window.location.search);
}

function configModal() {
    $(document).on('click', 'a[rel="modal:open"]', function() {
        window.location.hash = $(this).attr('href');
        $(document).on('keydown', function(event) {
            if (event.which === 27) {
                removeHash();
                $(document).off('keydown');
            }
        });
    });

    var nativeClose = $.modal.close;
    $.modal.close = function() {
        removeHash();
        nativeClose();
    }

    $(document).on('click.modal', 'a[rel~="modal:close"]', function() {
        removeHash();
    });
}

// ссылка вида page.html#c-translation открывает окно сразу, даже если строки со ссылкой сейчас нет на экране
function openModalFromHash() {
    var id = window.location.hash.slice(1);
    var el = id ? document.getElementById(id) : null;
    if (el && $(el).hasClass('modal')) {
        $(el).modal();
    }
}

/* ---------- сохранение состояния ---------- */

function getState() {
    var state = {};
    $('input.persisted').each(function(i, c) {
        state[c.name] = $(c).val();
    });
    $.each(flags, function(key, value) {
        state['ch-' + key] = value;
    });
    state.role = currentRole;
    return JSON.stringify(state);
}

// только записывает значения; перерисовку делает вызывающий код
function setState(json) {
    var state = JSON.parse(json);
    if (state.role && ROLES[state.role]) {
        currentRole = state.role;
    }
    $('input.persisted').each(function(i, c) {
        if (c.name in state) {
            $(c).val(state[c.name]);
        }
    });
    $.each(flags, function(key) {
        if (('ch-' + key) in state) {
            flags[key] = !!state['ch-' + key];
        }
    });
}

function saveState() {
    if (typeof(Storage) !== "undefined") {
        localStorage.setItem('state', getState());
    }
}

function restoreState() {
    if (typeof(Storage) !== "undefined") {
        var state = localStorage.getItem('state');
        if (state) {
            setState(state);
        }
    }
}

$(function() {
    initData();
    buildPopups();
    configModal();

    $('.print-button').click(function() {
        window.print();
    });

    $('.role-btn').on('click', function() {
        setRole($(this).attr('data-role'));
        saveState();
    });

    $(window).on('resize', fixColspans);

    // чекбокс в таблице и такой же чекбокс в окне — одно и то же состояние
    $(document).on('change', 'input.optional-check, input.optional-check-in-comment', function() {
        setFlag($(this).attr('data-key'), this.checked);
        saveState();
    });

    restoreState();
    setRole(currentRole);
    saveState();

    // старая ссылка page.html#updates ведёт к странице актуализации
    if (window.location.hash == '#updates') {
        removeHash();
        var upd = document.getElementById('page-updates');
        if (upd) upd.scrollIntoView();
    }
    openModalFromHash();
});