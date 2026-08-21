(function () {
  "use strict";

  var cs = new CSInterface();
  var config = {
    tab: "common",
    detail: "import-images",
    layerDetail: "rename",
    importMode: "smart",
    importLayout: "overlay",
    importGap: 20,
    importFit: "original",
    exportTarget: "selected",
    exportFormat: "png",
    exportFolder: "",
    exportQuality: 90,
    exportOpenFolder: true,
    slimMetadata: true,
    slimEmptyLayers: true,
    slimEmptyGroups: false,
    slimHiddenLayers: false,
    slimOutsideLayers: false,
    font: "",
    fontFamily: "",
    fontStyle: "",
    fontSize: 48,
    tracking: 0,
    leading: 1.2,
    textAlign: "left",
    textColor: "#ffffff",
    fauxBold: false,
    fauxItalic: false,
    allCaps: false,
    opticalKern: false,
    leadingPoints: 58,
    textDirection: "horizontal",
    textPreset: "regular",
    recentFonts: [],
    quickFonts: [],
    quickFontIndex: 0,
    fontFilter: "all",
    fontCategory: "sans",
    fontSizePresets: [6,8,10,11,12,14,16,18,24,30,36,48,60,72,84,96,108,120],
    lineSpacePresets: [1,1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2,2.5],
    wordSpacePresets: [-100,-50,-25,0,25,50,75,100,200,300,500,1000],
    hierarchyPresets: {
      regular: [92,48,36,24,15,12],
      mobile: [72,50,28,20,16,10],
      arithmetic: [90,60,40,27,18,12],
      contrast: [92,50,20,15,14,12]
    },
    showQuickFont: true,
    showHierarchy: true,
    showAutoLayout: true,
    translateFrom: "auto",
    translateTo: "en",
    translateReplace: true,
    textButtonPaddingRule: "28,12",
    textButtonBorder: false,
    textButtonCorner: "0",
    autoLayoutScene: 0,
    autoLayoutMode: 0,
    autoLayoutBaseGap: 40,
    autoLayoutAutoGap: true,
    autoLayoutGapRatio: "0.8:1.5",
    copiedTextStyle: null,
    textButtonShape: "capsule",
    textButtonColor: "#e53935",
    textButtonPaddingX: 24,
    textButtonPaddingY: 12,
    textButtonRadius: 9999,
    textButtonGroup: false,
    autoLayoutSizes: "64,48,36,30,24,18",
    autoLayoutGap: 12,
    autoLayoutAlign: "left",
    renamePattern: "产品图###",
    renameStart: 1,
    renameDigits: 3,
    renameSort: "layer",
    renameChildren: false,
    findCriteria: ["name"],
    findSizeTolerance: 1,
    findResultAction: "select",
    findLabelColor: "yellow",
    rectApplySize: true,
    rectWidth: 300,
    rectHeight: 120,
    rectApplyRadius: false,
    rectRadius: 16,
    rectApplyFill: true,
    rectFill: "#ffffff",
    rectApplyStroke: false,
    rectStroke: "#000000",
    rectStrokeWidth: 0,
    rectApplyOpacity: false,
    rectOpacity: 100
  };
  var CONFIG_FILE = "tools-v1.json";
  var busy = false;
  var busyControls = null;
  var configSaveTimer = 0;
  var configDirty = false;
  /* 输入文字属性后递增，用于丢弃晚到的旧属性读取结果。 */

  var documentPresets = [
    { id: "1688-main", name: "1688主图", description: "1688商品主图与方形产品展示", width: 800, height: 800, safe: 0, background: "white" },
    { id: "related-marketing", name: "关联营销海报", description: "790px产品推荐与关联营销模块", width: 790, height: 1200, safe: 3, background: "white" },
    { id: "mobile-detail", name: "移动端详情单屏", description: "移动详情页单屏与9:16内容模块", width: 790, height: 1404, safe: 3, background: "white" },
    { id: "long-detail", name: "长详情页", description: "790px电商详情长图与连续排版", width: 790, height: 8000, safe: 3, background: "white" },
    { id: "pc-home", name: "PC首页", description: "1920px店铺首页长页与模块化设计", width: 1920, height: 5500, safe: 15, background: "white" },
    { id: "pc-banner-700", name: "PC轮播横幅", description: "首页首屏轮播与主视觉横幅", width: 1920, height: 700, safe: 15, background: "white" },
    { id: "pc-banner-550", name: "PC横幅550", description: "活动横幅、品牌条幅与楼层海报", width: 1920, height: 550, safe: 15, background: "white" },
    { id: "pc-banner-600", name: "PC横幅600", description: "产品专题横幅与场景主视觉", width: 1920, height: 600, safe: 15, background: "white" },
    { id: "vertical-poster", name: "竖屏海报", description: "1080×1920竖屏宣传与短视频封面", width: 1080, height: 1920, safe: 3, background: "white" },
    { id: "poster-3-4", name: "3:4海报", description: "商品海报、详情卡片与平台素材", width: 900, height: 1200, safe: 3, background: "white" }
  ];

  function $(selector) {
    return document.querySelector(selector);
  }

  function all(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function status(message) {
    if (window.XinyangStatus && typeof window.XinyangStatus.set === "function") {
      window.XinyangStatus.set(message);
      return;
    }
    var node = $("#status-text");
    if (node) node.textContent = String(message || "就绪");
  }

  function humanError(error) {
    return error && error.message ? error.message : String(error || "未知错误");
  }

  function hostInvoke(method, payload) {
    if (window.XinyangRuntime && window.XinyangRuntime.hostInvoke) {
      return window.XinyangRuntime.hostInvoke(method, payload || {});
    }
    return new Promise(function (resolve, reject) {
      var json = JSON.stringify(payload || {});
      var script = "LongStitchCEP.invoke(" + JSON.stringify(String(method)) + "," + JSON.stringify(json) + ")";
      cs.evalScript(script, function (raw) {
        try {
          if (!raw || raw === "EvalScript error.") throw new Error("Photoshop 脚本执行失败");
          var result = JSON.parse(raw);
          if (!result.ok) throw new Error(result.error || "Photoshop 操作失败");
          resolve(result.data || {});
        } catch (error) { reject(error); }
      });
    });
  }

  function userDataPath() {
    try {
      return cs.getSystemPath(SystemPath.USER_DATA).replace(/\\/g, "/");
    } catch (error) {
      return "";
    }
  }

  function configPath() {
    var root = userDataPath();
    return root ? root + "/XinyangAssistant/config/" + CONFIG_FILE : "";
  }

  function ensureConfigDirectory() {
    if (!window.cep || !window.cep.fs || !window.cep.fs.makedir) return false;
    var root = userDataPath();
    if (!root) return false;
    window.cep.fs.makedir(root + "/XinyangAssistant");
    window.cep.fs.makedir(root + "/XinyangAssistant/config");
    return true;
  }

  function readConfig() {
    var path = configPath();
    try {
      if (path && window.cep && window.cep.fs && window.cep.fs.readFile) {
        var result = window.cep.fs.readFile(path);
        if (result && result.err === 0 && result.data) {
          var parsed = JSON.parse(result.data);
          Object.keys(config).forEach(function (key) {
            if (parsed[key] !== undefined) config[key] = parsed[key];
          });
          return;
        }
      }
    } catch (error) {}
    try {
      var fallback = window.localStorage.getItem("xinyang.tools.v1");
      if (!fallback) return;
      var saved = JSON.parse(fallback);
      Object.keys(config).forEach(function (key) {
        if (saved[key] !== undefined) config[key] = saved[key];
      });
    } catch (ignoreFallback) {}
  }

  function saveConfigNow() {
    if (configSaveTimer) window.clearTimeout(configSaveTimer);
    configSaveTimer = 0;
    if (!configDirty) return;
    configDirty = false;
    var text = JSON.stringify(config, null, 2);
    try {
      ensureConfigDirectory();
      var path = configPath();
      if (path && window.cep && window.cep.fs && window.cep.fs.writeFile) {
        var result = window.cep.fs.writeFile(path, text);
        if (result && result.err === 0) return;
      }
    } catch (error) {}
    try {
      window.localStorage.setItem("xinyang.tools.v1", text);
    } catch (ignoreFallback) {}
  }

  function saveConfig() {
    configDirty = true;
    if (configSaveTimer) window.clearTimeout(configSaveTimer);
    configSaveTimer = window.setTimeout(saveConfigNow, 180);
  }

  function getBusyControls() {
    if (!busyControls) {
      busyControls = all(
        "#tools-panel button, #tools-panel input, #tools-panel select, " +
        "#document-panel button, #document-panel input, #document-panel select, " +
        "#typography-panel button, #typography-panel input, #typography-panel select"
      );
    }
    return busyControls;
  }

  function setBusy(value, message) {
    busy = !!value;
    getBusyControls().forEach(function (node) {
      if (node.id === "tool-export-pick" && !value) return;
      node.disabled = !!value;
    });
    if (!value) {
      getBusyControls().forEach(function (node) { node.disabled = false; });
      updateExportFields();
    }
    if (message) status(message);
  }

  function selectTab() {
    config.tab = "common";
    all(".tools-view").forEach(function (view) {
      view.classList.toggle("active", view.getAttribute("data-tools-view") === "common");
    });
    saveConfig();
  }

  function selectDetail(detail) {
    config.detail = detail;
    all(".tool-card").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-tool-detail") === detail);
    });
    all(".tool-detail").forEach(function (view) {
      view.classList.toggle("active", view.getAttribute("data-tool-detail-view") === detail);
    });
    saveConfig();
  }

  function selectLayerDetail(detail) {
    if (!/^(rename|find|rectangle|smart)$/.test(detail || "")) detail = "rename";
    config.layerDetail = detail;
    all("[data-layer-tool]").forEach(function (button) {
      var active = button.getAttribute("data-layer-tool") === detail;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    all("[data-layer-detail]").forEach(function (view) {
      view.classList.toggle("active", view.getAttribute("data-layer-detail") === detail);
    });
    saveConfig();
  }

  var toolsImportExportInstance = null;

  function getToolsImportExport() {
    if (toolsImportExportInstance) return toolsImportExportInstance;
    if (!window.XinyangToolsImportExport || !window.XinyangToolsImportExport.create) throw new Error("导入导出模块未加载");
    toolsImportExportInstance = window.XinyangToolsImportExport.create({
      config: config, $: $, cs: cs, isBusy: function () { return busy; },
      status: status, humanError: humanError, hostInvoke: hostInvoke, saveConfig: saveConfig,
      selectTab: selectTab, selectDetail: selectDetail, restoreWordsUi: restoreWordsUi, setBusy: setBusy
    });
    return toolsImportExportInstance;
  }

  function pickFolder() { var module = getToolsImportExport(); return module.pickFolder.apply(module, arguments); }

  function readCommonConfigFromUi() { var module = getToolsImportExport(); return module.readCommonConfigFromUi.apply(module, arguments); }

  function restoreUi() { var module = getToolsImportExport(); return module.restoreUi.apply(module, arguments); }

  function importImages() { var module = getToolsImportExport(); return module.importImages.apply(module, arguments); }

  function runFileSlim() { var module = getToolsImportExport(); return module.runFileSlim.apply(module, arguments); }

  function runBatchFileSlim() { var module = getToolsImportExport(); return module.runBatchFileSlim.apply(module, arguments); }

  function updateExportFields() { var module = getToolsImportExport(); return module.updateExportFields.apply(module, arguments); }

  function runBatchExport() { var module = getToolsImportExport(); return module.runBatchExport.apply(module, arguments); }

  var toolsTransformInstance = null;

  function getToolsTransform() {
    if (toolsTransformInstance) return toolsTransformInstance;
    if (!window.XinyangToolsTransform || !window.XinyangToolsTransform.create) throw new Error("图层变换模块未加载");
    toolsTransformInstance = window.XinyangToolsTransform.create({
      documentPresets: documentPresets, $: $, isBusy: function () { return busy; },
      status: status, humanError: humanError, hostInvoke: hostInvoke, setBusy: setBusy
    });
    return toolsTransformInstance;
  }

  function runTransform() { var module = getToolsTransform(); return module.runTransform.apply(module, arguments); }

  function renderDocumentPresets() { var module = getToolsTransform(); return module.renderDocumentPresets.apply(module, arguments); }

  function createDocument() { var module = getToolsTransform(); return module.createDocument.apply(module, arguments); }

  function createCustomDocument() { var module = getToolsTransform(); return module.createCustomDocument.apply(module, arguments); }

  function nodeValue(selector, fallback) {
    var node = $(selector);
    return node ? node.value : fallback;
  }

  function setNodeValue(selector, value) {
    var node = $(selector);
    if (node) node.value = value;
  }

  /*
   * v2.1.59：文字面板的字号、行距、字距统一使用整数。
   * Photoshop 可能返回 23.687999725 这类浮点值，读取、显示和提交时均四舍五入，
   * 避免重载后重新出现小数；precision 参数仅为兼容旧调用保留。
   */
  function normalizeMetricNumber(value, precision, fallback) {
    var number = Number(value);
    if (!isFinite(number)) number = Number(fallback);
    if (!isFinite(number)) number = 0;
    var rounded = Math.round(number);
    return rounded === 0 ? 0 : rounded;
  }

  function formatMetricNumber(value, precision, fallback) {
    return String(normalizeMetricNumber(value, 0, fallback));
  }

  function setMetricNodeValue(selector, value, precision, fallback) {
    setNodeValue(selector, formatMetricNumber(value, precision, fallback));
  }

  function setNodeChecked(selector, value) {
    var node = $(selector);
    if (node) node.checked = !!value;
  }

  function bindNode(selector, eventName, handler) {
    var node = $(selector);
    if (node) node.addEventListener(eventName, handler);
  }

  function toggleHidden(selector, forceOpen) {
    var node = typeof selector === "string" ? $(selector) : selector;
    if (!node) return false;
    var open = forceOpen === undefined ? node.hasAttribute("hidden") : !!forceOpen;
    if (open) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
    return open;
  }








































  /*
   * 自动读取文字属性前先确认 Photoshop 当前只有一个文字图层被选中。
   * 多选时只保留选择状态，不读取活动层，也不触发任何图层重选。
   */

  /*
   * 不再注册 Photoshop 的 slct 全局回调。部分 Photoshop 27 环境中，
   * 该回调会在 Ctrl/Shift 连续选层期间反复触发属性读取，进而打断多选。
   * 改为仅在文字面板可见时，低频、只读地轮询选择签名；多选状态只记录，
   * 不读取/回填单个图层属性，也不会执行任何重新选择动作。
   */


  /*
   * v2.2.02：文字选择状态改为自适应轮询。
   * 刚进入文字面板或检测到选择变化时保持较快响应；选择持续稳定后逐步降频，
   * 避免长期每 480ms 进入 Photoshop 宿主，降低长图/低内存场景下的队列和 CPU 压力。
   */






























  var typographyInstance = null;

  function getTypography() {
    if (typographyInstance) return typographyInstance;
    if (!window.XinyangToolsTypography || !window.XinyangToolsTypography.create) {
      throw new Error("文字工具模块未加载");
    }
    typographyInstance = window.XinyangToolsTypography.create({
      config: config, isBusy: function () { return busy; }, $: $, all: all,
      status: status, humanError: humanError, hostInvoke: hostInvoke,
      saveConfig: saveConfig, setBusy: setBusy, nodeValue: nodeValue,
      setNodeValue: setNodeValue, normalizeMetricNumber: normalizeMetricNumber,
      setMetricNodeValue: setMetricNodeValue, setNodeChecked: setNodeChecked,
      bindNode: bindNode, toggleHidden: toggleHidden, cs: cs
    });
    return typographyInstance;
  }

  function typographyCall(name, args) {
    var module = getTypography();
    if (!module || typeof module[name] !== "function") throw new Error("文字模块能力缺失：" + name);
    return module[name].apply(module, args || []);
  }

  function restoreWordsUi() { return typographyCall("restoreWordsUi", arguments); }
  function readAdvancedConfig() { return typographyCall("readAdvancedConfig", arguments); }
  function updateFontSizeChips() { return typographyCall("updateFontSizeChips", arguments); }
  function normalizeWordsConfig() { return typographyCall("normalizeWordsConfig", arguments); }
  function ensureTextSelectionListener() { return typographyCall("ensureTextSelectionListener", arguments); }
  function removeTextSelectionListener() { return typographyCall("removeTextSelectionListener", arguments); }

  var toolsBatchInstance = null;

  function getToolsBatch() {
    if (toolsBatchInstance) return toolsBatchInstance;
    if (!window.XinyangToolsBatch || !window.XinyangToolsBatch.create) throw new Error("批处理模块未加载");
    toolsBatchInstance = window.XinyangToolsBatch.create({
      config: config, $: $, isBusy: function () { return busy; }, status: status,
      humanError: humanError, hostInvoke: hostInvoke, readAdvancedConfig: readAdvancedConfig, setBusy: setBusy
    });
    return toolsBatchInstance;
  }

  function batchRenameLayers() { var module = getToolsBatch(); return module.batchRenameLayers.apply(module, arguments); }

  function findSimilarLayers() { var module = getToolsBatch(); return module.findSimilarLayers.apply(module, arguments); }

  function applyRectangleSettings() { var module = getToolsBatch(); return module.applyRectangleSettings.apply(module, arguments); }

  function runSmartObject() { var module = getToolsBatch(); return module.runSmartObject.apply(module, arguments); }

  var documentToolsBound = false;
  var typographyToolsBound = false;
  var lifecycleBound = false;

  function bindDocumentTools() {
    if (documentToolsBound) return;
    documentToolsBound = true;

    all(".tool-card").forEach(function (button) { button.addEventListener("click", function () { selectDetail(button.getAttribute("data-tool-detail")); }); });
    bindNode("#tool-import-run", "click", importImages);
    bindNode("#tool-slim-run", "click", runFileSlim);
    bindNode("#tool-slim-batch", "click", runBatchFileSlim);
    bindNode("#tool-export-pick", "click", function () {
      var folder = pickFolder(); if (!folder) return;
      config.exportFolder = folder; setNodeValue("#tool-export-folder", folder); saveConfig(); status("已选择导出目录：" + folder);
    });
    bindNode("#tool-export-run", "click", runBatchExport);
    bindNode("#tool-export-format", "change", function () { updateExportFields(); readCommonConfigFromUi(); });
    all("#tools-panel select, #tools-panel input, #document-panel select, #document-panel input").forEach(function (node) {
      node.addEventListener("change", function () { if (/^tool-import-|^tool-export-|^slim-/.test(node.id)) readCommonConfigFromUi(); });
    });
    all("[data-transform-action]").forEach(function (button) { button.addEventListener("click", function () { runTransform(button.getAttribute("data-transform-action")); }); });
    bindNode("#document-preset-list", "click", function (event) {
      var button = event.target.closest("[data-preset-id]"); if (!button) return;
      var id = button.getAttribute("data-preset-id");
      var preset = documentPresets.filter(function (item) { return item.id === id; })[0]; if (preset) createDocument(preset);
    });
    bindNode("#custom-doc-create", "click", createCustomDocument);
  }

  function activateDocumentTools() {
    if (!window.XinyangToolsImportExport || !window.XinyangToolsTransform) {
      throw new Error("文档工具依赖尚未加载完成");
    }
    renderDocumentPresets();
    bindDocumentTools();
    restoreUi();
  }

  function activateTypographyTools() {
    if (!window.XinyangToolsTypography || !window.XinyangToolsTypography.create) {
      throw new Error("文字工具依赖尚未加载完成");
    }
    if (!typographyToolsBound) {
      normalizeWordsConfig();
      updateFontSizeChips();
      getTypography().bindTypography();
      restoreWordsUi();
      getTypography().setRealtimeReady(true);
      typographyToolsBound = true;
    }
    getTypography().activateTypographyPanel();
  }

  function deactivateTypographyTools() {
    if (!typographyInstance) return;
    try { typographyInstance.deactivateTypographyPanel(); } catch (ignoreDeactivate) {}
  }

  function bindRuntimeLifecycle() {
    if (lifecycleBound) return;
    lifecycleBound = true;
    window.addEventListener("pagehide", saveConfigNow);
    window.addEventListener("beforeunload", saveConfigNow);
    window.addEventListener("unload", function () {
      if (typographyInstance) {
        try { typographyInstance.destroy(); } catch (ignoreRemove) {}
      }
    });
    document.addEventListener("xinyang:runtimehidden", function () {
      /* 面板隐藏时不允许文字同步继续占用 Photoshop 主线程。 */
      deactivateTypographyTools();
    });
    document.addEventListener("xinyang:runtimeresume", function () {
      /* 返回仍处于文字页的面板时重新启用事件同步，不重复绑定 UI。 */
      var typographyPanel = document.querySelector("#typography-panel");
      if (typographyPanel && !typographyPanel.hasAttribute("hidden") && typographyPanel.classList.contains("panel-active")) {
        activateTypographyTools();
      }
    });
  }

  function handlePanelReady(panelId) {
    try {
      if (panelId === "document-panel") activateDocumentTools();
      if (panelId === "typography-panel") activateTypographyTools();
    } catch (error) {
      status("工具模块初始化失败：" + humanError(error));
    }
  }

  function init() {
    if (window.__XINYANG_TOOLS_INITIALIZED__) return;
    window.__XINYANG_TOOLS_INITIALIZED__ = true;
    readConfig();
    bindRuntimeLifecycle();
    document.addEventListener("xinyang:panelchange", function (event) {
      var panelId = event && event.detail ? event.detail.panelId : "";
      if (panelId !== "typography-panel") deactivateTypographyTools();
    });
    document.addEventListener("xinyang:panelready", function (event) {
      var panelId = event && event.detail ? event.detail.panelId : "";
      handlePanelReady(panelId);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
