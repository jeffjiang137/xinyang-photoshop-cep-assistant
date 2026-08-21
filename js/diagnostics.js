(function () {
  "use strict";

  if (window.XinyangDiagnostics) return;

  var VERSION = "2.2.69";
  var STORAGE_KEY = "xinyang.diagnostics.recent.v1";
  var MAX_ENTRIES = 600;
  var PERSIST_ENTRIES = 260;
  var IMPORTANT_ENTRIES = 120;
  var entries = [];
  var importantEntries = [];
  var persistTimer = 0;
  var sessionStartedAt = new Date().toISOString();
  var sessionId = "S" + String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
  var originalConsole = {};
  var exportBusy = false;
  var activeReportPath = "";
  var activeReportTimer = 0;
  var activeReportWriteInProgress = false;
  var ACTIVE_REPORT_DELAY_MS = 1200;
  var ACTIVE_REPORT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

  function nowIso() {
    return new Date().toISOString();
  }

  function safeString(value) {
    try {
      if (value === undefined) return "";
      if (value === null) return "null";
      if (typeof value === "string") return value;
      if (value && value.stack) return String(value.stack);
      return JSON.stringify(value);
    } catch (error) {
      try { return String(value); } catch (ignore) { return "[无法序列化]"; }
    }
  }

  function maskFileLeaf(pathText) {
    var text = String(pathText || "");
    return text.replace(/([A-Za-z]:\\(?:[^\s\\]+\\)+)([^\\\r\n]+\.(?:psd|psb|png|jpe?g|webp|tiff?|bmp|gif|pdf|ai|svg|txt|json|log))/ig,
      function (_, dir, file) {
        var ext = file.indexOf(".") >= 0 ? file.slice(file.lastIndexOf(".")) : "";
        return dir + "<FILE>" + ext;
      }).replace(/((?:\/(?:[^\s\/]+))+\/)([^\/\r\n]+\.(?:psd|psb|png|jpe?g|webp|tiff?|bmp|gif|pdf|ai|svg|txt|json|log))/ig,
      function (_, dir, file) {
        var ext = file.indexOf(".") >= 0 ? file.slice(file.lastIndexOf(".")) : "";
        return dir + "<FILE>" + ext;
      });
  }

  function sanitizeString(value) {
    var text = String(value == null ? "" : value);
    text = text.replace(/(C:\\Users\\)[^\\\r\n]+/ig, "$1<USER>");
    text = text.replace(/(\/Users\/)[^\/\r\n]+/ig, "$1<USER>");
    text = text.replace(/(\/home\/)[^\/\r\n]+/ig, "$1<USER>");
    text = text.replace(/([?&](?:key|token|secret|appid|app_id|sign|signature|password|authorization)=)[^&\s]+/ig, "$1<REDACTED>");
    text = text.replace(/((?:api[-_ ]?key|secret(?:key)?|appid|app_id|password|authorization|bearer)\s*[:=]\s*)[^\s,;\]}]+/ig, "$1<REDACTED>");
    text = text.replace(/\b[A-Fa-f0-9]{40,}\b/g, "<TOKEN_REDACTED>");
    text = text.replace(/\b[A-Za-z0-9_\-]{56,}\b/g, "<TOKEN_REDACTED>");
    text = maskFileLeaf(text);
    if (text.length > 5000) text = text.slice(0, 5000) + "…<TRUNCATED>";
    return text;
  }

  function sanitizeValue(value, depth, seen) {
    depth = depth || 0;
    seen = seen || [];
    if (depth > 5) return "<MAX_DEPTH>";
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return sanitizeString(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "function") return "<FUNCTION>";
    if (value instanceof Error) {
      return {
        name: sanitizeString(value.name || "Error"),
        message: sanitizeString(value.message || ""),
        stack: sanitizeString(value.stack || "")
      };
    }
    if (typeof value !== "object") return sanitizeString(value);
    if (seen.indexOf(value) >= 0) return "<CIRCULAR>";
    seen.push(value);
    if (Array.isArray(value)) {
      return value.slice(0, 100).map(function (item) {
        return sanitizeValue(item, depth + 1, seen);
      });
    }
    var output = {};
    Object.keys(value).slice(0, 100).forEach(function (key) {
      if (/(secret|password|api.?key|token|authorization|credential|sign|appid)/i.test(key)) {
        output[key] = value[key] ? "<REDACTED>" : "";
      } else {
        output[key] = sanitizeValue(value[key], depth + 1, seen);
      }
    });
    return output;
  }

  function schedulePersist() {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(function () {
      persistTimer = 0;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          version: VERSION,
          sessionId: sessionId,
          savedAt: nowIso(),
          entries: entries.slice(-PERSIST_ENTRIES),
          importantEntries: importantEntries.slice(-IMPORTANT_ENTRIES)
        }));
      } catch (error) {}
    }, 600);
  }

  function activeReportModules() {
    return {
      fs: nodeRequireSafe("fs"),
      path: nodeRequireSafe("path"),
      os: nodeRequireSafe("os")
    };
  }

  function ensureActiveReportPath() {
    if (activeReportPath) return activeReportPath;
    var modules = activeReportModules();
    if (!modules.fs || !modules.path || !modules.os) return "";
    try {
      var folder = modules.path.join(modules.os.tmpdir(), "XinyangAssistant");
      if (!modules.fs.existsSync(folder)) modules.fs.mkdirSync(folder, { recursive: true });
      activeReportPath = modules.path.join(folder, "active-debug-" + sessionId + ".json");
    } catch (error) { activeReportPath = ""; }
    return activeReportPath;
  }

  function cleanupStaleActiveReports() {
    var modules = activeReportModules();
    if (!modules.fs || !modules.path || !modules.os) return;
    try {
      var folder = modules.path.join(modules.os.tmpdir(), "XinyangAssistant");
      if (!modules.fs.existsSync(folder)) return;
      var cutoff = Date.now() - ACTIVE_REPORT_MAX_AGE_MS;
      modules.fs.readdirSync(folder).forEach(function (name) {
        if (!/^active-debug-.*\.json$/i.test(name)) return;
        var file = modules.path.join(folder, name);
        try {
          if (modules.fs.statSync(file).mtimeMs < cutoff) modules.fs.unlinkSync(file);
        } catch (ignoreStaleActiveReport) {}
      });
    } catch (ignoreActiveReportCleanup) {}
  }

  function activeReportSnapshot() {
    return sanitizeValue({
      reportFormat: "XinyangAssistant-ActiveDebugReport-v1",
      updatedAt: nowIso(),
      expiresAfter: "Deleted on normal panel close; stale files are removed on next startup after 12 hours.",
      plugin: { version: VERSION, sessionId: sessionId, sessionStartedAt: sessionStartedAt },
      ui: { statusBar: (document.getElementById("status-text") || {}).textContent || "", visibility: document.visibilityState || "" },
      recentIssues: importantEntries.slice(-IMPORTANT_ENTRIES),
      recentLogs: entries.slice(-PERSIST_ENTRIES)
    });
  }

  function writeActiveReportNow() {
    activeReportTimer = 0;
    if (activeReportWriteInProgress) return;
    var file = ensureActiveReportPath();
    var modules = activeReportModules();
    if (!file || !modules.fs) return;
    activeReportWriteInProgress = true;
    try {
      modules.fs.writeFileSync(file, JSON.stringify(activeReportSnapshot(), null, 2), "utf8");
    } catch (ignoreActiveReportWrite) {}
    activeReportWriteInProgress = false;
  }

  function scheduleActiveReportWrite(immediate) {
    if (activeReportTimer) window.clearTimeout(activeReportTimer);
    activeReportTimer = window.setTimeout(writeActiveReportNow, immediate ? 0 : ACTIVE_REPORT_DELAY_MS);
  }

  function removeActiveReport() {
    if (activeReportTimer) window.clearTimeout(activeReportTimer);
    activeReportTimer = 0;
    var modules = activeReportModules();
    try {
      if (activeReportPath && modules.fs && modules.fs.existsSync(activeReportPath)) modules.fs.unlinkSync(activeReportPath);
    } catch (ignoreActiveReportRemove) {}
  }

  function log(level, category, message, data) {
    var item = {
      time: nowIso(),
      level: String(level || "info"),
      category: sanitizeString(category || "general"),
      message: sanitizeString(message || ""),
      data: data === undefined ? undefined : sanitizeValue(data)
    };
    entries.push(item);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    if (item.level === "error" || item.level === "warning") {
      importantEntries.push(sanitizeValue(item));
      if (importantEntries.length > IMPORTANT_ENTRIES) {
        importantEntries.splice(0, importantEntries.length - IMPORTANT_ENTRIES);
      }
    }
    schedulePersist();
    scheduleActiveReportWrite(item.level === "error");
    updateDebugSummary();
    return item;
  }

  function captureException(error, category, context) {
    return log("error", category || "exception", error && error.message ? error.message : safeString(error), {
      error: error,
      context: context || null
    });
  }

  function loadPreviousEntries() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.entries)) return;
      saved.entries.slice(-120).forEach(function (entry) {
        entries.push({
          time: entry.time || "",
          level: entry.level || "info",
          category: "previous:" + (entry.category || "general"),
          message: sanitizeString(entry.message || ""),
          data: sanitizeValue(entry.data)
        });
      });
      var previousImportant = Array.isArray(saved.importantEntries)
        ? saved.importantEntries
        : saved.entries.filter(function (entry) {
            return entry && (entry.level === "error" || entry.level === "warning");
          });
      previousImportant.slice(-IMPORTANT_ENTRIES).forEach(function (entry) {
        importantEntries.push({
          time: entry.time || "",
          level: entry.level || "warning",
          category: "previous:" + String(entry.category || "general").replace(/^previous:/, ""),
          message: sanitizeString(entry.message || ""),
          data: sanitizeValue(entry.data)
        });
      });
      if (importantEntries.length > IMPORTANT_ENTRIES) {
        importantEntries.splice(0, importantEntries.length - IMPORTANT_ENTRIES);
      }
    } catch (error) {}
  }

  function patchConsole() {
    ["warn", "error"].forEach(function (name) {
      if (!window.console || typeof window.console[name] !== "function") return;
      originalConsole[name] = window.console[name];
      window.console[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        try { log(name === "error" ? "error" : "warning", "console." + name, args.map(safeString).join(" ")); } catch (ignore) {}
        return originalConsole[name].apply(window.console, args);
      };
    });
  }

  function describeControl(node) {
    if (!node) return "unknown";
    var text = node.getAttribute && (
      node.getAttribute("aria-label") || node.getAttribute("title") ||
      node.getAttribute("data-common-action") || node.getAttribute("data-panel") ||
      node.getAttribute("data-action") || node.id
    );
    if (!text) text = String(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    return sanitizeString(text || node.tagName || "control");
  }

  function bindInteractionLogging() {
    document.addEventListener("click", function (event) {
      var node = event.target && event.target.closest
        ? event.target.closest("button, [role='button'], summary, a")
        : event.target;
      if (!node) return;
      log("info", "ui.click", describeControl(node), {
        tag: node.tagName || "",
        id: node.id || "",
        panel: (node.closest && node.closest(".tool-panel") && node.closest(".tool-panel").id) || ""
      });
    }, true);
    document.addEventListener("change", function (event) {
      var node = event.target;
      if (!node) return;
      var data = { id: node.id || "", type: node.type || node.tagName || "" };
      if (node.type === "checkbox" || node.type === "radio") data.checked = !!node.checked;
      if (node.tagName === "SELECT") data.value = sanitizeString(node.value || "");
      log("info", "ui.change", describeControl(node), data);
    }, true);
  }

  function bindRuntimeEvents() {
    [
      "xinyang:moduleloaded", "xinyang:hostbusy", "xinyang:hostidle",
      "xinyang:hostslow", "xinyang:runtimehidden", "xinyang:runtimeresume",
      "xinyang:beforereload"
    ].forEach(function (name) {
      document.addEventListener(name, function (event) {
        var detail = event.detail || {};
        /*
         * toolsGetTextSelectionState 是文字面板的只读轮询。旧版每次轮询会写入
         * hostbusy + hostidle 两条诊断日志，约 25 秒即可覆盖最近 100 条记录，
         * 使真正的错误在导出报告前被挤掉。正常轮询不记录；失败和 hostslow 仍保留。
         */
        if (detail.method === "toolsGetTextSelectionState") {
          if (name === "xinyang:hostbusy") return;
          if (name === "xinyang:hostidle" && !detail.failed) return;
        }
        var level = /slow/.test(name) ? "warning" : (/hostidle/.test(name) && detail.failed ? "error" : "info");
        log(level, name.replace("xinyang:", "runtime."), name, detail);
      });
    });
  }

  function bindGlobalErrors() {
    window.addEventListener("error", function (event) {
      captureException(event.error || event.message || "Window error", "window.error", {
        filename: event.filename || "",
        line: event.lineno || 0,
        column: event.colno || 0
      });
    });
    window.addEventListener("unhandledrejection", function (event) {
      captureException(event.reason || "Unhandled rejection", "promise.unhandled");
    });
  }

  function bindStatusObserver() {
    var node = document.getElementById("status-text");
    if (!node || typeof MutationObserver !== "function") return;
    var last = String(node.textContent || "");
    new MutationObserver(function () {
      var next = String(node.textContent || "");
      if (next === last) return;
      last = next;
      var level = /(失败|错误|无法|异常|超时)/.test(next) ? "error" :
        (/(警告|等待|跳过|部分)/.test(next) ? "warning" : "info");
      log(level, "status", next);
    }).observe(node, { childList: true, characterData: true, subtree: true });
  }

  function updateDebugSummary() {
    var summary = document.getElementById("diagnostics-summary");
    if (!summary) return;
    var errors = importantEntries.filter(function (item) { return item.level === "error"; });
    summary.textContent = "已记录 " + entries.length + " 条；保留问题 " + importantEntries.length + " 条；最近错误：" +
      (errors.length ? errors[errors.length - 1].message.slice(0, 80) : "无");
  }

  function nodeRequireSafe(name) {
    try {
      if (typeof window.require === "function") return window.require(name);
      if (typeof require === "function") return require(name);
    } catch (error) {}
    return null;
  }


  function nodeBuffer() {
    var module = nodeRequireSafe("buffer");
    return module && module.Buffer ? module.Buffer : (typeof Buffer !== "undefined" ? Buffer : null);
  }

  function collectNodeEnvironment() {
    var os = nodeRequireSafe("os");
    var processModule = nodeRequireSafe("process");
    if (!os || !processModule) return { available: false };
    var memory = {};
    try {
      memory.totalBytes = os.totalmem();
      memory.freeBytes = os.freemem();
    } catch (error) {}
    return sanitizeValue({
      available: true,
      nodeVersion: processModule.version || "",
      platform: processModule.platform || "",
      arch: processModule.arch || "",
      cwd: (function () { try { return processModule.cwd(); } catch (error) { return ""; } }()),
      osType: os.type(),
      osRelease: os.release(),
      osArch: os.arch(),
      cpus: (os.cpus && os.cpus() || []).slice(0, 1).map(function (cpu) {
        return { model: cpu.model, speed: cpu.speed };
      }),
      cpuCount: (os.cpus && os.cpus() || []).length,
      memory: memory
    });
  }

  function activePanelInfo() {
    var active = document.querySelector(".tool-panel:not([hidden]), .tool-panel.panel-active");
    return {
      id: active ? active.id : "",
      scrollTop: active ? active.scrollTop || 0 : 0,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
      visibilityState: document.visibilityState || ""
    };
  }

  function domText(id) {
    var node = document.getElementById(id);
    return node ? sanitizeString(node.textContent || node.value || "") : "";
  }

  function collectUiState() {
    var translation = {};
    try {
      if (window.XinyangBaiduTranslator && typeof window.XinyangBaiduTranslator.getSettings === "function") {
        var settings = window.XinyangBaiduTranslator.getSettings();
        translation = {
          hasCredentials: !!settings.hasCredentials,
          sourceLanguage: settings.sourceLanguage || "",
          targetLanguage: settings.targetLanguage || ""
        };
      }
    } catch (error) {
      translation.error = sanitizeString(error.message || error);
    }
    return {
      activePanel: activePanelInfo(),
      statusBar: domText("status-text"),
      services: {
        ocr: { state: domText("local-ocr-state"), detail: domText("local-ocr-detail") },
        lama: { state: domText("local-lama-state"), detail: domText("local-lama-detail") },
        baidu: { state: domText("baidu-translator-state"), detail: domText("baidu-translator-detail") }
      },
      translation: translation,
      backgroundRunning: !!(document.getElementById("background-running") && document.getElementById("background-running").checked),
      lamaServiceUrl: sanitizeString((document.getElementById("lama-service-url") || {}).value || ""),
      iopaintInstallPath: sanitizeString((document.getElementById("iopaint-install-path") || {}).value || ""),
      pluginVersionText: domText("plugin-version")
    };
  }

  function collectRuntimeState() {
    try {
      return window.XinyangRuntime && typeof window.XinyangRuntime.getState === "function"
        ? sanitizeValue(window.XinyangRuntime.getState())
        : { available: false };
    } catch (error) {
      return { available: false, error: sanitizeString(error.message || error) };
    }
  }

  function hostDiagnosticInfo() {
    if (!window.XinyangRuntime || typeof window.XinyangRuntime.hostInvoke !== "function") {
      return Promise.resolve({ available: false, error: "XinyangRuntime.hostInvoke 不可用" });
    }
    return new Promise(function (resolve) {
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve({ available: false, error: "Photoshop 宿主诊断超过 5 秒未返回，报告已降级生成" });
      }, 5000);
      window.XinyangRuntime.hostInvoke("getDiagnosticInfo", {}, { slowAfterMs: 4500 }).then(function (data) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ available: true, data: sanitizeValue(data) });
      }).catch(function (error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ available: false, error: sanitizeString(error.message || error) });
      });
    });
  }

  function httpProbe(url, timeoutMs) {
    return new Promise(function (resolve) {
      var parsed;
      var http;
      var request;
      try {
        var urlModule = nodeRequireSafe("url");
        if (!urlModule) throw new Error("Node URL 模块不可用");
        parsed = urlModule.parse(url);
        http = nodeRequireSafe(parsed.protocol === "https:" ? "https" : "http");
        if (!http) throw new Error("Node HTTP 模块不可用");
        var started = Date.now();
        request = http.request({
          method: "GET",
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: parsed.path || "/",
          headers: { "Accept": "application/json,text/plain,*/*" }
        }, function (response) {
          var chunks = [];
          var bytes = 0;
          response.on("data", function (chunk) {
            if (bytes < 2048) chunks.push(chunk);
            bytes += chunk.length || 0;
          });
          response.on("end", function () {
            resolve({
              url: sanitizeString(url),
              ok: response.statusCode >= 200 && response.statusCode < 500,
              statusCode: response.statusCode,
              elapsedMs: Date.now() - started,
              body: sanitizeString((nodeBuffer() ? nodeBuffer().concat(chunks).toString("utf8") : chunks.join("")).slice(0, 800))
            });
          });
        });
        request.setTimeout(timeoutMs || 1800, function () {
          request.destroy(new Error("timeout"));
        });
        request.on("error", function (error) {
          resolve({ url: sanitizeString(url), ok: false, error: sanitizeString(error.message || error) });
        });
        request.end();
      } catch (error) {
        resolve({ url: sanitizeString(url), ok: false, error: sanitizeString(error.message || error) });
      }
    });
  }

  function collectServiceProbes() {
    var urls = [
      "http://127.0.0.1:8866/health",
      "http://127.0.0.1:8867/health"
    ];
    var configuredPath = "";
    try {
      configuredPath = String((document.getElementById("iopaint-install-path") || {}).value || "").trim();
    } catch (error) {}
    return Promise.all(urls.map(function (url) { return httpProbe(url, 1800); })).then(function (results) {
      if (!configuredPath) {
        results.push({
          url: "http://127.0.0.1:8080/api/v1/model",
          skipped: true,
          reason: "未配置 IOPaint，本次不探测 8080，避免把正常的 ECONNREFUSED 当成故障线索"
        });
        return results;
      }
      return httpProbe("http://127.0.0.1:8080/api/v1/model", 1800).then(function (probe) {
        results.push(probe);
        return results;
      });
    });
  }

  function statPath(fs, pathModule, filePath) {
    return new Promise(function (resolve) {
      if (!filePath) { resolve({ path: "", exists: false }); return; }
      fs.stat(filePath, function (error, stat) {
        resolve({
          path: sanitizeString(filePath),
          exists: !error,
          type: !error && stat.isDirectory() ? "directory" : (!error ? "file" : ""),
          size: !error && stat.isFile() ? stat.size : 0,
          modifiedAt: !error && stat.mtime ? stat.mtime.toISOString() : "",
          error: error ? sanitizeString(error.code || error.message || error) : ""
        });
      });
    });
  }

  function readTail(fs, filePath, maxBytes) {
    return new Promise(function (resolve) {
      if (!filePath) { resolve(""); return; }
      fs.stat(filePath, function (error, stat) {
        if (error || !stat.isFile()) { resolve(""); return; }
        var length = Math.min(Number(maxBytes) || 32768, stat.size);
        var start = Math.max(0, stat.size - length);
        var BufferClass = nodeBuffer();
        if (!BufferClass) { resolve(""); return; }
        var buffer = BufferClass.alloc ? BufferClass.alloc(length) : new BufferClass(length);
        fs.open(filePath, "r", function (openError, fd) {
          if (openError) { resolve(""); return; }
          fs.read(fd, buffer, 0, length, start, function (readError, bytesRead) {
            fs.close(fd, function () {});
            if (readError) { resolve(""); return; }
            resolve(sanitizeString(buffer.slice(0, bytesRead).toString("utf8")));
          });
        });
      });
    });
  }

  function collectModelFiles() {
    var fs = nodeRequireSafe("fs");
    var pathModule = nodeRequireSafe("path");
    if (!fs || !pathModule) return Promise.resolve({ available: false });
    var root = "";
    try { root = window.localStorage.getItem("longStitch.iopaintInstallPath") || ""; } catch (error) {}
    if (!root) return Promise.resolve({ available: true, configured: false });
    var processModule = nodeRequireSafe("process");
    var isWindows = processModule && processModule.platform === "win32";
    var paths = {
      root: root,
      python: pathModule.join(root, "runtime", isWindows ? "Scripts/python.exe" : "bin/python"),
      iopaint: pathModule.join(root, "runtime", isWindows ? "Scripts/iopaint.exe" : "bin/iopaint"),
      model: pathModule.join(root, "models", "hub", "checkpoints", "big-lama.pt"),
      marker: pathModule.join(root, "install.json"),
      log: pathModule.join(root, "iopaint-service.log")
    };
    return Promise.all([
      statPath(fs, pathModule, paths.root),
      statPath(fs, pathModule, paths.python),
      statPath(fs, pathModule, paths.iopaint),
      statPath(fs, pathModule, paths.model),
      statPath(fs, pathModule, paths.marker),
      statPath(fs, pathModule, paths.log),
      readTail(fs, paths.log, 32768)
    ]).then(function (results) {
      return {
        available: true,
        configured: true,
        files: results.slice(0, 6),
        serviceLogTail: results[6]
      };
    });
  }

  function collectCepLogs() {
    var fs = nodeRequireSafe("fs");
    var pathModule = nodeRequireSafe("path");
    var os = nodeRequireSafe("os");
    if (!fs || !pathModule || !os) return Promise.resolve({ available: false });
    var temp = "";
    try { temp = os.tmpdir(); } catch (error) { return Promise.resolve({ available: false, error: sanitizeString(error.message || error) }); }
    return new Promise(function (resolve) {
      fs.readdir(temp, function (readError, names) {
        if (readError) { resolve({ available: false, error: sanitizeString(readError.message || readError) }); return; }
        var candidates = (names || []).filter(function (name) {
          return /(CEPHtmlEngine|CSXS|PlugPlug|CEP)/i.test(name) && !/\.tmp$/i.test(name);
        }).slice(0, 80);
        Promise.all(candidates.map(function (name) {
          var full = pathModule.join(temp, name);
          return statPath(fs, pathModule, full).then(function (stat) {
            stat._full = full;
            return stat;
          });
        })).then(function (stats) {
          stats = stats.filter(function (item) { return item.exists && item.type === "file"; });
          stats.sort(function (a, b) { return String(b.modifiedAt).localeCompare(String(a.modifiedAt)); });
          stats = stats.slice(0, 8);
          return Promise.all(stats.map(function (item) {
            return readTail(fs, item._full, 16384).then(function (tail) {
              delete item._full;
              return { file: item, tail: tail };
            });
          }));
        }).then(function (logs) {
          resolve({ available: true, tempDirectory: sanitizeString(temp), logs: logs });
        }).catch(function (error) {
          resolve({ available: false, error: sanitizeString(error.message || error) });
        });
      });
    });
  }

  function collectExtensionFiles() {
    var fs = nodeRequireSafe("fs");
    var pathModule = nodeRequireSafe("path");
    if (!fs || !pathModule) return Promise.resolve({ available: false });
    var root = "";
    try {
      if (typeof CSInterface === "function" && typeof SystemPath !== "undefined") {
        root = new CSInterface().getSystemPath(SystemPath.EXTENSION) || "";
      }
    } catch (error) {}
    if (!root && window.location && /^file:/i.test(window.location.protocol || "")) {
      try { root = decodeURIComponent(String(window.location.pathname || "")).replace(/[\\/]index\.html$/i, ""); } catch (error2) {}
    }
    root = String(root || "");
    if (/^file:/i.test(root)) {
      try { root = decodeURIComponent(root.replace(/^file:\/{2,3}/i, "")); }
      catch (ignoreDecodeExtensionRoot) { root = root.replace(/^file:\/{2,3}/i, ""); }
    }
    root = root.replace(/^\/([A-Za-z]:)/, "$1");
    if (!root) return Promise.resolve({ available: false, error: "无法取得插件安装目录" });
    var required = [
      "CSXS/manifest.xml", "index.html", "js/runtime.js", "js/diagnostics.js",
      "js/panel.js", "js/tools.js", "js/modules/common/file-io.js",
      "js/modules/tools/import-export.js", "js/modules/tools/transform.js",
      "js/modules/tools/typography.js", "js/modules/smart-slice/analyzer.js",
      "js/modules/ocr/ocr-client.js", "js/modules/ocr/lama-client.js",
      "js/modules/ocr/iopaint-manager.js", "js/modules/ocr/service.js",
      "js/modules/ocr/analyzer.js", "jsx/host.jsx", "jsx/module-loader.jsx",
      "jsx/modules/core/shared.jsx", "jsx/modules/core/layers.jsx",
      "jsx/modules/core/colors.jsx", "jsx/modules/core/diagnostics.jsx",
      "jsx/modules/tools/layer-tools.jsx",
      "jsx/modules/tools/embed-import.jsx", "jsx/modules/tools/file-export.jsx",
      "jsx/modules/text/text-tools.jsx", "jsx/modules/stitch/stitch-slice.jsx",
      "jsx/modules/ocr/ocr-host.jsx", "jsx/modules/framework/frame.jsx",
      "jsx/modules/framework/guides.jsx", "assets/icon.png"
    ];
    return Promise.all(required.map(function (relative) {
      return statPath(fs, pathModule, pathModule.join(root, relative)).then(function (stat) {
        stat.relativePath = relative;
        return stat;
      });
    })).then(function (files) {
      return { available: true, root: sanitizeString(root), files: files };
    });
  }

  function storageSummary() {
    var keys = [
      "longStitch.activePanel", "longStitch.backgroundRunning", "longStitch.eraseMode",
      "longStitch.lamaServiceUrl", "longStitch.iopaintIdleMinutes",
      "longStitch.ocrApiUrl", "longStitch.iopaintInstallPath"
    ];
    var result = {};
    keys.forEach(function (key) {
      try {
        var value = window.localStorage.getItem(key);
        if (/iopaintInstallPath/.test(key)) value = sanitizeString(value || "");
        if (/ocrApiUrl|lamaServiceUrl/.test(key)) value = sanitizeString(value || "");
        result[key] = value;
      } catch (error) {
        result[key] = "<READ_ERROR>";
      }
    });
    return result;
  }

  function buildReport() {
    log("info", "diagnostics", "开始生成调试报告");
    return Promise.all([
      hostDiagnosticInfo(),
      collectServiceProbes(),
      collectModelFiles(),
      collectCepLogs(),
      collectExtensionFiles()
    ]).then(function (parts) {
      var nodeInfo = collectNodeEnvironment();
      var healthWarnings = [];
      try {
        if (nodeInfo && nodeInfo.memory && Number(nodeInfo.memory.freeBytes) > 0 &&
            Number(nodeInfo.memory.freeBytes) < 1073741824) {
          healthWarnings.push("系统可用内存低于 1 GB；大型长图与 Photoshop 宿主调用可能明显变慢。建议关闭不必要应用或释放 Photoshop 缓存后复测。");
        }
      } catch (ignoreMemoryWarning) {}
      var report = {
        reportFormat: "XinyangAssistant-DebugReport-v1",
        generatedAt: nowIso(),
        privacy: "已自动隐藏 API 密钥、APPID、用户目录、长令牌与常见素材文件名；不包含图片像素、PSD 内容或文字图层正文。",
        plugin: {
          version: VERSION,
          bundleVersion: window.XINYANG_BUNDLE_VERSION || "",
          sessionId: sessionId,
          sessionStartedAt: sessionStartedAt
        },
        browser: sanitizeValue({
          userAgent: navigator.userAgent || "",
          platform: navigator.platform || "",
          language: navigator.language || "",
          online: navigator.onLine
        }),
        node: nodeInfo,
        healthWarnings: healthWarnings,
        ui: collectUiState(),
        runtime: collectRuntimeState(),
        panelState: (function () {
          try {
            return typeof window.XinyangPanelDiagnostics === "function"
              ? sanitizeValue(window.XinyangPanelDiagnostics())
              : { available: false };
          } catch (error) {
            return { available: false, error: sanitizeString(error.message || error) };
          }
        }()),
        photoshop: parts[0],
        services: { probes: parts[1], localModel: parts[2] },
        cepLogs: parts[3],
        extensionFiles: parts[4],
        storage: storageSummary(),
        recentIssues: importantEntries.slice(-IMPORTANT_ENTRIES),
        recentLogs: entries.slice(-500)
      };
      return sanitizeValue(report);
    });
  }

  function formatReport(report) {
    var issues = (report.recentIssues && report.recentIssues.length) ? report.recentIssues : (report.recentLogs || []);
    var errors = issues.filter(function (entry) { return entry.level === "error"; });
    var warnings = issues.filter(function (entry) { return entry.level === "warning"; });
    var healthWarnings = report.healthWarnings || [];
    var lines = [
      "鑫洋助理 Photoshop CEP 调试报告",
      "================================",
      "生成时间：" + report.generatedAt,
      "插件版本：v" + VERSION,
      "会话编号：" + sessionId,
      "日志数量：" + (report.recentLogs || []).length + "（独立保留错误 " + errors.length + "，警告 " + warnings.length + "）",
      "隐私说明：" + report.privacy,
      "",
      "【快速摘要】",
      "当前页面：" + (((report.ui || {}).activePanel || {}).id || "未知"),
      "底部状态：" + ((report.ui || {}).statusBar || ""),
      "OCR：" + ((((report.ui || {}).services || {}).ocr || {}).state || "未知") + " / " + ((((report.ui || {}).services || {}).ocr || {}).detail || ""),
      "LaMa：" + ((((report.ui || {}).services || {}).lama || {}).state || "未知") + " / " + ((((report.ui || {}).services || {}).lama || {}).detail || ""),
      "最近错误：" + (errors.length ? errors[errors.length - 1].message : "无"),
      "运行提醒：" + (healthWarnings.length ? healthWarnings.join("；") : "无"),
      "",
      "【结构化数据】",
      JSON.stringify(report, null, 2),
      ""
    ];
    return lines.join("\r\n");
  }

  function chooseExportFolder() {
    if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) {
      throw new Error("当前 CEP 环境无法打开文件夹选择器");
    }
    var result = window.cep.fs.showOpenDialogEx(false, true, "选择调试报告保存位置", "", []);
    if (!result || result.err !== 0 || !result.data || !result.data.length) return "";
    return Array.isArray(result.data) ? result.data[0] : result.data;
  }

  function setUiStatus(message) {
    if (window.XinyangStatus && typeof window.XinyangStatus.set === "function") {
      window.XinyangStatus.set(message);
      return;
    }
    var node = document.getElementById("status-text");
    if (node) node.textContent = String(message || "就绪");
  }

  function exportReport() {
    if (exportBusy) return Promise.resolve("");
    exportBusy = true;
    var button = document.getElementById("export-debug-report");
    if (button) button.disabled = true;
    setUiStatus("正在收集调试信息…");
    var folder = "";
    try {
      folder = chooseExportFolder();
      if (!folder) {
        exportBusy = false;
        if (button) button.disabled = false;
        setUiStatus("已取消导出调试报告");
        return Promise.resolve("");
      }
    } catch (error) {
      exportBusy = false;
      if (button) button.disabled = false;
      captureException(error, "diagnostics.export");
      setUiStatus("导出调试报告失败：" + sanitizeString(error.message || error));
      return Promise.reject(error);
    }

    return buildReport().then(function (report) {
      var fs = nodeRequireSafe("fs");
      var pathModule = nodeRequireSafe("path");
      if (!fs || !pathModule) throw new Error("Node 文件模块不可用");
      var stamp = nowIso().replace(/[:.]/g, "-");
      var filePath = pathModule.join(folder, "鑫洋助理_调试报告_v" + VERSION + "_" + stamp + ".txt");
      return new Promise(function (resolve, reject) {
        fs.writeFile(filePath, "\uFEFF" + formatReport(report), "utf8", function (error) {
          if (error) reject(error); else resolve(filePath);
        });
      });
    }).then(function (filePath) {
      log("info", "diagnostics", "调试报告导出成功", { path: filePath });
      setUiStatus("调试报告已导出：" + sanitizeString(filePath));
      var last = document.getElementById("diagnostics-last-export");
      if (last) last.textContent = "最近导出：" + sanitizeString(filePath);
      return filePath;
    }).catch(function (error) {
      captureException(error, "diagnostics.export");
      setUiStatus("导出调试报告失败：" + sanitizeString(error.message || error));
      throw error;
    }).then(function (value) {
      exportBusy = false;
      if (button) button.disabled = false;
      return value;
    }, function (error) {
      exportBusy = false;
      if (button) button.disabled = false;
      throw error;
    });
  }

  function clearLogs() {
    entries = [];
    importantEntries = [];
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) {}
    log("info", "diagnostics", "调试日志已清空");
    setUiStatus("调试日志已清空");
  }

  function bindUi() {
    var exportButton = document.getElementById("export-debug-report");
    var clearButton = document.getElementById("clear-debug-log");
    if (exportButton && exportButton.getAttribute("data-bound") !== "1") {
      exportButton.setAttribute("data-bound", "1");
      exportButton.addEventListener("click", function () {
        exportReport().catch(function () {});
      });
    }
    if (clearButton && clearButton.getAttribute("data-bound") !== "1") {
      clearButton.setAttribute("data-bound", "1");
      clearButton.addEventListener("click", clearLogs);
    }
    updateDebugSummary();
  }

  loadPreviousEntries();
  patchConsole();
  bindGlobalErrors();
  bindRuntimeEvents();

  window.XinyangDiagnostics = {
    version: VERSION,
    log: log,
    error: captureException,
    exportReport: exportReport,
    clear: clearLogs,
    getEntries: function () { return entries.slice(); },
    sanitize: sanitizeValue,
    buildReport: buildReport,
    getActiveReportPath: function () { return activeReportPath; }
  };

  /* runtime.js 先于本模块加载；把启动阶段暂存的宿主加载日志接入当前报告。 */
  try {
    if (window.XinyangRuntime && typeof window.XinyangRuntime.flushDiagnostics === "function") {
      window.XinyangRuntime.flushDiagnostics();
    }
  } catch (ignoreRuntimeDiagnosticsFlush) {}

  function ready() {
    cleanupStaleActiveReports();
    ensureActiveReportPath();
    bindInteractionLogging();
    bindStatusObserver();
    bindUi();
    log("info", "lifecycle", "诊断模块已启动", { version: VERSION, sessionId: sessionId });
  }

  window.addEventListener("beforeunload", removeActiveReport);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
}());
