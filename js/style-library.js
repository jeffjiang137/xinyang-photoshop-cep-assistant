(function () {
  "use strict";

  var cs = new CSInterface();
  var busy = false;
  var selectedResource = "";
  var indexedResources = [];
  var state = {
    colors: [
      { id: "c-blue", name: "主蓝", value: "#2f6fff" },
      { id: "c-orange", name: "点缀橙", value: "#ff8a32" },
      { id: "c-red", name: "强调红", value: "#e9473f" },
      { id: "c-dark", name: "深灰", value: "#262b33" },
      { id: "c-light", name: "浅灰", value: "#f5f5f5" },
      { id: "c-white", name: "白色", value: "#ffffff" }
    ],
    gradients: [
      { id: "g-blue", name: "蓝紫渐变", from: "#2f6fff", to: "#8d5cff", angle: 0, opacity: 100 },
      { id: "g-warm", name: "橙金渐变", from: "#ff8a32", to: "#f4c56a", angle: 0, opacity: 100 }
    ],
    textStyles: [],
    layerStyles: [],
    presetFiles: [],
    resourceFolders: []
  };
  var FILE_NAME = "styles-v2.json";

  function $(selector) { return document.querySelector(selector); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function status(message) { var node = $("#status-text"); if (node) node.textContent = String(message || "就绪"); }
  function humanError(error) { return error && error.message ? error.message : String(error || "未知错误"); }
  function uid(prefix) { return prefix + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 9999).toString(36); }
  function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function hostInvoke(method, payload) {
    return new Promise(function (resolve, reject) {
      var script = "LongStitchCEP.invoke(" + JSON.stringify(String(method)) + "," + JSON.stringify(JSON.stringify(payload || {})) + ")";
      cs.evalScript(script, function (raw) {
        try {
          if (!raw || raw === "EvalScript error.") throw new Error("Photoshop 脚本执行失败");
          var result = JSON.parse(raw);
          if (!result.ok) throw new Error(result.error || "Photoshop 操作失败");
          resolve(result.data);
        } catch (error) { reject(error); }
      });
    });
  }

  function userDataPath() {
    try { return cs.getSystemPath(SystemPath.USER_DATA).replace(/\\/g, "/"); } catch (error) { return ""; }
  }
  function dataPath() { var root = userDataPath(); return root ? root + "/XinyangAssistant/config/" + FILE_NAME : ""; }
  function ensureDir() {
    var root = userDataPath();
    if (!root || !window.cep || !window.cep.fs) return false;
    window.cep.fs.makedir(root + "/XinyangAssistant");
    window.cep.fs.makedir(root + "/XinyangAssistant/config");
    return true;
  }
  function loadState() {
    try {
      var path = dataPath();
      var result = path && window.cep.fs.readFile(path);
      if (result && result.err === 0 && result.data) {
        var parsed = JSON.parse(result.data);
        ["colors", "gradients", "textStyles", "layerStyles", "presetFiles", "resourceFolders"].forEach(function (key) {
          if (parsed[key] instanceof Array) state[key] = parsed[key];
        });
      }
    } catch (error) {}
  }
  function saveState() {
    try {
      ensureDir();
      window.cep.fs.writeFile(dataPath(), JSON.stringify(state, null, 2));
    } catch (error) {
      status("保存样式配置失败：" + humanError(error));
    }
  }
  function setBusy(value, message) {
    busy = !!value;
    all('[data-tools-view="style"] button, [data-tools-view="style"] input, [data-tools-view="style"] select').forEach(function (node) { node.disabled = busy; });
    if (!busy) updateResourceButtons();
    if (message) status(message);
  }

  function renderColors() {
    var node = $("#style-color-list");
    node.innerHTML = state.colors.length ? state.colors.map(function (item) {
      return '<div class="style-swatch" data-color-id="' + escapeHtml(item.id) + '" title="单击应用 ' + escapeHtml(item.value) + '">' +
        '<button class="style-item-delete" type="button" data-color-delete="' + escapeHtml(item.id) + '" title="删除">×</button>' +
        '<button class="style-swatch-color" type="button" data-color-apply="' + escapeHtml(item.id) + '" style="--swatch-color:' + escapeHtml(item.value) + '"></button>' +
        '<span class="style-swatch-name" data-color-rename="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</span></div>';
    }).join("") : '<div class="empty-library">还没有收藏颜色</div>';
  }

  function renderGradients() {
    var node = $("#style-gradient-list");
    node.innerHTML = state.gradients.length ? state.gradients.map(function (item) {
      return '<div class="gradient-item"><span class="gradient-preview" style="--gradient-from:' + escapeHtml(item.from) + ';--gradient-to:' + escapeHtml(item.to) + ';--gradient-angle:' + (90 - Number(item.angle || 0)) + 'deg"></span>' +
        '<span class="item-main"><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.from) + ' → ' + escapeHtml(item.to) + ' · ' + Number(item.angle || 0) + '°</span></span>' +
        '<span class="item-actions"><button type="button" data-gradient-apply="' + escapeHtml(item.id) + '">应用</button><button type="button" data-gradient-delete="' + escapeHtml(item.id) + '">删除</button></span></div>';
    }).join("") : '<div class="empty-library">还没有收藏渐变</div>';
  }

  function renderTextStyles() {
    var node = $("#style-text-list");
    node.innerHTML = state.textStyles.length ? state.textStyles.map(function (item) {
      var style = item.style || {};
      return '<div class="text-style-item"><span class="gradient-preview" style="--gradient-from:' + escapeHtml(style.color || "#ffffff") + ';--gradient-to:' + escapeHtml(style.color || "#ffffff") + ';--gradient-angle:90deg"></span>' +
        '<span class="item-main"><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(style.font || "字体") + ' · ' + Number(style.size || 0) + ' pt · 字距 ' + Number(style.tracking || 0) + '</span></span>' +
        '<span class="item-actions"><button type="button" data-text-style-apply="' + escapeHtml(item.id) + '">应用</button><button type="button" data-text-style-delete="' + escapeHtml(item.id) + '">删除</button></span></div>';
    }).join("") : '<div class="empty-library">选择一个文字图层后收藏样式</div>';
  }

  function fileName(path) { return String(path || "").replace(/\\/g, "/").split("/").pop(); }
  function extension(path) { var name = fileName(path); var i = name.lastIndexOf("."); return i >= 0 ? name.slice(i + 1).toLowerCase() : ""; }

  function renderLayerStyles() {
    var node = $("#style-layer-list");
    node.innerHTML = state.layerStyles.length ? state.layerStyles.map(function (item) {
      return '<div class="text-style-item"><span class="resource-file-preview">FX</span>' +
        '<span class="item-main"><strong>' + escapeHtml(item.name) + '</strong><span>' + Number(item.effectCount || 1) + ' 项可编辑图层效果</span></span>' +
        '<span class="item-actions"><button type="button" data-layer-style-apply="' + escapeHtml(item.id) + '">应用</button><button type="button" data-layer-style-delete="' + escapeHtml(item.id) + '">删除</button></span></div>';
    }).join("") : '<div class="empty-library">选择带有图层效果的图层后收藏</div>';
  }

  function renderPresetFiles() {
    var node = $("#style-preset-list");
    node.innerHTML = state.presetFiles.length ? state.presetFiles.map(function (item) {
      return '<div class="local-file-item"><span class="resource-file-preview">' + escapeHtml(extension(item.path).toUpperCase()) + '</span>' +
        '<span class="item-main"><strong>' + escapeHtml(item.name || fileName(item.path)) + '</strong><span title="' + escapeHtml(item.path) + '">' + escapeHtml(item.path) + '</span></span>' +
        '<span class="item-actions"><button type="button" data-preset-load="' + escapeHtml(item.id) + '">载入</button><button type="button" data-preset-delete="' + escapeHtml(item.id) + '">移除</button></span></div>';
    }).join("") : '<div class="empty-library">可添加本机 ASL 图层样式或 GRD 渐变预设</div>';
  }

  function renderFolders() {
    var node = $("#resource-folder-list");
    node.innerHTML = state.resourceFolders.length ? state.resourceFolders.map(function (item) {
      return '<div class="resource-folder-item"><span class="item-main"><strong>' + escapeHtml(item.name || fileName(item.path)) + '</strong><span title="' + escapeHtml(item.path) + '">' + escapeHtml(item.path) + '</span></span>' +
        '<span class="item-actions"><button type="button" data-folder-scan="' + escapeHtml(item.id) + '">刷新</button><button type="button" data-folder-delete="' + escapeHtml(item.id) + '">移除</button></span></div>';
    }).join("") : '<div class="empty-library">添加常用模板或素材文件夹</div>';
  }

  function resourceKind(ext) {
    if (/^(psd|psb)$/.test(ext)) return "template";
    if (/^(jpg|jpeg|png|webp|gif|bmp|tif|tiff)$/.test(ext)) return "image";
    if (/^(ai|svg|pdf|eps)$/.test(ext)) return "vector";
    return "";
  }

  function statPath(path) {
    try { return window.cep.fs.stat(path); } catch (error) { return null; }
  }

  function scanFolder(path, output, depth) {
    if (output.length >= 500 || depth > 5) return;
    var result;
    try { result = window.cep.fs.readdir(path); } catch (error) { return; }
    if (!result || result.err !== 0 || !(result.data instanceof Array)) return;
    result.data.forEach(function (name) {
      if (output.length >= 500 || /^\./.test(name)) return;
      var full = String(path).replace(/[\\\/]$/, "") + "/" + name;
      var stat = statPath(full);
      var isDirectory = false;
      if (stat && stat.err === 0 && stat.data) {
        isDirectory = typeof stat.data.isDirectory === "function"
          ? !!stat.data.isDirectory()
          : !!stat.data.isDirectory;
      } else {
        try { var directoryProbe = window.cep.fs.readdir(full); isDirectory = !!(directoryProbe && directoryProbe.err === 0); } catch (ignoreProbe) {}
      }
      if (isDirectory) {
        scanFolder(full, output, depth + 1);
        return;
      }
      var ext = extension(full);
      var kind = resourceKind(ext);
      var modified = 0;
      if (stat && stat.data) modified = Number(stat.data.mtime || stat.data.modificationTime || 0) || 0;
      if (kind) output.push({ path: full, name: name, ext: ext, kind: kind, mtime: modified });
    });
  }

  function scanAllResources() {
    var output = [];
    state.resourceFolders.forEach(function (folder) { scanFolder(folder.path, output, 0); });
    output.sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name); });
    indexedResources = output.slice(0, 500);
    selectedResource = "";
    renderResources();
    status("已索引 " + indexedResources.length + " 个本地模板与素材文件");
  }

  function localUrl(path) { return encodeURI("file:///" + String(path || "").replace(/\\/g, "/").replace(/^\/+/, "")); }
  function renderResources() {
    var query = String($("#resource-search").value || "").toLowerCase();
    var type = $("#resource-type").value;
    var values = indexedResources.filter(function (item) {
      return (!query || item.name.toLowerCase().indexOf(query) >= 0) && (type === "all" || item.kind === type);
    });
    var node = $("#resource-file-list");
    node.innerHTML = values.length ? values.map(function (item) {
      var preview = item.kind === "image" ? '<img src="' + escapeHtml(localUrl(item.path)) + '" alt="" />' : escapeHtml(item.ext.toUpperCase());
      return '<button class="resource-file-card' + (selectedResource === item.path ? ' selected' : '') + '" type="button" data-resource-path="' + escapeHtml(item.path) + '" title="' + escapeHtml(item.path) + '"><span class="resource-file-preview">' + preview + '</span><span class="resource-file-name">' + escapeHtml(item.name) + '</span></button>';
    }).join("") : '<div class="empty-library">没有匹配的本地文件</div>';
    updateResourceButtons();
  }

  function updateResourceButtons() {
    $("#resource-open").disabled = busy || !selectedResource;
    $("#resource-place").disabled = busy || !selectedResource;
  }

  function saveColor(fromForeground) {
    if (busy) return;
    var name = $("#style-color-name").value.trim() || "颜色";
    function add(value) {
      value = String(value || "#000000").toLowerCase();
      state.colors.push({ id: uid("color"), name: name, value: value });
      saveState(); renderColors(); status("已收藏颜色 “" + name + "”");
    }
    if (fromForeground) {
      setBusy(true, "正在读取 Photoshop 前景色…");
      hostInvoke("toolsGetForegroundColor", {}).then(function (result) {
        $("#style-color-value").value = result.color;
        add(result.color);
      }).catch(function (error) { status("读取前景色失败：" + humanError(error)); }).then(function () { setBusy(false); });
    } else add($("#style-color-value").value);
  }

  function applyColor(id) {
    var item = state.colors.filter(function (v) { return v.id === id; })[0];
    if (!item || busy) return;
    setBusy(true, "正在应用颜色…");
    hostInvoke("toolsApplySavedColor", { color: item.value }).then(function (result) {
      status("已将 “" + item.name + "” 应用到 " + result.processed + " 个图层，跳过 " + result.skipped + " 个");
    }).catch(function (error) { status("应用颜色失败：" + humanError(error)); }).then(function () { setBusy(false); });
  }

  function saveGradient() {
    var item = {
      id: uid("gradient"),
      name: $("#style-gradient-name").value.trim() || "渐变",
      from: $("#style-gradient-from").value,
      to: $("#style-gradient-to").value,
      angle: Math.max(-180, Math.min(180, Number($("#style-gradient-angle").value) || 0)),
      opacity: Math.max(0, Math.min(100, Number($("#style-gradient-opacity").value) || 100))
    };
    state.gradients.push(item); saveState(); renderGradients(); status("已保存渐变 “" + item.name + "”");
  }

  function applyGradient(id) {
    var item = state.gradients.filter(function (v) { return v.id === id; })[0];
    if (!item || busy) return;
    setBusy(true, "正在应用渐变叠加…");
    hostInvoke("toolsApplyGradientOverlay", item).then(function (result) {
      status("渐变已应用到 " + result.processed + " 个图层");
    }).catch(function (error) { status("应用渐变失败：" + humanError(error)); }).then(function () { setBusy(false); });
  }

  function captureTextStyle() {
    if (busy) return;
    var name = $("#style-text-name").value.trim() || "文字样式";
    setBusy(true, "正在读取选中文字图层…");
    hostInvoke("toolsCopyTextStyle", {}).then(function (result) {
      state.textStyles.push({ id: uid("text"), name: name, style: result.style });
      saveState(); renderTextStyles(); status("已收藏文字样式 “" + name + "”");
    }).catch(function (error) { status("收藏文字样式失败：" + humanError(error)); }).then(function () { setBusy(false); });
  }

  function applyTextStyle(id) {
    var item = state.textStyles.filter(function (v) { return v.id === id; })[0];
    if (!item || busy) return;
    setBusy(true, "正在应用文字样式…");
    hostInvoke("toolsPasteTextStyle", { style: item.style }).then(function (result) {
      status("文字样式已应用到 " + result.processed + " 个图层，跳过 " + result.skipped + " 个");
    }).catch(function (error) { status("应用文字样式失败：" + humanError(error)); }).then(function () { setBusy(false); });
  }

  function captureLayerStyle() {
    if (busy) return;
    var name = $("#style-layer-name").value.trim() || "图层样式";
    setBusy(true, "正在读取当前图层样式…");
    hostInvoke("toolsCaptureLayerStyle", {}).then(function (result) {
      state.layerStyles.push({ id: uid("layerStyle"), name: name, effects: result.effects, effectCount: result.effectCount || 1 });
      saveState(); renderLayerStyles(); status("已收藏图层样式 “" + name + "”");
    }).catch(function (error) { status("收藏图层样式失败：" + humanError(error)); }).then(function () { setBusy(false); });
  }

  function applyLayerStyle(id) {
    var item = state.layerStyles.filter(function (v) { return v.id === id; })[0];
    if (!item || busy) return;
    setBusy(true, "正在应用图层样式…");
    hostInvoke("toolsApplyLayerStyle", { effects: item.effects }).then(function (result) {
      status("图层样式已应用到 " + result.processed + " 个图层");
    }).catch(function (error) { status("应用图层样式失败：" + humanError(error)); }).then(function () { setBusy(false); });
  }

  function addPresetFiles() {
    var result = window.cep.fs.showOpenDialogEx(true, false, "选择 Photoshop 样式或渐变预设", "", ["asl", "grd"]);
    if (!result || result.err !== 0 || !result.data) return;
    result.data.forEach(function (path) {
      if (!state.presetFiles.some(function (item) { return item.path === path; })) state.presetFiles.push({ id: uid("preset"), name: fileName(path), path: path });
    });
    saveState(); renderPresetFiles(); status("已添加 " + result.data.length + " 个预设文件");
  }

  function loadPreset(id) {
    var item = state.presetFiles.filter(function (v) { return v.id === id; })[0];
    if (!item || busy) return;
    setBusy(true, "正在载入 Photoshop 预设…");
    hostInvoke("toolsLoadPresetFile", { path: item.path }).then(function () {
      status("已载入预设：" + item.name);
    }).catch(function (error) { status("载入预设失败：" + humanError(error)); }).then(function () { setBusy(false); });
  }

  function addResourceFolder() {
    var result = window.cep.fs.showOpenDialogEx(false, true, "选择模板或素材文件夹", "", []);
    if (!result || result.err !== 0 || !result.data || !result.data.length) return;
    var path = result.data[0];
    if (!state.resourceFolders.some(function (item) { return item.path === path; })) state.resourceFolders.push({ id: uid("folder"), name: fileName(path), path: path });
    saveState(); renderFolders(); scanAllResources();
  }

  function openResource(mode) {
    if (!selectedResource || busy) return;
    setBusy(true, mode === "place" ? "正在置入素材…" : "正在打开文件…");
    hostInvoke("toolsOpenResourceFile", { path: selectedResource, mode: mode }).then(function (result) {
      status((mode === "place" ? "已置入：" : "已打开：") + result.name);
    }).catch(function (error) { status("处理资源失败：" + humanError(error)); }).then(function () { setBusy(false); });
  }

  function exportLibrary() {
    var folderResult = window.cep.fs.showOpenDialogEx(false, true, "选择样式预设导出文件夹", "", []);
    if (!folderResult || folderResult.err !== 0 || !folderResult.data || !folderResult.data.length) return;
    var path = folderResult.data[0].replace(/[\\\/]$/, "") + "/鑫洋助理样式预设.json";
    var result = window.cep.fs.writeFile(path, JSON.stringify(state, null, 2));
    status(result && result.err === 0 ? "已导出样式预设：" + path : "导出样式预设失败");
  }

  function importLibrary() {
    var result = window.cep.fs.showOpenDialogEx(false, false, "选择鑫洋助理样式预设", "", ["json"]);
    if (!result || result.err !== 0 || !result.data || !result.data.length) return;
    try {
      var read = window.cep.fs.readFile(result.data[0]);
      if (!read || read.err !== 0) throw new Error("无法读取文件");
      var parsed = JSON.parse(read.data);
      ["colors", "gradients", "textStyles", "layerStyles", "presetFiles", "resourceFolders"].forEach(function (key) { if (parsed[key] instanceof Array) state[key] = parsed[key]; });
      saveState(); renderAll(); scanAllResources(); status("样式预设导入完成");
    } catch (error) { status("导入样式预设失败：" + humanError(error)); }
  }

  function removeById(listName, id) {
    state[listName] = state[listName].filter(function (item) { return item.id !== id; });
    saveState(); renderAll();
  }

  function bind() {
    $("#style-color-save").addEventListener("click", function () { saveColor(false); });
    $("#style-color-foreground").addEventListener("click", function () { saveColor(true); });
    $("#style-color-list").addEventListener("click", function (event) {
      var apply = event.target.closest("[data-color-apply]");
      var del = event.target.closest("[data-color-delete]");
      if (apply) applyColor(apply.getAttribute("data-color-apply"));
      if (del) removeById("colors", del.getAttribute("data-color-delete"));
    });
    $("#style-color-list").addEventListener("dblclick", function (event) {
      var node = event.target.closest("[data-color-rename]"); if (!node) return;
      var id = node.getAttribute("data-color-rename"); var item = state.colors.filter(function (v) { return v.id === id; })[0]; if (!item) return;
      var name = window.prompt("颜色名称", item.name); if (name && name.trim()) { item.name = name.trim(); saveState(); renderColors(); }
    });
    $("#style-gradient-save").addEventListener("click", saveGradient);
    $("#style-gradient-list").addEventListener("click", function (event) {
      var apply = event.target.closest("[data-gradient-apply]"); var del = event.target.closest("[data-gradient-delete]");
      if (apply) applyGradient(apply.getAttribute("data-gradient-apply"));
      if (del) removeById("gradients", del.getAttribute("data-gradient-delete"));
    });
    $("#style-text-capture").addEventListener("click", captureTextStyle);
    $("#style-text-list").addEventListener("click", function (event) {
      var apply = event.target.closest("[data-text-style-apply]"); var del = event.target.closest("[data-text-style-delete]");
      if (apply) applyTextStyle(apply.getAttribute("data-text-style-apply"));
      if (del) removeById("textStyles", del.getAttribute("data-text-style-delete"));
    });
    $("#style-layer-capture").addEventListener("click", captureLayerStyle);
    $("#style-layer-list").addEventListener("click", function (event) {
      var apply = event.target.closest("[data-layer-style-apply]"); var del = event.target.closest("[data-layer-style-delete]");
      if (apply) applyLayerStyle(apply.getAttribute("data-layer-style-apply"));
      if (del) removeById("layerStyles", del.getAttribute("data-layer-style-delete"));
    });
    $("#style-preset-add").addEventListener("click", addPresetFiles);
    $("#style-preset-clear-missing").addEventListener("click", function () {
      state.presetFiles = state.presetFiles.filter(function (item) { var stat = statPath(item.path); return stat && stat.err === 0; }); saveState(); renderPresetFiles(); status("已清理失效预设路径");
    });
    $("#style-preset-list").addEventListener("click", function (event) {
      var load = event.target.closest("[data-preset-load]"); var del = event.target.closest("[data-preset-delete]");
      if (load) loadPreset(load.getAttribute("data-preset-load"));
      if (del) removeById("presetFiles", del.getAttribute("data-preset-delete"));
    });
    $("#resource-add-folder").addEventListener("click", addResourceFolder);
    $("#resource-folder-list").addEventListener("click", function (event) {
      var scan = event.target.closest("[data-folder-scan]"); var del = event.target.closest("[data-folder-delete]");
      if (scan) scanAllResources();
      if (del) { removeById("resourceFolders", del.getAttribute("data-folder-delete")); scanAllResources(); }
    });
    $("#resource-search").addEventListener("input", renderResources);
    $("#resource-type").addEventListener("change", renderResources);
    $("#resource-file-list").addEventListener("click", function (event) {
      var card = event.target.closest("[data-resource-path]"); if (!card) return; selectedResource = card.getAttribute("data-resource-path"); renderResources();
    });
    $("#resource-open").addEventListener("click", function () { openResource("open"); });
    $("#resource-place").addEventListener("click", function () { openResource("place"); });
    $("#style-export-json").addEventListener("click", exportLibrary);
    $("#style-import-json").addEventListener("click", importLibrary);
  }

  function renderAll() { renderColors(); renderGradients(); renderTextStyles(); renderLayerStyles(); renderPresetFiles(); renderFolders(); renderResources(); }
  function init() { loadState(); bind(); renderAll(); scanAllResources(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
}());
