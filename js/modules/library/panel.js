(function () {
  'use strict';
  if (window.XinyangLibraryPanel) return;
  var root = document.getElementById('library-app');
  var store = null, initialized = false, popup = null, dialog = null, lastFocus = null;
  var preferences = window.XinyangLibraryPreferences ? window.XinyangLibraryPreferences.create() : null;
  var keys = { active: 'longStitch.libraryActive.v1', recent: 'longStitch.libraryRecent.v1', zoom: 'longStitch.libraryZoom.v1', sort: 'longStitch.librarySort.v1', direction: 'longStitch.librarySortDirection.v1', showName: 'longStitch.libraryShowName.v1', showSize: 'longStitch.libraryShowSize.v1', view: 'longStitch.libraryView.v1:' };
  var savedSort = read(keys.sort, 'time');
  var state = { data: null, dataRevision: 0, failedRoot: '', folder: '__all', search: '', searchOpen: false, tags: [], ratings: [], dates: [], dateFrom: '', dateTo: '', sort: /^(name|rating)$/.test(savedSort) ? savedSort : 'time', direction: read(keys.direction, savedSort === 'oldest' || savedSort === 'name' ? 'asc' : 'desc') === 'asc' ? 'asc' : 'desc', showName: read(keys.showName, '1') !== '0', showSize: read(keys.showSize, '1') !== '0', zoom: Math.max(75, Math.min(230, Number(read(keys.zoom, '112')) || 112)), selected: '', busy: false, limit: 200, status: '', error: false, lastAppliedId: '', lastAppliedAt: 0 };
  var refs = {};
  var layoutTimer = 0;
  var paths = {
    folder: 'M2 6h6l2-2h11v15H2z M2 8h19', search: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M15 15l6 6',
    filter: 'M3 4h18l-7 8v7l-4-2v-5z', settings: 'M4 5h16 M4 12h16 M4 19h16 M8 3v4 M16 10v4 M10 17v4',
    chevron: 'M7 9l5 5 5-5', back: 'M14 6l-6 6 6 6', plus: 'M12 4v16 M4 12h16',
    document: 'M16 20H5V3h11l4 4v8 M15 3v5h5 M16 18h6 M19 15v6',
    layers: 'M4 16H2V2h14v2 M6 6h14v14H6z M17 17h6 M20 14v7',
    sort: 'M4 4v16 M1 17l3 3 3-3 M10 5h11 M10 11h8 M10 17h5',
    refresh: 'M20 8a8 8 0 1 0 0 8 M20 3v5h-5', check: 'M4 12l5 5L20 6',
    tag: 'M3 3h8l10 10-8 8L3 11z M7 7h.1', import: 'M12 2v12 M7 9l5 5 5-5 M4 14v7h16v-7',
    trash: 'M3 6h18 M5 6l1 15h12l1-15 M8 6V3h8v3 M10 10v7 M14 10v7', close: 'M5 5l14 14 M19 5L5 19',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', top: 'M5 4h14 M6 13l6-6 6 6 M12 7v14'
  };

  function read(key, fallback) { if (preferences) return preferences.get(key, fallback); try { return window.localStorage.getItem(key) || fallback; } catch (ignoreStorage) { return fallback; } }
  function write(key, value) { if (preferences) return preferences.set(key, value); try { window.localStorage.setItem(key, value); } catch (ignoreStorage) {} }
  function restoreLastLibrary() {
    if (state.data || state.busy) return;
    var active = read(keys.active, '') || recentLibraries()[0];
    if (active) return run('读取上次素材库', function () { return loadLibrary(active); });
  }
  function el(tag, className, text) { var n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
  function icon(name) { var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', paths[name] || paths.folder); svg.appendChild(p); return svg; }
  function button(label, className, action, iconName) { var n = el('button', className); n.type = 'button'; n.setAttribute('aria-label', label); n.title = label; if (iconName) n.appendChild(icon(iconName)); else n.textContent = label; if (action) n.addEventListener('click', function (event) { if (state.busy && !n.dataset.allowBusy) { event.preventDefault(); event.stopPropagation(); return; } action(event); }); return n; }
  function getStore() { if (!store) { if (!window.XinyangLibraryStore) throw new Error('素材库模块尚未加载，请重新打开面板'); store = window.XinyangLibraryStore.create(); } return store; }
  function host(method, payload) { if (!window.XinyangRuntime || !window.XinyangRuntime.hostInvoke) return Promise.reject(new Error('请在 Photoshop 中使用此功能')); return window.XinyangRuntime.hostInvoke(method, payload || {}); }
  function libraryRoot() { if (!state.data) throw new Error('请先打开或新建素材库'); return state.data.root; }
  function notify(message, error, warning) { state.status = message || ''; state.error = !!error; if (!refs.status) return; refs.status.textContent = state.status; refs.status.hidden = !message; refs.status.className = 'lib-status' + (error ? ' is-error' : warning ? ' is-warning' : ''); updateFloatingActions(); }
  function acceptData(data) { if (data && data.root && Array.isArray(data.files)) { var sameLibrary = state.data && state.data.root === data.root; state.data = data; state.dataRevision += 1; if (sameLibrary) reconcileView(); } return data; }
  function setBusy(value) {
    state.busy = value; root.setAttribute('aria-busy', String(value));
    Array.prototype.forEach.call(root.querySelectorAll('button,input,select'), function (control) {
      if (control.dataset.allowBusy) return;
      if (value) { control._libraryWasDisabled = control.disabled; control.disabled = true; }
      else if (Object.prototype.hasOwnProperty.call(control, '_libraryWasDisabled')) { control.disabled = control._libraryWasDisabled; delete control._libraryWasDisabled; }
    });
  }
  function run(label, action) {
    if (state.busy) return Promise.resolve({ ok: false, error: new Error('请等待当前操作完成') });
    closePopup(); var actionFocus = document.activeElement; setBusy(true); notify(label + '…');
    // Let CEP paint the waiting state before synchronous filesystem work starts.
    // A timeout also permits work to continue when the panel is not visible.
    var painted = new Promise(function (resolve) { var fallback = window.setTimeout(resolve, 60); if (window.requestAnimationFrame) window.requestAnimationFrame(function () { window.setTimeout(function () { window.clearTimeout(fallback); resolve(); }, 0); }); });
    return painted.then(action).then(function (value) {
      acceptData(value); if (state.status === label + '…') notify(value && value.canceled ? '' : label + '完成');
      return { ok: true, value: value };
    }).catch(function (error) {
      var message = error.message || String(error);
      if (state.data && /其他程序修改|素材不存在，请刷新/.test(message)) {
        try { acceptData(getStore().load(state.data.root)); message += ' 列表已刷新，请检查后重试。'; } catch (ignoreRefresh) {}
      }
      notify(message, true); return { ok: false, error: error };
    }).then(function (outcome) {
      setBusy(false);
      try { render(); } catch (error) { notify('列表显示失败，请刷新素材库：' + (error.message || String(error)), true); }
      if (document.activeElement === document.body || document.activeElement === root) focusNode(actionFocus);
      return outcome;
    });
  }
  function recentLibraries() { try { var list = JSON.parse(read(keys.recent, '[]')); return Array.isArray(list) ? list.filter(function (x) { return typeof x === 'string'; }).slice(0, 10) : []; } catch (ignoreRecent) { return []; } }
  function baseName(path) { return String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop(); }
  function loadLibrary(path) {
    var data; try { data = getStore().load(path); } catch (error) { state.failedRoot = path; throw error; } state.failedRoot = ''; acceptData(data); state.selected = ''; state.limit = 200; restoreView(); state.search = ''; if (refs.search) refs.search.value = ''; if (refs.scroll) refs.scroll.scrollTop = 0;
    write(keys.active, data.root); write(keys.recent, JSON.stringify([data.root].concat(recentLibraries().filter(function (p) { return p.toLowerCase() !== data.root.toLowerCase(); })).slice(0, 10)));
    notify(data.warnings && data.warnings.length ? data.warnings.join('；') : '', false, true); return data;
  }
  function chooseLibrary() { return run('打开素材库', function () { return host('toolsLibraryChooseFolder', { title: '选择 .Library 素材库文件夹', path: state.data ? state.data.root : '' }).then(function (result) { if (result.canceled) return result; return loadLibrary(result.path); }); }); }
  function fileUrl(path) { if (!path) return ''; var value = String(path).replace(/\\/g, '/'); return (/^\//.test(value) ? 'file://' : 'file:///') + value.split('/').map(function (part, index) { return index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part); }).join('/'); }
  function itemPaths(item, recycled) { return getStore().assetPaths(libraryRoot(), item, recycled === undefined ? state.folder === '__recycle' : recycled); }
  function sourcePaths(item) { var result = itemPaths(item); if (result.sourceExists === false) throw new Error('源文件缺失，请恢复原目录中的源文件后刷新素材库。预览图和素材信息仍可查看。'); return result; }
  function reveal(path) {
    return host('toolsLibraryReveal', { path: path });
  }
  function folders() { return state.data && Array.isArray(state.data.folders) ? state.data.folders : []; }
  function folderName(id) { if (id === '__all') return '全部素材'; if (id === '__unassigned') return '未分类'; if (id === '__recycle') return '回收站'; var folder = folders().filter(function (x) { return String(x.id) === String(id); })[0]; return folder ? folder.name : '全部素材'; }
  function currentFolder() { return state.folder.slice(0, 2) === '__' ? '' : state.folder; }
  function assetFolders(item) { return Array.isArray(item.folder) ? item.folder.map(String) : item.folder ? [String(item.folder)] : []; }
  function allTags() { var tags = Object.create(null); if (state.data) { (state.data.tags || []).forEach(function (tag) { var name = typeof tag === 'string' ? tag : tag && tag.name; if (name) tags[name] = true; }); (state.data.files || []).forEach(function (item) { (item.tags || []).forEach(function (tag) { if (typeof tag === 'string') tags[tag] = true; }); }); } return Object.keys(tags).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); }); }
  function folderTree() {
    var list = folders(), result = [], used = {};
    function add(parent, depth) { list.forEach(function (folder) { var pid = String(folder.pid || '0'); if (!used[folder.id] && pid === String(parent)) { used[folder.id] = true; result.push({ folder: folder, depth: Math.min(depth, 8) }); add(folder.id, depth + 1); } }); }
    add('0', 0); list.forEach(function (folder) { if (!used[folder.id]) { used[folder.id] = true; result.push({ folder: folder, depth: 0 }); add(folder.id, 1); } }); return result;
  }
  function parseLocalDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return NaN;
    var result = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return result.getFullYear() === Number(match[1]) && result.getMonth() === Number(match[2]) - 1 && result.getDate() === Number(match[3]) ? result.getTime() : NaN;
  }
  function assetTime(value) {
    var text = String(value == null ? '' : value).trim(), native = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/.exec(text);
    if (native) {
      var year = Number(native[1]), month = Number(native[2]) - 1, day = Number(native[3]), hour = Number(native[4] || 0), minute = Number(native[5] || 0), second = Number(native[6] || 0);
      var date = new Date(year, month, day, hour, minute, second);
      return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second ? date.getTime() : NaN;
    }
    if (/^\d{10}$/.test(text)) return Number(text) * 1000;
    if (/^\d{13}$/.test(text)) return Number(text);
    var iso = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
    if (!iso || !isFinite(parseLocalDate(iso[1])) || Number(iso[2] || 0) > 23 || Number(iso[3] || 0) > 59 || Number(iso[4] || 0) > 59) return NaN;
    return iso[2] ? Date.parse(text) : parseLocalDate(iso[1]);
  }
  function localDayOffset(day, amount) { return new Date(day.getFullYear(), day.getMonth(), day.getDate() + amount).getTime(); }
  function calendarMonthsAgo(day, months) {
    var first = new Date(day.getFullYear(), day.getMonth() - months, 1);
    return new Date(first.getFullYear(), first.getMonth(), Math.min(day.getDate(), new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate())).getTime();
  }
  function normalizeView(value, folderIds, tagNames) {
    value = value && typeof value === 'object' ? value : {};
    function unique(items, valid) { return (Array.isArray(items) ? items : []).filter(function (item, index, all) { return valid(item) && all.indexOf(item) === index; }); }
    var folder = typeof value.folder === 'string' ? value.folder : '__all';
    if (['__all', '__unassigned', '__recycle'].indexOf(folder) < 0 && folderIds.indexOf(folder) < 0) folder = '__all';
    var from = typeof value.from === 'string' && isFinite(parseLocalDate(value.from)) ? value.from : '';
    var to = typeof value.to === 'string' && isFinite(parseLocalDate(value.to)) ? value.to : '';
    if (from && to && parseLocalDate(from) > parseLocalDate(to)) { from = ''; to = ''; }
    return {
      folder: folder,
      tags: unique(value.tags, function (tag) { return typeof tag === 'string' && tagNames.indexOf(tag) >= 0; }),
      ratings: unique(value.ratings, function (rating) { return typeof rating === 'number' && [1, 2, 3, 4, 5].indexOf(rating) >= 0; }),
      dates: from || to ? [] : unique(value.dates, function (date) { return ['yesterday', '7days', '3months', 'year', 'older'].indexOf(date) >= 0; }),
      from: from, to: to
    };
  }
  function viewKey() { return keys.view + String(state.data.root).replace(/\\/g, '/').toLowerCase(); }
  function currentView() { return { folder: state.folder, tags: state.tags, ratings: state.ratings, dates: state.dates, from: state.dateFrom, to: state.dateTo }; }
  function applyView(value) {
    var view = normalizeView(value, folders().map(function (folder) { return String(folder.id); }), allTags());
    state.folder = view.folder; state.tags = view.tags; state.ratings = view.ratings; state.dates = view.dates; state.dateFrom = view.from; state.dateTo = view.to;
  }
  function restoreView() { var view = {}; try { view = JSON.parse(read(viewKey(), '{}')); } catch (ignoreView) {} applyView(view); }
  function saveView() { if (state.data) write(viewKey(), JSON.stringify(currentView())); }
  function reconcileView() {
    applyView(currentView());
    var items = state.folder === '__recycle' ? state.data.recycle || [] : state.data.files;
    if (state.selected && !items.some(function (item) { return String(item.id) === state.selected; })) state.selected = '';
  }
  function hasFilters() { return state.ratings.length || state.tags.length || state.dates.length || state.dateFrom || state.dateTo; }
  function clearFilters(clearSearch) { state.ratings = []; state.tags = []; state.dates = []; state.dateFrom = ''; state.dateTo = ''; if (clearSearch) { state.search = ''; refs.search.value = ''; } state.limit = 200; refs.scroll.scrollTop = 0; render(); }
  function dateMatches(item, now) {
    if (!state.dates.length && !state.dateFrom && !state.dateTo) return true;
    var time = assetTime(item.time), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!isFinite(time) || time > now.getTime()) return false;
    var from = state.dateFrom ? parseLocalDate(state.dateFrom) : -Infinity;
    var toDay = state.dateTo ? parseLocalDate(state.dateTo) : Infinity;
    var to = isFinite(toDay) ? localDayOffset(new Date(toDay), 1) : Infinity;
    if (time < from || time >= to) return false;
    if (!state.dates.length) return true;
    return state.dates.some(function (key) {
      if (key === 'yesterday') return time >= localDayOffset(today, -1) && time < today.getTime();
      if (key === '7days') return time >= localDayOffset(today, -6);
      if (key === '3months') return time >= calendarMonthsAgo(today, 3);
      if (key === 'year') return time >= calendarMonthsAgo(today, 12);
      if (key === 'older') return time < calendarMonthsAgo(today, 12);
      return false;
    });
  }
  function filteredItems() {
    if (!state.data) return [];
    var search = state.search.trim().toLowerCase(), now = new Date();
    return (state.folder === '__recycle' ? state.data.recycle || [] : state.data.files).filter(function (item) {
      var itemFolders = assetFolders(item), tags = item.tags || [];
      if (!search && state.folder === '__unassigned' && itemFolders.length) return false;
      if (!search && currentFolder() && itemFolders.indexOf(String(state.folder)) < 0) return false;
      if (state.ratings.length && state.ratings.indexOf(Number(item.star || 0)) < 0) return false;
      if (state.tags.length && !state.tags.some(function (tag) { return tags.indexOf(tag) >= 0; })) return false;
      if (!dateMatches(item, now)) return false;
      return !search || [item.name, tags.join(' '), item.note || ''].join(' ').toLowerCase().indexOf(search) >= 0;
    }).slice().sort(function (a, b) {
      var compared = 0, direction = state.direction === 'asc' ? 1 : -1;
      if (state.sort === 'name') compared = String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN', { numeric: true });
      else if (state.sort === 'rating') compared = Number(a.star || 0) - Number(b.star || 0);
      else { var at = assetTime(a.time), bt = assetTime(b.time); if (!isFinite(at) || !isFinite(bt)) return isFinite(at) ? -1 : isFinite(bt) ? 1 : 0; compared = at - bt; }
      return direction * compared;
    });
  }
  function resizeGrid() {
    if (!refs.grid || !refs.cards) return;
    var width = refs.scroll.clientWidth - 14;
    if (width <= 0) return;
    var count = Math.max(1, Math.floor((width + 6) / (state.zoom + 6)));
    var columnWidth = (width - (count - 1) * 6) / count;
    if (refs.layoutWidth === width && refs.layoutColumns === count && refs.layoutCards === refs.cards) return;
    var columns = [], heights = [], fragment = document.createDocumentFragment();
    for (var i = 0; i < count; i += 1) {
      var column = el('div', 'lib-masonry-column');
      column.setAttribute('role', 'presentation');
      columns.push(column); heights.push(0); fragment.appendChild(column);
    }
    // Place each sorted asset in the shortest column; move its existing node so
    // viewport/zoom changes retain image resources and attached event handlers.
    refs.cards.forEach(function (card) {
      var item = card._libraryItem, shortest = 0;
      for (var index = 1; index < count; index += 1) if (heights[index] < heights[shortest]) shortest = index;
      var imageHeight = !card._previewMissing && item && Number(item.width) > 0 && Number(item.height) > 0
        ? Math.max(36, Math.min(320, (columnWidth - 2) * Number(item.height) / Number(item.width))) : 84;
      columns[shortest].appendChild(card);
      var captionHeight = state.showName || state.showSize ? 9 + (state.showName ? 17 : 0) + (state.showSize ? 16 : 0) : 0;
      heights[shortest] += imageHeight + captionHeight + 8;
    });
    refs.grid.textContent = ''; refs.grid.appendChild(fragment);
    refs.layoutWidth = width; refs.layoutColumns = count; refs.layoutCards = refs.cards;
  }
  function scheduleLayout() { if (layoutTimer) return; layoutTimer = window.setTimeout(function () { layoutTimer = 0; refs.layoutCards = null; resizeGrid(); }, 16); }
  function focusNode(node) {
    if (!node) return;
    if (!document.documentElement.contains(node)) {
      var previous = node.closest && node.closest('.lib-card'), menu = node.classList && node.classList.contains('lib-card-menu');
      var replacement = previous && (refs.cards || []).filter(function (card) { return card.dataset.id === previous.dataset.id; })[0];
      node = replacement ? menu ? replacement.querySelector('.lib-card-menu') : replacement : state.searchOpen ? refs.search : refs.folder;
    }
    if (!node || node.disabled || !node.getClientRects().length) return;
    try { node.focus({ preventScroll: true }); } catch (ignoreFocusOptions) { node.focus(); }
  }
  function selectItem(item, card) { state.selected = String(item.id); Array.prototype.forEach.call(refs.grid.querySelectorAll('.lib-card'), function (node) { var selected = node === card; node.classList.toggle('is-selected', selected); node.setAttribute('aria-selected', String(selected)); }); }
  function activateCard(item, event) {
    if (state.folder === '__recycle' || state.busy || (event && (event.detail > 1 || event.repeat))) return;
    var now = Date.now();
    if (state.lastAppliedId === String(item.id) && now - state.lastAppliedAt < 550) return;
    state.lastAppliedId = String(item.id); state.lastAppliedAt = now; openAsset(item, 'apply');
  }
  function renderCard(item) {
    var card = el('div', 'lib-card' + (String(item.id) === state.selected ? ' is-selected' : '')); card._libraryItem = item; card.tabIndex = 0; card.setAttribute('role', 'option'); card.setAttribute('aria-selected', String(String(item.id) === state.selected)); card.setAttribute('aria-label', (item.name || '未命名') + '，点击应用素材，右键更多操作'); card.dataset.id = String(item.id);
    var preview = el('div', 'lib-preview'), img = el('img'); img.alt = ''; img.loading = 'lazy'; img.draggable = false;
    function missingPreview(error) {
      card._previewMissing = true; preview.textContent = ''; preview.classList.add('is-missing');
      preview.appendChild(el('span', 'lib-missing-format', String(item.ext || 'PSD').toUpperCase()));
      preview.appendChild(el('span', 'lib-missing-title', error ? '素材路径不可用' : '暂无预览'));
      preview.appendChild(el('span', 'lib-missing-hint', error ? '可刷新素材库后重试' : card._sourceMissing ? '请恢复源文件后刷新' : '右键可更新缩略图'));
      preview.title = error ? error.message || String(error) : card._sourceMissing ? '请恢复原目录中的源文件后刷新素材库' : '源素材仍可使用；右键选择“更新缩略图”生成预览';
      if (document.documentElement.contains(card)) scheduleLayout();
    }
    try { var path = itemPaths(item); card._sourceMissing = path.sourceExists === false; if (path.preview && path.previewExists !== false) { img.onerror = function () { missingPreview(); }; img.src = fileUrl(path.preview) + '?v=' + encodeURIComponent(String(item._previewVersion || item.time || '1')); preview.appendChild(img); } else missingPreview(); } catch (error) { card._pathError = true; missingPreview(error); }
    card.appendChild(preview); var caption = el('div', 'lib-card-caption'), nameNode = el('span', 'lib-card-name', item.name || '未命名'), sizeNode = el('span', 'lib-card-size', item.width && item.height ? item.width + '×' + item.height : String(item.ext || 'PSD').toUpperCase()); nameNode.hidden = !state.showName; sizeNode.hidden = !state.showSize; caption.hidden = !state.showName && !state.showSize; caption.appendChild(nameNode); caption.appendChild(sizeNode); card.appendChild(caption);
    if (Number(item.star)) card.appendChild(el('span', 'lib-card-star', '★ ' + item.star));
    if (card._sourceMissing) { var warning = el('span', 'lib-source-warning', '源文件缺失'); warning.title = '预览图仍可查看；请恢复原目录中的源文件后刷新素材库'; card.appendChild(warning); card.setAttribute('aria-label', (item.name || '未命名') + '，源文件缺失，右键可管理素材信息'); }
    var menuButton = button('素材操作', 'lib-card-menu', function (event) { event.stopPropagation(); selectItem(item, card); showAssetMenu(item, menuButton); }); menuButton.textContent = '•••'; card.appendChild(menuButton);
    card.addEventListener('click', function (event) { if (state.busy || (event.button && event.button !== 0)) return; selectItem(item, card); activateCard(item, event); });
    card.addEventListener('dblclick', function (event) { event.preventDefault(); });
    card.addEventListener('contextmenu', function (event) { event.preventDefault(); if (state.busy) return; selectItem(item, card); showAssetMenu(item, card, event); });
    card.addEventListener('keydown', function (event) { if (event.target !== card || state.busy) return; if (event.key === 'Enter') { event.preventDefault(); selectItem(item, card); activateCard(item, event); } if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); selectItem(item, card); showAssetMenu(item, card); } }); return card;
  }
  function render() {
    if (!initialized) return;
    var previousScroll = refs.scroll.scrollTop;
    var active = document.activeElement, focusedCard = refs.grid.contains(active) && active.closest ? active.closest('.lib-card') : null;
    var focusedId = focusedCard ? focusedCard.dataset.id : '', focusedMenu = focusedCard && active.classList.contains('lib-card-menu');
    var signature = JSON.stringify([state.dataRevision, state.folder, state.search, state.tags, state.ratings, state.dates, state.dateFrom, state.dateTo, state.sort, state.direction, state.showName, state.showSize, state.limit]);
    if (refs.renderSignature === signature) {
      (refs.cards || []).forEach(function (card) { var selected = card.dataset.id === state.selected; card.classList.toggle('is-selected', selected); card.setAttribute('aria-selected', String(selected)); });
      resizeGrid(); updateFloatingActions(); saveView(); return;
    }
    refs.folderTitle.textContent = folderName(state.folder); refs.folder.title = state.data ? state.data.name + ' · ' + state.data.root : '选择素材库';
    refs.cards = []; refs.grid.textContent = ''; refs.empty.textContent = ''; refs.empty.hidden = true; refs.more.hidden = true; refs.floating.hidden = !state.data;
    refs.filter.classList.toggle('is-active', !!hasFilters());
    var items = filteredItems(); refs.count.textContent = state.data ? '共 ' + items.length + ' 个项目' : '本地素材库'; refs.clear.hidden = !(hasFilters() || state.search); refs.clear.textContent = '清除筛选';
    refs.sortLabel.textContent = '排序';
    if (!state.data || !items.length) {
      refs.empty.hidden = false; refs.empty.appendChild(icon('folder')); refs.empty.appendChild(el('strong', '', !state.data ? '让常用素材触手可及' : state.folder === '__recycle' ? '回收站为空' : '暂无素材'));
      refs.empty.appendChild(el('p', '', !state.data ? '打开已有 .Library 素材库，或建立自己的模板收藏。' : state.search || hasFilters() ? '调整搜索词或筛选条件后重试。' : '从设置导入文件，或用右下角按钮收藏当前文档和选中图层。'));
      if (!state.data) { var actions = el('div', 'lib-empty-actions'); actions.appendChild(button('打开素材库', 'lib-primary', chooseLibrary)); actions.appendChild(button('新建素材库', 'lib-secondary', createLibrary)); refs.empty.appendChild(actions); }
    } else { refs.cards = items.slice(0, state.limit).map(renderCard); refs.more.hidden = items.length <= state.limit; refs.more.textContent = '继续加载（剩余 ' + Math.max(0, items.length - state.limit) + '）'; }
    resizeGrid(); refs.scroll.scrollTop = previousScroll; refs.renderSignature = signature; updateFloatingActions(); saveView();
    if (focusedId) { var restored = (refs.cards || []).filter(function (card) { return card.dataset.id === focusedId; })[0]; focusNode(restored ? focusedMenu ? restored.querySelector('.lib-card-menu') : restored : refs.folder); }
  }
  function closePopup(restoreFocus) {
    var target = popup && popup._returnFocus;
    if (popup) { if (popup._anchor && popup._anchor.tagName === 'BUTTON') popup._anchor.setAttribute('aria-expanded', 'false'); popup.remove(); }
    popup = null; if (restoreFocus) focusNode(target);
  }
  function positionPopup(menu, anchor, event) {
    var r = root.getBoundingClientRect(), a = anchor ? anchor.getBoundingClientRect() : null;
    var topDropdown = menu.classList.contains('lib-folder-popup') || menu.classList.contains('lib-filter-popup');
    var x = topDropdown ? 7 : event ? event.clientX - r.left : a ? a.left - r.left : 6;
    var y = topDropdown ? 44 : event ? event.clientY - r.top : a ? a.bottom - r.top + 4 : 42;
    menu.style.left = Math.max(6, Math.min(x, r.width - menu.offsetWidth - 6)) + 'px';
    menu.style.top = Math.max(6, Math.min(y, r.height - menu.offsetHeight - 6)) + 'px';
  }
  function newPopup(anchor, event, className) { closePopup(); popup = el('div', 'lib-popup ' + (className || '')); popup.setAttribute('role', 'menu'); root.appendChild(popup); popup._anchor = anchor; popup._returnFocus = anchor || document.activeElement; popup._event = event; if (anchor && anchor.tagName === 'BUTTON') anchor.setAttribute('aria-expanded', 'true'); return popup; }
  function finishPopup(menu) { positionPopup(menu, menu._anchor, menu._event); focusNode(menu.querySelector('button:not(:disabled)')); }
  function menuItem(menu, label, action, options) { options = options || {}; var b = button(label, 'lib-menu-item' + (options.active ? ' is-active' : '') + (options.danger ? ' is-danger' : ''), function () { if (state.busy) return; closePopup(true); action(); }); if (options.icon) { b.textContent = ''; b.appendChild(icon(options.icon)); b.appendChild(el('span', '', label)); } b.disabled = !!options.disabled; b.setAttribute('role', 'menuitem'); menu.appendChild(b); return b; }
  function separator(menu) { menu.appendChild(el('hr', 'lib-separator')); }
  function chooseFolderView(id) { state.folder = String(id); state.limit = 200; state.selected = ''; closePopup(true); refs.scroll.scrollTop = 0; render(); }
  function showFolders() {
    if (popup && popup._anchor === refs.folder) { closePopup(true); return; }
    if (!state.data) { chooseLibrary(); return; } var menu = newPopup(refs.folder, null, 'lib-folder-popup'); refs.folder.setAttribute('aria-expanded', 'true');
    var tabs = el('div', 'lib-folder-tabs'); [['__all', '全部'], ['__unassigned', '未分类'], ['__recycle', '回收站']].forEach(function (entry) { tabs.appendChild(button(entry[1], state.folder === entry[0] ? 'is-active' : '', function () { chooseFolderView(entry[0]); })); }); menu.appendChild(tabs);
    var heading = el('div', 'lib-folder-heading'); heading.appendChild(el('span', '', '根目录（' + folders().length + '）')); heading.appendChild(button('＋ 新建', '', newFolder)); menu.appendChild(heading);
    var counts = {}; (state.data.files || []).forEach(function (item) { assetFolders(item).forEach(function (id) { counts[id] = (counts[id] || 0) + 1; }); });
    folderTree().forEach(function (entry) { var f = entry.folder, row = button(f.name, 'lib-folder-row' + (String(f.id) === state.folder ? ' is-active' : ''), function () { chooseFolderView(f.id); }); row.textContent = ''; row.style.paddingLeft = (9 + entry.depth * 13) + 'px'; row.appendChild(icon('folder')); row.appendChild(el('span', 'lib-folder-name', f.name)); row.appendChild(el('span', 'lib-folder-number', String(counts[f.id] || 0))); menu.appendChild(row); }); finishPopup(menu);
  }
  function closeDialog(restoreFocus) { if (dialog) dialog.remove(); dialog = null; if (restoreFocus !== false) focusNode(lastFocus); }
  function createDialog(title, description) {
    var origin = popup ? popup._returnFocus : dialog ? lastFocus : document.activeElement;
    closePopup(); closeDialog(false); lastFocus = origin; var shade = el('div', 'lib-dialog-shade'), box = el('div', 'lib-dialog'); shade.appendChild(box); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title); box.appendChild(el('h3', '', title)); if (description) box.appendChild(el('p', '', description)); root.appendChild(shade); dialog = shade;
    shade.addEventListener('mousedown', function (event) { if (event.target === shade && !state.busy) closeDialog(); }); return box;
  }
  function form(title, fields, onSubmit, description, submitLabel) {
    var box = createDialog(title, description), controls = {}, formNode = el('form'); box.appendChild(formNode);
    fields.forEach(function (field) { var label = el('label', '', field.label), input = field.options ? el('select') : el('input'); input.id = 'library-field-' + field.name; label.htmlFor = input.id; if (field.options) field.options.forEach(function (option) { var n = el('option', '', option.label); n.value = option.value; input.appendChild(n); }); else { input.type = 'text'; input.placeholder = field.placeholder || ''; input.autocomplete = 'off'; } input.value = field.value || ''; if (field.required) input.required = true; controls[field.name] = input; formNode.appendChild(label); formNode.appendChild(input); });
    var error = el('div', 'lib-dialog-error'), footer = el('div', 'lib-dialog-actions'), cancel = button('取消', 'lib-secondary', function () { if (!state.busy) closeDialog(); }), submit = button(submitLabel || '确定', 'lib-primary'); submit.type = 'submit'; footer.appendChild(cancel); footer.appendChild(submit); formNode.appendChild(error); formNode.appendChild(footer);
    formNode.addEventListener('submit', function (event) { event.preventDefault(); if (state.busy) return; var values = {}; Object.keys(controls).forEach(function (key) { values[key] = controls[key].value.trim(); }); submit.disabled = true; cancel.disabled = true; error.textContent = ''; run(title, function () { return onSubmit(values); }).then(function (outcome) { submit.disabled = false; cancel.disabled = false; if (outcome.ok && !(outcome.value && outcome.value.canceled)) closeDialog(); else if (!outcome.ok) error.textContent = outcome.error.message || String(outcome.error); }); });
    var first = formNode.querySelector('input, select, button'); if (first) { first.focus(); if (first.select) first.select(); } return box;
  }
  function folderOptions(includeRoot) { var options = includeRoot ? [{ value: '', label: '根目录' }] : [{ value: '', label: '未分类' }]; folderTree().forEach(function (entry) { options.push({ value: String(entry.folder.id), label: new Array(entry.depth + 1).join('　') + entry.folder.name }); }); return options; }
  function newFolder() { form('新建文件夹', [{ name: 'name', label: '文件夹名称', required: true }, { name: 'parent', label: '父文件夹', options: folderOptions(true), value: currentFolder() }], function (value) { return getStore().createFolder(libraryRoot(), value.name, value.parent); }); }
  function createLibrary() { form('新建素材库', [{ name: 'name', label: '素材库名称', value: '我的素材库', required: true }], function (value) { return host('toolsLibraryChooseFolder', { title: '选择新素材库的保存位置' }).then(function (result) { if (result.canceled) return result; var data = getStore().createLibrary(result.path, value.name); return loadLibrary(data.root || data); }); }, '选择保存位置后，会创建独立的 .Library 文件夹。'); }
  function openAsset(item, mode) { return run(mode === 'apply' ? '应用到当前文档' : mode === 'edit' ? '打开模板源文件' : '新文档打开', function () { return host('toolsLibraryOpenAsset', { path: sourcePaths(item).source, mode: mode }); }); }
  function renameAsset(item) { form('重命名素材', [{ name: 'name', label: '素材名称', value: item.name, required: true }], function (value) { return getStore().updateAsset(libraryRoot(), item.id, { name: value.name }); }); }
  function editTags(item) { form('添加标签', [{ name: 'tags', label: '标签（用逗号分隔）', value: (item.tags || []).join('，'), placeholder: '例如：主图，促销，蓝色' }], function (value) { return getStore().setTags(libraryRoot(), item.id, value.tags.split(/[,，;；\n]/).map(function (t) { return t.trim(); }).filter(Boolean)); }, allTags().length ? '已有标签：' + allTags().join('、') : '标签可用于搜索和筛选，留空可移除该素材的标签。'); }
  function moveAsset(item, addOnly) { var options = folderOptions(false); if (addOnly) options[0].label = '请选择文件夹'; form(addOnly ? '添加到指定文件夹' : '移动文件', [{ name: 'folder', label: '目标文件夹', options: options, value: assetFolders(item)[0] || '', required: addOnly }], function (value) { if (addOnly && !value.folder) throw new Error('请选择目标文件夹；可先在文件夹列表中新建文件夹'); return getStore().moveAsset(libraryRoot(), item.id, value.folder, addOnly); }, addOnly ? '为素材增加文件夹归属，保留原有归属。' : '改变素材的文件夹归属，原始素材仍保存在素材库中。'); }
  function exportPack(item) { return run('分享此素材', function () { var target = libraryRoot(); sourcePaths(item); return host('toolsLibraryChooseSave', { name: item.name, kind: 'pack' }).then(function (result) { if (result.canceled) return result; return getStore().exportPack(target, [item.id], result.path); }); }); }
  function updateThumbnail(item) { return run('更新缩略图', function () { var p = sourcePaths(item); return host('toolsLibraryThumbnail', { path: p.source, preview: p.thumbnail || p.preview }).then(function (result) { var data = getStore().updateAsset(libraryRoot(), item.id, { width: result.width, height: result.height }); data.files.forEach(function (x) { if (String(x.id) === String(item.id)) x._previewVersion = Date.now(); }); return data; }); }); }
  function showAssetMenu(item, anchor, event) {
    var menu = newPopup(anchor, event), recycled = state.folder === '__recycle';
    if (recycled) { menuItem(menu, '恢复素材', function () { run('恢复素材', function () { return getStore().restoreAsset(libraryRoot(), item.id); }); }, { icon: 'refresh' }); menuItem(menu, '打开所在目录', function () { run('打开所在目录', function () { return reveal(itemPaths(item, true).directory); }); }, { icon: 'folder' }); finishPopup(menu); return; }
    var unavailable = false; try { unavailable = itemPaths(item).sourceExists === false; } catch (ignorePath) { unavailable = true; }
    if (unavailable) menu.appendChild(el('div', 'lib-menu-warning', '源文件缺失或不可用，请恢复后刷新素材库。'));
    menuItem(menu, '应用到当前文档', function () { openAsset(item, 'apply'); }, { disabled: unavailable }); menuItem(menu, '新文档打开', function () { openAsset(item, 'open'); }, { disabled: unavailable }); menuItem(menu, '编辑模板源文件', function () { openAsset(item, 'edit'); }, { disabled: unavailable }); separator(menu);
    menuItem(menu, '重命名', function () { renameAsset(item); }); menuItem(menu, '分享此文件', function () { exportPack(item); }, { disabled: unavailable }); menuItem(menu, '移动文件', function () { moveAsset(item, false); }); menuItem(menu, '添加到指定文件夹', function () { moveAsset(item, true); }); menuItem(menu, '打开所在目录', function () { run('打开所在目录', function () { return reveal(itemPaths(item).directory); }); }); separator(menu);
    menuItem(menu, item.tags && item.tags.length ? '编辑标签…' : '添加标签…', function () { editTags(item); });
    var rating = el('div', 'lib-rating'); rating.appendChild(el('span', '', '标星')); [1, 2, 3, 4, 5].forEach(function (star) { var b = button(star + ' 星（再次点击清除）', Number(item.star || 0) >= star ? 'is-filled' : '', function () { run('设置星级', function () { return getStore().updateAsset(libraryRoot(), item.id, { star: Number(item.star) === star ? 0 : star }); }); }); b.textContent = '★'; rating.appendChild(b); }); menu.appendChild(rating);
    menuItem(menu, '更新缩略图', function () { updateThumbnail(item); }, { disabled: unavailable }); menuItem(menu, '移入回收站', function () { run('移入回收站', function () { return getStore().trashAsset(libraryRoot(), item.id); }); }, { danger: true }); separator(menu); menuItem(menu, '取消', closePopup); finishPopup(menu);
  }
  function importFolder() { return run('导入文件夹', function () { var target = libraryRoot(), folder = currentFolder(); return host('toolsLibraryChooseFolder', { title: '选择要导入的素材文件夹' }).then(function (result) { if (result.canceled) return result; return getStore().importFiles(target, [result.path], folder); }); }); }
  function importFiles() { return run('导入素材文件', function () { var target = libraryRoot(), folder = currentFolder(); return host('toolsLibraryChooseFiles', { kind: 'assets' }).then(function (result) { if (result.canceled) return result; return getStore().importFiles(target, result.paths || [], folder); }); }); }
  function importPack() { return run('导入素材包', function () { var target = libraryRoot(), folder = currentFolder(); return host('toolsLibraryChooseFiles', { kind: 'pack' }).then(function (result) { if (result.canceled) return result; if (!result.paths || result.paths.length !== 1) throw new Error('请一次选择一个 .pack 素材包文件夹'); return getStore().importPack(target, result.paths[0], folder); }); }); }
  function tagManager() {
    var tags = allTags(), box = createDialog('标签管理', '修改标签名称会同步更新使用该标签的素材。');
    if (!tags.length) box.appendChild(el('p', '', '暂无标签。可在素材右键菜单中添加标签。'));
    tags.forEach(function (tag) { var row = el('div', 'lib-tag-row'); row.appendChild(el('span', '', tag)); row.appendChild(button('改名', '', function () { form('重命名标签', [{ name: 'name', label: '标签名称', value: tag, required: true }], function (value) { var data = getStore().renameTag(libraryRoot(), tag, value.name); state.tags = state.tags.map(function (name) { return name === tag ? value.name : name; }); return data; }); })); row.appendChild(button('删除', '', function () { form('删除标签', [], function () { return getStore().deleteTag(libraryRoot(), tag); }, '从全部素材中移除标签“' + tag + '”，素材文件会保留。', '删除标签'); })); box.appendChild(row); });
    var footer = el('div', 'lib-dialog-actions'); footer.appendChild(button('完成', 'lib-primary', closeDialog)); box.appendChild(footer); footer.querySelector('button').focus();
  }
  function showSettings() {
    if (popup && popup._anchor === refs.settings) { closePopup(true); return; }
    var menu = newPopup(refs.settings); refs.settings.setAttribute('aria-expanded', 'true'); menu.appendChild(el('div', 'lib-menu-label', '素材库'));
    recentLibraries().forEach(function (path) { var item = menuItem(menu, baseName(path), function () { run('切换素材库', function () { return loadLibrary(path); }); }, { active: !!state.data && path.toLowerCase() === state.data.root.toLowerCase(), icon: state.data && path.toLowerCase() === state.data.root.toLowerCase() ? 'check' : 'folder' }); item.title = path; }); separator(menu);
    menuItem(menu, '打开其它素材库', chooseLibrary, { icon: 'folder' }); menuItem(menu, '新建素材库', createLibrary, { icon: 'plus' }); separator(menu);
    menuItem(menu, '标签管理', tagManager, { icon: 'tag', disabled: !state.data }); separator(menu);
    menuItem(menu, '导入文件', importFiles, { icon: 'import', disabled: !state.data }); menuItem(menu, '导入文件夹', importFolder, { icon: 'import', disabled: !state.data }); menuItem(menu, '导入素材包 (.pack)', importPack, { icon: 'import', disabled: !state.data }); separator(menu);
    menuItem(menu, '打开所在目录', function () { run('打开素材库目录', function () { return reveal(libraryRoot()); }); }, { icon: 'folder', disabled: !state.data }); menuItem(menu, '刷新素材库', function () { run('刷新素材库', function () { return getStore().load(libraryRoot()); }); }, { icon: 'refresh', disabled: !state.data });
    menuItem(menu, '修复数据', function () { var target = state.failedRoot || libraryRoot(); form('修复素材库数据', [], function () { getStore().repair(target); return loadLibrary(target); }, '扫描已有素材，备份当前索引并重建可恢复的数据。不会清理源素材文件。目标：' + target, '扫描并修复'); }, { icon: 'refresh', disabled: !state.data && !state.failedRoot }); finishPopup(menu);
  }
  function tagSections() {
    var names = allTags(), sections = [], assigned = Object.create(null), byId = Object.create(null), metadata = state.data.tags || [];
    metadata.forEach(function (tag) { if (tag && tag.id && tag.name) byId[String(tag.id)] = tag.name; });
    (state.data.tagGroups || []).forEach(function (group) {
      if (!group || typeof group !== 'object') return;
      var members = [], groupId = String(group.id || ''), raw = Array.isArray(group.tags) ? group.tags : [];
      raw.forEach(function (tag) { if (tag == null) return; var value = typeof tag === 'object' ? tag.name || byId[String(tag.id)] : byId[String(tag)] || String(tag); if (names.indexOf(value) >= 0 && members.indexOf(value) < 0) members.push(value); });
      metadata.forEach(function (tag) { if (tag && groupId && String(tag.groupId || tag.group || tag.gid || '') === groupId && names.indexOf(tag.name) >= 0 && members.indexOf(tag.name) < 0) members.push(tag.name); });
      members.forEach(function (name) { assigned[name] = true; });
      if (members.length) sections.push({ name: group.name || '标签分组', names: members });
    });
    var ungrouped = names.filter(function (name) { return !assigned[name]; });
    if (ungrouped.length || !sections.length) sections.push({ name: '未分组', names: ungrouped });
    return sections;
  }
  function showFilter(force) {
    if (!state.data) return;
    if (force !== true && popup && popup._anchor === refs.filter) { closePopup(true); return; }
    var menu = newPopup(refs.filter, null, 'lib-filter-popup'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '筛选素材');
    var heading = el('div', 'lib-filter-heading'); heading.appendChild(el('span', '', '筛选'));
    heading.appendChild(button('清除筛选', 'lib-filter-clear', function () { clearFilters(false); showFilter(true); })); menu.appendChild(heading);
    function section(label) { var group = el('div', 'lib-filter-section'); group.appendChild(el('div', 'lib-filter-label', label)); var chips = el('div', 'lib-filter-chips'); group.appendChild(chips); menu.appendChild(group); return chips; }
    function chip(container, text, label, key, listName) {
      var selected = state[listName].indexOf(key) >= 0, b = button(label, 'lib-filter-chip' + (selected ? ' is-active' : ''), function () {
        if (state.busy) return;
        var index = state[listName].indexOf(key); if (index >= 0) state[listName].splice(index, 1); else state[listName].push(key);
        if (listName === 'dates') { state.dateFrom = ''; state.dateTo = ''; fromInput.value = ''; toInput.value = ''; dateError.textContent = ''; }
        Array.prototype.forEach.call(menu.querySelectorAll('.lib-filter-chip'), function (other) { var type = other.dataset.filterType, value = type === 'ratings' ? Number(other.dataset.filterKey) : other.dataset.filterKey; var active = state[type].indexOf(value) >= 0; other.classList.toggle('is-active', active); other.setAttribute('aria-pressed', String(active)); }); state.limit = 200; refs.scroll.scrollTop = 0; render();
      }); b.textContent = text; b.setAttribute('aria-pressed', String(selected)); b.dataset.filterKey = String(key); b.dataset.filterType = listName; container.appendChild(b);
    }
    var ratingChips = section('标星'); [1, 2, 3, 4, 5].forEach(function (rating) { chip(ratingChips, '★ ' + rating, rating + ' 星', rating, 'ratings'); });
    var dateChips = section('添加时间'); [['yesterday', '昨日'], ['7days', '7天内'], ['3months', '3个月内'], ['year', '一年内'], ['older', '一年以上']].forEach(function (entry) { chip(dateChips, entry[1], entry[1], entry[0], 'dates'); });
    var dateRow = el('div', 'lib-date-range'), fromInput = el('input'), toInput = el('input'); fromInput.type = 'date'; toInput.type = 'date'; fromInput.value = state.dateFrom; toInput.value = state.dateTo; fromInput.setAttribute('aria-label', '开始日期'); toInput.setAttribute('aria-label', '结束日期');
    dateRow.appendChild(fromInput); dateRow.appendChild(el('span', '', '至')); dateRow.appendChild(toInput); menu.appendChild(dateRow); var dateError = el('div', 'lib-filter-error'); dateError.setAttribute('role', 'status'); menu.appendChild(dateError);
    function changeRange() {
      var from = fromInput.value, to = toInput.value;
      if ((from && !isFinite(parseLocalDate(from))) || (to && !isFinite(parseLocalDate(to)))) { dateError.textContent = '请输入有效日期'; return; }
      if (from && to && parseLocalDate(from) > parseLocalDate(to)) { dateError.textContent = '开始日期不能晚于结束日期'; return; }
      dateError.textContent = ''; state.dateFrom = from; state.dateTo = to; state.dates = []; Array.prototype.forEach.call(dateChips.querySelectorAll('button'), function (b) { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); }); state.limit = 200; refs.scroll.scrollTop = 0; render();
    }
    fromInput.addEventListener('change', changeRange); toInput.addEventListener('change', changeRange);
    tagSections().forEach(function (group) { var tagChips = section(group.name + '（' + group.names.length + '）'); group.names.forEach(function (name) { chip(tagChips, name, '标签：' + name, name, 'tags'); }); if (!group.names.length) tagChips.appendChild(el('span', 'lib-filter-muted', '暂无标签')); });
    finishPopup(menu);
  }
  function showSort() {
    if (popup && popup._anchor === refs.sort) { closePopup(true); return; }
    var menu = newPopup(refs.sort); [['time', '时间'], ['name', '文件名'], ['rating', '标星']].forEach(function (entry) { menuItem(menu, entry[1], function () { state.sort = entry[0]; write(keys.sort, state.sort); refs.scroll.scrollTop = 0; render(); }, { active: state.sort === entry[0], icon: state.sort === entry[0] ? 'check' : undefined }); }); separator(menu);
    [['asc', '升序'], ['desc', '降序']].forEach(function (entry) { menuItem(menu, entry[1], function () { state.direction = entry[0]; write(keys.direction, state.direction); refs.scroll.scrollTop = 0; render(); }, { active: state.direction === entry[0], icon: state.direction === entry[0] ? 'check' : undefined }); }); finishPopup(menu);
  }
  function showDisplay() {
    if (popup && popup._anchor === refs.display) { closePopup(true); return; }
    var menu = newPopup(refs.display); [['showName', '显示名称'], ['showSize', '显示尺寸']].forEach(function (entry) { var b = menuItem(menu, entry[1], function () { state[entry[0]] = !state[entry[0]]; write(keys[entry[0]], state[entry[0]] ? '1' : '0'); render(); }, { active: state[entry[0]], icon: state[entry[0]] ? 'check' : undefined }); b.setAttribute('role', 'menuitemcheckbox'); b.setAttribute('aria-checked', String(state[entry[0]])); }); finishPopup(menu);
  }
  function toggleSearch(open) {
    state.searchOpen = open; closePopup(); refs.folder.hidden = open; refs.searchToggle.hidden = open; refs.searchRow.hidden = !open;
    if (open) refs.search.focus(); else { state.search = ''; refs.search.value = ''; state.limit = 200; render(); refs.searchToggle.focus(); }
  }
  function updateFloatingActions() {
    if (!refs.floating || !refs.backTop || !refs.scroll) return;
    refs.backTop.hidden = !state.data || refs.scroll.scrollTop < 240;
    if (state.busy) return;
    refs.floating.style.bottom = ((refs.footer ? refs.footer.offsetHeight : 29) + (refs.status && !refs.status.hidden ? refs.status.offsetHeight : 0) + 8) + 'px';
  }
  function exportCurrent(mode) {
    if (!state.data) return;
    return run(mode === 'document' ? '添加文档到素材库' : '添加图层到素材库', function () {
      var target = libraryRoot(), folder = currentFolder(), record = null;
      return host('toolsLibraryExportInfo', { mode: mode }).then(function (info) {
        if (!info.name) throw new Error('未能读取素材名称');
        record = getStore().reserveAsset(target, info.name, folder);
        return host('toolsLibraryExportAsset', { source: record.source, preview: record.preview, mode: mode, name: info.name, expectedDocumentId: info.documentId, expectedLayerIds: info.selectedLayerIds });
      }).then(function (result) { record.width = result.width; record.height = result.height; return getStore().commitAsset(target, record); }).catch(function (error) { try { if (record && getStore().cancelReservation) getStore().cancelReservation(target, record); } catch (ignoreCleanup) {} throw error; });
    });
  }
  function init() {
    if (initialized || !root) return; initialized = true; root.textContent = ''; root.setAttribute('aria-label', '素材库');
    var toolbar = el('div', 'lib-toolbar'); refs.folder = button('选择文件夹', 'lib-folder-toggle', showFolders); refs.folder.textContent = ''; refs.folder.appendChild(icon('folder')); refs.folderTitle = el('span', 'lib-folder-title', '全部素材'); refs.folder.appendChild(refs.folderTitle); refs.folder.appendChild(icon('chevron')); refs.folder.setAttribute('aria-expanded', 'false'); toolbar.appendChild(refs.folder);
    refs.searchRow = el('div', 'lib-search-inline'); refs.searchRow.hidden = true; refs.search = el('input'); refs.search.type = 'text'; refs.search.setAttribute('role', 'searchbox'); refs.search.autocomplete = 'off'; refs.search.spellcheck = false; refs.search.placeholder = '搜索整个素材库'; refs.search.setAttribute('aria-label', '搜索名称、标签'); var searchTimer, composing = false;
    function updateSearch() {
      window.clearTimeout(searchTimer);
      if (composing) return;
      state.search = refs.search.value; state.limit = 200;
      searchTimer = window.setTimeout(function () { if (state.busy || composing) return; refs.scroll.scrollTop = 0; render(); }, 120);
    }
    refs.search.addEventListener('compositionstart', function () { composing = true; window.clearTimeout(searchTimer); });
    refs.search.addEventListener('compositionend', function () { composing = false; updateSearch(); });
    refs.search.addEventListener('input', updateSearch); refs.searchRow.appendChild(button('返回文件夹', 'lib-icon', function () { toggleSearch(false); }, 'back')); refs.searchRow.appendChild(refs.search); toolbar.appendChild(refs.searchRow);
    refs.searchToggle = button('搜索素材', 'lib-icon', function () { toggleSearch(true); }, 'search'); toolbar.appendChild(refs.searchToggle); refs.filter = button('筛选', 'lib-icon', showFilter, 'filter'); toolbar.appendChild(refs.filter); refs.settings = button('素材库设置', 'lib-icon', showSettings, 'settings'); refs.settings.setAttribute('aria-expanded', 'false'); toolbar.appendChild(refs.settings); root.appendChild(toolbar);
    var count = el('div', 'lib-count'); refs.count = el('span'); count.appendChild(refs.count); refs.clear = button('清除筛选', 'lib-count-clear', function () { clearFilters(true); }); count.appendChild(refs.clear); root.appendChild(count);
    refs.scroll = el('div', 'lib-scroll'); refs.grid = el('div', 'lib-grid'); refs.grid.setAttribute('role', 'listbox'); refs.grid.setAttribute('aria-label', '素材列表'); refs.empty = el('div', 'lib-empty'); refs.scroll.appendChild(refs.grid); refs.scroll.appendChild(refs.empty); refs.more = button('继续加载', 'lib-more', function () { state.limit += 200; render(); }); refs.scroll.appendChild(refs.more); root.appendChild(refs.scroll);
    refs.status = el('div', 'lib-status'); refs.status.setAttribute('role', 'status'); refs.status.setAttribute('aria-live', 'polite'); refs.status.hidden = true; root.appendChild(refs.status);
    var footer = el('div', 'lib-footer'), footerLeft = el('div', 'lib-footer-left'); refs.footer = footer; refs.sort = button('排序', 'lib-sort', showSort); refs.sort.textContent = ''; refs.sort.appendChild(icon('sort')); refs.sortLabel = el('span', '', '排序'); refs.sort.appendChild(refs.sortLabel); footerLeft.appendChild(refs.sort); refs.display = button('显示选项', 'lib-icon lib-display-toggle', showDisplay, 'eye'); footerLeft.appendChild(refs.display); footer.appendChild(footerLeft);
    var zoom = el('div', 'lib-zoom'); zoom.appendChild(el('span', '', '−')); var slider = el('input'); slider.type = 'range'; slider.min = '75'; slider.max = '230'; slider.value = String(state.zoom); slider.setAttribute('aria-label', '缩略图大小'); slider.addEventListener('input', function () { state.zoom = Number(slider.value); write(keys.zoom, String(state.zoom)); resizeGrid(); }); zoom.appendChild(slider); zoom.appendChild(el('span', '', '＋')); footer.appendChild(zoom); root.appendChild(footer);
    refs.floating = el('div', 'lib-floating-actions'); refs.fab = el('div', 'lib-fab'); [['document', '添加文档到素材库', 'document'], ['layers', '添加图层到素材库', 'layers']].forEach(function (entry) { var b = button(entry[1], '', function () { exportCurrent(entry[0]); }, entry[2]); b.dataset.exportMode = entry[0]; b.appendChild(el('span', 'lib-fab-tooltip', entry[1])); refs.fab.appendChild(b); }); refs.floating.appendChild(refs.fab);
    refs.fab.addEventListener('mousedown', function () { refs.fab.classList.add('is-pointer-focus'); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Tab') refs.fab.classList.remove('is-pointer-focus'); });
    refs.fab.addEventListener('keydown', function () { refs.fab.classList.remove('is-pointer-focus'); });
    refs.backTop = button('返回顶部', 'lib-back-top', function () { refs.scroll.scrollTop = 0; updateFloatingActions(); }, 'top'); refs.backTop.dataset.allowBusy = '1'; refs.backTop.appendChild(el('span', 'lib-fab-tooltip', '返回顶部')); refs.backTop.hidden = true; refs.floating.appendChild(refs.backTop); root.appendChild(refs.floating); refs.scroll.addEventListener('scroll', updateFloatingActions);
    document.addEventListener('mousedown', function (event) { if (popup && !popup.contains(event.target) && !(popup._anchor && popup._anchor.contains(event.target))) closePopup(); });
    document.addEventListener('focusin', function (event) { if (popup && !popup.contains(event.target) && !(popup._anchor && popup._anchor.contains(event.target))) closePopup(); });
    root.addEventListener('keydown', function (event) {
      if (event.isComposing || event.keyCode === 229 || composing) return;
      if (event.key === 'Escape' && !state.busy) { event.preventDefault(); if (dialog) closeDialog(); else if (popup) closePopup(true); else if (state.searchOpen) toggleSearch(false); }
      if (!state.busy && (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'f') { event.preventDefault(); toggleSearch(true); }
      if (popup && popup.contains(event.target) && popup.getAttribute('role') === 'menu') {
        var choices = Array.prototype.slice.call(popup.querySelectorAll('button:not(:disabled)')), selected = choices.indexOf(document.activeElement), next = selected;
        if (event.key === 'ArrowDown') next = (selected + 1) % choices.length;
        else if (event.key === 'ArrowUp') next = (selected - 1 + choices.length) % choices.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = choices.length - 1;
        else if (event.key === 'Tab') closePopup(true);
        if (popup && choices.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) >= 0) { event.preventDefault(); var target = choices[next]; focusNode(target); if (target.offsetTop < popup.scrollTop) popup.scrollTop = target.offsetTop; else if (target.offsetTop + target.offsetHeight > popup.scrollTop + popup.clientHeight) popup.scrollTop = target.offsetTop + target.offsetHeight - popup.clientHeight; }
      }
      if (dialog && event.key === 'Tab') { var focusable = dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)'); if (!focusable.length) return; var first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    });
    function panelChange(event) { if (event.detail && event.detail.panelId === 'library-panel') { resizeGrid(); updateFloatingActions(); restoreLastLibrary(); } else { closePopup(); if (!state.busy) closeDialog(false); } }
    function resizePanel() { resizeGrid(); updateFloatingActions(); if (popup) positionPopup(popup, popup._anchor, popup._event); }
    document.addEventListener('xinyang:panelready', panelChange); document.addEventListener('xinyang:panelchange', panelChange); window.addEventListener('resize', resizePanel); if (window.ResizeObserver) new ResizeObserver(resizePanel).observe(root);
    render(); restoreLastLibrary();
  }
  window.XinyangLibraryPanel = { init: init, openLibrary: function (path) { return run('打开素材库', function () { return loadLibrary(path); }); }, refresh: function () { return run('刷新素材库', function () { return getStore().load(libraryRoot()); }); }, getState: function () { return { root: state.data ? state.data.root : '', folder: state.folder, count: filteredItems().length, busy: state.busy, selected: state.selected, search: state.search, searchOpen: state.searchOpen, sort: state.sort, direction: state.direction, showName: state.showName, showSize: state.showSize, filters: { ratings: state.ratings.slice(), tags: state.tags.slice(), dates: state.dates.slice(), from: state.dateFrom, to: state.dateTo }, error: state.error }; } };
  init();
}());
