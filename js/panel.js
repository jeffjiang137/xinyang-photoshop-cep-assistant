(function () {
  "use strict";

  var cs = new CSInterface();
  var IMAGE_EXTENSIONS = {
    jpg: true, jpeg: true, png: true, webp: true,
    psd: true, psb: true, tif: true, tiff: true, bmp: true
  };
  var LOCAL_OCR_URL = "http://127.0.0.1:8866";
  var LOCAL_LAMA_URL = "http://127.0.0.1:8867";
  var LOCAL_IOPAINT_URL = "http://127.0.0.1:8080";
  var IOPAINT_PACKAGE_VERSION = "1.5.3";
  var IOPAINT_MODEL_URL = "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt";
  var IOPAINT_MODEL_MD5 = "e3aa4aaa15225a33ec84f9f4bc47e500";
  var STORAGE_KEYS = {
    activePanel: "longStitch.activePanel",
    backgroundRunning: "longStitch.backgroundRunning",
    session: "longStitch.session.v1",
    ocrApiUrl: "longStitch.ocrApiUrl",
    legacyOcrServiceUrl: "longStitch.ocrServiceUrl",
    ocrApiKey: "longStitch.ocrApiKey",
    eraseMode: "longStitch.eraseMode",
    lamaServiceUrl: "longStitch.lamaServiceUrl",
    iopaintInstallPath: "longStitch.iopaintInstallPath",
    iopaintIdleMinutes: "longStitch.iopaintIdleMinutes"
  };
  var VALID_PANELS = {
    "stitch-panel": true,
    "framework-panel": true,
    "spacing-panel": true,
    "text-panel": true,
    "guides-panel": true,
    "document-panel": true,
    "typography-panel": true,
    "tools-panel": true,
    "settings-panel": true
  };
  var state = {
    files: [],
    stitchBusy: false,
    sliceBusy: false,
    sliceExportBusy: false,
    spacingBusy: false,
    targetWidth: 790,
    widthManuallySelected: false,
    widthDetectionToken: 0,
    activePanel: "stitch-panel",
    backgroundRunning: true,
    filesRendered: false,
    filesRenderScheduled: false,
    sessionRestored: false,
    persistTimer: 0,
    sessionDirty: false,
    panelScrollPositions: {},
    dom: null,
    ocrBusy: false,
    ocrResult: null,
    ocrSource: null,
    eraseBusy: false,
    lastEraseLayerId: 0,
    eraseLayersBySelection: {},
    localOcrAvailable: false,
    localOcrEngine: "",
    localOcrChecking: false,
    localOcrCheckedAt: 0,
    localOcrPromise: null,
    localLamaAvailable: false,
    localLamaReachable: false,
    localLamaRouteVerified: false,
    localLamaRouteNote: "",
    localLamaEngine: "",
    localLamaChecking: false,
    localLamaCheckedAt: 0,
    localLamaPromise: null,
    localLamaFault: "",
    localLamaFaultUrl: "",
    localLamaFaultAt: 0,
    panelDomReady: false,
    serviceDetectionStarted: false,
    localLamaUrl: "http://127.0.0.1:8867",
    localLamaProtocol: "legacy",
    iopaintInstallPath: "",
    iopaintIdleMinutes: 10,
    iopaintInstalled: false,
    iopaintInstallChecking: false,
    iopaintInstallBusy: false,
    iopaintProcess: null,
    iopaintProcessPid: 0,
    iopaintStartPromise: null,
    iopaintIdleTimer: 0,
    iopaintActiveRequests: 0
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  var statusResetTimer = 0;
  var statusObserver = null;

  function classifyStatus(text) {
    var value = String(text || "就绪");
    if (!value || value === "就绪") return "ready";
    if (/(失败|错误|不可用|未检测到|没有找到|无法|请先|超时|异常|中断)/.test(value)) return "error";
    if (/(警告|跳过|等待|保留|较长|耗时|部分|取消)/.test(value)) return "warning";

    /*
     * “创建完成”过去会因为以“创建”开头被误判为忙碌状态，
     * 因而永远不触发自动恢复。先识别完成语义，再判断进行中。
     */
    if (/(完成|成功|已创建|已生成|已保存|已导出|已更新|已应用|已复制|已清理|已执行|已切换|连接正常|可用$)/.test(value)) {
      return "success";
    }
    if (/^(正在|开始|读取|识别|检测|检查|创建中|调整中|拼接中|执行中|处理中|保存中|下载中|安装中|导入中|导出中|翻译中|擦除中|连接中|启动中)/.test(value)) {
      return "busy";
    }
    return "success";
  }

  function renderStatusBar(message, options) {
    var text = String(message || "就绪");
    var statusText = $("#status-text");
    var footer = document.querySelector("footer");
    var kind;
    var delay;
    options = options || {};
    if (!statusText || !footer) return;

    if (statusText.textContent !== text) statusText.textContent = text;
    window.clearTimeout(statusResetTimer);
    statusResetTimer = 0;
    footer.classList.remove("status-success", "status-warning", "status-error", "status-busy");

    kind = classifyStatus(text);
    footer.setAttribute("data-status", kind);
    if (kind !== "ready") footer.classList.add("status-" + kind);

    /*
     * 底栏始终占据固定布局空间。进行中的任务保留当前文字；
     * 完成、警告和失败在可读时间后恢复“就绪”，但不隐藏底栏。
     */
    if (!options.skipReset && kind !== "ready" && kind !== "busy") {
      delay = kind === "error" ? 6200 : (kind === "warning" ? 4800 : 3000);
      statusResetTimer = window.setTimeout(function () {
        renderStatusBar("就绪", { skipReset: true });
      }, delay);
    }
  }

  function setStatus(message) {
    renderStatusBar(message);
  }

  function ensurePanelModules(panelId) {
    if (window.XinyangRuntime && window.XinyangRuntime.ensurePanelModule) {
      return window.XinyangRuntime.ensurePanelModule(panelId);
    }
    return Promise.resolve(true);
  }

  function ensureFeatureModule(featureName) {
    if (window.XinyangRuntime && window.XinyangRuntime.ensureFeatureModule) {
      return window.XinyangRuntime.ensureFeatureModule(featureName);
    }
    return Promise.resolve(true);
  }

  function runAfterPanelModules(panelId, task, loadingMessage) {
    if (loadingMessage) setStatus(loadingMessage);
    return ensurePanelModules(panelId).then(function () {
      return task();
    }).catch(function (error) {
      setStatus("功能模块加载失败：" + humanError(error));
    });
  }

  function normalizeServiceUrlFallback(value, fallback) {
    var text = String(value || fallback || "").trim();
    return text ? text.replace(/\/+$/, "") : "";
  }

  function initializeStatusBar() {
    var statusText = $("#status-text");
    if (!statusText || statusText.getAttribute("data-status-managed") === "1") return;
    statusText.setAttribute("data-status-managed", "1");
    renderStatusBar(statusText.textContent || "就绪");

    /*
     * tools/framework/runtime 等按需模块仍可直接修改 status-text。
     * 统一监听文本变化，确保所有页面都得到相同的状态分类和复位行为。
     */
    if (typeof MutationObserver === "function") {
      statusObserver = new MutationObserver(function () {
        renderStatusBar(statusText.textContent || "就绪");
      });
      statusObserver.observe(statusText, { childList: true, characterData: true, subtree: true });
    }
    window.XinyangStatus = {
      set: setStatus,
      ready: function () { renderStatusBar("就绪", { skipReset: true }); }
    };
  }

  function fallbackBundleVersion() {
    var script = document.querySelector('script[src*="panel.js"]');
    var source = script ? String(script.getAttribute("src") || "") : "";
    var match = source.match(/[?&]v=([^&#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function readBundleVersion() {
    /*
     * 版本号由构建阶段注入。旧版启动时同步读取 manifest.xml，CEP 的同步
     * 文件 I/O 会与面板首帧竞争，切回插件时容易出现短暂空白。
     */
    return String(
      window.XINYANG_BUNDLE_VERSION || fallbackBundleVersion() || ""
    );
  }

  function renderBundleVersion() {
    var node = $("#plugin-version");
    if (!node) return;
    var version = String(readBundleVersion() || "").replace(/^v/i, "");
    node.textContent = version ? "当前版本 v" + version : "当前版本未知";
  }

  function storageGet(key) {
    return window.XinyangStorage.get(key);
  }

  function storageSet(key, value) {
    return window.XinyangStorage.set(key, value);
  }

  function storageRemove(key) {
    window.XinyangStorage.remove(key);
  }

  function currentSpacingValues() {
    return {
      side: $("#side-margin") ? $("#side-margin").value : "0",
      top: $("#top-spacing") ? $("#top-spacing").value : "0",
      bottom: $("#bottom-spacing") ? $("#bottom-spacing").value : "0"
    };
  }

  function persistSessionNow() {
    if (!state.backgroundRunning) return;
    storageSet(STORAGE_KEYS.session, JSON.stringify({
      files: state.files.slice(),
      targetWidth: state.targetWidth,
      widthManuallySelected: state.widthManuallySelected,
      spacing: currentSpacingValues()
    }));
    state.sessionDirty = false;
  }

  function persistSession() {
    if (!state.backgroundRunning) return;
    state.sessionDirty = true;
    if (state.persistTimer) window.clearTimeout(state.persistTimer);
    state.persistTimer = window.setTimeout(function () {
      state.persistTimer = 0;
      persistSessionNow();
    }, 120);
  }

  function restoreSession() {
    if (!state.backgroundRunning) {
      state.sessionRestored = true;
      return;
    }
    var raw = storageGet(STORAGE_KEYS.session);
    if (!raw) {
      state.sessionRestored = true;
      return;
    }

    try {
      var saved = JSON.parse(raw);
      if (saved && Array.isArray(saved.files)) {
        state.files = saved.files.filter(function (path) {
          return typeof path === "string" && isSupportedImage(path);
        });
        state.files.sort(naturalCompare);
      }
      state.targetWidth = Number(saved.targetWidth) === 1920 ? 1920 : 790;
      state.widthManuallySelected = !!saved.widthManuallySelected;
      if (saved.spacing) {
        $("#side-margin").value = /^-?\d+$/.test(String(saved.spacing.side))
          ? String(saved.spacing.side)
          : "0";
        $("#top-spacing").value = /^-?\d+$/.test(String(saved.spacing.top))
          ? String(saved.spacing.top)
          : "0";
        $("#bottom-spacing").value = /^-?\d+$/.test(String(saved.spacing.bottom))
          ? String(saved.spacing.bottom)
          : "0";
      }
    } catch (error) {
      storageRemove(STORAGE_KEYS.session);
    }
    state.filesRendered = false;
    state.sessionRestored = true;
    setSelectedWidth(state.targetWidth, state.widthManuallySelected, true);
    if (state.activePanel === "stitch-panel") {
      scheduleFilesRender();
    } else {
      updateFileControls();
    }
  }

  function scheduleSessionRestore() {
    var restore = function () {
      restoreSession();
    };
    /*
     * 先让静态 HTML/CSS 完成首帧绘制，再解析可能很长的图片路径列表。
     * 即使宿主重新创建了 CEP 页面，也会先立即显示面板，而不是白屏等待。
     */
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(function () {
        window.setTimeout(restore, 0);
      });
    } else {
      window.setTimeout(restore, 16);
    }
  }

  function schedulePhotoshopPersistence() {
    if (!state.backgroundRunning) return;
    if (window.XinyangRuntime && window.XinyangRuntime.requestPersistence) {
      window.XinyangRuntime.requestPersistence(true);
      return;
    }
    setPhotoshopPersistence(true);
    window.setTimeout(function () {
      if (state.backgroundRunning) setPhotoshopPersistence(true);
    }, 240);
  }

  function setPhotoshopPersistence(enabled) {
    if (enabled && window.XinyangRuntime && window.XinyangRuntime.requestPersistence) {
      return window.XinyangRuntime.requestPersistence(true);
    }
    try {
      var event = new CSEvent(
        enabled
          ? "com.adobe.PhotoshopPersistent"
          : "com.adobe.PhotoshopUnPersistent",
        "APPLICATION"
      );
      event.extensionId =
        cs.getExtensionID() ||
        "com.jeffjiang.ecommerce-design-assistant-cep.panel";
      return cs.dispatchEvent(event);
    } catch (error) {
      return false;
    }
  }

  function updateBackgroundSession(enabled, announce) {
    state.backgroundRunning = !!enabled;
    storageSet(
      STORAGE_KEYS.backgroundRunning,
      state.backgroundRunning ? "1" : "0"
    );

    if (state.backgroundRunning) {
      persistSession();
    } else {
      if (state.persistTimer) {
        window.clearTimeout(state.persistTimer);
        state.persistTimer = 0;
      }
      storageRemove(STORAGE_KEYS.session);
    }
    var persistenceAvailable = setPhotoshopPersistence(state.backgroundRunning);

    if (announce) {
      setStatus(
        state.backgroundRunning
          ? persistenceAvailable
            ? "插件后台运行已开启，已请求保持 CEP 会话并减少重复初始化"
            : "已保存设置；当前 CEP 主机未确认持久化能力"
          : "插件后台运行已关闭；切换到其他插件再返回时将自动重新加载"
      );
    }
  }

  function manualReloadPlugin() {
    var button = $("#manual-reload-plugin");
    if (button) {
      button.disabled = true;
      button.textContent = "正在重新加载…";
    }
    setStatus("正在重新加载插件并读取磁盘上的最新文件…");

    /*
     * 不修改后台运行设置。手动操作始终强制刷新当前 CEP 页面，并为
     * index.html 增加时间戳，避免 Photoshop/Chromium 继续使用旧缓存。
     */
    window.setTimeout(function () {
      if (
        window.XinyangRuntime &&
        typeof window.XinyangRuntime.manualReloadExtension === "function"
      ) {
        window.XinyangRuntime.manualReloadExtension("settings-button");
        return;
      }

      try {
        var href = String(window.location.href || "index.html");
        var hash = "";
        var hashIndex = href.indexOf("#");
        if (hashIndex >= 0) {
          hash = href.slice(hashIndex);
          href = href.slice(0, hashIndex);
        }
        href = href
          .replace(/([?&])xinyang_reload=[^&#]*&?/g, "$1")
          .replace(/[?&]$/, "");
        href += (href.indexOf("?") >= 0 ? "&" : "?") +
          "xinyang_reload=" + (Date.now ? Date.now() : new Date().getTime());
        window.location.replace(href + hash);
      } catch (error) {
        if (button) {
          button.disabled = false;
          button.textContent = "重新加载插件";
        }
        setStatus("重新加载失败：" + humanError(error));
      }
    }, 60);
  }

  function baseName(path) {
    return String(path || "").replace(/\\/g, "/").split("/").pop();
  }

  function parentFolderPath(filePath) {
    var value = String(filePath || "");
    if (!value) return "";
    try {
      return nodeFsHelpers().path.dirname(value);
    } catch (ignoreNodePath) {
      value = value.replace(/\\/g, "/").replace(/\/+$/, "");
      var index = value.lastIndexOf("/");
      return index > 0 ? value.slice(0, index) : "";
    }
  }

  function chooseSliceExportFolder(initialPath) {
    var result = window.cep.fs.showOpenDialogEx(
      false,
      true,
      "选择导出文件夹",
      String(initialPath || ""),
      []
    );
    return result && result.err === 0 && result.data && result.data.length
      ? String(result.data[0] || "")
      : "";
  }

  function extension(path) {
    var name = baseName(path);
    var dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  }

  function isSupportedImage(path) {
    return !!IMAGE_EXTENSIONS[extension(path)];
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function tokenizeName(value) {
    return String(value || "").toLowerCase().split(/(\d+)/).filter(function (part) {
      return part !== "";
    });
  }

  function naturalCompare(a, b) {
    var left = tokenizeName(baseName(a));
    var right = tokenizeName(baseName(b));
    var length = Math.max(left.length, right.length);
    var index;

    for (index = 0; index < length; index += 1) {
      if (left[index] === undefined) return -1;
      if (right[index] === undefined) return 1;
      if (left[index] === right[index]) continue;

      var leftIsNumber = /^\d+$/.test(left[index]);
      var rightIsNumber = /^\d+$/.test(right[index]);
      if (leftIsNumber && rightIsNumber) {
        var difference = Number(left[index]) - Number(right[index]);
        if (difference) return difference;
        return left[index].length - right[index].length;
      }

      var lexical = left[index].localeCompare(right[index], "zh-CN");
      if (lexical) return lexical;
    }

    return String(a).localeCompare(String(b), "zh-CN");
  }

  function normalizedPath(path) {
    return String(path || "").replace(/\//g, "\\").toLowerCase();
  }

  function addFiles(paths) {
    var existing = {};
    var added = 0;
    var rejected = 0;

    state.files.forEach(function (path) {
      existing[normalizedPath(path)] = true;
    });

    Array.prototype.slice.call(paths || []).forEach(function (path) {
      path = String(path || "");
      if (!path || !isSupportedImage(path)) {
        rejected += 1;
        return;
      }
      var key = normalizedPath(path);
      if (existing[key]) return;
      existing[key] = true;
      state.files.push(path);
      added += 1;
    });

    state.files.sort(naturalCompare);
    renderFiles();
    persistSession();

    if (added) {
      setStatus("已加入 " + added + " 张图片，并按文件名自动排序");
      autoMatchWidth();
    } else if (rejected) {
      setStatus("没有找到支持的图片文件");
    } else {
      setStatus("所选图片已在列表中");
    }
  }

  function ensureGuidePageLoaded() {
    var frame = $("#guide-page-frame");
    if (!frame || frame.getAttribute("data-loaded") === "1") return;
    var source = frame.getAttribute("data-src");
    if (!source) return;
    frame.setAttribute("data-loaded", "1");
    frame.setAttribute("src", source);
  }

  function ensureLocalServiceDetection() {
    if (state.serviceDetectionStarted) return;
    state.serviceDetectionStarted = true;
    window.setTimeout(function () {
      try {
        detectLocalOcr(false, false);
        detectLocalLama(false, false);
      } catch (error) {
        state.serviceDetectionStarted = false;
        setStatus("本机服务初始化失败：" + humanError(error));
      }
    }, 40);
  }

  function onPanelModulesReady(panelId) {
    if (panelId === "text-panel" || panelId === "settings-panel") {
      try {
        renderLocalOcrStatus();
        renderLocalLamaStatus();
        refreshManagedIopaintInstallState();
        ensureLocalServiceDetection();
      } catch (error) {
        setStatus("本机服务模块初始化失败：" + humanError(error));
      }
    }
    if (panelId === "settings-panel") {
      renderBaiduTranslatorSettings();
    }
    try {
      document.dispatchEvent(new CustomEvent("xinyang:panelready", {
        detail: { panelId: panelId }
      }));
    } catch (ignorePanelReadyEvent) {}
  }

  function setPanelNodeActive(node, active) {
    if (!node) return;
    node.classList.toggle("panel-active", !!active);
    node.hidden = !active;
    node.setAttribute("aria-hidden", active ? "false" : "true");
  }

  function setNavButtonActive(node, active) {
    if (!node) return;
    node.classList.toggle("active", !!active);
    node.setAttribute("aria-selected", active ? "true" : "false");
  }

  function setActivePanel(panelId, skipAnnouncement) {
    if (!VALID_PANELS[panelId]) panelId = "stitch-panel";
    var dom = state.dom || {};
    var buttons = dom.navButtons || document.querySelectorAll(".nav-button");
    var panels = dom.panels || document.querySelectorAll(".tool-panel");
    var content = dom.content || document.querySelector(".content");
    var previousPanel = state.activePanel;
    var index;

    if (content && previousPanel) {
      state.panelScrollPositions[previousPanel] = Number(content.scrollTop) || 0;
    }

    if (state.panelDomReady && previousPanel === panelId) return;
    state.activePanel = panelId;
    storageSet(STORAGE_KEYS.activePanel, panelId);
    if (panelId === "guides-panel") ensureGuidePageLoaded();
    ensurePanelModules(panelId).then(function () {
      if (state.activePanel === panelId) onPanelModulesReady(panelId);
    }).catch(function (error) {
      if (state.activePanel === panelId) {
        setStatus("功能模块加载失败：" + humanError(error));
      }
    });

    /*
     * 旧版每次切换都修改 html[data-initial-panel]，会让全部样式规则重新
     * 匹配并对大型文字/工具页面做全局重排，看起来像重新加载。运行阶段
     * 改为只切换目标面板和导航按钮的 class/hidden 状态。
     */
    if (!state.panelDomReady) {
      for (index = 0; index < panels.length; index += 1) {
        setPanelNodeActive(panels[index], panels[index].id === panelId);
      }
      for (index = 0; index < buttons.length; index += 1) {
        setNavButtonActive(
          buttons[index],
          buttons[index].getAttribute("data-panel") === panelId
        );
      }
    } else {
      /* 后续只更新前后两个节点，避免每次切换让九个大面板全部失效重排。 */
      setPanelNodeActive(dom.panelById && dom.panelById[previousPanel], false);
      setPanelNodeActive(dom.panelById && dom.panelById[panelId], true);
      setNavButtonActive(dom.navByPanel && dom.navByPanel[previousPanel], false);
      setNavButtonActive(dom.navByPanel && dom.navByPanel[panelId], true);
    }
    if (content) content.classList.toggle("guides-content-active", panelId === "guides-panel");
    /* 首帧完成后移除只用于防白屏的初始属性，后续不再触发全局选择器重算。 */
    document.documentElement.removeAttribute("data-initial-panel");
    state.panelDomReady = true;
    try {
      document.dispatchEvent(new CustomEvent("xinyang:panelchange", {
        detail: { panelId: panelId, previousPanel: previousPanel }
      }));
    } catch (ignorePanelEvent) {}

    if (content) {
      var targetScroll = Number(state.panelScrollPositions[panelId]) || 0;
      var restoreScroll = function () {
        if (state.activePanel === panelId) content.scrollTop = targetScroll;
      };
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(restoreScroll);
      } else {
        window.setTimeout(restoreScroll, 0);
      }
    }

    if (!skipAnnouncement) {
      setStatus(
        panelId === "framework-panel"
          ? "按行列表达式生成矩形、圆形或方形自定义框架"
          : panelId === "spacing-panel"
          ? "在 Photoshop 图层面板中选择一张图片后设置间距"
          : panelId === "guides-panel"
            ? "按画布、选区、图层或画板创建和管理参考线"
            : panelId === "document-panel"
              ? "使用文档预设快速创建画布与安全参考线"
              : panelId === "typography-panel"
                ? "设置字体、字号、字距、行距与文字排版"
                : panelId === "tools-panel"
                  ? "使用常用功能与图层工具"
                  : panelId === "settings-panel"
              ? "可设置插件是否在切换 Photoshop 面板后保留当前会话"
              : panelId === "text-panel"
                ? "选择一个包含文字的图片图层后开始 OCR 识别"
                : "拖入多张图片，插件会自动按文件名排序"
      );
    }

    if (
      panelId === "stitch-panel" &&
      state.sessionRestored &&
      !state.filesRendered
    ) {
      scheduleFilesRender();
    }
  }

  function setSelectedWidth(width, isManual, skipPersist) {
    width = Number(width) === 1920 ? 1920 : 790;
    state.targetWidth = width;
    if (isManual) state.widthManuallySelected = true;

    var buttons = document.querySelectorAll(".width-button");
    var index;
    for (index = 0; index < buttons.length; index += 1) {
      var active = Number(buttons[index].getAttribute("data-width")) === width;
      buttons[index].classList.toggle("active", active);
      buttons[index].setAttribute("aria-pressed", active ? "true" : "false");
    }

    updateCreateButton();
    if (!skipPersist) persistSession();
  }

  function updateCreateButton() {
    var button = $("#create-stitch");
    if (!button) return;
    button.textContent = state.stitchBusy
      ? "正在创建长图…"
      : "创建 " + state.targetWidth + "px 分层长图";
  }

  function updateSliceButton() {
    var button = $("#create-slices");
    if (button) {
      button.textContent = state.sliceBusy
        ? "正在分析并切片…"
        : "智能切片";
      button.disabled =
        state.sliceBusy || state.sliceExportBusy || state.stitchBusy ||
        state.spacingBusy || state.ocrBusy || state.eraseBusy;
    }
    var exportButton = $("#export-slices");
    if (exportButton) {
      exportButton.textContent = state.sliceExportBusy
        ? "正在导出…"
        : "导出切片";
      exportButton.disabled =
        state.sliceExportBusy || state.sliceBusy || state.stitchBusy ||
        state.spacingBusy || state.ocrBusy || state.eraseBusy;
    }
  }

  function updateWidthButtonsDisabled() {
    var disabled =
      state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    Array.prototype.slice.call(
      document.querySelectorAll(".width-button")
    ).forEach(function (button) {
      button.disabled = disabled;
    });
  }

  function fileUrl(path) {
    var normalized = String(path || "").replace(/\\/g, "/");
    var parts = normalized.split("/");
    var encoded = parts.map(function (part, index) {
      if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
      return encodeURIComponent(part);
    }).join("/");
    return "file:///" + encoded;
  }

  function browserImageWidth(path) {
    return new Promise(function (resolve) {
      var ext = extension(path);
      if (!/^(jpg|jpeg|png|webp|bmp)$/.test(ext)) {
        resolve(0);
        return;
      }

      var image = new Image();
      var settled = false;
      var timeout = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        image.onload = null;
        image.onerror = null;
        image.src = "";
        resolve(0);
      }, 2500);

      image.onload = function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        var width = Number(image.naturalWidth || image.width || 0);
        image.onload = null;
        image.onerror = null;
        image.src = "";
        resolve(width);
      };
      image.onerror = function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        image.src = "";
        resolve(0);
      };
      image.src = fileUrl(path);
    });
  }

  function readWidthsSequentially(paths, index, output) {
    if (index >= paths.length) return Promise.resolve(output);
    return browserImageWidth(paths[index]).then(function (width) {
      if (width > 0) output.push(width);
      return readWidthsSequentially(paths, index + 1, output);
    });
  }

  function median(values) {
    values = values.filter(function (value) {
      return isFinite(value) && value > 0;
    }).sort(function (a, b) {
      return a - b;
    });
    if (!values.length) return 0;
    var middle = Math.floor(values.length / 2);
    if (values.length % 2) return values[middle];
    return (values[middle - 1] + values[middle]) / 2;
  }

  function closestCanvasWidth(sourceWidth) {
    return Math.abs(sourceWidth - 790) <= Math.abs(sourceWidth - 1920)
      ? 790
      : 1920;
  }

  function autoMatchWidth() {
    if (!state.files.length || state.widthManuallySelected) return;

    var token = state.widthDetectionToken + 1;
    state.widthDetectionToken = token;
    /*
     * 最多顺序读取前 5 张，避免多张长图同时解码造成面板卡顿。
     * 同批详情页图片通常同宽，取样中位数足以稳定匹配。
     */
    var candidates = state.files.slice(0, 5);

    readWidthsSequentially(candidates, 0, []).then(function (widths) {
      if (token !== state.widthDetectionToken || state.widthManuallySelected) {
        return 0;
      }
      var sourceWidth = median(widths);
      if (sourceWidth) return sourceWidth;

      /*
       * PSD / PSB / TIF 等无法由 CEP 浏览器直接读取尺寸时，
       * 只让 Photoshop 检查列表中的一张代表图片并立即关闭。
       */
      return hostInvoke("inspectImageWidth", {
        path: state.files[0]
      }).then(function (result) {
        return Number(result && result.width ? result.width : 0);
      }).catch(function () {
        return 0;
      });
    }).then(function (sourceWidth) {
      if (
        !sourceWidth ||
        token !== state.widthDetectionToken ||
        state.widthManuallySelected
      ) {
        return;
      }
      var matchedWidth = closestCanvasWidth(sourceWidth);
      setSelectedWidth(matchedWidth, false);
      setStatus(
        "原图宽度约 " + Math.round(sourceWidth) +
        "px，已自动选择 " + matchedWidth + "px"
      );
    });
  }

  function renderFiles() {
    var container = $("#file-list");
    var renderLimit = 120;
    var visibleFiles = state.files.slice(0, renderLimit);
    state.filesRendered = true;
    state.filesRenderScheduled = false;
    $("#file-count").textContent = state.files.length + " 张";
    $("#clear-files").disabled =
      state.stitchBusy || state.spacingBusy || !state.files.length;
    $("#create-stitch").disabled =
      state.stitchBusy || state.spacingBusy || !state.files.length;

    if (!state.files.length) {
      container.className = "file-list empty";
      container.textContent = "支持 JPG、PNG、WEBP、PSD、PSB、TIF、BMP";
      return;
    }

    container.className = "file-list";
    container.innerHTML = visibleFiles.map(function (path, index) {
      var number = String(index + 1);
      if (number.length < 2) number = "0" + number;
      return '<div class="file-row" data-index="' + index + '">' +
        '<span class="file-index">' + number + '</span>' +
        '<div class="row-main">' +
          '<div class="row-title" title="' + escapeHtml(baseName(path)) + '">' +
            escapeHtml(baseName(path)) +
          '</div>' +
          '<div class="row-meta" title="' + escapeHtml(path) + '">' +
            escapeHtml(path) +
          '</div>' +
        '</div>' +
        '<button class="remove-file" type="button" title="移除" aria-label="移除 ' +
          escapeHtml(baseName(path)) + '">×</button>' +
      '</div>';
    }).join("") + (
      state.files.length > renderLimit
        ? '<div class="file-list-more">其余 ' +
          (state.files.length - renderLimit) +
          ' 张已保留，将按列表顺序参与拼接</div>'
        : ""
    );
  }

  function updateFileControls() {
    $("#file-count").textContent = state.files.length + " 张";
    $("#clear-files").disabled =
      state.stitchBusy || state.spacingBusy || !state.files.length;
    $("#create-stitch").disabled =
      state.stitchBusy || state.spacingBusy || !state.files.length;
  }

  function scheduleFilesRender() {
    if (state.filesRendered || state.filesRenderScheduled) return;
    state.filesRenderScheduled = true;
    updateFileControls();

    if (state.files.length) {
      var container = $("#file-list");
      container.className = "file-list empty";
      container.textContent = "正在恢复图片列表…";
    }

    var render = function () {
      if (!state.filesRendered) renderFiles();
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(render, { timeout: 80 });
    } else {
      window.setTimeout(render, 0);
    }
  }

  function hostInvoke(method, payload) {
    if (window.XinyangRuntime && window.XinyangRuntime.hostInvoke) {
      return window.XinyangRuntime.hostInvoke(method, payload || {});
    }
    return new Promise(function (resolve, reject) {
      var json = JSON.stringify(payload || {});
      var script = "LongStitchCEP.invoke(" +
        JSON.stringify(String(method)) + "," +
        JSON.stringify(json) + ")";
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

  function showOpenFiles() {
    var result = window.cep.fs.showOpenDialogEx(
      true,
      false,
      "选择需要拼接的多张图片",
      "",
      ["jpg", "jpeg", "png", "webp", "psd", "psb", "tif", "tiff", "bmp"]
    );
    return result && result.err === 0 && result.data ? result.data : [];
  }

  function droppedPaths(event) {
    var output = [];
    var files = event.dataTransfer && event.dataTransfer.files
      ? event.dataTransfer.files
      : [];
    var index;

    for (index = 0; index < files.length; index += 1) {
      var file = files[index];
      var path = file.path || file.nativePath || "";
      if (path) output.push(path);
    }
    return output;
  }

  function setBusy(isBusy) {
    state.stitchBusy = isBusy;
    var button = $("#create-stitch");
    button.disabled =
      isBusy || state.sliceBusy || state.sliceExportBusy ||
      state.spacingBusy || !state.files.length;
    updateCreateButton();
    updateSliceButton();
    updateWidthButtonsDisabled();
    $("#pick-files").disabled = isBusy || state.sliceBusy || state.sliceExportBusy;
    $("#clear-files").disabled = isBusy || !state.files.length;
    $("#apply-spacing").disabled =
      isBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    $("#reset-spacing-values").disabled =
      isBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    setOcrBusy(state.ocrBusy);
  }

  function setSpacingBusy(isBusy) {
    state.spacingBusy = isBusy;
    var button = $("#apply-spacing");
    button.disabled =
      isBusy || state.stitchBusy || state.sliceBusy || state.sliceExportBusy;
    button.textContent = isBusy ? "正在调整间距…" : "确认应用";
    $("#side-margin").disabled = isBusy;
    $("#top-spacing").disabled = isBusy;
    $("#bottom-spacing").disabled = isBusy;
    $("#reset-spacing-values").disabled =
      isBusy || state.stitchBusy || state.sliceBusy || state.sliceExportBusy;
    $("#create-stitch").disabled =
      isBusy || state.stitchBusy || state.sliceBusy ||
      state.sliceExportBusy || !state.files.length;
    $("#pick-files").disabled =
      isBusy || state.stitchBusy || state.sliceBusy || state.sliceExportBusy;
    $("#clear-files").disabled =
      isBusy || state.stitchBusy || state.sliceBusy ||
      state.sliceExportBusy || !state.files.length;
    updateSliceButton();
    updateWidthButtonsDisabled();
    setOcrBusy(state.ocrBusy);
  }

  function setSliceBusy(isBusy) {
    state.sliceBusy = !!isBusy;
    updateSliceButton();
    $("#create-stitch").disabled =
      isBusy || state.sliceExportBusy || state.stitchBusy ||
      state.spacingBusy || !state.files.length;
    $("#pick-files").disabled =
      isBusy || state.sliceExportBusy || state.stitchBusy || state.spacingBusy;
    $("#clear-files").disabled =
      isBusy || state.sliceExportBusy || state.stitchBusy ||
      state.spacingBusy || !state.files.length;
    $("#apply-spacing").disabled =
      isBusy || state.sliceExportBusy || state.stitchBusy || state.spacingBusy;
    $("#reset-spacing-values").disabled =
      isBusy || state.sliceExportBusy || state.stitchBusy || state.spacingBusy;
    updateWidthButtonsDisabled();
    setOcrBusy(state.ocrBusy);
  }

  function setSliceExportBusy(isBusy) {
    state.sliceExportBusy = !!isBusy;
    updateSliceButton();
    $("#create-stitch").disabled =
      isBusy || state.sliceBusy || state.stitchBusy ||
      state.spacingBusy || !state.files.length;
    $("#pick-files").disabled =
      isBusy || state.sliceBusy || state.stitchBusy || state.spacingBusy;
    $("#clear-files").disabled =
      isBusy || state.sliceBusy || state.stitchBusy ||
      state.spacingBusy || !state.files.length;
    $("#apply-spacing").disabled =
      isBusy || state.sliceBusy || state.stitchBusy || state.spacingBusy;
    $("#reset-spacing-values").disabled =
      isBusy || state.sliceBusy || state.stitchBusy || state.spacingBusy;
    updateWidthButtonsDisabled();
    setOcrBusy(state.ocrBusy);
  }

  function humanError(error) {
    var message = String(error && error.message ? error.message : error || "未知错误");
    if (/cancel/i.test(message)) return "操作已取消";
    return message;
  }

  var ocrServiceInstance = null;

  function getOcrService() {
    if (ocrServiceInstance) return ocrServiceInstance;
    if (!window.XinyangOcrService || !window.XinyangOcrService.create) {
      throw new Error("OCR 服务模块未加载");
    }
    ocrServiceInstance = window.XinyangOcrService.create({
      state: state, $: $, cs: cs, setStatus: setStatus, humanError: humanError,
      setOcrBusy: setOcrBusy, storageSet: storageSet, STORAGE_KEYS: STORAGE_KEYS,
      LOCAL_OCR_URL: LOCAL_OCR_URL, LOCAL_LAMA_URL: LOCAL_LAMA_URL,
      LOCAL_IOPAINT_URL: LOCAL_IOPAINT_URL, IOPAINT_PACKAGE_VERSION: IOPAINT_PACKAGE_VERSION,
      IOPAINT_MODEL_URL: IOPAINT_MODEL_URL, IOPAINT_MODEL_MD5: IOPAINT_MODEL_MD5
    });
    return ocrServiceInstance;
  }

  function normalizedApiUrl() {
    var module = getOcrService();
    return module.normalizedApiUrl.apply(module, arguments);
  }

  function normalizeServiceUrl(value, fallback) {
    if (!ocrServiceInstance && (!window.XinyangOcrService || !window.XinyangOcrService.create)) {
      return normalizeServiceUrlFallback(value, fallback);
    }
    var module = getOcrService();
    return module.normalizeServiceUrl.apply(module, arguments);
  }

  function currentLamaUrl() {
    var module = getOcrService();
    return module.currentLamaUrl.apply(module, arguments);
  }

  function loadBase64Image() {
    var module = getOcrService();
    return module.loadBase64Image.apply(module, arguments);
  }

  function canvasPngBase64() {
    var module = getOcrService();
    return module.canvasPngBase64.apply(module, arguments);
  }

  function multipartLamaRequest() {
    var module = getOcrService();
    return module.multipartLamaRequest.apply(module, arguments);
  }

  function renderLocalOcrStatus() {
    var module = getOcrService();
    return module.renderLocalOcrStatus.apply(module, arguments);
  }

  function detectLocalOcr() {
    var module = getOcrService();
    return module.detectLocalOcr.apply(module, arguments);
  }

  function renderLocalLamaStatus() {
    var module = getOcrService();
    return module.renderLocalLamaStatus.apply(module, arguments);
  }

  function detectLocalLama() {
    var module = getOcrService();
    return module.detectLocalLama.apply(module, arguments);
  }

  function nodeFsHelpers() {
    var module = getOcrService();
    return module.nodeFsHelpers.apply(module, arguments);
  }

  function refreshManagedIopaintInstallState() {
    var module = getOcrService();
    return module.refreshManagedIopaintInstallState.apply(module, arguments);
  }

  function downloadLocalIopaint() {
    var module = getOcrService();
    return module.downloadLocalIopaint.apply(module, arguments);
  }

  function touchManagedIopaint() {
    var module = getOcrService();
    return module.touchManagedIopaint.apply(module, arguments);
  }

  function stopManagedIopaint() {
    var module = getOcrService();
    return module.stopManagedIopaint.apply(module, arguments);
  }

  function ensureLamaServiceReady() {
    var module = getOcrService();
    return module.ensureLamaServiceReady.apply(module, arguments);
  }

  function ocrRequest() {
    var module = getOcrService();
    return module.ocrRequest.apply(module, arguments);
  }

  function readFileBase64() {
    var module = getOcrService();
    return module.readFileBase64.apply(module, arguments);
  }

  function deleteTempFile() {
    var module = getOcrService();
    return module.deleteTempFile.apply(module, arguments);
  }

  function cleanupOcrTemp() {
    var module = getOcrService();
    return module.cleanupOcrTemp.apply(module, arguments);
  }

  function writeTempPng() {
    var module = getOcrService();
    return module.writeTempPng.apply(module, arguments);
  }

  var ocrAnalyzerInstance = null;

  function getOcrAnalyzer() {
    if (ocrAnalyzerInstance) return ocrAnalyzerInstance;
    if (!window.XinyangOcrAnalyzer || !window.XinyangOcrAnalyzer.create) {
      throw new Error("OCR 排版分析模块未加载");
    }
    ocrAnalyzerInstance = window.XinyangOcrAnalyzer.create({
      $: $, setStatus: setStatus, ocrRequest: ocrRequest,
      loadBase64Image: loadBase64Image, canvasPngBase64: canvasPngBase64
    });
    return ocrAnalyzerInstance;
  }

  function analyzeOcrAppearance() {
    var module = getOcrAnalyzer();
    return module.analyzeOcrAppearance.apply(module, arguments);
  }

  function normalizeOcrResponse() {
    var module = getOcrAnalyzer();
    return module.normalizeOcrResponse.apply(module, arguments);
  }

  function markOcrTableLayoutHints() {
    var module = getOcrAnalyzer();
    return module.markOcrTableLayoutHints.apply(module, arguments);
  }

  function groupOcrTableCells() {
    var module = getOcrAnalyzer();
    return module.groupOcrTableCells.apply(module, arguments);
  }

  function groupOcrTextFragments() {
    var module = getOcrAnalyzer();
    return module.groupOcrTextFragments.apply(module, arguments);
  }

  function splitIconMixedOcrLines() {
    var module = getOcrAnalyzer();
    return module.splitIconMixedOcrLines.apply(module, arguments);
  }

  function normalizeOcrTypographyHeights() {
    var module = getOcrAnalyzer();
    return module.normalizeOcrTypographyHeights.apply(module, arguments);
  }

  function expandTypographyLines() {
    var module = getOcrAnalyzer();
    return module.expandTypographyLines.apply(module, arguments);
  }

  function recoverSmallOcrLines() {
    var module = getOcrAnalyzer();
    return module.recoverSmallOcrLines.apply(module, arguments);
  }

  function renderOcrResult() {
    if (state.ocrResult && state.ocrResult.lines.length) {
      state.ocrResult.generatedLines =
        expandTypographyLines(state.ocrResult.lines);
    }
  }

  function setOcrBusy(isBusy) {
    state.ocrBusy = !!isBusy;
    $("#recognize-text").disabled =
      isBusy || state.eraseBusy || state.stitchBusy ||
      state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    $("#recognize-text").textContent = isBusy
      ? "正在识别文字图层…"
      : "识别文字图层";
    $("#text-font-mode").disabled =
      isBusy || state.eraseBusy || state.stitchBusy ||
      state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    $("#erase-text-mode").disabled =
      isBusy || state.eraseBusy || state.stitchBusy ||
      state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    $("#erase-original-text").disabled =
      isBusy || state.eraseBusy || state.stitchBusy ||
      state.sliceBusy || state.sliceExportBusy || state.spacingBusy ||
      !state.ocrResult || !state.ocrSource;
    $("#detect-local-ocr").disabled =
      isBusy || state.eraseBusy || state.stitchBusy ||
      state.sliceBusy || state.sliceExportBusy || state.spacingBusy ||
      state.localOcrChecking || state.localLamaChecking;
    $("#test-ocr-api").disabled =
      isBusy || state.eraseBusy || state.stitchBusy ||
      state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    var downloadButton = $("#download-local-iopaint");
    if (downloadButton) downloadButton.disabled =
      isBusy || state.eraseBusy || state.stitchBusy || state.sliceBusy || state.sliceExportBusy ||
      state.spacingBusy || state.iopaintInstallBusy;
    updateSliceButton();
  }

  function setEraseBusy(isBusy) {
    state.eraseBusy = !!isBusy;
    var button = $("#erase-original-text");
    button.textContent = isBusy ? "正在擦除原文字…" : "擦除原文字";
    $("#create-stitch").disabled =
      isBusy || state.stitchBusy || state.sliceBusy || state.sliceExportBusy ||
      state.spacingBusy || !state.files.length;
    $("#pick-files").disabled =
      isBusy || state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    $("#clear-files").disabled =
      isBusy || state.stitchBusy || state.sliceBusy || state.sliceExportBusy ||
      state.spacingBusy || !state.files.length;
    $("#apply-spacing").disabled =
      isBusy || state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    $("#reset-spacing-values").disabled =
      isBusy || state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy;
    updateSliceButton();
    setOcrBusy(state.ocrBusy);
  }

  function testOcrApi() {
    if (state.ocrBusy) return;
    var apiUrl;
    try {
      apiUrl = normalizedApiUrl();
    } catch (error) {
      setStatus(humanError(error));
      return;
    }
    setOcrBusy(true);
    setStatus("正在测试 OCR API 地址…");
    new Promise(function (resolve, reject) {
      var request = new XMLHttpRequest();
      request.open("GET", apiUrl.replace(/\/ocr\/?$/i, "/health"), true);
      request.timeout = 8000;
      request.setRequestHeader("Accept", "application/json");
      var apiKey = String($("#ocr-api-key").value || "").trim();
      if (apiKey) request.setRequestHeader("Authorization", "Bearer " + apiKey);
      request.onreadystatechange = function () {
        if (request.readyState !== 4) return;
        if (request.status > 0 && request.status < 500) {
          resolve(request.status);
        } else {
          reject(new Error("OCR API 返回 " + request.status));
        }
      };
      request.onerror = function () {
        reject(new Error("无法连接 OCR API"));
      };
      request.ontimeout = function () {
        reject(new Error("OCR API 响应超时"));
      };
      request.send(null);
    }).then(function (status) {
      setStatus(
        status >= 200 && status < 300
          ? "OCR API 地址可用"
          : "OCR API 地址可达（HTTP " + status + "），实际识别时将验证接口"
      );
    }).catch(function (error) {
      setStatus("OCR API 测试失败：" + humanError(error));
    }).then(function () {
      setOcrBusy(false);
    });
  }

  function recognizeSelectedLayerText() {
    if (state.ocrBusy || state.eraseBusy ||
        state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy) return;
    cleanupOcrTemp();
    state.ocrResult = null;
    state.ocrSource = null;
    state.lastEraseLayerId = 0;
    state.eraseLayersBySelection = {};
    renderOcrResult();
    setOcrBusy(true);
    setStatus("正在检查当前选区或选中图片…");

    var exported = null;
    var keepExported = false;
    var phase = "export";
    var sourceImageBase64 = "";
    hostInvoke("exportSelectedLayerForOCR", {}).then(function (result) {
      exported = result;
      phase = "recognize";
      setStatus(
        result.scope === "selection"
          ? "已优先使用当前选区，正在识别选区内文字…"
          : "未检测到选区，正在识别当前选中图片…"
      );
      return readFileBase64(result.tempPath);
    }).then(function (imageBase64) {
      sourceImageBase64 = imageBase64;
      return ocrRequest({
        image_base64: imageBase64,
        filename: exported.fileName || "selected_layer.png",
        group: false
      });
    }).then(function (result) {
      state.ocrResult = normalizeOcrResponse(result.response);
      state.ocrResult.source = result.source;
      state.ocrSource = exported;
      return recoverSmallOcrLines(
        state.ocrResult, sourceImageBase64
      );
    }).then(function (recoveredLines) {
      state.ocrResult.lines = recoveredLines;
      state.ocrResult.tableLayout = markOcrTableLayoutHints(
        state.ocrResult.lines
      );
      setStatus("OCR 已完成，正在匹配原图文字颜色与真实字框…");
      return analyzeOcrAppearance(
        state.ocrResult.lines,
        sourceImageBase64
      );
    }).then(function () {
      var visualLines = splitIconMixedOcrLines(state.ocrResult.lines);
      var tableCells = groupOcrTableCells(
        visualLines,
        state.ocrResult.tableLayout
      );
      state.ocrResult.lines = normalizeOcrTypographyHeights(
        tableCells || groupOcrTextFragments(visualLines)
      );
      state.ocrResult.tableCellMode = !!tableCells;
      renderOcrResult();
      setStatus(
        state.ocrResult.source + " OCR 识别完成：" +
        state.ocrResult.lines.length +
        (state.ocrResult.tableCellMode
          ? " 个表格单元格文字；正在原位创建可编辑文字图层…"
          : " 行文字；正在原位创建可编辑文字图层…")
      );
      phase = "create";
      return createEditableTextLayers();
    }).then(function (result) {
      keepExported = true;
      return result;
    }).catch(function (error) {
      setStatus(
        (phase === "create" ? "生成文字图层失败：" : "文字识别失败：") +
        humanError(error)
      );
      state.ocrSource = null;
      renderOcrResult();
    }).then(function () {
      if (exported && !keepExported) deleteTempFile(exported.tempPath);
      setOcrBusy(false);
    });
  }

  function createEditableTextLayers() {
    if (
      !state.ocrResult ||
      !state.ocrSource || !state.ocrResult.lines.length
    ) {
      return Promise.reject(new Error("没有可生成的 OCR 文字"));
    }

    var generatedLines = expandTypographyLines(state.ocrResult.lines);
    var originX = Number(state.ocrSource.originX) || 0;
    var originY = Number(state.ocrSource.originY) || 0;
    var payloadLines = generatedLines.map(function (line) {
      return {
        text: line.text,
        x: originX + line.box.x,
        y: originY + line.box.y,
        width: line.box.width,
        height: line.box.height,
        fontHeight: line.fontHeight || line.box.height,
        color: line.color,
        fontFamily: line.fontFamily || "",
        fontStyle: line.fontStyle,
        fontStyleSource: line.fontStyleSource || "",
        fontStyleConfidence: Number(line.fontStyleConfidence) || 0,
        strokeRatio: Number(line.strokeRatio) || 0,
        weight: line.weight,
        weightValue: Number(line.weightValue) || 0,
        weightScore: Number(line.weightScore) || 0,
        letterSpacing: isFinite(Number(line.letterSpacing))
          ? Number(line.letterSpacing)
          : null,
        fontSize: line.fontSize,
        angle: line.angle,
        score: line.score,
        mixedSizePart: line.mixedSizePart
      };
    });

    return hostInvoke("createEditableTextLayers", {
      documentId: state.ocrSource.documentId,
      sourceLayerId: state.ocrSource.layerId,
      sourceLayerName: state.ocrSource.layerName,
      fontMode: $("#text-font-mode").value,
      lines: payloadLines
    }).then(function (result) {
      setStatus(
        "已生成 " + result.layers +
        " 个扁平可编辑文字图层（无逐行分组）；字体：" +
        result.fontSummary
      );
      return result;
    });
  }

  function runLamaErase(
    regions,
    absoluteBoxes,
    textLayerIds,
    restoreLayerIds,
    previousRepairLayerId,
    currentSourceLayerId,
    currentSourceLayerName
  ) {
    var repairedPath = "";
    state.iopaintActiveRequests += 1;
    return ensureLamaServiceReady().then(function () {
      touchManagedIopaint();
      return readFileBase64(state.ocrSource.tempPath);
    }).then(function (initialBase64) {
      var currentBase64 = initialBase64;
      var chain = Promise.resolve();
      regions.forEach(function (region, index) {
        chain = chain.then(function () {
          setStatus(
            "LaMa 正在擦除原文字 " + (index + 1) + "/" + regions.length + "…"
          );
          return multipartLamaRequest({
            imageBase64: currentBase64,
            filename: state.ocrSource.fileName || "selected_layer.png",
            box: region,
            timeout: 300000
          }).then(function (nextBase64) {
            currentBase64 = nextBase64;
          });
        });
      });
      return chain.then(function () {
        repairedPath = writeTempPng(
          currentBase64,
          state.ocrSource.tempPath
        );
        setStatus("LaMa 擦除完成，正在写入 Photoshop 修复图层…");
        return hostInvoke("applyInpaintResult", {
          documentId: state.ocrSource.documentId,
          sourceLayerId: currentSourceLayerId || state.ocrSource.layerId,
          sourceLayerName: currentSourceLayerName || state.ocrSource.layerName,
          repairedPath: repairedPath,
          originX: Number(state.ocrSource.originX) || 0,
          originY: Number(state.ocrSource.originY) || 0,
          boxes: absoluteBoxes,
          textLayerIds: textLayerIds || [],
          restoreLayerIds: restoreLayerIds || textLayerIds || [],
          previousRepairLayerId: previousRepairLayerId
        });
      });
    }).then(function (result) {
      if (repairedPath) deleteTempFile(repairedPath);
      state.iopaintActiveRequests = Math.max(0, state.iopaintActiveRequests - 1);
      touchManagedIopaint();
      return result;
    }, function (error) {
      if (repairedPath) deleteTempFile(repairedPath);
      state.iopaintActiveRequests = Math.max(0, state.iopaintActiveRequests - 1);
      touchManagedIopaint();
      throw error;
    });
  }

  function eraseOriginalText() {
    if (state.ocrBusy || state.eraseBusy ||
        state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy) return;
    if (!state.ocrSource) {
      setStatus("请先点击“识别文字图层”");
      return;
    }
    var mode = String($("#erase-text-mode").value || "lama");
    setEraseBusy(true);
    setStatus("正在读取 Photoshop 当前选中的文字图层…");

    var selectedInfo = null;
    var selectionKey = "";
    var previousRepairLayerId = 0;
    var task = hostInvoke("selectedTextEraseRegions", {
      documentId: state.ocrSource.documentId,
      sourceLayerId: state.ocrSource.layerId
    }).then(function (result) {
      selectedInfo = result;
      selectionKey = String(result.selectionKey || "");
      previousRepairLayerId = Number(
        state.eraseLayersBySelection[selectionKey]
      ) || 0;
      var absoluteBoxes = result.boxes || [];
      if (!absoluteBoxes.length) {
        throw new Error("当前选择中没有可擦除的文字图层");
      }

      var originX = Number(state.ocrSource.originX) || 0;
      var originY = Number(state.ocrSource.originY) || 0;
      var sourceWidth = Math.max(1, Number(state.ocrSource.width) || 1);
      var sourceHeight = Math.max(1, Number(state.ocrSource.height) || 1);
      var relativeBoxes = absoluteBoxes.map(function (box) {
        var left = Math.max(0, Number(box.x) - originX);
        var top = Math.max(0, Number(box.y) - originY);
        var right = Math.min(
          sourceWidth,
          Number(box.x) + Number(box.width) - originX
        );
        var bottom = Math.min(
          sourceHeight,
          Number(box.y) + Number(box.height) - originY
        );
        return {
          x: Math.floor(left),
          y: Math.floor(top),
          width: Math.max(0, Math.ceil(right) - Math.floor(left)),
          height: Math.max(0, Math.ceil(bottom) - Math.floor(top))
        };
      }).filter(function (box) {
        return box.width > 1 && box.height > 1;
      });
      if (relativeBoxes.length !== absoluteBoxes.length) {
        throw new Error("选中的文字图层有部分超出原图片范围");
      }

      var eraseTargetLabel = Number(selectedInfo.groupCount) > 0
        ? (selectedInfo.groupCount + " 个文字组内的 " + absoluteBoxes.length + " 个文字图层")
        : (absoluteBoxes.length + " 个文字图层");

      if (mode === "lama") {
        setStatus(
          "正在使用本机 LaMa 批量擦除" + eraseTargetLabel + "…"
        );
        return runLamaErase(
          relativeBoxes,
          absoluteBoxes,
          selectedInfo.textLayerIds || [],
          selectedInfo.restoreLayerIds || selectedInfo.textLayerIds || [],
          previousRepairLayerId,
          selectedInfo.sourceLayerId,
          selectedInfo.sourceLayerName
        );
      }

      var modeLabel = mode === "horizontal"
        ? "横向拉伸"
        : mode === "vertical"
          ? "纵向拉伸"
          : mode === "solidFill"
            ? "背景纯色填充（3px 柔边）"
            : "PS 内容识别填充";
      setStatus(
        "正在使用" + modeLabel + "批量擦除" + eraseTargetLabel + "…"
      );
      return hostInvoke("eraseOriginalText", {
        documentId: state.ocrSource.documentId,
        sourceLayerId: selectedInfo.sourceLayerId || state.ocrSource.layerId,
        sourceLayerName: selectedInfo.sourceLayerName || state.ocrSource.layerName,
        mode: mode,
        boxes: absoluteBoxes,
        textLayerIds: selectedInfo.textLayerIds || [],
        restoreLayerIds: selectedInfo.restoreLayerIds || selectedInfo.textLayerIds || [],
        previousRepairLayerId: previousRepairLayerId
      });
    });

    task.then(function (result) {
      if (mode === "lama") {
        state.localLamaReachable = true;
        state.localLamaAvailable = true;
        state.localLamaRouteVerified = true;
        state.localLamaRouteNote = "已通过真实擦除验证";
        state.localLamaFault = "";
        state.localLamaFaultUrl = "";
        state.localLamaFaultAt = 0;
        state.localLamaCheckedAt = Date.now();
        renderLocalLamaStatus();
      }
      state.lastEraseLayerId =
        result && Number(result.layerId) > 0
          ? Number(result.layerId)
          : 0;
      if (selectionKey && state.lastEraseLayerId > 0) {
        state.eraseLayersBySelection[selectionKey] =
          state.lastEraseLayerId;
      }
      var label = mode === "lama"
        ? "本地 LaMa"
        : mode === "horizontal"
          ? "横向拉伸"
        : mode === "vertical"
          ? "纵向拉伸"
            : mode === "solidFill"
              ? "背景纯色填充（3px 柔边）"
              : "PS 内容识别填充";
      var completedTarget = selectedInfo && Number(selectedInfo.groupCount) > 0
        ? (selectedInfo.groupCount + " 个文字组内的 " + selectedInfo.count + " 个文字图层")
        : ((selectedInfo ? selectedInfo.count : 0) + " 个文字图层");
      var partialNote = result && result.failedRegions && result.failedRegions.length
        ? "；其中 " + result.failedRegions.length + " 个区域已跳过（请查看调试日志）"
        : "";
      setStatus(
        "已使用" + label + "批量擦除" + completedTarget +
        "下方原字，可按 Ctrl+Z 撤回" +
        (result && result.layers ? "（" + result.layers + " 层）" : "") + partialNote
      );
    }).catch(function (error) {
      var message = humanError(error);
      if (mode === "lama" && /(LaMa|IOPaint|本机通道|ECONN|EPIPE|socket|擦除接口|响应超时)/i.test(message)) {
        var hardOffline = /(ECONNREFUSED|ENOTFOUND|无法连接 IOPaint|未检测到 LaMa|服务启动失败)/i.test(message);
        state.localLamaReachable = !hardOffline;
        state.localLamaAvailable = !hardOffline;
        state.localLamaRouteVerified = false;
        state.localLamaRouteNote = "上次真实擦除未通过，后续会自动重试兼容通道";
        if (hardOffline) state.localLamaEngine = "";
        state.localLamaFault = message.slice(0, 180);
        state.localLamaFaultUrl = currentLamaUrl();
        state.localLamaFaultAt = Date.now();
        state.localLamaCheckedAt = 0;
        renderLocalLamaStatus();
      }
      setStatus("擦除失败：" + message);
    }).then(function () {
      setEraseBusy(false);
    });
  }

  function createLongImage() {
    if (
      state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy ||
      state.ocrBusy || state.eraseBusy
    ) return;
    if (!state.files.length) {
      setStatus("请先拖入需要拼接的图片");
      return;
    }

    state.widthDetectionToken += 1;
    var targetWidth = state.targetWidth;
    setBusy(true);
    setStatus("正在读取并拼接 " + state.files.length + " 张图片…");

    /*
     * 给 CEP 面板一次绘制机会，确保忙碌状态稳定显示后再进入
     * Photoshop 主机脚本，避免按钮文字和状态栏在开始时跳闪。
     */
    window.setTimeout(function () {
      hostInvoke("createLongStitch", {
        files: state.files.slice(),
        width: targetWidth
      }).then(function (result) {
        var elapsed = result.elapsedMs
          ? "，用时 " + (result.elapsedMs / 1000).toFixed(1) + " 秒"
          : "";
        setStatus(
          "创建完成：" + result.width + " × " + result.height +
          " px，共 " + result.layers + " 个智能对象图层" + elapsed
        );
      }).catch(function (error) {
        setStatus("创建失败：" + humanError(error));
      }).then(function () {
        setBusy(false);
      });
    }, 40);
  }

  function invokeStandaloneSliceExport(action, payload) {
    return new Promise(function (resolve, reject) {
      var extensionRoot = "";
      try {
        extensionRoot = String(cs.getSystemPath(SystemPath.EXTENSION) || "")
          .replace(/\\/g, "/")
          .replace(/\/+$/, "");
      } catch (ignoreExtensionPath) {}
      var scriptPath = extensionRoot
        ? extensionRoot + "/jsx/slice-export-v2193.jsx"
        : "";
      if (!scriptPath) {
        reject(new Error("无法定位独立导出脚本"));
        return;
      }

      var payloadJson = JSON.stringify(payload || {});
      var script = '(function(){try{$.evalFile(new File(' +
        JSON.stringify(scriptPath) +
        '));if(typeof XinyangSliceExportV2193==="undefined"||!XinyangSliceExportV2193.invoke){throw new Error("独立导出入口未加载");}return XinyangSliceExportV2193.invoke(' +
        JSON.stringify(String(action || "")) + ',' +
        JSON.stringify(payloadJson) +
        ');}catch(e){return "__XY_EXPORT_ERROR__"+String(e&&e.message?e.message:e)+(e&&e.line?"（脚本第 "+e.line+" 行）":"");}})()';

      var runner = window.XinyangRuntime && window.XinyangRuntime.evalScriptRaw
        ? function (callback) {
            window.XinyangRuntime.evalScriptRaw(script, {
              label: "独立导出 " + String(action || ""),
              slowAfterMs: 12000
            }).then(callback, reject);
          }
        : function (callback) {
            cs.evalScript(script, function (raw) { callback(raw); });
          };

      runner(function (raw) {
        try {
          raw = String(raw || "");
          if (!raw || raw === "EvalScript error.") {
            throw new Error("Photoshop 独立导出脚本执行失败");
          }
          if (raw.indexOf("__XY_EXPORT_ERROR__") === 0) {
            throw new Error(raw.slice("__XY_EXPORT_ERROR__".length));
          }
          var result = JSON.parse(raw);
          if (!result.ok) throw new Error(result.error || "Photoshop 独立导出失败");
          resolve(result.data || {});
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function exportCurrentDocumentSlices() {
    if (
      state.sliceExportBusy || state.sliceBusy || state.stitchBusy ||
      state.spacingBusy || state.ocrBusy || state.eraseBusy
    ) {
      return;
    }

    setSliceExportBusy(true);
    setStatus("正在读取当前文档、画板、切片与默认导出目录…");

    /*
     * v2.1.94 使用独立 JSX 文件，不再依赖 LongStitchCEP 方法表。
     * 即使 Photoshop 长驻会话保留了旧宿主对象，也不会再出现
     * “未知功能：getSliceExport...”。
     */
    invokeStandaloneSliceExport("defaultFolder", {}).then(function (defaultInfo) {
      var initialPath = String(defaultInfo && defaultInfo.path || "");
      var selectedFolder = chooseSliceExportFolder(initialPath);
      if (!selectedFolder) {
        var cancelled = new Error("CANCELLED_SLICE_EXPORT");
        cancelled.cancelled = true;
        throw cancelled;
      }
      setStatus("正在根据参考线生成切片，并使用存储为 Web 一次性导出 JPG…");
      return invokeStandaloneSliceExport("export", {
        folder: selectedFolder,
        format: "jpg",
        quality: 82
      });
    }).then(function (result) {
      var mode = String(result && result.mode || "slices");
      var label = mode === "artboards"
        ? "画板导出完成"
        : (mode === "canvas" ? "当前画布导出完成" : "切片导出完成");
      setStatus(
        label + "：共 " + result.count + " 个 Web JPG（质量 " +
        String(result.quality || 82) + "），保存到 " + String(result.folder || "所选文件夹")
      );
    }).catch(function (error) {
      if (error && (error.cancelled || error.message === "CANCELLED_SLICE_EXPORT")) {
        setStatus("已取消导出切片");
        return;
      }
      setStatus("导出切片失败：" + humanError(error));
    }).then(function () {
      setSliceExportBusy(false);
    });
  }

  function getFileIo() {
    if (!window.XinyangFileIO) throw new Error("通用文件模块未加载");
    return window.XinyangFileIO;
  }

  function readAnalysisFileBase64(path) {
    return getFileIo().readFileBase64(path, {
      label: "智能切片分析图",
      validatePng: true
    });
  }

  function deleteAnalysisTempFile(path) {
    if (window.XinyangFileIO) {
      window.XinyangFileIO.deleteFile(path);
      return;
    }
    try {
      if (path && window.cep && window.cep.fs && window.cep.fs.deleteFile) {
        window.cep.fs.deleteFile(path);
      }
    } catch (ignoreDelete) {}
  }

  var smartSliceAnalyzerInstance = null;

  function getSmartSliceAnalyzer() {
    if (smartSliceAnalyzerInstance) return smartSliceAnalyzerInstance;
    if (!window.XinyangSmartSliceAnalyzer || !window.XinyangSmartSliceAnalyzer.create) {
      throw new Error("智能切片分析模块未加载");
    }
    smartSliceAnalyzerInstance = window.XinyangSmartSliceAnalyzer.create({});
    return smartSliceAnalyzerInstance;
  }

  function analyzeSmartSliceImage() {
    var module = getSmartSliceAnalyzer();
    return module.analyzeSmartSliceImage.apply(module, arguments);
  }

  function createSmartSlices() {
    if (
      state.sliceBusy || state.sliceExportBusy || state.stitchBusy || state.spacingBusy ||
      state.ocrBusy || state.eraseBusy
    ) {
      return;
    }

    setSliceBusy(true);
    setStatus("正在判断文档类型并优先寻找贯穿画布的横向分割带…");
    var prepared = null;
    var analysis = null;
    window.setTimeout(function () {
      hostInvoke("prepareSmartSliceAnalysis", {}).then(function (result) {
        prepared = result;
        if (result.mode === "stitch") {
          setStatus("检测到拼图源记录，正在按原始图片边缘切片…");
          return hostInvoke("createStitchSlices", {});
        }

        setStatus("正在加载智能切片分析模块…");
        return ensureFeatureModule("smartSlice").then(function () {
          setStatus(
            result.layerHints && result.layerHints.length
              ? "正在结合 PSD 图层关系与横向贯穿带保护完整板块…"
              : "正在扫描贯穿画布的横向留白、纯色过渡和完整内容区域…"
          );
          return readAnalysisFileBase64(result.tempPath);
        }).then(function (imageBase64) {
          return analyzeSmartSliceImage(imageBase64, result);
        }).then(function (analysisResult) {
          analysis = analysisResult;
          deleteAnalysisTempFile(result.tempPath);
          prepared.tempPath = "";
          return hostInvoke("createSmartSlices", {
            documentId: result.documentId,
            boundaries: analysisResult.boundaries
          });
        });
      }).then(function (result) {
        if (prepared && prepared.tempPath) {
          deleteAnalysisTempFile(prepared.tempPath);
          prepared.tempPath = "";
        }
        if (result.mode === "stitch") {
          setStatus(
            "切片完成：读取 " + result.sources + " 张拼图源图片，生成 " +
            result.guides + " 条水平参考线、" + result.slices +
            " 个切片，可按 Ctrl+Z 撤回"
          );
          return;
        }
        setStatus(
          "智能切片完成：按" +
          (
            analysis && analysis.layerHintCount
              ? " PSD 图层结构与画面内容"
              : "画面内容"
          ) +
          "生成 " + result.guides + " 条水平参考线、" +
          result.slices + " 个切片，可按 Ctrl+Z 撤回"
        );
      }).catch(function (error) {
        if (prepared && prepared.tempPath) {
          deleteAnalysisTempFile(prepared.tempPath);
          prepared.tempPath = "";
        }
        setStatus("切片失败：" + humanError(error));
      }).then(function () {
        setSliceBusy(false);
      });
    }, 30);
  }

  function integerInput(selector, label, allowNegative) {
    var raw = $(selector).value.trim();
    if (!/^-?\d+$/.test(raw)) {
      throw new Error(label + "请输入整数");
    }
    var value = Number(raw);
    if (!allowNegative && value < 0) {
      throw new Error(label + "必须大于或等于 0");
    }
    return value;
  }

  function resetSpacingValues() {
    if (
      state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy ||
      state.ocrBusy || state.eraseBusy
    ) return;
    $("#side-margin").value = "0";
    $("#top-spacing").value = "0";
    $("#bottom-spacing").value = "0";
    persistSession();
    setStatus("间距数值已全部清零，点击“确认应用”后生效");
  }

  function boundedInteger(input, value) {
    var minimum = input.hasAttribute("min")
      ? Number(input.getAttribute("min"))
      : -Infinity;
    var maximum = input.hasAttribute("max")
      ? Number(input.getAttribute("max"))
      : Infinity;
    value = Math.round(Number(value) || 0);
    if (isFinite(minimum)) value = Math.max(minimum, value);
    if (isFinite(maximum)) value = Math.min(maximum, value);
    return value;
  }

  function bindSpacingScrubber(scrubber) {
    scrubber.addEventListener("mousedown", function (event) {
      if (
        event.button !== 0 || state.stitchBusy || state.sliceBusy ||
        state.spacingBusy || state.ocrBusy || state.eraseBusy
      ) return;

      var input = document.getElementById(scrubber.getAttribute("data-input"));
      if (!input || input.disabled) return;

      event.preventDefault();
      event.stopPropagation();

      var startX = Number(event.screenX || event.clientX || 0);
      var startValue = /^-?\d+$/.test(input.value.trim())
        ? Number(input.value)
        : 0;
      var changed = false;

      scrubber.classList.add("dragging");
      document.body.classList.add("spacing-scrubbing");

      function move(moveEvent) {
        var currentX = Number(moveEvent.screenX || moveEvent.clientX || 0);
        var delta = Math.round(currentX - startX);
        if (!delta) return;
        changed = true;
        input.value = String(boundedInteger(input, startValue + delta));
        moveEvent.preventDefault();
      }

      function finish() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", finish);
        window.removeEventListener("blur", finish);
        scrubber.classList.remove("dragging");
        document.body.classList.remove("spacing-scrubbing");

        if (changed) {
          persistSession();
          setStatus(
            scrubber.textContent.replace(/\s+/g, "") +
            "已调整为 " + input.value + " px，点击“确认应用”后生效"
          );
        } else {
          input.focus();
          input.select();
        }
      }

      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", finish);
      window.addEventListener("blur", finish);
    });
  }

  function applyLayerSpacing() {
    if (
      state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy ||
      state.ocrBusy || state.eraseBusy
    ) return;

    var values;
    try {
      values = {
        side: integerInput("#side-margin", "左右边距", true),
        top: integerInput("#top-spacing", "上间距", true),
        bottom: integerInput("#bottom-spacing", "下间距", true)
      };
    } catch (error) {
      setStatus(humanError(error));
      return;
    }

    setSpacingBusy(true);
    setStatus("正在定位当前内容对应的拼图图片并调整间距…");

    window.setTimeout(function () {
      hostInvoke("applyLayerSpacing", values).then(function (result) {
        var elapsed = result.elapsedMs
          ? "，用时 " + (result.elapsedMs / 1000).toFixed(1) + " 秒"
          : "";
        var savedHint = result.spacingStateSaved
          ? ""
          : "；当前结果已应用，但重新打开 PSD 后需再次设置";
        var mappedHint = result.mappedFromLayer
          ? "；已由当前图层“" + result.mappedFromLayer + "”自动定位到对应拼图图片"
          : "";
        setStatus(
          "已调整“" + result.layerName + "”：左右 " + result.side +
          "，上 " + result.top + "，下 " + result.bottom +
          "；画布 " + result.width + " × " + result.height +
          " px" + mappedHint + elapsed + savedHint
        );
      }).catch(function (error) {
        setStatus("调整失败：" + humanError(error));
      }).then(function () {
        setSpacingBusy(false);
      });
    }, 40);
  }

  function baiduTranslatorModule() {
    return window.XinyangBaiduTranslator || null;
  }

  function setBaiduTranslatorStatus(mode, label, detail) {
    var dot = $("#baidu-translator-dot");
    var stateNode = $("#baidu-translator-state");
    var detailNode = $("#baidu-translator-detail");
    var badge = $("#baidu-translator-badge");
    if (dot) {
      dot.classList.remove("online", "offline", "checking", "standby");
      dot.classList.add(mode || "offline");
    }
    if (stateNode) stateNode.textContent = label || "未配置";
    if (detailNode) detailNode.textContent = detail || "请填写百度翻译 APPID 和密钥";
    if (badge) {
      badge.classList.remove("configured", "online");
      badge.textContent = mode === "online" ? "连接正常" : mode === "standby" ? "已配置" : mode === "checking" ? "检测中" : "未配置";
      if (mode === "online") badge.classList.add("online");
      else if (mode === "standby" || mode === "checking") badge.classList.add("configured");
    }
  }

  function renderBaiduTranslatorSettings() {
    var module = baiduTranslatorModule();
    if (!module) {
      setBaiduTranslatorStatus("offline", "模块未加载", "请重新安装完整插件包");
      return;
    }
    var settings = module.getSettings();
    var source = $("#baidu-translator-from");
    var target = $("#baidu-translator-to");
    var appIdInput = $("#baidu-translator-appid");
    var keyInput = $("#baidu-translator-key");
    if (source) source.value = settings.sourceLanguage || "auto";
    if (target) target.value = settings.targetLanguage || "en";
    if (appIdInput) {
      appIdInput.value = "";
      appIdInput.setAttribute("data-has-saved-credential", settings.hasCredentials ? "1" : "0");
      appIdInput.placeholder = settings.hasCredentials
        ? "APPID 已加密保存（" + (settings.maskedAppId || "已保存") + "）；留空继续使用"
        : "填写开发者信息页中的 APPID";
    }
    if (keyInput) {
      keyInput.value = "";
      keyInput.type = "password";
      keyInput.setAttribute("data-has-saved-credential", settings.hasCredentials ? "1" : "0");
      keyInput.placeholder = settings.hasCredentials
        ? "密钥已加密保存；留空继续使用"
        : "填写开发者信息页中的密钥";
    }
    var toggle = $("#baidu-translator-key-toggle");
    if (toggle) toggle.textContent = "显示";
    if (settings.hasCredentials) {
      setBaiduTranslatorStatus("standby", "已配置", "标准版每秒最多 1 次请求；点击“保存并测试”验证连接");
    } else {
      setBaiduTranslatorStatus("offline", "未配置", "请填写 APPID 和密钥并保存");
    }
  }

  function readBaiduTranslatorForm() {
    var module = baiduTranslatorModule();
    if (!module) throw new Error("百度翻译模块未加载");
    var appIdInput = $("#baidu-translator-appid");
    var keyInput = $("#baidu-translator-key");
    return {
      appId: appIdInput ? appIdInput.value.trim() : "",
      secretKey: keyInput ? keyInput.value.trim() : "",
      sourceLanguage: module.normalizeLanguage($("#baidu-translator-from").value, "auto"),
      targetLanguage: module.normalizeLanguage($("#baidu-translator-to").value, "en")
    };
  }

  function saveBaiduTranslatorSettings(shouldTest) {
    var module = baiduTranslatorModule();
    if (!module) {
      setStatus("百度翻译模块未加载，请重新安装插件");
      return Promise.reject(new Error("百度翻译模块未加载"));
    }
    var form;
    try {
      form = readBaiduTranslatorForm();
      module.saveSettings(form);
    } catch (error) {
      setBaiduTranslatorStatus("offline", "配置错误", humanError(error));
      setStatus("百度翻译配置保存失败：" + humanError(error));
      return Promise.reject(error);
    }
    renderBaiduTranslatorSettings();
    if (!shouldTest) {
      setStatus("百度翻译配置已保存");
      return Promise.resolve(module.getSettings());
    }
    setBaiduTranslatorStatus("checking", "正在测试", "正在请求百度通用文本翻译…");
    setStatus("正在测试百度翻译连接…");
    var testButton = $("#baidu-translator-test");
    var saveButton = $("#baidu-translator-save");
    if (testButton) testButton.disabled = true;
    if (saveButton) saveButton.disabled = true;
    return module.testConnection({
      appId: form.appId,
      secretKey: form.secretKey,
      sourceLanguage: form.sourceLanguage,
      targetLanguage: form.targetLanguage
    }).then(function (result) {
      setBaiduTranslatorStatus("online", "连接正常", "测试译文：" + (result.translatedText || "成功"));
      setStatus("百度翻译连接测试成功");
      return result;
    }).catch(function (error) {
      setBaiduTranslatorStatus("offline", "测试失败", humanError(error));
      setStatus("百度翻译测试失败：" + humanError(error));
      throw error;
    }).then(function (result) {
      if (testButton) testButton.disabled = false;
      if (saveButton) saveButton.disabled = false;
      return result;
    }, function (error) {
      if (testButton) testButton.disabled = false;
      if (saveButton) saveButton.disabled = false;
      return Promise.reject(error);
    });
  }

  function clearBaiduTranslatorCredentials() {
    var module = baiduTranslatorModule();
    if (!module) return;
    if (!window.confirm("确定清除当前电脑中保存的百度翻译 APPID 和密钥吗？")) return;
    try {
      module.clearCredentials();
      renderBaiduTranslatorSettings();
      setStatus("已清除百度翻译凭据");
    } catch (error) {
      setStatus("清除百度翻译凭据失败：" + humanError(error));
    }
  }

  function openUserGuide() {
    try {
      if (!cs || !cs.getSystemPath || typeof SystemPath === "undefined") {
        throw new Error("无法读取插件安装目录");
      }
      var extensionPath = String(cs.getSystemPath(SystemPath.EXTENSION) || "")
        .replace(/\\/g, "/");
      if (!extensionPath) throw new Error("插件安装目录为空");
      var guidePath = extensionPath + "/docs/鑫洋助理_使用说明.html";
      var guideUrl = encodeURI("file:///" + guidePath.replace(/^\/+/, ""));
      if (cs.openURLInDefaultBrowser(guideUrl) === false) {
        if (window.require) {
          window.require("child_process").execFile(
            "cmd.exe", ["/c", "start", "", guidePath.replace(/\//g, "\\")],
            { windowsHide: true }
          );
        } else {
          throw new Error("CEP 无法打开本地说明");
        }
      }
      setStatus("已在浏览器中打开插件使用说明");
    } catch (error) {
      setStatus("打开使用说明失败：" + humanError(error));
    }
  }

  function openBaiduTutorialUrl(url) {
    var value = String(url || "").trim();
    if (!/^https:\/\//i.test(value)) return;
    try {
      if (cs.openURLInDefaultBrowser(value) !== false) return;
      throw new Error("CEP 无法打开链接");
    } catch (error) {
      try {
        if (window.require) window.require("child_process").execFile("cmd.exe", ["/c", "start", "", value], { windowsHide: true });
      } catch (ignore) {
        setStatus("无法打开浏览器，请检查系统默认浏览器设置");
      }
    }
  }

  function bindEvents() {
    var dropZone = $("#drop-zone");

    Array.prototype.slice.call(
      document.querySelectorAll(".nav-button")
    ).forEach(function (button) {
      button.addEventListener("click", function () {
        setActivePanel(button.getAttribute("data-panel"));
      });
    });

    Array.prototype.slice.call(
      document.querySelectorAll(".width-button")
    ).forEach(function (button) {
      button.addEventListener("click", function () {
        state.widthDetectionToken += 1;
        setSelectedWidth(
          Number(button.getAttribute("data-width")),
          true
        );
        persistSession();
        setStatus("已手动选择 " + state.targetWidth + "px 画布宽度");
      });
    });

    $("#pick-files").addEventListener("click", function (event) {
      event.stopPropagation();
      addFiles(showOpenFiles());
    });

    dropZone.addEventListener("click", function (event) {
      if (event.target.id !== "pick-files") addFiles(showOpenFiles());
    });

    dropZone.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        addFiles(showOpenFiles());
      }
    });

    ["dragenter", "dragover"].forEach(function (name) {
      dropZone.addEventListener(name, function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        dropZone.classList.add("drag-active");
      });
    });

    ["dragleave", "dragend"].forEach(function (name) {
      dropZone.addEventListener(name, function (event) {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.remove("drag-active");
      });
    });

    dropZone.addEventListener("drop", function (event) {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove("drag-active");
      var paths = droppedPaths(event);
      if (!paths.length) {
        setStatus("未读取到文件路径，请使用“选择图片”按钮");
        return;
      }
      addFiles(paths);
    });

    document.addEventListener("dragover", function (event) {
      event.preventDefault();
    });
    document.addEventListener("drop", function (event) {
      if (!dropZone.contains(event.target)) event.preventDefault();
    });

    $("#file-list").addEventListener("click", function (event) {
      var button = event.target.closest(".remove-file");
      if (!button) return;
      var row = button.closest("[data-index]");
      var index = Number(row.getAttribute("data-index"));
      if (isNaN(index) || !state.files[index]) return;
      var removed = baseName(state.files[index]);
      state.files.splice(index, 1);
      if (!state.files.length) {
        state.widthDetectionToken += 1;
        state.widthManuallySelected = false;
        setSelectedWidth(790, false);
      }
      renderFiles();
      persistSession();
      setStatus(
        "已移除：" + removed +
        (!state.files.length ? "；下次导入将重新自动匹配宽度" : "")
      );
    });

    $("#clear-files").addEventListener("click", function () {
      state.files = [];
      state.widthDetectionToken += 1;
      state.widthManuallySelected = false;
      setSelectedWidth(790, false);
      renderFiles();
      persistSession();
      setStatus("列表已清空，下次导入将重新自动匹配宽度");
    });

    $("#create-stitch").addEventListener("click", createLongImage);
    $("#create-slices").addEventListener(
      "click",
      createSmartSlices
    );
    $("#export-slices").addEventListener(
      "click",
      exportCurrentDocumentSlices
    );
    $("#apply-spacing").addEventListener("click", applyLayerSpacing);
    $("#reset-spacing-values").addEventListener("click", resetSpacingValues);
    $("#recognize-text").addEventListener("click", function () {
      runAfterPanelModules("text-panel", recognizeSelectedLayerText, "正在加载文字识别模块…");
    });
    $("#erase-original-text").addEventListener("click", function () {
      runAfterPanelModules("text-panel", eraseOriginalText, "正在加载文字修复模块…");
    });
    $("#detect-local-ocr").addEventListener("click", function () {
      runAfterPanelModules("settings-panel", function () {
        var lamaInput = $("#lama-service-url");
        var typedUrl = normalizeServiceUrl(lamaInput ? lamaInput.value : "", "");
        if (typedUrl) {
          state.localLamaUrl = typedUrl;
          storageSet(STORAGE_KEYS.lamaServiceUrl, typedUrl);
        }
        state.localLamaCheckedAt = 0;
        setStatus("正在重新检测本机 OCR 与 LaMa/IOPaint 服务…");
        return Promise.all([
          detectLocalOcr(true, false),
          detectLocalLama(true, false)
        ]).then(function (results) {
          setStatus(
            "本机服务检测完成：OCR " + (results[0] ? "可用" : "不可用") +
            "，LaMa/IOPaint " + (results[1] ? "可用" : "不可用")
          );
        });
      }, "正在加载本机服务模块…");
    });
    var downloadIopaintButton = $("#download-local-iopaint");
    if (downloadIopaintButton) downloadIopaintButton.addEventListener("click", function () {
      runAfterPanelModules("settings-panel", downloadLocalIopaint, "正在加载本地模型管理模块…");
    });
    var stopIopaintButton = $("#stop-local-iopaint");
    if (stopIopaintButton) stopIopaintButton.addEventListener("click", function () {
      runAfterPanelModules("settings-panel", function () {
        return stopManagedIopaint("manual", false);
      }, "正在加载本地模型管理模块…");
    });
    var idleSelect = $("#iopaint-idle-minutes");
    if (idleSelect) idleSelect.addEventListener("change", function () {
      var minutes = Math.max(1, Number(this.value) || 10);
      state.iopaintIdleMinutes = minutes;
      storageSet(STORAGE_KEYS.iopaintIdleMinutes, String(minutes));
      runAfterPanelModules("settings-panel", function () {
        touchManagedIopaint();
        renderLocalLamaStatus();
      });
    });
    var lamaServiceInput = $("#lama-service-url");
    if (lamaServiceInput) lamaServiceInput.addEventListener("change", function () {
      var input = this;
      runAfterPanelModules("settings-panel", function () {
        var value = normalizeServiceUrl(input.value, "");
        input.value = value;
        if (value) {
          state.localLamaUrl = value;
          storageSet(STORAGE_KEYS.lamaServiceUrl, value);
          state.localLamaCheckedAt = 0;
        } else {
          storageRemove(STORAGE_KEYS.lamaServiceUrl);
        }
        renderLocalLamaStatus();
      });
    });
    $("#test-ocr-api").addEventListener("click", function () {
      runAfterPanelModules("settings-panel", testOcrApi, "正在加载 OCR 配置模块…");
    });
    var baiduSaveButton = $("#baidu-translator-save");
    if (baiduSaveButton) baiduSaveButton.addEventListener("click", function () {
      runAfterPanelModules("settings-panel", function () { return saveBaiduTranslatorSettings(false); }, "正在加载翻译配置模块…");
    });
    var baiduTestButton = $("#baidu-translator-test");
    if (baiduTestButton) baiduTestButton.addEventListener("click", function () {
      runAfterPanelModules("settings-panel", function () { return saveBaiduTranslatorSettings(true); }, "正在加载翻译配置模块…");
    });
    var baiduKeyToggle = $("#baidu-translator-key-toggle");
    if (baiduKeyToggle) baiduKeyToggle.addEventListener("click", function () {
      var input = $("#baidu-translator-key");
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      this.textContent = show ? "隐藏" : "显示";
    });
    var baiduKeyClear = $("#baidu-translator-key-clear");
    if (baiduKeyClear) baiduKeyClear.addEventListener("click", function () {
      runAfterPanelModules("settings-panel", clearBaiduTranslatorCredentials, "正在加载翻译配置模块…");
    });
    Array.prototype.slice.call(document.querySelectorAll("[data-baidu-url]")).forEach(function (button) {
      button.addEventListener("click", function () { openBaiduTutorialUrl(button.getAttribute("data-baidu-url")); });
    });
    ["#baidu-translator-appid", "#baidu-translator-key", "#baidu-translator-from", "#baidu-translator-to"].forEach(function (selector) {
      var node = $(selector);
      if (!node) return;
      node.addEventListener("change", function () {
        setBaiduTranslatorStatus("standby", "配置已修改", "点击“保存并测试”应用新配置");
      });
    });
    $("#background-running").addEventListener("change", function () {
      updateBackgroundSession(this.checked, true);
    });
    var manualReloadButton = $("#manual-reload-plugin");
    if (manualReloadButton) {
      manualReloadButton.addEventListener("click", manualReloadPlugin);
    }
    var openUserGuideButton = $("#open-user-guide");
    if (openUserGuideButton) {
      openUserGuideButton.addEventListener("click", openUserGuide);
    }
    $("#ocr-api-url").addEventListener("change", function () {
      storageSet(STORAGE_KEYS.ocrApiUrl, this.value.trim());
    });
    $("#ocr-api-key").addEventListener("change", function () {
      storageSet(STORAGE_KEYS.ocrApiKey, this.value.trim());
    });
    $("#erase-text-mode").addEventListener("change", function () {
      storageSet(STORAGE_KEYS.eraseMode, this.value || "lama");
    });

    Array.prototype.slice.call(
      document.querySelectorAll(".spacing-scrubber")
    ).forEach(bindSpacingScrubber);

    ["#side-margin", "#top-spacing", "#bottom-spacing"].forEach(function (selector) {
      $(selector).addEventListener("input", persistSession);
      $(selector).addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          applyLayerSpacing();
        }
      });
    });

    document.addEventListener("keydown", function (event) {
      var key = String(event.key || "").toLowerCase();
      if (
        key !== "z" ||
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      var target = event.target;
      var tagName = target && target.tagName
        ? String(target.tagName).toLowerCase()
        : "";
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        (target && target.isContentEditable)
      ) {
        return;
      }
      if (state.ocrBusy || state.eraseBusy ||
          state.stitchBusy || state.sliceBusy || state.sliceExportBusy || state.spacingBusy) {
        return;
      }
      event.preventDefault();
      hostInvoke("undoPhotoshop", {}).then(function () {
        state.lastEraseLayerId = 0;
        state.eraseLayersBySelection = {};
        setStatus("已执行 Photoshop 撤回（Ctrl+Z）");
      }).catch(function (error) {
        setStatus("撤回失败：" + humanError(error));
      });
    });

    /*
     * 状态在每次实际修改时已经保存。不要在面板失焦/隐藏瞬间同步写
     * localStorage，避免与 Photoshop 的面板切换绘制争用主线程。
     */
    window.addEventListener("beforeunload", function () {
      window.clearTimeout(statusResetTimer);
      if (statusObserver) statusObserver.disconnect();
      if (state.sessionDirty) persistSessionNow();
    });
    window.addEventListener("beforeunload", function () {
      if (ocrServiceInstance || window.XinyangOcrService) {
        try { cleanupOcrTemp(); } catch (ignoreCleanup) {}
        try { stopManagedIopaint("exit", true); } catch (ignoreStop) {}
      }
    });
    document.addEventListener("xinyang:runtimeresume", function () {
      if (state.backgroundRunning && window.XinyangRuntime) {
        window.XinyangRuntime.requestPersistence(true);
      }
      var content = state.dom && state.dom.content;
      if (content) content.scrollTop = Number(state.panelScrollPositions[state.activePanel]) || content.scrollTop || 0;
    });
  }

  window.XinyangPanelDiagnostics = function () {
    return {
      activePanel: state.activePanel,
      busy: {
        stitch: !!state.stitchBusy,
        slice: !!state.sliceBusy,
        sliceExport: !!state.sliceExportBusy,
        spacing: !!state.spacingBusy,
        ocr: !!state.ocrBusy,
        erase: !!state.eraseBusy
      },
      filesCount: state.files ? state.files.length : 0,
      targetWidth: state.targetWidth,
      ocr: {
        available: !!state.localOcrAvailable,
        checking: !!state.localOcrChecking,
        checkedAt: state.localOcrCheckedAt || 0
      },
      lama: {
        reachable: !!state.localLamaReachable,
        available: !!state.localLamaAvailable,
        checking: !!state.localLamaChecking,
        checkedAt: state.localLamaCheckedAt || 0,
        routeVerified: !!state.localLamaRouteVerified,
        routeNote: state.localLamaRouteNote || "",
        protocol: state.localLamaProtocol || "",
        engine: state.localLamaEngine || "",
        url: state.localLamaUrl || "",
        fault: state.localLamaFault || "",
        faultUrl: state.localLamaFaultUrl || "",
        faultAt: state.localLamaFaultAt || 0
      },
      iopaint: {
        installPath: state.iopaintInstallPath || "",
        installed: !!state.iopaintInstalled,
        installBusy: !!state.iopaintInstallBusy,
        processPid: state.iopaintProcessPid || 0,
        activeRequests: state.iopaintActiveRequests || 0,
        idleMinutes: state.iopaintIdleMinutes || 0
      }
    };
  };

  function init() {
    if (window.__XINYANG_PANEL_INITIALIZED__) return;
    window.__XINYANG_PANEL_INITIALIZED__ = true;
    var savedPanel = storageGet(STORAGE_KEYS.activePanel);
    var savedBackground = storageGet(STORAGE_KEYS.backgroundRunning);
    state.activePanel = VALID_PANELS[savedPanel] ? savedPanel : "stitch-panel";
    state.backgroundRunning = savedBackground === null
      ? true
      : savedBackground === "1";
    var cachedNavButtons = document.querySelectorAll(".nav-button");
    var cachedPanels = document.querySelectorAll(".tool-panel");
    var navByPanel = {};
    var panelById = {};
    Array.prototype.slice.call(cachedNavButtons).forEach(function (node) {
      navByPanel[node.getAttribute("data-panel")] = node;
    });
    Array.prototype.slice.call(cachedPanels).forEach(function (node) {
      panelById[node.id] = node;
    });
    state.dom = {
      navButtons: cachedNavButtons,
      panels: cachedPanels,
      navByPanel: navByPanel,
      panelById: panelById,
      content: document.querySelector(".content")
    };
    initializeStatusBar();

    $("#background-running").checked = state.backgroundRunning;
    var savedApiUrl = storageGet(STORAGE_KEYS.ocrApiUrl);
    var legacyServiceUrl = storageGet(STORAGE_KEYS.legacyOcrServiceUrl);
    if (legacyServiceUrl) {
      legacyServiceUrl = legacyServiceUrl.replace(/\/+$/, "");
      if (!/\/ocr$/i.test(legacyServiceUrl)) legacyServiceUrl += "/ocr";
    }
    $("#ocr-api-url").value = savedApiUrl || (
      legacyServiceUrl && legacyServiceUrl !== LOCAL_OCR_URL + "/ocr"
        ? legacyServiceUrl
        : ""
    );
    $("#ocr-api-key").value = storageGet(STORAGE_KEYS.ocrApiKey) || "";
    var savedLamaUrl = normalizeServiceUrl(storageGet(STORAGE_KEYS.lamaServiceUrl), "");
    state.localLamaUrl = savedLamaUrl || LOCAL_LAMA_URL;
    state.iopaintInstallPath = storageGet(STORAGE_KEYS.iopaintInstallPath) || "";
    state.iopaintIdleMinutes = Math.max(1, Number(storageGet(STORAGE_KEYS.iopaintIdleMinutes)) || 10);
    var idleSelect = $("#iopaint-idle-minutes");
    if (idleSelect) idleSelect.value = String(state.iopaintIdleMinutes);
    var lamaInput = $("#lama-service-url");
    if (lamaInput) lamaInput.value = savedLamaUrl || "";
    var savedEraseMode = storageGet(STORAGE_KEYS.eraseMode);
    $("#erase-text-mode").value = /^(lama|horizontal|vertical|solidFill|contentAware)$/.test(
      savedEraseMode || ""
    ) ? savedEraseMode : "lama";
    schedulePhotoshopPersistence();
    setActivePanel(state.activePanel, false);
    renderBundleVersion();
    bindEvents();
    setSelectedWidth(790, false, true);
    updateFileControls();
    updateSliceButton();
    renderOcrResult();
    scheduleSessionRestore();
    var finishBoot = function () {
      document.documentElement.removeAttribute("data-runtime-booting");
      document.documentElement.classList.add("xinyang-runtime-ready");
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(finishBoot);
    } else {
      window.setTimeout(finishBoot, 0);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
