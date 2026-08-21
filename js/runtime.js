(function () {
  "use strict";

  if (window.XinyangRuntime) return;

  /*
   * 变更版本号会让 CEP 和 Photoshop 同时放弃之前常驻的宿主对象。
   * v2.2.58 曾在按需加载改造期间缓存过不完整的 LongStitchCEP，
   * 拼图入口最容易因此停留在旧方法表。
   */
  var VERSION = "2.2.69";
  var cs = new CSInterface();
  var modulePromises = {};
  var loadedModules = {};
  var hostQueue = [];
  var hostActive = null;
  var hostSerial = 0;
  var lifecycleBound = false;
  var persistenceRetryTimer = 0;
  var resumeTimer = 0;
  var slowHostTimer = 0;
  var reloadTimer = 0;
  var hostEnsurePromise = null;
  var hostEnsureSerial = 0;
  var pendingDiagnostics = [];
  var hostLoadedVersion = "";
  var runtimeState = {
    visible: document.visibilityState !== "hidden",
    lastHiddenAt: 0,
    lastVisibleAt: Date.now ? Date.now() : new Date().getTime(),
    lastPersistenceAt: 0,
    reloadPending: false,
    reloadInProgress: false,
    hostQueueLength: 0,
    hostMethod: "",
    modules: loadedModules
  };

  var PANEL_MODULES = {
    "framework-panel": ["framework"],
    "document-panel": ["toolsImportExport", "toolsTransform", "tools"],
    "typography-panel": ["baiduTranslator", "toolsTypography", "tools"],
    "tools-panel": ["commonTools"],
    "text-panel": ["ocrClient", "lamaClient", "iopaintManager", "ocrService", "ocrAnalyzer"],
    "settings-panel": ["baiduTranslator", "ocrClient", "lamaClient", "iopaintManager", "ocrService"]
  };

  var FEATURE_MODULES = {
    smartSlice: ["fileIO", "smartSliceAnalyzer"],
    ocrService: ["ocrClient", "lamaClient", "iopaintManager", "ocrService"],
    ocrText: ["ocrClient", "lamaClient", "iopaintManager", "ocrService", "ocrAnalyzer"],
    documentTools: ["toolsImportExport", "toolsTransform", "tools"],
    typographyTools: ["baiduTranslator", "toolsTypography", "tools"],
    settingsServices: ["baiduTranslator", "ocrClient", "lamaClient", "iopaintManager", "ocrService"]
  };

  var MODULE_PATHS = {
    framework: "js/framework.js?v=" + VERSION,
    tools: "js/tools.js?v=" + VERSION,
    commonTools: "js/common-tools-v217.js?v=" + VERSION,
    pinyin: "js/pinyin-map.js?v=" + VERSION,
    baiduTranslator: "js/baidu-translator.js?v=" + VERSION,
    fileIO: "js/modules/common/file-io.js?v=" + VERSION,
    settingsStorage: "js/modules/settings/storage.js?v=" + VERSION,
    ocrClient: "js/modules/ocr/ocr-client.js?v=" + VERSION,
    lamaClient: "js/modules/ocr/lama-client.js?v=" + VERSION,
    iopaintManager: "js/modules/ocr/iopaint-manager.js?v=" + VERSION,
    ocrService: "js/modules/ocr/service.js?v=" + VERSION,
    ocrAnalyzer: "js/modules/ocr/analyzer.js?v=" + VERSION,
    smartSliceAnalyzer: "js/modules/smart-slice/analyzer.js?v=" + VERSION,
    toolsImportExport: "js/modules/tools/import-export.js?v=" + VERSION,
    toolsTransform: "js/modules/tools/transform.js?v=" + VERSION,
    toolsBatch: "js/modules/tools/batch.js?v=" + VERSION,
    toolsTypography: "js/modules/tools/typography.js?v=" + VERSION
  };

  var MODULE_GLOBALS = {
    baiduTranslator: "XinyangBaiduTranslator",
    fileIO: "XinyangFileIO",
    settingsStorage: "XinyangStorage",
    ocrClient: "XinyangOcrClient",
    lamaClient: "XinyangLamaClient",
    iopaintManager: "XinyangIopaintManager",
    ocrService: "XinyangOcrService",
    ocrAnalyzer: "XinyangOcrAnalyzer",
    smartSliceAnalyzer: "XinyangSmartSliceAnalyzer",
    toolsImportExport: "XinyangToolsImportExport",
    toolsTransform: "XinyangToolsTransform",
    toolsBatch: "XinyangToolsBatch",
    toolsTypography: "XinyangToolsTypography"
  };

  function now() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function safeStorageGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function dispatch(name, detail) {
    var event;
    try {
      event = new CustomEvent(name, { detail: detail || {} });
    } catch (error) {
      event = document.createEvent("CustomEvent");
      event.initCustomEvent(name, false, false, detail || {});
    }
    document.dispatchEvent(event);
  }

  /*
   * runtime.js 在 index.html 中先于 diagnostics.js 加载。宿主脚本通常会
   * 在诊断模块初始化前开始探测，因此不能直接依赖 XinyangDiagnostics.log。
   * 先暂存少量启动日志，diagnostics.js 就绪后再一次性转交，避免宿主加载
   * 失败时只剩下 CEP 的通用 error code 38。
   */
  function diagnosticLog(level, category, message, data) {
    var item = {
      level: String(level || "info"),
      category: String(category || "runtime"),
      message: String(message || ""),
      data: data
    };
    if (window.XinyangDiagnostics && typeof window.XinyangDiagnostics.log === "function") {
      try {
        window.XinyangDiagnostics.log(item.level, item.category, item.message, item.data);
        return;
      } catch (ignoreDiagnosticLog) {}
    }
    pendingDiagnostics.push(item);
    if (pendingDiagnostics.length > 80) {
      pendingDiagnostics.splice(0, pendingDiagnostics.length - 80);
    }
  }

  function flushDiagnostics() {
    var diagnostics = window.XinyangDiagnostics;
    if (!diagnostics || typeof diagnostics.log !== "function") return 0;
    while (pendingDiagnostics.length) {
      var item = pendingDiagnostics.shift();
      try {
        diagnostics.log(item.level, item.category, item.message, item.data);
      } catch (ignorePendingDiagnostic) {}
    }
    return true;
  }

  function setStatus(message) {
    if (window.XinyangStatus && typeof window.XinyangStatus.set === "function") {
      window.XinyangStatus.set(message);
      return;
    }
    var node = document.getElementById("status-text");
    if (node) node.textContent = String(message || "就绪");
  }

  function currentExtensionId() {
    try {
      return cs.getExtensionID() ||
        "com.jeffjiang.ecommerce-design-assistant-cep.panel";
    } catch (error) {
      return "com.jeffjiang.ecommerce-design-assistant-cep.panel";
    }
  }


  function extensionHostScriptPath() {
    try {
      var root = cs.getSystemPath(SystemPath.EXTENSION) || "";
      root = String(root).replace(/\\/g, "/").replace(/\/+$/, "");
      return root + "/jsx/host.jsx";
    } catch (error) {
      return "";
    }
  }

  function evalScriptDirect(script, meta) {
    meta = meta || {};
    var stage = String(meta.stage || "unknown");
    var startedAt = now();
    var scriptText = String(script || "");
    diagnosticLog("info", "runtime.hostscript.eval.start", "开始执行宿主脚本阶段：" + stage, {
      stage: stage,
      scriptLength: scriptText.length,
      force: !!meta.force,
      attemptId: meta.attemptId || 0
    });
    return new Promise(function (resolve, reject) {
      try {
        cs.evalScript(scriptText, function (raw) {
          var elapsedMs = now() - startedAt;
          if (raw === undefined || raw === null || raw === "EvalScript error.") {
            diagnosticLog("error", "runtime.hostscript.eval.failure", "宿主脚本阶段失败：" + stage, {
              stage: stage,
              raw: raw === undefined ? "<UNDEFINED>" : (raw === null ? "<NULL>" : String(raw)),
              rawType: typeof raw,
              elapsedMs: elapsedMs,
              force: !!meta.force,
              attemptId: meta.attemptId || 0
            });
            reject(new Error("Photoshop 宿主脚本执行失败"));
            return;
          }
          diagnosticLog("info", "runtime.hostscript.eval.success", "宿主脚本阶段完成：" + stage, {
            stage: stage,
            rawLength: String(raw).length,
            rawPreview: String(raw).slice(0, 240),
            elapsedMs: elapsedMs,
            force: !!meta.force,
            attemptId: meta.attemptId || 0
          });
          resolve(String(raw));
        });
      } catch (error) {
        diagnosticLog("error", "runtime.hostscript.eval.exception", "宿主脚本阶段抛出异常：" + stage, {
          stage: stage,
          elapsedMs: now() - startedAt,
          force: !!meta.force,
          attemptId: meta.attemptId || 0,
          error: error
        });
        reject(error);
      }
    });
  }

  function ensureHostScript(force) {
    force = !!force;
    var attemptId = ++hostEnsureSerial;
    diagnosticLog("info", "runtime.hostscript.ensure.start", "开始检查 Photoshop 宿主脚本", {
      force: force,
      attemptId: attemptId,
      cachedVersion: hostLoadedVersion || ""
    });
    if (!force && hostLoadedVersion === VERSION) {
      diagnosticLog("info", "runtime.hostscript.ensure.cached", "复用已加载的 Photoshop 宿主脚本", {
        version: VERSION,
        attemptId: attemptId
      });
      return Promise.resolve(VERSION);
    }
    if (hostEnsurePromise) {
      diagnosticLog("info", "runtime.hostscript.ensure.join", "等待已有的宿主脚本加载任务", {
        force: force,
        attemptId: attemptId
      });
      return hostEnsurePromise;
    }

    var versionProbe = '(function(){try{return (typeof LongStitchCEP!=="undefined"&&LongStitchCEP&&LongStitchCEP.version)?String(LongStitchCEP.version):"";}catch(e){return "";}})()';
    hostEnsurePromise = evalScriptDirect(versionProbe, {
      stage: "version-probe",
      force: force,
      attemptId: attemptId
    }).then(function (currentVersion) {
      currentVersion = String(currentVersion || "");
      diagnosticLog("info", "runtime.hostscript.version", "宿主脚本版本探测完成", {
        currentVersion: currentVersion,
        expectedVersion: VERSION,
        force: force,
        attemptId: attemptId
      });
      if (!force && currentVersion === VERSION) {
        hostLoadedVersion = currentVersion;
        return currentVersion;
      }
      var hostPath = extensionHostScriptPath();
      if (!hostPath) {
        diagnosticLog("error", "runtime.hostscript.path.failure", "无法定位 Photoshop 宿主脚本", {
          force: force,
          attemptId: attemptId
        });
        throw new Error("无法定位 Photoshop 宿主脚本");
      }
      diagnosticLog("info", "runtime.hostscript.reload.start", "准备重新加载 Photoshop 宿主脚本", {
        hostPath: hostPath,
        previousVersion: currentVersion,
        expectedVersion: VERSION,
        force: force,
        attemptId: attemptId
      });
      var reloadScript = '(function(){try{$.evalFile(new File(' +
        JSON.stringify(hostPath) +
        '));return (typeof LongStitchCEP!=="undefined"&&LongStitchCEP&&LongStitchCEP.version)?String(LongStitchCEP.version):"";}catch(e){return "__ERROR__"+String(e&&e.message?e.message:e);}})()';
      return evalScriptDirect(reloadScript, {
        stage: "host-reload-evalFile",
        force: force,
        attemptId: attemptId
      }).then(function (loadedVersion) {
        loadedVersion = String(loadedVersion || "");
        if (loadedVersion.indexOf("__ERROR__") === 0) {
          diagnosticLog("error", "runtime.hostscript.reload.failure", "宿主脚本返回加载错误", {
            hostPath: hostPath,
            loadedVersion: loadedVersion,
            force: force,
            attemptId: attemptId
          });
          throw new Error("重新加载宿主脚本失败：" + loadedVersion.slice(9));
        }
        if (loadedVersion !== VERSION) {
          diagnosticLog("error", "runtime.hostscript.version.mismatch", "宿主脚本加载后版本不一致", {
            hostPath: hostPath,
            loadedVersion: loadedVersion,
            expectedVersion: VERSION,
            force: force,
            attemptId: attemptId
          });
          throw new Error("宿主脚本版本不一致：" + (loadedVersion || "未知") + "，需要 " + VERSION);
        }
        hostLoadedVersion = loadedVersion;
        diagnosticLog("info", "runtime.hostscript.reload.success", "Photoshop 宿主脚本加载成功", {
          hostPath: hostPath,
          version: loadedVersion,
          force: force,
          attemptId: attemptId
        });
        dispatch("xinyang:hostscriptloaded", { version: loadedVersion });
        return loadedVersion;
      });
    });

    hostEnsurePromise = hostEnsurePromise.then(function (value) {
      hostEnsurePromise = null;
      return value;
    }, function (error) {
      diagnosticLog("error", "runtime.hostscript.ensure.failure", "Photoshop 宿主脚本加载失败", {
        force: force,
        attemptId: attemptId,
        error: error
      });
      dispatch("xinyang:hostscriptloadfailed", {
        force: force,
        attemptId: attemptId,
        error: String(error && error.message ? error.message : error || "")
      });
      hostEnsurePromise = null;
      throw error;
    });
    return hostEnsurePromise;
  }

  function requestPersistence(force) {
    var enabled = safeStorageGet("longStitch.backgroundRunning") !== "0";
    if (!enabled) return false;
    var time = now();
    if (!force && time - runtimeState.lastPersistenceAt < 500) return true;
    runtimeState.lastPersistenceAt = time;
    try {
      var event = new CSEvent(
        "com.adobe.PhotoshopPersistent",
        "APPLICATION",
        "PHXS",
        currentExtensionId()
      );
      event.extensionId = currentExtensionId();
      cs.dispatchEvent(event);
      return true;
    } catch (error) {
      return false;
    }
  }

  function backgroundRunningEnabled() {
    return safeStorageGet("longStitch.backgroundRunning") !== "0";
  }

  function clearPersistenceRetry() {
    if (persistenceRetryTimer) window.clearTimeout(persistenceRetryTimer);
    persistenceRetryTimer = 0;
  }

  function buildReloadUrl() {
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
      "xinyang_reload=" + now();
    return href + hash;
  }

  function requestUnPersistence() {
    try {
      var event = new CSEvent(
        "com.adobe.PhotoshopUnPersistent",
        "APPLICATION",
        "PHXS",
        currentExtensionId()
      );
      event.extensionId = currentExtensionId();
      cs.dispatchEvent(event);
      return true;
    } catch (error) {
      return false;
    }
  }

  function reloadExtensionPage(source, options) {
    options = options || {};
    var forced = !!options.force;
    if (runtimeState.reloadInProgress) return true;
    if (!forced && backgroundRunningEnabled()) {
      runtimeState.reloadPending = false;
      return false;
    }
    if (hostActive || hostQueue.length) {
      runtimeState.reloadPending = true;
      setStatus("等待当前 Photoshop 任务完成后重新加载插件");
      if (reloadTimer) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(function () {
        reloadTimer = 0;
        reloadExtensionPage(source || "host-idle", options);
      }, 180);
      return true;
    }
    runtimeState.reloadInProgress = true;
    runtimeState.reloadPending = false;
    clearPersistenceRetry();
    if (reloadTimer) window.clearTimeout(reloadTimer);
    reloadTimer = 0;

    /*
     * 手动重新加载不依赖“后台运行”开关。先撤销 CEP 持久化请求，再用
     * 时间戳打开同一 index.html，强制 Chromium 重新读取磁盘上的 HTML、
     * CSS 和 JavaScript。重新进入后会按原设置重新申请持久化。
     */
    if (forced) requestUnPersistence();
    dispatch("xinyang:beforereload", {
      source: source || "panel-visible",
      forced: forced
    });
    setStatus(forced ? "正在重新加载插件并读取磁盘上的最新文件…" : "正在重新加载插件…");
    window.setTimeout(function () {
      try {
        window.location.replace(buildReloadUrl());
      } catch (error) {
        try { window.location.reload(true); } catch (ignored) {}
      }
    }, forced ? 80 : 35);
    return true;
  }

  function manualReloadExtension(source) {
    return reloadExtensionPage(source || "settings-manual", { force: true });
  }

  function schedulePersistenceRetry() {
    if (persistenceRetryTimer) window.clearTimeout(persistenceRetryTimer);
    persistenceRetryTimer = window.setTimeout(function () {
      persistenceRetryTimer = 0;
      requestPersistence(true);
    }, 220);
  }

  function moduleLoaded(name) {
    loadedModules[name] = true;
    dispatch("xinyang:moduleloaded", { name: name });
    return true;
  }

  function loadScript(name) {
    if (loadedModules[name]) return Promise.resolve(true);
    if (MODULE_GLOBALS[name] && window[MODULE_GLOBALS[name]]) {
      return Promise.resolve(moduleLoaded(name));
    }
    if (modulePromises[name]) return modulePromises[name];
    var path = MODULE_PATHS[name];
    if (!path) return Promise.reject(new Error("未知模块：" + name));

    modulePromises[name] = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      var settled = false;
      script.src = path;
      script.async = false;
      script.setAttribute("data-xinyang-module", name);
      script.onload = function () {
        if (settled) return;
        settled = true;
        script.onload = null;
        script.onerror = null;
        moduleLoaded(name);
        resolve(true);
      };
      script.onerror = function () {
        if (settled) return;
        settled = true;
        script.onload = null;
        script.onerror = null;
        modulePromises[name] = null;
        reject(new Error("模块加载失败：" + name));
      };
      (document.head || document.documentElement).appendChild(script);
    });

    return modulePromises[name];
  }

  function ensureModules(modules) {
    modules = modules || [];
    if (!modules.length) return Promise.resolve(true);
    /*
     * CEP 动态脚本按依赖声明顺序串行加载。这样既避免老 Chromium
     * 对动态 script 的完成顺序差异，也保证门面模块只在依赖就绪后初始化。
     */
    var chain = Promise.resolve(true);
    modules.forEach(function (name) {
      chain = chain.then(function () { return loadScript(name); });
    });
    return chain.then(function () { return true; });
  }

  function ensurePanelModule(panelId) {
    return ensureModules(PANEL_MODULES[String(panelId || "")] || []);
  }

  function ensureFeatureModule(featureName) {
    var modules = FEATURE_MODULES[String(featureName || "")];
    if (!modules) return Promise.reject(new Error("未知功能模块：" + featureName));
    return ensureModules(modules);
  }

  function prefetchPanelModule(panelId) {
    var run = function () {
      ensurePanelModule(panelId).catch(function () {});
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 400 });
    } else {
      window.setTimeout(run, 40);
    }
  }

  function ensurePinyinMap() {
    if (window.XINYANG_PINYIN_MAP) {
      loadedModules.pinyin = true;
      return Promise.resolve(true);
    }
    return loadScript("pinyin");
  }

  function shouldLoadCommonToolsInBackground() {
    var raw = safeStorageGet("xinyang.commonTools.v217") ||
      safeStorageGet("xinyang.commonTools.v210") || "";
    if (!raw) return false;
    try {
      var config = JSON.parse(raw);
      return !!(
        config.autoFillColor ||
        config.autoEmbedPlace ||
        config.autoEmbedPaste
      );
    } catch (error) {
      return false;
    }
  }

  function warmBackgroundModules() {
    if (!shouldLoadCommonToolsInBackground()) return;
    var load = function () {
      loadScript("commonTools").catch(function () {});
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(load, { timeout: 700 });
    } else {
      window.setTimeout(load, 120);
    }
  }

  function parseHostResult(raw) {
    if (!raw || raw === "EvalScript error.") {
      throw new Error("Photoshop 脚本执行失败");
    }
    var result = JSON.parse(raw);
    if (!result || !result.ok) {
      throw new Error(result && result.error ? result.error : "Photoshop 操作失败");
    }
    return result.data || {};
  }

  function updateHostState() {
    runtimeState.hostQueueLength = hostQueue.length;
    runtimeState.hostMethod = hostActive ? hostActive.method : "";
    if (document.body) {
      document.body.classList.toggle("xinyang-host-busy", !!hostActive);
    }
  }

  function clearSlowTimer() {
    if (slowHostTimer) window.clearTimeout(slowHostTimer);
    slowHostTimer = 0;
  }

  function finishHostTask(task, error, data) {
    clearSlowTimer();
    if (hostActive !== task) return;
    hostActive = null;
    updateHostState();
    if (error) task.reject(error);
    else task.resolve(data);
    dispatch("xinyang:hostidle", {
      id: task.id,
      method: task.method,
      elapsedMs: now() - task.startedAt,
      queueLength: hostQueue.length,
      failed: !!error,
      error: error ? String(error && error.message ? error.message : error) : ""
    });
    window.setTimeout(processHostQueue, 0);
  }

  function processHostQueue() {
    if (hostActive || !hostQueue.length) {
      updateHostState();
      return;
    }
    var task = hostQueue.shift();
    hostActive = task;
    task.startedAt = now();
    updateHostState();
    dispatch("xinyang:hostbusy", {
      id: task.id,
      method: task.method,
      queueLength: hostQueue.length,
      queuedMs: now() - task.createdAt
    });

    slowHostTimer = window.setTimeout(function () {
      if (hostActive !== task) return;
      dispatch("xinyang:hostslow", {
        method: task.method,
        elapsedMs: now() - task.startedAt
      });
      var node = document.getElementById("status-text");
      if (node && !/正在|处理中|识别|导出|创建|调整/.test(node.textContent || "")) {
        setStatus("Photoshop 正在处理较大任务，请等待完成，避免重复点击");
      }
    }, Number(task.options.slowAfterMs) || 12000);

    var json;
    var script;
    try {
      if (task.rawScript) {
        script = task.rawScript;
      } else {
        json = JSON.stringify(task.payload || {});
        script = "LongStitchCEP.invoke(" +
          JSON.stringify(String(task.method)) + "," +
          JSON.stringify(json) + ")";
      }
    } catch (error) {
      finishHostTask(task, error);
      return;
    }

    try {
      diagnosticLog("info", "runtime.hostscript.invoke.start", "开始调用 Photoshop 宿主方法", {
        method: task.method,
        scriptLength: script.length,
        payloadLength: json ? json.length : 0,
        taskId: task.id
      });
      cs.evalScript(script, function (raw) {
        var data;
        var rawText = raw === null || typeof raw === "undefined"
          ? ""
          : String(raw);
        diagnosticLog(
          rawText === "EvalScript error." ? "error" : "info",
          "runtime.hostscript.invoke.response",
          rawText === "EvalScript error."
            ? "Photoshop 宿主方法返回 CEP error code 38"
            : "Photoshop 宿主方法返回结果",
          {
            method: task.method,
            rawLength: rawText.length,
            rawPreview: rawText.slice(0, 240),
            scriptLength: script.length,
            payloadLength: json ? json.length : 0,
            taskId: task.id
          }
        );
        try {
          data = task.rawScript ? raw : parseHostResult(rawText);
          finishHostTask(task, null, data);
        } catch (error) {
          finishHostTask(task, error);
        }
      });
    } catch (error) {
      finishHostTask(task, error);
    }
  }

  function enqueueHostInvoke(method, payload, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      if (hostQueue.length >= 40) {
        reject(new Error("Photoshop 操作队列过长，请等待当前任务完成"));
        return;
      }
      var task = {
        id: ++hostSerial,
        method: String(method || ""),
        payload: payload || {},
        options: options,
        resolve: resolve,
        reject: reject,
        createdAt: now(),
        startedAt: 0
      };
      hostQueue.push(task);
      updateHostState();
      processHostQueue();
    });
  }

  function hostInvoke(method, payload, options) {
    options = options || {};
    var retryOptions = {};
    var key;
    for (key in options) {
      if (options.hasOwnProperty(key)) retryOptions[key] = options[key];
    }
    return ensureHostScript(false).then(function () {
      return enqueueHostInvoke(method, payload, options);
    }).catch(function (error) {
      var message = String(error && error.message ? error.message : error || "");
      diagnosticLog("error", "runtime.hostscript.invoke.failure", "宿主调用前置检查失败", {
        method: String(method || ""),
        message: message,
        retryAttempted: !!options.__hostReloadRetried
      });
      if (!options.__hostReloadRetried && /未知功能|LongStitchCEP|宿主脚本版本|宿主脚本执行失败|不支持的文字擦除方式/.test(message)) {
        retryOptions.__hostReloadRetried = true;
        diagnosticLog("warning", "runtime.hostscript.retry", "宿主调用将强制重新加载后重试", {
          method: String(method || ""),
          message: message
        });
        return ensureHostScript(true).then(function () {
          return enqueueHostInvoke(method, payload, retryOptions);
        }).catch(function (retryError) {
          diagnosticLog("error", "runtime.hostscript.retry.failure", "宿主脚本强制重载重试失败", {
            method: String(method || ""),
            error: retryError
          });
          throw retryError;
        });
      }
      throw error;
    });
  }

  function evalScriptRaw(script, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      if (hostQueue.length >= 40) {
        reject(new Error("Photoshop 操作队列过长，请等待当前任务完成"));
        return;
      }
      var task = {
        id: ++hostSerial,
        method: String(options.label || "rawScript"),
        payload: {},
        rawScript: String(script || ""),
        options: options,
        resolve: resolve,
        reject: reject,
        createdAt: now(),
        startedAt: 0
      };
      hostQueue.push(task);
      updateHostState();
      processHostQueue();
    });
  }

  function markResuming() {
    var root = document.documentElement;
    if (!root) return;
    root.classList.add("xinyang-runtime-resuming");
    if (resumeTimer) window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(function () {
      resumeTimer = 0;
      root.classList.remove("xinyang-runtime-resuming");
    }, 140);
  }

  function onHidden(source) {
    if (!runtimeState.visible) return;
    runtimeState.visible = false;
    runtimeState.lastHiddenAt = now();
    /*
     * 后台运行关闭时，不保留当前页面实例。若 Photoshop 没有立即销毁
     * CEP 页面，则在下次重新显示时主动刷新；若宿主已经销毁页面，
     * 下次打开本身就会加载磁盘上的最新版。该标记只保存在内存中，
     * 不写 localStorage，避免新页面启动后形成刷新循环。
     */
    runtimeState.reloadPending = !backgroundRunningEnabled();
    if (runtimeState.reloadPending) clearPersistenceRetry();
    if (document.documentElement) {
      document.documentElement.setAttribute("data-runtime-hidden", "1");
    }
    dispatch("xinyang:runtimehidden", {
      source: source || "visibility",
      reloadPending: runtimeState.reloadPending
    });
  }

  function onVisible(source) {
    var wasHidden = !runtimeState.visible;
    runtimeState.visible = true;
    runtimeState.lastVisibleAt = now();
    if (document.documentElement) {
      document.documentElement.removeAttribute("data-runtime-hidden");
    }
    if (
      wasHidden &&
      runtimeState.reloadPending &&
      !backgroundRunningEnabled()
    ) {
      reloadExtensionPage(source || "visibility");
      return;
    }
    runtimeState.reloadPending = false;
    /*
     * 只有真正从隐藏状态恢复时才强制重发持久化事件。CEP 窗口在
     * 输入框聚焦、宿主切换焦点时可能重复触发 focus；旧逻辑每次都
     * 强制 dispatch + retry，会形成无意义的宿主事件风暴。
     */
    if (wasHidden) {
      requestPersistence(true);
      schedulePersistenceRetry();
      markResuming();
      dispatch("xinyang:runtimeresume", {
        source: source || "visibility",
        hiddenMs: runtimeState.lastHiddenAt
          ? runtimeState.lastVisibleAt - runtimeState.lastHiddenAt
          : 0
      });
    } else {
      requestPersistence(false);
    }
  }

  function bindLifecycle() {
    if (lifecycleBound) return;
    lifecycleBound = true;
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") onHidden("visibilitychange");
      else onVisible("visibilitychange");
    });
    window.addEventListener("pagehide", function () { onHidden("pagehide"); });
    window.addEventListener("pageshow", function () { onVisible("pageshow"); });
    window.addEventListener("focus", function () {
      if (document.visibilityState !== "hidden") onVisible("focus");
    });
  }

  function getState() {
    return {
      visible: runtimeState.visible,
      lastHiddenAt: runtimeState.lastHiddenAt,
      lastVisibleAt: runtimeState.lastVisibleAt,
      lastPersistenceAt: runtimeState.lastPersistenceAt,
      reloadPending: runtimeState.reloadPending,
      reloadInProgress: runtimeState.reloadInProgress,
      backgroundRunning: backgroundRunningEnabled(),
      hostQueueLength: hostQueue.length,
      hostMethod: hostActive ? hostActive.method : "",
      modules: Object.keys(loadedModules)
    };
  }

  window.XinyangRuntime = {
    version: VERSION,
    hostInvoke: hostInvoke,
    evalScriptRaw: evalScriptRaw,
    ensureHostScript: ensureHostScript,
    loadModule: loadScript,
    ensureModules: ensureModules,
    ensurePanelModule: ensurePanelModule,
    ensureFeatureModule: ensureFeatureModule,
    prefetchPanelModule: prefetchPanelModule,
    ensurePinyinMap: ensurePinyinMap,
    requestPersistence: requestPersistence,
    reloadExtensionPage: reloadExtensionPage,
    manualReloadExtension: manualReloadExtension,
    flushDiagnostics: flushDiagnostics,
    getState: getState,
    dispatch: dispatch
  };
  window.XINYANG_BUNDLE_VERSION = VERSION;

  bindLifecycle();
  requestPersistence(true);
  schedulePersistenceRetry();
  ensureHostScript(false).catch(function (error) {
    diagnosticLog("error", "runtime.hostscript.startup.failure", "插件启动时宿主脚本加载失败", {
      error: error
    });
  });
  warmBackgroundModules();
}());
