(function () {
  "use strict";

  var cs = new CSInterface();
  var busy = false;
  var config = {
    pinyinMode: "dash",
    distributeAxis: "horizontal",
    distributeGap: 20
  };

  function one(selector) { return document.querySelector(selector); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function status(message) {
    var node = one("#status-text");
    if (node) node.textContent = String(message || "就绪");
  }
  function errorText(error) { return error && error.message ? error.message : String(error || "未知错误"); }

  function hostInvoke(method, payload) {
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
    all(".common-tools-shell button, .common-tools-shell input").forEach(function (node) {
      node.disabled = busy;
    });
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
      multiple ? "选择需要嵌入的图片" : "选择一张需要嵌入的图片",
      "",
      ["jpg", "jpeg", "png", "webp", "psd", "psb", "tif", "tiff", "bmp", "gif"]
    );
    return result && result.err === 0 && result.data ? result.data : [];
  }

  function runEmbed(multiple) {
    if (!multiple) {
      runHost("toolsEmbedSelectedLayerClipped", {}, "正在将当前图层嵌入下方图层…", function (result) {
        return "嵌入完成：‘" + (result.sourceName || "当前图层") + "’已等比覆盖‘" + (result.targetName || "下方图层") + "’并建立剪切蒙版";
      }).catch(function () {});
      return;
    }

    runHost(
      "toolsEmbedSelectedLayersToGroup",
      {},
      "正在把所选图片逐一嵌入目标图层组…",
      function (result) {
        return "嵌入多图完成：" + result.processed + " 张图片已分别覆盖目标图层并建立剪切蒙版";
      }
    ).catch(function () {});
  }

  var activeDetailItem = null;
  var resizeTimer = null;

  function gridColumnCount(grid) {
    if (!grid || !window.getComputedStyle) return 3;
    var value = String(window.getComputedStyle(grid).gridTemplateColumns || "").trim();
    if (!value || value === "none") return window.innerWidth <= 300 ? 2 : 3;
    var columns = value.split(/\s+/).filter(function (item) { return !!item; }).length;
    return Math.max(1, columns || 3);
  }

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
      "import-images": '[data-common-action="import-images"]',
      "file-slim": '[data-common-action="file-slim"]',
      "batch-export": '[data-common-action="export-image"]',
      "quick-transform": '[data-common-action="custom-transform"]'
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
    var columns = gridColumnCount(grid);
    var rowEndIndex = Math.min(items.length - 1, (Math.floor(index / columns) + 1) * columns - 1);
    var rowEndItem = items[rowEndIndex];
    grid.insertBefore(drawer, rowEndItem.nextSibling);
    drawer.setAttribute("data-anchor-index", String(index));
    drawer.setAttribute("data-anchor-row", String(Math.floor(index / columns)));
  }

  function openDetail(detail, sourceNode) {
    var drawer = one("#common-tools-parameter-drawer");
    if (!drawer) return;
    var item = resolveDetailItem(detail, sourceNode);
    if (item) {
      activeDetailItem = item;
      positionDrawerBelowRow(item);
    }
    drawer.classList.remove("drawer-collapsed");
    all(".common-tool-item").forEach(function (node) {
      node.classList.toggle("detail-row-active", node === activeDetailItem);
    });
    all("#common-tools-parameter-drawer .tool-detail").forEach(function (view) {
      view.classList.toggle("active", view.getAttribute("data-tool-detail-view") === detail);
    });
    if (drawer.scrollIntoView) drawer.scrollIntoView(false);
    status("已在当前工具行下方展开参数设置");
  }

  function repositionActiveDrawer() {
    if (!activeDetailItem) return;
    var drawer = one("#common-tools-parameter-drawer");
    if (!drawer || drawer.classList.contains("drawer-collapsed")) return;
    positionDrawerBelowRow(activeDetailItem);
  }

  function switchToolsTab(tab) {
    var button = one('.tools-tab[data-tools-tab="' + tab + '"]');
    if (button) button.click();
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
      flipHorizontalCenter: "左右中心翻转",
      flipVerticalCenter: "上下中心翻转",
      flipLeftEdge: "左边缘翻转",
      flipRightEdge: "右边缘翻转",
      flipBottomEdge: "下边缘翻转",
      flipTopEdge: "上边缘翻转"
    };
    runHost("toolsQuickTransform", { action: action }, "正在执行" + (names[action] || "翻转") + "…", function (result) {
      return (names[action] || "翻转") + "完成：处理 " + result.processed + " 个图层";
    }).catch(function () {});
  }

  function runAutoFill() {
    runHost("toolsAutoFillForeground", {}, "正在使用前景色填充…", function (result) {
      return "自动填色完成：处理 " + result.processed + " 个，跳过 " + result.skipped + " 个";
    }).catch(function () {});
  }

  function runFixBlur() {
    runHost("toolsSnapShapeAnchors", { threshold: 0.51, collinearTolerance: 0.08 }, "正在吸附形状锚点到像素网格…", function (result) {
      return "修正模糊完成：处理 " + result.processed + " 个形状，移动 " + result.movedAnchors + " 个锚点，跳过 " + result.skipped + " 个";
    }).catch(function () {});
  }

  function runSwapFillStroke() {
    runHost("toolsSwapShapeFillStroke", {}, "正在互换填充与线框…", function (result) {
      return "填充线框互换完成：处理 " + result.processed + " 个，跳过 " + result.skipped + " 个";
    }).catch(function () {});
  }

  function runDistribute() {
    var previous = (config.distributeAxis === "vertical" ? "V" : "H") + config.distributeGap;
    var input = window.prompt("输入分布方式和间距：H20 表示水平20px，V20 表示垂直20px", previous);
    if (input === null) return;
    var match = /^\s*([hHvV])?\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input);
    if (!match) { status("格式错误，请输入 H20 或 V20"); return; }
    config.distributeAxis = String(match[1] || "H").toUpperCase() === "V" ? "vertical" : "horizontal";
    config.distributeGap = Number(match[2]);
    saveConfig();
    runHost("toolsDistributeLayers", { axis: config.distributeAxis, gap: config.distributeGap }, "正在按间距分布…", function (result) {
      return "分布完成：" + result.processed + " 个图层，间距 " + config.distributeGap + "px";
    }).catch(function () {});
  }

  function runReplace() {
    if (!window.confirm("将当前活动图层/组作为源，替换其余已选目标，并保留目标位置、名称和层级。继续吗？")) return;
    runHost("toolsReplaceElements", { matchBounds: true }, "正在替换选中的元素或图层组…", function (result) {
      return "元素替换完成：替换 " + result.replaced + " 个目标";
    }).catch(function () {});
  }

  function runFindSame() {
    switchToolsTab("layer");
    window.setTimeout(function () {
      var button = one("#tool-layer-find");
      if (button) button.click();
    }, 0);
  }

  function runSwapPosition() {
    runHost("toolsQuickTransform", { action: "swapPosition" }, "正在互换两个图层的位置…", "位置互换完成").catch(function () {});
  }

  function runSwapColors() {
    runHost("toolsSwapLayerColors", {}, "正在互换两个图层的主颜色…", function (result) {
      return "图层颜色互换完成：" + result.firstColor + " ↔ " + result.secondColor;
    }).catch(function () {});
  }

  function runRectangle() {
    switchToolsTab("layer");
    window.setTimeout(function () {
      var section = one("#tool-layer-rectangle");
      if (section && section.scrollIntoView) section.scrollIntoView(false);
      status("已打开矩形批量设置，可确认参数后执行");
    }, 0);
  }

  function pinyinTokens(value) {
    var map = window.XINYANG_PINYIN_MAP || {};
    var tokens = [];
    var latin = "";
    var i;
    function flush() {
      if (latin) { tokens.push(latin.toLowerCase()); latin = ""; }
    }
    for (i = 0; i < String(value || "").length; i += 1) {
      var ch = value.charAt(i);
      if (map[ch]) { flush(); tokens.push(map[ch]); }
      else if (/[A-Za-z0-9]/.test(ch)) latin += ch;
      else flush();
    }
    flush();
    return tokens;
  }

  function convertPinyin(value, mode) {
    var tokens = pinyinTokens(value);
    if (!tokens.length) return String(value || "");
    if (mode === "initial") return tokens.map(function (item) { return item.charAt(0); }).join("").toUpperCase();
    if (mode === "camel") return tokens.map(function (item) { return item.charAt(0).toUpperCase() + item.slice(1); }).join("");
    if (mode === "underscore") return tokens.join("_");
    return tokens.join("-");
  }

  function runPinyin() {
    var input = window.prompt("拼音格式：dash（中划线）/ underscore（下划线）/ camel（大驼峰）/ initial（首字母）", config.pinyinMode);
    if (input === null) return;
    var mode = String(input || "dash").toLowerCase();
    if (!/^(dash|underscore|camel|initial)$/.test(mode)) { status("不支持的拼音格式"); return; }
    config.pinyinMode = mode;
    saveConfig();
    setBusy(true, "正在读取选中图层名称…");
    hostInvoke("toolsGetSelectedLayerNames", {}).then(function (result) {
      var layers = result.layers || [];
      var renamed = layers.map(function (item) {
        return { id: item.id, name: convertPinyin(item.name, mode) };
      });
      return hostInvoke("toolsSetSelectedLayerNames", { layers: renamed });
    }).then(function (result) {
      status("汉字转拼音完成：重命名 " + result.renamed + " 个图层");
    }).catch(function (error) {
      status("汉字转拼音失败：" + errorText(error));
    }).then(function () { setBusy(false); });
  }

  function runAction(action, sourceNode) {
    if (busy) return;
    if (action === "embed-one") runEmbed(false);
    else if (action === "embed-many") runEmbed(true);
    else if (action === "import-images") openDetail("import-images", sourceNode);
    else if (action === "auto-fill") runAutoFill();
    else if (action === "fix-blur") runFixBlur();
    else if (action === "swap-fill-stroke") runSwapFillStroke();
    else if (action === "file-slim") { var node = one("#tool-slim-run"); if (node) node.click(); }
    else if (action === "custom-transform") openDetail("quick-transform", sourceNode);
    else if (action === "export-image") openDetail("batch-export", sourceNode);
    else if (action === "distribute") runDistribute();
    else if (action === "replace-elements") runReplace();
    else if (action === "find-same") runFindSame();
    else if (action === "swap-position") runSwapPosition();
    else if (action === "swap-colors") runSwapColors();
    else if (action === "image-text") { switchMainPanel("text-panel"); status("请框选文字区域，或选中图片图层后开始识别"); }
    else if (action === "rectangle") runRectangle();
    else if (action === "pinyin") runPinyin();
  }

  function loadConfig() {
    try {
      var saved = JSON.parse(window.localStorage.getItem("xinyang.commonTools.v210") || "{}");
      Object.keys(config).forEach(function (key) { if (saved[key] !== undefined) config[key] = saved[key]; });
    } catch (ignore) {}
  }
  function saveConfig() {
    try { window.localStorage.setItem("xinyang.commonTools.v210", JSON.stringify(config)); } catch (ignore) {}
  }

  function bind() {
    all("[data-common-action]").forEach(function (button) {
      button.addEventListener("click", function () { runAction(button.getAttribute("data-common-action"), button); });
    });
    all("[data-common-more]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        openDetail(button.getAttribute("data-common-more"), button);
      });
    });
    all("[data-common-scale]").forEach(function (button) {
      button.addEventListener("click", function () { runScale(button.getAttribute("data-common-scale")); });
    });
    all("[data-common-align]").forEach(function (button) {
      button.addEventListener("click", function () { runAlign(button.getAttribute("data-common-align")); });
    });
    all("[data-common-canvas-center]").forEach(function (button) {
      button.addEventListener("click", function () { runCanvasCenter(button.getAttribute("data-common-canvas-center")); });
    });
    all("[data-common-even-distribute]").forEach(function (button) {
      button.addEventListener("click", function () { runEvenDistribute(button.getAttribute("data-common-even-distribute")); });
    });
    all("[data-common-flip]").forEach(function (button) {
      button.addEventListener("click", function () { runFlip(button.getAttribute("data-common-flip")); });
    });
    ["common-scale-up-custom", "common-scale-down-custom"].forEach(function (id) {
      var input = one("#" + id);
      if (!input) return;
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.keyCode === 13) { event.preventDefault(); runScale(input.value); }
      });
    });
    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(repositionActiveDrawer, 80);
    });
  }

  function init() {
    loadConfig();
    var drawer = one("#common-tools-parameter-drawer");
    if (drawer) drawer.classList.add("drawer-collapsed");
    bind();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
