(function () {
  "use strict";

  var cs = new CSInterface();
  var busy = false;
  var busyControls = null;
  var configSaveTimer = 0;
  var configDirty = false;
  var config = {
    distributeAxis: "horizontal",
    distributeGap: 0,
    distributeOrder: 0,
    autoEmbedPlace: false,
    autoEmbedPaste: false,
    embedLowerVisual: false,
    importImagesIsLinkObject: false,
    autoFillColor: false,
    autoFillText: true,
    autoFillShape: true,
    autoFillNormal: true,
    customTransformPoint: 1,
    exportFormat: "jpg",
    exportQuality: 100,
    exportPngMode: "8",
    exportPath: "",
    exportPathType: "desktop",
    exportFileName: "",
    exportLayerName: false,
    exportAutoNumber: false,
    exportSaveType: 0,
    exportWidth: "",
    exportHeight: "",
    exportWatermark: "",
    exportOriginImage: false,
    exportOpenFolder: false,
    smartSnapEnabled: false,
    smartSnapDistance: 20,
    smartSnapLayerEdges: true,
    smartSnapCenters: true,
    smartSnapEqualSpacing: true,
    smartSnapCanvasEdges: true,
    smartSnapGuides: true
  };

  var AUTO_EMBED_PLACE_EVENT = "1349280544";
  var AUTO_EMBED_PASTE_EVENT = "1885434740";
  var AUTO_FILL_COLOR_EVENT = "1936028772";
  var photoshopCallbackInstalled = false;
  var photoshopCallbackName = "";
  var autoEmbedAttemptSerial = 0;
  var autoEmbedInFlight = false;
  var pendingAutoEmbedTrigger = "";
  var lastEventAt = {};
  var autoFillTimer = 0;
  var autoFillInFlight = false;
  var autoFillSuppressUntil = 0;
  var pendingAutoFillColorSet = "";
  var AUTO_FILL_DEBOUNCE_MS = 260;
  var AUTO_FILL_SUPPRESS_MS = 900;

  function one(selector) { return document.querySelector(selector); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function status(message) {
    if (window.XinyangStatus && typeof window.XinyangStatus.set === "function") {
      window.XinyangStatus.set(message);
      return;
    }
    var node = one("#status-text");
    if (node) node.textContent = String(message || "就绪");
  }
  function errorText(error) { return error && error.message ? error.message : String(error || "未知错误"); }
  function numberValue(selector, fallback) {
    var node = one(selector);
    var value = node ? Number(node.value) : Number(fallback);
    return isFinite(value) ? value : Number(fallback || 0);
  }
  function textValue(selector) {
    var node = one(selector);
    return node ? String(node.value || "") : "";
  }
  function checked(selector) {
    var node = one(selector);
    return !!(node && node.checked);
  }
  function selectedRadio(name, fallback) {
    var node = one('input[name="' + name + '"]:checked');
    return node ? String(node.value) : String(fallback || "");
  }

  function extensionRootPath() {
    var value = "";
    try {
      if (typeof SystemPath !== "undefined" && cs.getSystemPath) {
        value = cs.getSystemPath(SystemPath.EXTENSION) || "";
      }
    } catch (error) {}
    if (!value && window.location && /^file:/i.test(window.location.protocol || "")) {
      try {
        value = decodeURIComponent(String(window.location.pathname || ""))
          .replace(/[\/]index\.html$/i, "");
      } catch (ignorePath) {}
    }
    try { value = decodeURIComponent(String(value || "")); }
    catch (ignoreDecodeExtensionPath) { value = String(value || ""); }
    return value
      .replace(/^file:\/{2,3}/i, "")
      .replace(/^\/([A-Za-z]:)/, "$1");
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

  function setBusy(value, message) {
    busy = !!value;
    if (!busyControls) {
      busyControls = all(
        ".common-tools-shell button, .common-tools-shell input, " +
        ".common-tools-shell select"
      );
    }
    busyControls.forEach(function (node) { node.disabled = busy; });
    /* 解除 busy 后重新应用嵌入模式互斥状态，避免“嵌入下方图层”开启时
       两个自动嵌入选项被通用 busy 解锁。 */
    if (!busy && typeof updateEmbedOptionUi === "function") updateEmbedOptionUi();
    if (message) status(message);
  }

  function runHost(method, payload, pending, done) {
    if (busy) return Promise.reject(new Error("已有工具正在执行"));
    setBusy(true, pending);
    return hostInvoke(method, payload || {}).then(function (result) {
      status(typeof done === "function" ? done(result) : String(done || "操作完成"));
      return result;
    }).catch(function (error) {
      status("操作失败：" + errorText(error));
      throw error;
    }).then(function (result) {
      setBusy(false);
      return result;
    }, function (error) {
      setBusy(false);
      return Promise.reject(error);
    });
  }

  function pickImages(multiple) {
    var result = window.cep.fs.showOpenDialogEx(
      !!multiple,
      false,
      multiple ? "选择需要导入的图片" : "选择一张图片",
      "",
      ["jpg", "jpeg", "png", "webp", "psd", "psb", "tif", "tiff", "bmp", "gif"]
    );
    return result && result.err === 0 && result.data ? result.data : [];
  }

  function pickFolder(title) {
    var result = window.cep.fs.showOpenDialogEx(false, true, title || "选择文件夹", "", []);
    return result && result.err === 0 && result.data && result.data.length ? result.data[0] : "";
  }

  function pickWatermark() {
    var result = window.cep.fs.showOpenDialogEx(false, false, "选择水印图片", "", ["png", "jpg", "jpeg", "webp", "psd"]);
    return result && result.err === 0 && result.data && result.data.length ? result.data[0] : "";
  }

  function invokeStandaloneEmbedLowerVisual() {
    return new Promise(function (resolve, reject) {
      var extensionRoot = "";
      try {
        extensionRoot = String(cs.getSystemPath(SystemPath.EXTENSION) || "")
          .replace(/\\/g, "/")
          .replace(/\/+$/, "");
      } catch (ignoreExtensionPath) {}
      var scriptPath = extensionRoot
        ? extensionRoot + "/jsx/embed-lower-visual-v2202.jsx"
        : "";
      if (!scriptPath) {
        reject(new Error("无法定位独立‘嵌入下方图层’脚本"));
        return;
      }

      var script = '(function(){try{$.evalFile(new File(' +
        JSON.stringify(scriptPath) +
        '));if(typeof XinyangEmbedLowerV2202==="undefined"||!XinyangEmbedLowerV2202.invoke){throw new Error("独立嵌入下方图层入口未加载");}return XinyangEmbedLowerV2202.invoke("{}");' +
        '}catch(e){return "__XY_EMBED_LOWER_ERROR__"+String(e&&e.message?e.message:e)+(e&&e.line?"（脚本第 "+e.line+" 行）":"");}})()';

      var runner = window.XinyangRuntime && window.XinyangRuntime.evalScriptRaw
        ? function (callback) {
            window.XinyangRuntime.evalScriptRaw(script, {
              label: "独立嵌入下方图层 V2202",
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
            throw new Error("Photoshop 独立嵌入下方图层脚本执行失败");
          }
          if (raw.indexOf("__XY_EMBED_LOWER_ERROR__") === 0) {
            throw new Error(raw.slice("__XY_EMBED_LOWER_ERROR__".length));
          }
          var result = JSON.parse(raw);
          if (!result.ok) throw new Error(result.error || "Photoshop 嵌入下方图层失败");
          resolve(result.data || {});
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function runStandaloneEmbedLowerVisual() {
    if (busy) return Promise.reject(new Error("已有工具正在执行"));
    setBusy(true, "正在读取当前图层视觉下方内容并建立剪切蒙版…");
    return invokeStandaloneEmbedLowerVisual().then(function (result) {
      status("嵌入下方图层完成：已按‘" + (result.sourceName || "当前图层") + "’的透明区域复制视觉下层内容，并建立剪切蒙版");
      return result;
    }).catch(function (error) {
      status("操作失败：" + errorText(error));
      throw error;
    }).then(function (result) {
      setBusy(false);
      return result;
    }, function (error) {
      setBusy(false);
      return Promise.reject(error);
    });
  }

  function runEmbed(multiple) {
    if (!multiple) {
      if (config.embedLowerVisual) {
        runStandaloneEmbedLowerVisual().catch(function () {});
        return;
      }
      runHost("toolsEmbedSelectedLayerClipped", {}, "正在将当前图层嵌入下方图层…", function (result) {
        var baseNote = Number(result.skippedClippedLayers || 0) > 0 ? "（已越过上方剪切层，按最底部显示底图适配）" : "";
        return "嵌入完成：‘" + (result.sourceName || "当前图层") + "’已等比覆盖‘" + (result.targetName || "下方图层") + "’" + baseNote + "并建立剪切蒙版";
      }).catch(function () {});
      return;
    }
    runHost("toolsEmbedSelectedLayersToGroup", {}, "正在把所选图片逐一嵌入目标图层组…", function (result) {
      return "嵌入多图完成：" + result.processed + " 张图片已分别覆盖目标图层并建立剪切蒙版";
    }).catch(function () {});
  }

  function dispatchPhotoshopEvent(type, data) {
    var extensionId = cs.getExtensionID ? cs.getExtensionID() : "";
    var event = new CSEvent(type, "APPLICATION", "PHXS", extensionId);
    event.data = String(data === undefined || data === null ? "" : data);
    cs.dispatchEvent(event);
    return true;
  }
  function unregisterPhotoshopEvent(eventId) { return dispatchPhotoshopEvent("com.adobe.PhotoshopUnRegisterEvent", eventId); }
  function registerPhotoshopEvent(eventId) { return dispatchPhotoshopEvent("com.adobe.PhotoshopRegisterEvent", eventId); }

  function parsePhotoshopCallback(rawEvent) {
    try {
      var raw = String(rawEvent && rawEvent.data || "").replace(/^ver1,/, "");
      return JSON.parse(raw);
    } catch (ignore) { return null; }
  }

  function runAutoEmbedAfterEvent(trigger) {
    /*
     * Photoshop 置入/粘贴一次可能连续发出多条通知。旧版每条通知都启动
     * 四轮探测，容易向宿主脚本队列堆入大量重复任务。这里改为单飞：
     * 当前探测未完成时只记录最新触发，完成后再补一轮，不并发执行。
     */
    pendingAutoEmbedTrigger = trigger === "paste" ? "paste" : "place";
    if (autoEmbedInFlight) return;

    autoEmbedInFlight = true;
    var currentTrigger = pendingAutoEmbedTrigger;
    pendingAutoEmbedTrigger = "";
    var serial = ++autoEmbedAttemptSerial;
    var delays = [80, 220, 520, 1000];

    function finish() {
      if (serial !== autoEmbedAttemptSerial) return;
      autoEmbedInFlight = false;
      if (pendingAutoEmbedTrigger) {
        window.setTimeout(function () {
          if (!autoEmbedInFlight && pendingAutoEmbedTrigger) {
            runAutoEmbedAfterEvent(pendingAutoEmbedTrigger);
          }
        }, 60);
      }
    }

    function attempt(index) {
      if (serial !== autoEmbedAttemptSerial) return;
      window.setTimeout(function () {
        if (serial !== autoEmbedAttemptSerial) return;
        hostInvoke("toolsAutoEmbedActiveLayer", {
          trigger: currentTrigger
        }).then(function (result) {
          if (result && result.processed) {
            status((currentTrigger === "paste" ? "粘贴" : "插入") +
              "图片已自动嵌入“" + (result.targetName || "下方图层") + "”");
            finish();
            return;
          }
          if (index + 1 < delays.length) attempt(index + 1);
          else finish();
        }).catch(function () {
          if (index + 1 < delays.length) attempt(index + 1);
          else finish();
        });
      }, delays[index]);
    }

    attempt(0);
  }

  function findDeepValue(value, key) {
    if (!value || typeof value !== "object") return undefined;
    if (value[key] !== undefined) return value[key];
    var names = Object.keys(value);
    for (var i = 0; i < names.length; i += 1) {
      var found = findDeepValue(value[names[i]], key);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function normalizeColorSetProperty(value) {
    var text = String(value === undefined || value === null ? "" : value);
    if (/foregroundColor/i.test(text)) return "foregroundColor";
    if (/backgroundColor/i.test(text)) return "backgroundColor";
    return "";
  }

  function findColorSetProperty(eventData) {
    var direct = normalizeColorSetProperty(findDeepValue(eventData, "_property"));
    if (direct) return direct;
    direct = normalizeColorSetProperty(findDeepValue(eventData, "property"));
    if (direct) return direct;
    return "";
  }

  function clearAutoFillQueue() {
    if (autoFillTimer) window.clearTimeout(autoFillTimer);
    autoFillTimer = 0;
    pendingAutoFillColorSet = "";
  }

  function scheduleAutoFill(colorSet, delay) {
    if (!config.autoFillColor) return;
    colorSet = normalizeColorSetProperty(colorSet);
    if (!colorSet) return;
    pendingAutoFillColorSet = colorSet;
    if (autoFillTimer) window.clearTimeout(autoFillTimer);
    autoFillTimer = window.setTimeout(function runQueuedAutoFill() {
      autoFillTimer = 0;
      if (!config.autoFillColor || !pendingAutoFillColorSet) return;
      var now = Date.now ? Date.now() : new Date().getTime();
      if (autoFillInFlight || now < autoFillSuppressUntil) {
        scheduleAutoFill(pendingAutoFillColorSet, Math.max(80, autoFillSuppressUntil - now + 40));
        return;
      }
      var requestedColorSet = pendingAutoFillColorSet;
      pendingAutoFillColorSet = "";
      autoFillInFlight = true;
      autoFillSuppressUntil = now + AUTO_FILL_SUPPRESS_MS;
      /* 批量写入期间临时注销 setd，进一步阻止 Photoshop 生成回调洪峰。 */
      unregisterPhotoshopEvent(AUTO_FILL_COLOR_EVENT);
      hostInvoke("autoColor", {
        text: !!config.autoFillText,
        shape: !!config.autoFillShape,
        normal: !!config.autoFillNormal,
        colorSet: requestedColorSet
      }).then(function (result) {
        if (result && result.processed) status("自动填充颜色：已处理 " + result.processed + " 个图层");
      }).catch(function (error) {
        status("自动填充颜色失败：" + errorText(error));
      }).then(function () {
        autoFillInFlight = false;
        autoFillSuppressUntil = (Date.now ? Date.now() : new Date().getTime()) + AUTO_FILL_SUPPRESS_MS;
        if (config.autoFillColor) registerPhotoshopEvent(AUTO_FILL_COLOR_EVENT);
        if (pendingAutoFillColorSet && config.autoFillColor) {
          scheduleAutoFill(pendingAutoFillColorSet, AUTO_FILL_SUPPRESS_MS + 60);
        }
      });
    }, Number(delay) >= 0 ? Number(delay) : AUTO_FILL_DEBOUNCE_MS);
  }

  function handlePhotoshopEvent(event) {
    var payload = parsePhotoshopCallback(event);
    if (!payload) return;
    var rawEventId = payload.eventID !== undefined ? payload.eventID : payload.eventId;
    var eventId = String(rawEventId === undefined ? "" : rawEventId);
    var now = Date.now ? Date.now() : new Date().getTime();

    if (eventId === AUTO_FILL_COLOR_EVENT && config.autoFillColor) {
      /*
       * setd 是 Photoshop 的通用“设置”事件。旧逻辑把所有 setd 都当作
       * 前景色变化，而填充图层本身也会再次触发 setd，形成递归事件风暴。
       * 这里只接受明确的前景色/背景色属性，并通过单飞、抑制窗口和合并
       * 队列保证一次改色最多执行一轮批量填充。
       */
      var eventData = payload.eventData || payload;
      var colorSet = findColorSetProperty(eventData);
      if (!colorSet || autoFillInFlight || now < autoFillSuppressUntil) return;
      if (lastEventAt.color && now - lastEventAt.color < 80) return;
      lastEventAt.color = now;
      scheduleAutoFill(colorSet, AUTO_FILL_DEBOUNCE_MS);
      return;
    }

    var trigger = "";
    if (eventId === AUTO_EMBED_PLACE_EVENT && config.autoEmbedPlace) trigger = "place";
    if (eventId === AUTO_EMBED_PASTE_EVENT && config.autoEmbedPaste) trigger = "paste";
    if (!trigger) return;
    if (lastEventAt[trigger] && now - lastEventAt[trigger] < 180) return;
    lastEventAt[trigger] = now;
    runAutoEmbedAfterEvent(trigger);
  }

  function ensurePhotoshopCallback() {
    if (photoshopCallbackInstalled) return true;
    var extensionId = cs.getExtensionID ? cs.getExtensionID() : "";
    if (!extensionId || !cs.addEventListener) return false;
    photoshopCallbackName = "com.adobe.PhotoshopJSONCallback" + extensionId;
    try {
      cs.addEventListener(photoshopCallbackName, handlePhotoshopEvent);
      photoshopCallbackInstalled = true;
    } catch (ignoreCallbackInstall) {
      photoshopCallbackInstalled = false;
    }
    return photoshopCallbackInstalled;
  }

  function syncPhotoshopNotifiers(showMessage, subject) {
    /*
     * Photoshop 的原生 notifier 在面板隐藏、CEP JSON 回调丢失时仍会运行。
     * 这里必须传入实际开关状态；旧代码固定传 false，会在每次初始化或
     * 切换选项时把刚注册的原生监听器又注销掉，导致只能手动点击嵌入。
     */
    var notifierSync = hostInvoke("toolsConfigureAutoEmbed", {
      place: !!config.autoEmbedPlace,
      paste: !!config.autoEmbedPaste,
      extensionPath: extensionRootPath()
    });
    if (!ensurePhotoshopCallback()) {
      var unsupported = new Error("当前 CEP 环境不支持 Photoshop 事件监听");
      if (showMessage) status("监听配置失败：" + unsupported.message);
      return Promise.reject(unsupported);
    }
    unregisterPhotoshopEvent(AUTO_EMBED_PLACE_EVENT);
    unregisterPhotoshopEvent(AUTO_EMBED_PASTE_EVENT);
    unregisterPhotoshopEvent(AUTO_FILL_COLOR_EVENT);
    var ok = true;
    if (config.autoEmbedPlace) ok = registerPhotoshopEvent(AUTO_EMBED_PLACE_EVENT) && ok;
    if (config.autoEmbedPaste) ok = registerPhotoshopEvent(AUTO_EMBED_PASTE_EVENT) && ok;
    if (config.autoFillColor) ok = registerPhotoshopEvent(AUTO_FILL_COLOR_EVENT) && ok;
    if (!ok) {
      var dispatchError = new Error("Photoshop 未接受事件注册请求");
      if (showMessage) status("监听配置失败：" + dispatchError.message);
      return Promise.reject(dispatchError);
    }
    if (showMessage) {
      if (subject === "autoFill") status(config.autoFillColor ? "自动填充颜色已开启" : "自动填充颜色已关闭");
      else {
        var enabled = [];
        if (config.autoEmbedPlace) enabled.push("插入图片");
        if (config.autoEmbedPaste) enabled.push("粘贴图片");
        status(enabled.length ? enabled.join("、") + "自动嵌入已开启" : "自动嵌入监听已关闭");
      }
    }
    return notifierSync.catch(function () {
      /* CEP 回调仍保留为兼容旧版 Photoshop 的后备监听通道。 */
      return { registered: 0, fallback: "cep" };
    }).then(function (notifier) {
      return {
      place: !!config.autoEmbedPlace,
      paste: !!config.autoEmbedPaste,
      autoFill: !!config.autoFillColor,
      notifier: notifier || {}
      };
    });
  }

  var activeDetailItem = null;
  var activeDetailName = "";
  var resizeTimer = null;

  function directToolItems(grid) {
    if (!grid) return [];
    return Array.prototype.slice.call(grid.children).filter(function (node) {
      return node.classList && node.classList.contains("common-tool-item");
    });
  }

  function resolveDetailItem(detail, sourceNode) {
    var item = sourceNode && sourceNode.closest ? sourceNode.closest(".common-tool-item") : null;
    if (item) return item;
    var selectorMap = {
      "embed-image": '[data-common-action="embed-one"]',
      "import-images": '[data-common-action="import-images"]',
      "auto-fill": '[data-common-action="auto-fill"]',
      "file-slim": '[data-common-action="file-slim"]',
      "batch-export": '[data-common-action="export-image"]',
      "quick-transform": '[data-common-action="custom-transform"]',
      "distribute": '[data-common-action="distribute"]',
      "rectangle-set": '[data-common-action="rectangle"]',
      "find-same": '[data-common-action="find-same"]'
    };
    var target = one(selectorMap[detail] || ('[data-common-more="' + detail + '"]'));
    return target && target.closest ? target.closest(".common-tool-item") : null;
  }

  function positionDrawerBelowRow(anchorItem) {
    var drawer = one("#common-tools-parameter-drawer");
    var grid = one(".common-tools-grid");
    if (!drawer || !grid || !anchorItem || anchorItem.parentNode !== grid) return;
    var items = directToolItems(grid);
    var index = items.indexOf(anchorItem);
    if (index < 0) return;
    var rowTop = Number(anchorItem.offsetTop || 0);
    var rowEndItem = anchorItem;
    var rowIndex = 0;
    var seenRows = [];
    items.forEach(function (item) {
      var top = Number(item.offsetTop || 0);
      var known = -1;
      for (var i = 0; i < seenRows.length; i += 1) {
        if (Math.abs(seenRows[i] - top) <= 2) { known = i; break; }
      }
      if (known < 0) { seenRows.push(top); known = seenRows.length - 1; }
      if (Math.abs(top - rowTop) <= 2) rowEndItem = item;
      if (item === anchorItem) rowIndex = known;
    });
    grid.insertBefore(drawer, rowEndItem.nextSibling);
    drawer.setAttribute("data-anchor-index", String(index));
    drawer.setAttribute("data-anchor-row", String(rowIndex));
  }

  function closeDetail() {
    var drawer = one("#common-tools-parameter-drawer");
    if (!drawer) return;
    drawer.classList.add("drawer-collapsed");
    all("#common-tools-parameter-drawer .tool-detail").forEach(function (view) { view.classList.remove("active"); });
    all(".common-tool-item").forEach(function (node) { node.classList.remove("detail-row-active"); });
    activeDetailItem = null;
    activeDetailName = "";
    status("已收起参数设置");
  }

  function openDetail(detail, sourceNode) {
    var drawer = one("#common-tools-parameter-drawer");
    if (!drawer) return;
    if (!drawer.classList.contains("drawer-collapsed") && activeDetailName === detail) {
      closeDetail();
      return;
    }
    var item = resolveDetailItem(detail, sourceNode);
    if (item) {
      activeDetailItem = item;
      positionDrawerBelowRow(item);
    }
    drawer.classList.remove("drawer-collapsed");
    activeDetailName = detail;
    all(".common-tool-item").forEach(function (node) { node.classList.toggle("detail-row-active", node === activeDetailItem); });
    all("#common-tools-parameter-drawer .tool-detail").forEach(function (view) {
      view.classList.toggle("active", view.getAttribute("data-tool-detail-view") === detail);
    });
    if (item && item.scrollIntoView) item.scrollIntoView({ block: "nearest" });
    status("已在当前工具行下方展开参数设置");
  }

  function repositionActiveDrawer() {
    if (!activeDetailItem) return;
    var drawer = one("#common-tools-parameter-drawer");
    if (!drawer || drawer.classList.contains("drawer-collapsed")) return;
    positionDrawerBelowRow(activeDetailItem);
  }

  function switchMainPanel(panel) {
    var button = one('.nav-button[data-panel="' + panel + '"]');
    if (button) button.click();
  }

  function runScale(percent) {
    percent = Number(percent);
    if (!(percent > 0 && percent <= 1000)) { status("请输入 1—1000 之间的缩放比例"); return; }
    runHost("toolsScaleLayers", { percent: percent }, "正在缩放选中图层…", function (result) {
      return "缩放完成：" + result.processed + " 个图层，比例 " + percent + "%";
    }).catch(function () {});
  }

  function parseZoomInput(raw, direction) {
    var text = String(raw === undefined || raw === null ? "" : raw)
      .replace(/^\s+|\s+$/g, "")
      .replace(/％/g, "%");
    var value;
    if (!text) return direction === "down" ? 90 : 110;
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*%$/.test(text)) {
      value = Number(text.replace(/\s*%$/, ""));
    } else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*\/\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
      var pieces = text.split("/");
      var denominator = Number(pieces[1]);
      if (!denominator) throw new Error("分母不能为 0");
      value = Number(pieces[0]) / denominator * 100;
    } else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
      value = Number(text);
      if (Math.abs(value) > 0 && Math.abs(value) < 1) value *= 100;
    } else {
      throw new Error("请输入百分比、分数、小数或数值");
    }
    value = Math.round(value * 10000) / 10000;
    if (direction === "up") {
      if (!(value > 100 && value <= 1000)) throw new Error("放大比例需大于 100 且不超过 1000");
    } else if (!(value > 0 && value < 100)) {
      throw new Error("缩小比例需大于 0 且小于 100");
    }
    return value;
  }

  function zoomInputFor(direction) {
    return one(direction === "down" ? "#common-scale-down-custom" : "#common-scale-up-custom");
  }

  function closeZoomExtras(exceptDirection) {
    all("[data-zoom-extra]").forEach(function (panel) {
      var direction = panel.getAttribute("data-zoom-extra");
      if (exceptDirection && direction === exceptDirection) return;
      panel.hidden = true;
      var trigger = one('[data-zoom-drop="' + direction + '"]');
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function toggleZoomExtra(direction) {
    var panel = one('[data-zoom-extra="' + direction + '"]');
    var trigger = one('[data-zoom-drop="' + direction + '"]');
    if (!panel) return;
    var open = panel.hidden;
    closeZoomExtras(direction);
    panel.hidden = !open;
    if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function runZoomInput(direction) {
    var input = zoomInputFor(direction);
    try {
      var percent = parseZoomInput(input ? input.value : "", direction);
      if (input) input.value = String(percent);
      runScale(percent);
    } catch (error) {
      status("缩放输入有误：" + errorText(error));
      if (input) input.focus();
    }
  }

  function runAlign(action) {
    runHost("toolsAlignLayers", { action: action }, "正在对齐选中图层…", function (result) {
      return "对齐完成：处理 " + result.processed + " 个图层";
    }).catch(function () {});
  }

  function runCanvasCenter(axis) {
    var label = axis === "vertical" ? "基于画布垂直居中" : "基于画布水平居中";
    runHost("toolsCenterLayersOnCanvas", { axis: axis }, "正在" + label + "…", function (result) {
      return label + "完成：移动 " + result.processed + " 个图层";
    }).catch(function () {});
  }

  function runEvenDistribute(axis) {
    var label = axis === "vertical" ? "垂直分布" : "水平分布";
    runHost("toolsDistributeLayersEvenly", { axis: axis }, "正在执行多选元素" + label + "…", function (result) {
      var gap = Math.round(Number(result.gap || 0) * 100) / 100;
      return label + "完成：处理 " + result.processed + " 个图层，间隔 " + gap + "px";
    }).catch(function () {});
  }

  function runFlip(action) {
    var names = {
      flipHorizontalCenter: "左右中心翻转", flipVerticalCenter: "上下中心翻转",
      flipLeftEdge: "左边缘翻转", flipRightEdge: "右边缘翻转",
      flipBottomEdge: "下边缘翻转", flipTopEdge: "上边缘翻转"
    };
    runHost("toolsQuickTransform", { action: action }, "正在执行" + (names[action] || "翻转") + "…", function (result) {
      return (names[action] || "翻转") + "完成：处理 " + result.processed + " 个图层" + (result.collective ? "（按多选整体中心翻转）" : "");
    }).catch(function () {});
  }

  function runImportImages() {
    var files = pickImages(true);
    if (!files.length) { status("已取消导入多图片"); return; }
    runHost("importMoreImages", {
      files: files,
      isLinkObject: !!config.importImagesIsLinkObject,
      mode: "smart",
      layout: "overlay",
      fit: "original",
      gap: 0
    }, "正在导入多图片…", function (result) {
      return "导入完成：" + result.imported + " 张图片" + (result.isLinkObject ? "（链接智能对象）" : "（嵌入智能对象）");
    }).catch(function () {});
  }

  function updateAutoFillCard() {
    var button = one('[data-common-action="auto-fill"]');
    var item = button && button.closest ? button.closest(".common-tool-item") : null;
    if (item) item.classList.toggle("auto-fill-active", !!config.autoFillColor);
  }

  function updateSmartSnapCard() {
    var button = one('[data-common-action="smart-snap"]');
    var item = button && button.closest ? button.closest(".common-tool-item") : null;
    if (button) button.setAttribute("aria-pressed", config.smartSnapEnabled ? "true" : "false");
    if (item) item.classList.toggle("smart-snap-active", !!config.smartSnapEnabled);
  }

  function invokeSmartSnapStandalone(payload) {
    var root = extensionRootPath().replace(/\\/g, "/").replace(/\/+$/, "");
    var path = root ? root + "/jsx/smart-snap-v2241.jsx" : "";
    if (!path) return Promise.reject(new Error("无法定位磁吸模式宿主脚本"));
    var serialized = "distance=" + Number(payload.distance || 20) + "&layerEdges=" + (payload.layerEdges ? "1" : "0") + "&centers=" + (payload.centers ? "1" : "0") + "&equalSpacing=" + (payload.equalSpacing ? "1" : "0") + "&canvasEdges=" + (payload.canvasEdges ? "1" : "0") + "&guides=" + (payload.guides ? "1" : "0");
    var script = '(function(){try{$.evalFile(new File(' + JSON.stringify(path) + '));' +
      'if(typeof XinyangSmartSnapV2241==="undefined"||!XinyangSmartSnapV2241.invoke){throw new Error("磁吸脚本未加载");}' +
      'return XinyangSmartSnapV2241.invoke(' + JSON.stringify(serialized) + ');}catch(e){return "__SMART_SNAP_HOST_ERROR__"+String(e&&e.message?e.message:e);}})()';
    if (window.XinyangRuntime && window.XinyangRuntime.evalScriptRaw) {
      return window.XinyangRuntime.evalScriptRaw(script, { label: "加载磁吸模式宿主脚本" }).then(function (raw) {
        raw = String(raw || "");
        if (raw.indexOf("__SMART_SNAP_HOST_ERROR__") === 0 || raw.indexOf("__XY_SMART_ERROR__") === 0) throw new Error(raw.replace(/^__SMART_SNAP_HOST_ERROR__|^__XY_SMART_ERROR__/, ""));
        if (raw.indexOf("__XY_SMART_OK__") !== 0) throw new Error("磁吸脚本返回异常：" + raw);
        var parts = raw.slice(15).split("|"); return { processed: Number(parts[0]) || 0, xTarget: parts[1] || "未命中水平目标", yTarget: parts[2] || "未命中垂直目标" };
      });
    }
    return new Promise(function (resolve, reject) {
      cs.evalScript(script, function (raw) {
        raw = String(raw || "");
        if (raw.indexOf("__SMART_SNAP_HOST_ERROR__") === 0) reject(new Error(raw.slice(25)));
        else if (raw.indexOf("__XY_SMART_OK__") === 0) { var parts = raw.slice(15).split("|"); resolve({ processed: Number(parts[0]) || 0, xTarget: parts[1] || "未命中水平目标", yTarget: parts[2] || "未命中垂直目标" }); }
        else reject(new Error("磁吸脚本返回异常：" + raw));
      });
    });
  }

  function runSmartSnap() {
    if (!config.smartSnapEnabled) {
      config.smartSnapEnabled = true;
      saveConfig(); updateSmartSnapCard();
      status("磁吸模式已开启；移动图层后再次点击此按钮即可执行吸附");
      return;
    }
    status("正在计算最近磁吸目标…");
    invokeSmartSnapStandalone({ distance: config.smartSnapDistance, layerEdges: config.smartSnapLayerEdges, centers: config.smartSnapCenters, equalSpacing: config.smartSnapEqualSpacing, canvasEdges: config.smartSnapCanvasEdges, guides: config.smartSnapGuides }).then(function (result) {
      status("磁吸完成：" + result.processed + " 个图层，" + (result.xTarget || "未命中水平目标") + "，" + (result.yTarget || "未命中垂直目标"));
    }).catch(function (error) { status("磁吸模式加载失败：" + errorText(error)); });
  }

  function toggleAutoFill(sourceNode) {
    if (!config.autoFillText && !config.autoFillShape && !config.autoFillNormal) {
      config.autoFillColor = false;
      clearAutoFillQueue();
      saveConfig();
      updateAutoFillCard();
      openDetail("auto-fill", sourceNode);
      status("请至少勾选一种自动填充的图层类型");
      return;
    }
    config.autoFillColor = !config.autoFillColor;
    if (!config.autoFillColor) {
      clearAutoFillQueue();
      autoFillInFlight = false;
      autoFillSuppressUntil = 0;
    }
    saveConfig();
    updateAutoFillCard();
    syncPhotoshopNotifiers(true, "autoFill").catch(function () {});
  }

  function runFixBlur() {
    runHost("toolsSnapShapeAnchors", { threshold: 0.51, collinearTolerance: 0.08 }, "正在吸附形状锚点到像素网格…", function (result) {
      return "修正模糊完成：处理 " + result.processed + " 个形状，移动 " + result.movedAnchors + " 个锚点，跳过 " + result.skipped + " 个";
    }).catch(function () {});
  }

  function runSwapFillStroke() {
    runHost("switchColor", {}, "正在互换填充与线框…", function (result) {
      return "填充线框互换完成：处理 " + result.processed + " 个，跳过 " + result.skipped + " 个";
    }).catch(function () {});
  }

  function runDistributeDirection(direction) {
    var gap = numberValue("#tuniu-distribute-gap", 0);
    var order = Number(selectedRadio("tuniu-distribute-order", "0")) || 0;
    var axis = direction === "vertical" ? "vertical" : "horizontal";
    config.distributeAxis = axis;
    config.distributeGap = gap;
    config.distributeOrder = order;
    saveConfig();
    runHost("spreadElement", {
      axis: axis,
      direction: axis === "vertical" ? 1 : 0,
      gap: gap,
      space: gap,
      order: order
    }, "正在按间距分布…", function (result) {
      return (axis === "vertical" ? "垂直" : "水平") + "分布完成：" + result.processed + " 个图层，间距 " + gap + "px";
    }).catch(function () {});
  }

  function runReplace() {
    if (!window.confirm("将当前活动图层/组作为源，替换其余已选目标，并保留目标位置、名称和层级。继续吗？")) return;
    runHost("toolsReplaceElements", { matchBounds: true }, "正在替换选中的元素或图层组…", function (result) {
      return "元素替换完成：替换 " + result.replaced + " 个目标";
    }).catch(function () {});
  }

  function runFindSame(sourceNode) { openDetail("find-same", sourceNode); }
  function runFindSameType(type) {
    var labels = {
      textColor: "文字颜色相同", textContent: "文字内容相同", shapeSize: "形状大小相同",
      shapeFill: "填充颜色相同", shapeStroke: "边框颜色相同"
    };
    var label = labels[type];
    if (!label) { status("未知的查找相同类型"); return; }
    runHost("toolsFindSimilarLayers", { quickType: type, action: "select", tolerance: type === "shapeSize" ? 0.5 : 0 }, "正在查找" + label + "的图层…", function (result) {
      return "查找完成：已选中 " + result.matched + " 个" + label + "的图层";
    }).catch(function () {});
  }

  function runSwapPosition() {
    runHost("toolsQuickTransform", { action: "swapPosition" }, "正在互换两个图层的位置与层级…", function (result) {
      return "位置互换完成：坐标与图层顺序已交换" + (result.clippingPreserved ? "，剪切状态已恢复" : "");
    }).catch(function () {});
  }

  function runSwapColors() {
    runHost("toolsSwapLayerColors", {}, "正在互换两个图层的主颜色…", function (result) {
      return "图层颜色互换完成：" + result.firstColor + " ↔ " + result.secondColor;
    }).catch(function () {});
  }

  function runRectangleSettings() {
    var width = textValue("#tuniu-rect-width");
    var height = textValue("#tuniu-rect-height");
    if (!width && !height) { status("矩形宽度和高度至少填写一项"); return; }
    if ((width && !(Number(width) > 0)) || (height && !(Number(height) > 0))) { status("矩形宽度和高度必须大于 0"); return; }
    runHost("setShape", {
      applySize: true,
      width: width,
      height: height
    }, "正在批量设置矩形尺寸…", function (result) {
      return "矩形批量设置完成：处理 " + result.processed + " 个，跳过 " + result.skipped + " 个";
    }).catch(function () {});
  }

  function resetCustomTransform() {
    ["#tuniu-transform-count", "#tuniu-transform-scale", "#tuniu-transform-col-space", "#tuniu-transform-row-space", "#tuniu-transform-angle", "#tuniu-transform-opacity"].forEach(function (selector) {
      var node = one(selector); if (node) node.value = "";
    });
    config.customTransformPoint = 1;
    all("[data-transform-anchor]").forEach(function (node) {
      node.classList.toggle("active", Number(node.getAttribute("data-transform-anchor")) === 1);
    });
    saveConfig();
    status("自定义变换参数已重置");
  }

  function runCustomTransform() {
    var count = Math.max(0, Math.floor(numberValue("#tuniu-transform-count", 0)));
    if (!count) { status("请输入大于 0 的复制数量"); return; }
    var scaleText = textValue("#tuniu-transform-scale");
    runHost("customTransform", {
      repetNumber: count,
      scale: scaleText ? numberValue("#tuniu-transform-scale", 100) : 100,
      colSpace: textValue("#tuniu-transform-col-space") || "0px",
      rowSpace: textValue("#tuniu-transform-row-space") || "0px",
      angle: textValue("#tuniu-transform-angle") || 0,
      transparent: textValue("#tuniu-transform-opacity") || 0,
      point: config.customTransformPoint
    }, "正在生成自定义变换…", function (result) {
      return "自定义变换完成：生成 " + result.created + " 个副本";
    }).catch(function () {});
  }

  function exportPayload(extra) {
    var payload = {
      format: config.exportFormat,
      ext: config.exportFormat,
      quality: config.exportQuality,
      pngMode: config.exportPngMode,
      png24: config.exportPngMode !== "8",
      isPng24: config.exportPngMode !== "8",
      path: config.exportPath,
      folder: config.exportPath,
      pathType: config.exportPathType,
      fileName: config.exportFileName,
      layerName: !!config.exportLayerName,
      autoNumber: !!config.exportAutoNumber,
      saveType: Number(config.exportSaveType) || 0,
      width: config.exportWidth,
      height: config.exportHeight,
      compress_width: config.exportWidth,
      compress_height: config.exportHeight,
      watermark: config.exportWatermark,
      originImage: !!config.exportOriginImage,
      exportOriginImage: !!config.exportOriginImage,
      autoOpenFolder: !!config.exportOpenFolder,
      openFolder: !!config.exportOpenFolder
    };
    if (extra) Object.keys(extra).forEach(function (key) { payload[key] = extra[key]; });
    return payload;
  }

  function syncExportConfigFromUi() {
    config.exportQuality = Math.max(1, Math.min(100, numberValue("#tuniu-export-quality", 100)));
    config.exportPngMode = textValue("#tuniu-export-png-mode") || "24";
    config.exportPath = textValue("#tuniu-export-path");
    config.exportPathType = selectedRadio("tuniu-export-path-type", config.exportPathType || "desktop");
    config.exportFileName = textValue("#tuniu-export-file-name");
    config.exportLayerName = checked("#tuniu-export-layer-name");
    config.exportAutoNumber = checked("#tuniu-export-auto-number");
    config.exportSaveType = Number(selectedRadio("tuniu-export-save-type", "0")) || 0;
    config.exportWidth = textValue("#tuniu-export-width");
    config.exportHeight = textValue("#tuniu-export-height");
    config.exportWatermark = textValue("#tuniu-export-watermark");
    config.exportOriginImage = checked("#tuniu-export-origin");
    config.exportOpenFolder = checked("#tuniu-export-open-folder");
    saveConfig();
  }

  function updateExportFormatUi() {
    all("[data-export-format]").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-export-format") === config.exportFormat);
    });
    var quality = one(".quality-field");
    var pngMode = one(".png-mode-field");
    if (quality) quality.hidden = config.exportFormat !== "jpg";
    if (pngMode) pngMode.hidden = config.exportFormat !== "png";
  }

  function runExportImage() {
    syncExportConfigFromUi();
    runHost("exportImage", exportPayload(), "正在导出图片…", function (result) {
      return "导出完成：" + result.exported + " 张，目录 " + (result.folder || "已选择位置");
    }).catch(function () {});
  }

  function runBatchExport(level) {
    syncExportConfigFromUi();
    var method = level === "secondLevel" ? "BatchExportSecondLevelLayer" : "batchExportLayer";
    runHost(method, exportPayload({ target: level }), "正在批量导出图片…", function (result) {
      return "批量导出完成：" + result.exported + " 张";
    }).catch(function () {});
  }

  function runExportPsdFolder() {
    syncExportConfigFromUi();
    var folder = pickFolder("选择包含 PSD/PSB 的文件夹");
    if (!folder) { status("已取消批量导出 PSD 文件夹"); return; }
    runHost("bacthExportPsd", exportPayload({ sourceFolder: folder }), "正在批量导出文件夹内 PSD…", function (result) {
      return "PSD 文件夹导出完成：处理 " + result.documents + " 个文档，导出 " + result.exported + " 张";
    }).catch(function () {});
  }

  function openExportFolder() {
    syncExportConfigFromUi();
    runHost("toolsOpenExportFolder", exportPayload(), "正在打开所在目录…", "已打开所在目录").catch(function () {});
  }

  function pinyinLine(value) {
    var source = String(value || "");
    var map = window.XINYANG_PINYIN_MAP || {};
    var tokens = [];
    var latin = "";
    var hasChinese = false;
    var i;
    function flushLatin() {
      if (!latin) return;
      tokens.push(latin);
      latin = "";
    }
    for (i = 0; i < source.length; i += 1) {
      var ch = source.charAt(i);
      if (map[ch]) {
        flushLatin();
        tokens.push(String(map[ch]).toLowerCase());
        hasChinese = true;
      } else if (/[A-Za-z0-9]/.test(ch)) {
        latin += ch;
      } else if (/\s/.test(ch)) {
        flushLatin();
      } else {
        flushLatin();
        tokens.push(ch);
      }
    }
    flushLatin();
    return hasChinese ? tokens.join(" ") : source;
  }

  function convertTextToPinyin(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(pinyinLine)
      .join("\r");
  }

  function executePinyinConversion() {
    return hostInvoke("getText", {}).then(function (result) {
      var source = result && result.texts instanceof Array ? result.texts : [];
      if (!source.length) throw new Error("请先选择文字图层");
      var total = source.reduce(function (sum, item) {
        return sum + String(item.text || "").length;
      }, 0);
      if (total > 1000) throw new Error("选中文字总计超过 1000 字，请分批转换");
      var converted = source.map(function (item) {
        return { id: item.id, text: convertTextToPinyin(item.text) };
      });
      return hostInvoke("pinyin", { texts: converted });
    });
  }

  function runPinyin() {
    if (busy) return;
    setBusy(true, "正在读取拼音字典并转换文字…");
    var ensure = window.XinyangRuntime && window.XinyangRuntime.ensurePinyinMap
      ? window.XinyangRuntime.ensurePinyinMap()
      : Promise.resolve(true);
    ensure.then(executePinyinConversion).then(function (result) {
      status("汉字转拼音完成：已转换 " + result.converted + " 个文字图层");
    }).catch(function (error) {
      status("汉字转拼音失败：" + errorText(error));
    }).then(function () {
      setBusy(false);
    });
  }

  function runAction(action, sourceNode) {
    if (busy) return;
    if (action === "embed-one") runEmbed(false);
    else if (action === "embed-many") runEmbed(true);
    else if (action === "import-images") runImportImages();
    else if (action === "auto-fill") toggleAutoFill(sourceNode);
    else if (action === "fix-blur") runFixBlur();
    else if (action === "swap-fill-stroke") runSwapFillStroke();
    else if (action === "file-slim") { var node = one("#tool-slim-run"); if (node) node.click(); }
    else if (action === "custom-transform") openDetail("quick-transform", sourceNode);
    else if (action === "export-image") runExportImage();
    else if (action === "distribute") openDetail("distribute", sourceNode);
    else if (action === "replace-elements") runReplace();
    else if (action === "find-same") runFindSame(sourceNode);
    else if (action === "swap-position") runSwapPosition();
    else if (action === "swap-colors") runSwapColors();
    else if (action === "image-text") { switchMainPanel("text-panel"); status("请框选文字区域，或选中图片图层后开始识别"); }
    else if (action === "rectangle") openDetail("rectangle-set", sourceNode);
    else if (action === "pinyin") runPinyin();
    else if (action === "smart-snap") runSmartSnap();
  }

  function loadConfig() {
    try {
      var saved = JSON.parse(window.localStorage.getItem("xinyang.commonTools.v217") || window.localStorage.getItem("xinyang.commonTools.v210") || "{}");
      Object.keys(config).forEach(function (key) { if (saved[key] !== undefined) config[key] = saved[key]; });
      if (config.embedLowerVisual && (config.autoEmbedPlace || config.autoEmbedPaste)) {
        /* 自动嵌入优先：历史配置同时开启时按新的点击规则取消第三项。 */
        config.embedLowerVisual = false;
        window.localStorage.setItem("xinyang.commonTools.v217", JSON.stringify(config));
      }
    } catch (ignore) {}
  }
  function saveConfigNow() {
    if (configSaveTimer) window.clearTimeout(configSaveTimer);
    configSaveTimer = 0;
    if (!configDirty) return;
    configDirty = false;
    try { window.localStorage.setItem("xinyang.commonTools.v217", JSON.stringify(config)); } catch (ignore) {}
  }
  function saveConfig() {
    configDirty = true;
    if (configSaveTimer) window.clearTimeout(configSaveTimer);
    configSaveTimer = window.setTimeout(saveConfigNow, 140);
  }

  function setEmbedOptionDisabled(input, disabled) {
    if (!input) return;
    input.disabled = !!disabled;
    var label = input.parentNode;
    if (label && label.classList) label.classList.toggle("option-disabled", !!disabled);
    if (label && label.setAttribute) label.setAttribute("aria-disabled", disabled ? "true" : "false");
  }

  function normalizeEmbedOptions(preferLower) {
    config.embedLowerVisual = !!config.embedLowerVisual;
    if (!preferLower && (config.autoEmbedPlace || config.autoEmbedPaste)) {
      config.embedLowerVisual = false;
    } else if (preferLower && config.embedLowerVisual) {
      config.autoEmbedPlace = false;
      config.autoEmbedPaste = false;
    }
  }

  function updateEmbedOptionUi() {
    var autoPlace = one("#embed-auto-place");
    var autoPaste = one("#embed-auto-paste");
    var embedLowerVisual = one("#embed-lower-visual");
    var lowerActive = !!config.embedLowerVisual;
    if (autoPlace) autoPlace.checked = !!config.autoEmbedPlace;
    if (autoPaste) autoPaste.checked = !!config.autoEmbedPaste;
    if (embedLowerVisual) embedLowerVisual.checked = lowerActive;
    /* 自动嵌入始终可点；勾选时由 change 事件取消第三项。 */
    setEmbedOptionDisabled(autoPlace, false);
    setEmbedOptionDisabled(autoPaste, false);
  }

  function restoreControls() {
    var autoPlace = one("#embed-auto-place");
    var autoPaste = one("#embed-auto-paste");
    var embedLowerVisual = one("#embed-lower-visual");
    var importLinked = one("#tuniu-import-linked");
    var autoText = one("#tuniu-auto-fill-text");
    var autoShape = one("#tuniu-auto-fill-shape");
    var autoNormal = one("#tuniu-auto-fill-normal");
    normalizeEmbedOptions(false);
    updateEmbedOptionUi();
    if (importLinked) importLinked.checked = !!config.importImagesIsLinkObject;
    if (autoText) autoText.checked = !!config.autoFillText;
    if (autoShape) autoShape.checked = !!config.autoFillShape;
    if (autoNormal) autoNormal.checked = !!config.autoFillNormal;
    var gap = one("#tuniu-distribute-gap"); if (gap) gap.value = config.distributeGap;
    var order = one('input[name="tuniu-distribute-order"][value="' + config.distributeOrder + '"]'); if (order) order.checked = true;
    all("[data-transform-anchor]").forEach(function (node) { node.classList.toggle("active", Number(node.getAttribute("data-transform-anchor")) === Number(config.customTransformPoint)); });
    var exportQuality = one("#tuniu-export-quality"); if (exportQuality) exportQuality.value = config.exportQuality;
    var exportPngMode = one("#tuniu-export-png-mode"); if (exportPngMode) exportPngMode.value = config.exportPngMode;
    var exportPath = one("#tuniu-export-path"); if (exportPath) exportPath.value = config.exportPath;
    all('input[name="tuniu-export-path-type"]').forEach(function (node) { node.checked = false; });
    var pathType = one('input[name="tuniu-export-path-type"][value="' + config.exportPathType + '"]'); if (pathType) pathType.checked = true;
    var exportFileName = one("#tuniu-export-file-name"); if (exportFileName) exportFileName.value = config.exportFileName;
    var exportLayerName = one("#tuniu-export-layer-name"); if (exportLayerName) exportLayerName.checked = !!config.exportLayerName;
    var exportAutoNumber = one("#tuniu-export-auto-number"); if (exportAutoNumber) exportAutoNumber.checked = !!config.exportAutoNumber;
    var saveType = one('input[name="tuniu-export-save-type"][value="' + config.exportSaveType + '"]'); if (saveType) saveType.checked = true;
    var exportWidth = one("#tuniu-export-width"); if (exportWidth) exportWidth.value = config.exportWidth;
    var exportHeight = one("#tuniu-export-height"); if (exportHeight) exportHeight.value = config.exportHeight;
    var exportWatermark = one("#tuniu-export-watermark"); if (exportWatermark) exportWatermark.value = config.exportWatermark;
    var exportOrigin = one("#tuniu-export-origin"); if (exportOrigin) exportOrigin.checked = !!config.exportOriginImage;
    var exportOpen = one("#tuniu-export-open-folder"); if (exportOpen) exportOpen.checked = !!config.exportOpenFolder;
    var smartEnabled = one("#smart-snap-enabled"); if (smartEnabled) smartEnabled.checked = !!config.smartSnapEnabled;
    [10, 20, 30, 50].forEach(function (value) { var button = one('[data-smart-snap-distance="' + value + '"]'); if (button) button.classList.toggle("active", Number(config.smartSnapDistance) === value); });
    [["#smart-snap-layer-edges", "smartSnapLayerEdges"], ["#smart-snap-centers", "smartSnapCenters"], ["#smart-snap-equal-spacing", "smartSnapEqualSpacing"], ["#smart-snap-canvas-edges", "smartSnapCanvasEdges"], ["#smart-snap-guides", "smartSnapGuides"]].forEach(function (entry) { var node = one(entry[0]); if (node) node.checked = !!config[entry[1]]; });
    updateAutoFillCard();
    updateSmartSnapCard();
    updateExportFormatUi();
  }

  function bind() {
    all("[data-common-action]").forEach(function (button) {
      button.addEventListener("click", function () { runAction(button.getAttribute("data-common-action"), button); });
    });
    all("[data-common-more]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        var detail = button.getAttribute("data-common-more");
        var drawer = one("#common-tools-parameter-drawer");
        if (drawer && !drawer.classList.contains("drawer-collapsed") && activeDetailName === detail) closeDetail();
        else openDetail(detail, button);
      });
    });
    all("[data-common-scale]").forEach(function (button) { button.addEventListener("click", function () { runScale(button.getAttribute("data-common-scale")); closeZoomExtras(); }); });
    all("[data-common-align]").forEach(function (button) { button.addEventListener("click", function () { runAlign(button.getAttribute("data-common-align")); }); });
    all("[data-common-canvas-center]").forEach(function (button) { button.addEventListener("click", function () { runCanvasCenter(button.getAttribute("data-common-canvas-center")); }); });
    all("[data-common-even-distribute]").forEach(function (button) { button.addEventListener("click", function () { runEvenDistribute(button.getAttribute("data-common-even-distribute")); }); });
    all("[data-common-flip]").forEach(function (button) { button.addEventListener("click", function () { runFlip(button.getAttribute("data-common-flip")); }); });
    all("[data-find-same-type]").forEach(function (button) {
      button.addEventListener("click", function (event) { event.stopPropagation(); runFindSameType(button.getAttribute("data-find-same-type")); });
    });
    var smartEnabled = one("#smart-snap-enabled");
    if (smartEnabled) smartEnabled.addEventListener("change", function () { config.smartSnapEnabled = !!smartEnabled.checked; saveConfig(); updateSmartSnapCard(); });
    all("[data-smart-snap-distance]").forEach(function (button) { button.addEventListener("click", function () { config.smartSnapDistance = Number(button.getAttribute("data-smart-snap-distance")) || 20; all("[data-smart-snap-distance]").forEach(function (node) { node.classList.toggle("active", node === button); }); saveConfig(); }); });
    [["#smart-snap-layer-edges", "smartSnapLayerEdges"], ["#smart-snap-centers", "smartSnapCenters"], ["#smart-snap-equal-spacing", "smartSnapEqualSpacing"], ["#smart-snap-canvas-edges", "smartSnapCanvasEdges"], ["#smart-snap-guides", "smartSnapGuides"]].forEach(function (entry) { var node = one(entry[0]); if (node) node.addEventListener("change", function () { config[entry[1]] = !!node.checked; saveConfig(); }); });
    document.addEventListener("keydown", function (event) { if (event.shiftKey && !event.ctrlKey && !event.altKey && String(event.key || "").toLowerCase() === "s") { var target = event.target || {}; if (/input|textarea|select/i.test(target.tagName || "")) return; event.preventDefault(); config.smartSnapEnabled = !config.smartSnapEnabled; saveConfig(); restoreControls(); status(config.smartSnapEnabled ? "磁吸模式已开启" : "磁吸模式已关闭"); } });
    all("[data-zoom-submit]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        runZoomInput(button.getAttribute("data-zoom-submit"));
      });
    });
    all("[data-zoom-drop]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        toggleZoomExtra(button.getAttribute("data-zoom-drop"));
      });
    });
    ["up", "down"].forEach(function (direction) {
      var input = zoomInputFor(direction);
      if (!input) return;
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.keyCode === 13) {
          event.preventDefault();
          runZoomInput(direction);
        }
      });
      input.addEventListener("focus", function () {
        var control = one('[data-zoom-control="' + direction + '"]');
        if (control) control.classList.add("active");
      });
      input.addEventListener("blur", function () {
        var control = one('[data-zoom-control="' + direction + '"]');
        if (control) control.classList.remove("active");
      });
    });
    document.addEventListener("click", function (event) {
      var zooms = one(".common-zooms");
      if (!zooms || zooms.contains(event.target)) return;
      closeZoomExtras();
    });

    var autoPlace = one("#embed-auto-place");
    var autoPaste = one("#embed-auto-paste");
    var embedLowerVisual = one("#embed-lower-visual");
    if (autoPlace) autoPlace.addEventListener("change", function () {
      config.autoEmbedPlace = !!autoPlace.checked;
      if (config.autoEmbedPlace && config.embedLowerVisual) config.embedLowerVisual = false;
      updateEmbedOptionUi();
      saveConfig();
      syncPhotoshopNotifiers(true, "autoEmbed").catch(function () {});
    });
    if (autoPaste) autoPaste.addEventListener("change", function () {
      config.autoEmbedPaste = !!autoPaste.checked;
      if (config.autoEmbedPaste && config.embedLowerVisual) config.embedLowerVisual = false;
      updateEmbedOptionUi();
      saveConfig();
      syncPhotoshopNotifiers(true, "autoEmbed").catch(function () {});
    });
    if (embedLowerVisual) embedLowerVisual.addEventListener("change", function () {
      config.embedLowerVisual = !!embedLowerVisual.checked;
      if (config.embedLowerVisual) {
        config.autoEmbedPlace = false;
        config.autoEmbedPaste = false;
      }
      updateEmbedOptionUi();
      saveConfig();
      syncPhotoshopNotifiers(true, "autoEmbed").catch(function () {});
      status(config.embedLowerVisual ? "嵌入下方图层已开启：插入/粘贴自动嵌入已关闭" : "嵌入下方图层已关闭");
    });

    var importLinked = one("#tuniu-import-linked");
    if (importLinked) importLinked.addEventListener("change", function () { config.importImagesIsLinkObject = !!importLinked.checked; saveConfig(); });
    [
      ["#tuniu-auto-fill-text", "autoFillText"], ["#tuniu-auto-fill-shape", "autoFillShape"], ["#tuniu-auto-fill-normal", "autoFillNormal"]
    ].forEach(function (entry) {
      var node = one(entry[0]);
      if (node) node.addEventListener("change", function () {
        config[entry[1]] = !!node.checked;
        if (!config.autoFillText && !config.autoFillShape && !config.autoFillNormal) config.autoFillColor = false;
        saveConfig(); updateAutoFillCard(); syncPhotoshopNotifiers(false, "autoFill").catch(function () {});
      });
    });

    all("[data-tuniu-distribute]").forEach(function (button) {
      button.addEventListener("click", function () { runDistributeDirection(button.getAttribute("data-tuniu-distribute")); });
    });
    var rectRun = one("#tuniu-rect-run"); if (rectRun) rectRun.addEventListener("click", runRectangleSettings);
    var transformRun = one("#tuniu-transform-run"); if (transformRun) transformRun.addEventListener("click", runCustomTransform);
    var transformReset = one("#tuniu-transform-reset"); if (transformReset) transformReset.addEventListener("click", resetCustomTransform);
    all("[data-transform-anchor]").forEach(function (button) {
      button.addEventListener("click", function () {
        config.customTransformPoint = Number(button.getAttribute("data-transform-anchor")) || 1;
        all("[data-transform-anchor]").forEach(function (node) { node.classList.toggle("active", node === button); });
        saveConfig();
      });
    });

    all("[data-export-format]").forEach(function (button) {
      button.addEventListener("click", function () {
        config.exportFormat = button.getAttribute("data-export-format") === "png" ? "png" : "jpg";
        saveConfig(); updateExportFormatUi();
      });
    });
    var pickExportFolder = one("#tuniu-export-pick-folder");
    if (pickExportFolder) pickExportFolder.addEventListener("click", function () {
      var folder = pickFolder("选择导出目录");
      if (!folder) return;
      config.exportPath = folder;
      config.exportPathType = "custom";
      var node = one("#tuniu-export-path"); if (node) node.value = folder;
      all('input[name="tuniu-export-path-type"]').forEach(function (radio) { radio.checked = false; });
      saveConfig(); status("已选择自定义导出目录");
    });
    all('input[name="tuniu-export-path-type"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        if (!radio.checked) return;
        config.exportPathType = radio.value;
        config.exportPath = "";
        var pathInput = one("#tuniu-export-path"); if (pathInput) pathInput.value = "";
        saveConfig();
      });
    });
    var exportPathInput = one("#tuniu-export-path");
    if (exportPathInput) exportPathInput.addEventListener("input", function () {
      config.exportPath = exportPathInput.value;
      if (config.exportPath) {
        config.exportPathType = "custom";
        all('input[name="tuniu-export-path-type"]').forEach(function (radio) { radio.checked = false; });
      }
      saveConfig();
    });

    var pickExportWatermark = one("#tuniu-export-pick-watermark");
    if (pickExportWatermark) pickExportWatermark.addEventListener("click", function () {
      var file = pickWatermark();
      if (!file) return;
      config.exportWatermark = file;
      var node = one("#tuniu-export-watermark"); if (node) node.value = file;
      saveConfig(); status("已选择水印文件");
    });
    var openCurrent = one("#tuniu-export-open-current"); if (openCurrent) openCurrent.addEventListener("click", openExportFolder);
    var exportPsd = one("#tuniu-export-psd-folder"); if (exportPsd) exportPsd.addEventListener("click", runExportPsdFolder);
    all("[data-export-batch-level]").forEach(function (button) {
      button.addEventListener("click", function () { runBatchExport(button.getAttribute("data-export-batch-level")); });
    });
    all("#common-tools-parameter-drawer input, #common-tools-parameter-drawer select").forEach(function (node) {
      node.addEventListener("change", function () {
        if (/^tuniu-export-/.test(node.id) || /tuniu-export-/.test(node.name || "")) syncExportConfigFromUi();
      });
    });

    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(repositionActiveDrawer, 80);
    });
  }

  function bindRuntimeLifecycle() {
    window.addEventListener("pagehide", saveConfigNow);
    window.addEventListener("beforeunload", saveConfigNow);
    document.addEventListener("xinyang:runtimehidden", function () {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = 0;
      /* 保留抽屉、缩放菜单和表单状态；后台自动化监听继续工作。 */
    });
    document.addEventListener("xinyang:runtimeresume", function () {
      if (activeDetailName) {
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(repositionActiveDrawer);
        } else {
          window.setTimeout(repositionActiveDrawer, 0);
        }
      }
    });
  }

  function init() {
    if (window.__XINYANG_COMMON_TOOLS_INITIALIZED__) return;
    window.__XINYANG_COMMON_TOOLS_INITIALIZED__ = true;
    loadConfig();
    restoreControls();
    var drawer = one("#common-tools-parameter-drawer");
    if (drawer) drawer.classList.add("drawer-collapsed");
    activeDetailItem = null;
    activeDetailName = "";
    bind();
    bindRuntimeLifecycle();
    syncPhotoshopNotifiers(false, "init").catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
