(function () {
  "use strict";

  if (window.__XINYANG_FRAMEWORK_INITIALIZED__) return;
  window.__XINYANG_FRAMEWORK_INITIALIZED__ = true;

  var cs = new CSInterface();
  var STORAGE_KEY = "xinyang.framework.v1";
  var HEIGHT_KEY = "showHeightInput";
  var busy = false;
  var stateSaveTimer = 0;
  var stateDirty = false;
  var state = {
    type: 0,
    lines: [{ value: "", height: "" }],
    rowSpace: "",
    colSpace: "",
    t1: "",
    t2: "",
    titleStyleIndex: 1,
    heightInput: false,
    showHelper: false
  };

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
  function cloneLine(line) { return { value: String(line && line.value || ""), height: String(line && line.height || "") }; }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, String(value)); } catch (error) {}
  }

  function loadState() {
    var raw = storageGet(STORAGE_KEY);
    if (raw) {
      try {
        var saved = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          state.type = Number(saved.type) >= 0 && Number(saved.type) <= 2 ? Number(saved.type) : 0;
          if (saved.lines instanceof Array && saved.lines.length) {
            state.lines = saved.lines.map(cloneLine);
          }
          state.rowSpace = String(saved.rowSpace || "");
          state.colSpace = String(saved.colSpace || "");
          state.t1 = String(saved.t1 || "");
          state.t2 = String(saved.t2 || "");
          state.titleStyleIndex = Math.max(1, Math.min(9, Number(saved.titleStyleIndex) || 1));
        }
      } catch (error) {}
    }
    state.heightInput = storageGet(HEIGHT_KEY) === "true";
  }

  function saveStateNow() {
    if (stateSaveTimer) window.clearTimeout(stateSaveTimer);
    stateSaveTimer = 0;
    if (!stateDirty) return;
    stateDirty = false;
    storageSet(STORAGE_KEY, JSON.stringify({
      type: state.type,
      lines: state.lines,
      rowSpace: state.rowSpace,
      colSpace: state.colSpace,
      t1: state.t1,
      t2: state.t2,
      titleStyleIndex: state.titleStyleIndex
    }));
    storageSet(HEIGHT_KEY, state.heightInput ? "true" : "false");
  }

  function saveState() {
    stateDirty = true;
    if (stateSaveTimer) window.clearTimeout(stateSaveTimer);
    stateSaveTimer = window.setTimeout(saveStateNow, 140);
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

  function setBusy(value) {
    busy = !!value;
    all("#framework-panel button, #framework-panel input").forEach(function (node) {
      if (node.id === "framework-create") {
        node.disabled = busy || !hasFrameData();
      } else {
        node.disabled = busy;
      }
    });
  }

  function normalizeUnit(value, defaultUnit, allowedUnits) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "");
    if (!text) return "";
    text = text.replace(/，/g, ".");
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return text + defaultUnit;
    var match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-z%]+)$/i);
    if (!match) return text;
    var unit = match[2].toLowerCase();
    if (allowedUnits.indexOf(unit) < 0) return text;
    return match[1] + unit;
  }

  function normalizeSpace(value) {
    return normalizeUnit(value, "px", ["px", "mm", "cm", "in", "pt"]);
  }

  function normalizeFont(value) {
    return normalizeUnit(value, "px", ["px", "mm", "pt"]);
  }

  function hasFrameData() {
    var index;
    for (index = 0; index < state.lines.length; index += 1) {
      if (String(state.lines[index].value || "").replace(/\s/g, "")) return true;
    }
    return false;
  }

  function updateCreateButton() {
    var button = one("#framework-create");
    if (!button) return;
    var hasData = hasFrameData();
    button.disabled = busy || !hasData;
    button.classList.toggle("has-data", hasData);
  }

  function inputComponent(icon, placeholder, value, className, dataIndex, field) {
    var label = document.createElement("label");
    label.className = "framework-input-component " + (className || "");
    var left = document.createElement("span");
    left.className = "framework-input-left";
    var image = document.createElement("img");
    image.alt = "";
    image.src = icon;
    left.appendChild(image);
    var input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    input.placeholder = placeholder;
    input.value = value;
    input.setAttribute("data-frame-line-index", String(dataIndex));
    input.setAttribute("data-frame-line-field", field);
    label.appendChild(left);
    label.appendChild(input);
    return label;
  }

  function renderLines() {
    var container = one("#framework-lines");
    if (!container) return;
    container.innerHTML = "";
    state.lines.forEach(function (line, index) {
      var row = document.createElement("div");
      row.className = "framework-list";
      row.setAttribute("data-frame-line-row", String(index));
      row.appendChild(inputComponent(
        "assets/icons/framework/frame_rows.svg",
        "第" + (index + 1) + "行列数",
        line.value,
        "framework-line-main",
        index,
        "value"
      ));

      if (state.type === 0 && state.heightInput) {
        var heightInput = inputComponent(
          "assets/icons/framework/frame_row_height.svg",
          "高度",
          line.height,
          "framework-line-height",
          index,
          "height"
        );
        heightInput.querySelector(".framework-input-left").setAttribute("data-frame-height-toggle", "1");
        heightInput.querySelector(".framework-input-left").title = "隐藏每行高度";
        row.appendChild(heightInput);
      } else if (state.type === 0) {
        var mini = document.createElement("button");
        mini.className = "framework-height-mini";
        mini.type = "button";
        mini.title = "显示每行高度";
        mini.setAttribute("data-frame-height-toggle", "1");
        mini.innerHTML = '<img alt="" src="assets/icons/framework/frame_row_height.svg"/>';
        row.appendChild(mini);
      }

      var option = document.createElement("div");
      option.className = "framework-option";
      var add = document.createElement("button");
      add.type = "button";
      add.title = "在下方增加一行";
      add.setAttribute("data-frame-line-action", "add");
      add.setAttribute("data-frame-line-index", String(index));
      add.innerHTML = '<img alt="" src="assets/icons/framework/add.svg"/>';
      var remove = document.createElement("button");
      remove.type = "button";
      remove.title = "删除当前行";
      remove.setAttribute("data-frame-line-action", "remove");
      remove.setAttribute("data-frame-line-index", String(index));
      remove.innerHTML = '<img alt="" src="assets/icons/framework/reduce.svg"/>';
      option.appendChild(add);
      option.appendChild(remove);
      row.appendChild(option);
      container.appendChild(row);
    });
    updateCreateButton();
  }

  function syncStaticFields() {
    var rowSpace = one("#framework-row-space");
    var colSpace = one("#framework-col-space");
    var t1 = one("#framework-t1");
    var t2 = one("#framework-t2");
    if (rowSpace) rowSpace.value = state.rowSpace;
    if (colSpace) colSpace.value = state.colSpace;
    if (t1) t1.value = state.t1;
    if (t2) t2.value = state.t2;
    all("[data-frame-type]").forEach(function (button) {
      var active = Number(button.getAttribute("data-frame-type")) === state.type;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    all("[data-frame-title-style]").forEach(function (button) {
      var active = Number(button.getAttribute("data-frame-title-style")) === state.titleStyleIndex;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", active ? "true" : "false");
    });
  }

  function syncStateFromStaticFields() {
    state.rowSpace = one("#framework-row-space") ? one("#framework-row-space").value : "";
    state.colSpace = one("#framework-col-space") ? one("#framework-col-space").value : "";
    state.t1 = one("#framework-t1") ? one("#framework-t1").value : "";
    state.t2 = one("#framework-t2") ? one("#framework-t2").value : "";
  }

  function setFrameType(type) {
    state.type = Math.max(0, Math.min(2, Number(type) || 0));
    syncStaticFields();
    renderLines();
    saveState();
    status(["矩形框架", "圆形框架", "方形框架"][state.type] + "已选中");
  }

  function setTitleStyle(index) {
    state.titleStyleIndex = Math.max(1, Math.min(9, Number(index) || 1));
    syncStaticFields();
    saveState();
  }

  function toggleHeightInput() {
    if (state.type !== 0) return;
    state.heightInput = !state.heightInput;
    saveState();
    renderLines();
    status(state.heightInput ? "已显示每行高度输入" : "已隐藏每行高度输入");
  }

  function addLine(index) {
    index = Math.max(0, Math.min(state.lines.length - 1, Number(index) || 0));
    state.lines.splice(index + 1, 0, cloneLine(state.lines[index]));
    saveState();
    renderLines();
    status("已增加第 " + (index + 2) + " 行");
  }

  function removeLine(index) {
    if (state.lines.length <= 1) {
      status("最少保留一行");
      return;
    }
    index = Math.max(0, Math.min(state.lines.length - 1, Number(index) || 0));
    state.lines.splice(index, 1);
    saveState();
    renderLines();
    status("已删除一行");
  }

  function payload() {
    syncStateFromStaticFields();
    return {
      type: state.type,
      lines: state.lines.map(cloneLine),
      rowSpace: state.rowSpace || "8px",
      colSpace: state.colSpace || "8px",
      t1: state.t1,
      t2: state.t2,
      titleStyleIndex: state.titleStyleIndex,
      showHeightInput: state.heightInput
    };
  }

  function createFramework() {
    if (busy || !hasFrameData()) return;
    setBusy(true);
    status("正在生成自定义框架…");
    hostInvoke("frame.create", payload()).then(function (result) {
      status("框架生成完成：" + Number(result.created || 0) + " 个框架，" + Number(result.rows || 0) + " 行");
    }).catch(function (error) {
      status("生成框架失败：" + errorText(error));
    }).then(function () { setBusy(false); });
  }

  function mergeShapes() {
    if (busy) return;
    setBusy(true);
    status("正在合并选中矩形…");
    hostInvoke("frame.mergeShape", {}).then(function (result) {
      status("合并完成：" + Number(result.processed || 0) + " 个矩形已合并");
    }).catch(function (error) {
      status("合并矩形失败：" + errorText(error));
    }).then(function () { setBusy(false); });
  }

  function resetFramework() {
    state.type = 0;
    state.lines = [{ value: "", height: "" }];
    state.rowSpace = "";
    state.colSpace = "";
    state.t1 = "";
    state.t2 = "";
    state.titleStyleIndex = 1;
    state.heightInput = false;
    syncStaticFields();
    renderLines();
    saveState();
    status("自定义框架参数已重置");
  }

  function toggleHelper() {
    state.showHelper = !state.showHelper;
    var button = one("#framework-helper-toggle");
    var body = one("#framework-helper-body");
    if (button) button.setAttribute("aria-expanded", state.showHelper ? "true" : "false");
    if (body) body.hidden = !state.showHelper;
  }

  function bindInputFocus() {
    all("#framework-panel input").forEach(function (input) {
      input.addEventListener("focus", function () {
        var parent = input.parentNode;
        if (parent) parent.classList.add("active");
      });
      input.addEventListener("blur", function () {
        var parent = input.parentNode;
        if (parent) parent.classList.remove("active");
      });
    });
  }

  function bind() {
    all("[data-frame-type]").forEach(function (button) {
      button.addEventListener("click", function () { setFrameType(button.getAttribute("data-frame-type")); });
    });
    all("[data-frame-title-style]").forEach(function (button) {
      button.addEventListener("click", function () { setTitleStyle(button.getAttribute("data-frame-title-style")); });
    });

    var staticFields = [
      ["#framework-row-space", "rowSpace", normalizeSpace],
      ["#framework-col-space", "colSpace", normalizeSpace],
      ["#framework-t1", "t1", normalizeFont],
      ["#framework-t2", "t2", normalizeFont]
    ];
    staticFields.forEach(function (entry) {
      var node = one(entry[0]);
      if (!node) return;
      node.addEventListener("input", function () {
        state[entry[1]] = node.value;
        saveState();
      });
      node.addEventListener("blur", function () {
        node.value = entry[2](node.value);
        state[entry[1]] = node.value;
        saveState();
      });
    });

    var lines = one("#framework-lines");
    if (lines) {
      lines.addEventListener("input", function (event) {
        var input = event.target;
        var index = Number(input.getAttribute("data-frame-line-index"));
        var field = input.getAttribute("data-frame-line-field");
        if (!state.lines[index] || (field !== "value" && field !== "height")) return;
        state.lines[index][field] = input.value;
        saveState();
        updateCreateButton();
      });
      lines.addEventListener("blur", function (event) {
        var input = event.target;
        var index = Number(input.getAttribute("data-frame-line-index"));
        var field = input.getAttribute("data-frame-line-field");
        if (!state.lines[index] || field !== "height") return;
        input.value = normalizeSpace(input.value);
        state.lines[index].height = input.value;
        saveState();
      }, true);
      lines.addEventListener("click", function (event) {
        var target = event.target;
        while (target && target !== lines && !target.getAttribute("data-frame-line-action") && !target.getAttribute("data-frame-height-toggle")) target = target.parentNode;
        if (!target || target === lines) return;
        if (target.getAttribute("data-frame-height-toggle")) {
          toggleHeightInput();
          return;
        }
        var action = target.getAttribute("data-frame-line-action");
        var index = Number(target.getAttribute("data-frame-line-index"));
        if (action === "add") addLine(index);
        else if (action === "remove") removeLine(index);
      });
    }

    var create = one("#framework-create");
    var merge = one("#framework-merge");
    var reset = one("#framework-reset");
    var helper = one("#framework-helper-toggle");
    if (create) create.addEventListener("click", createFramework);
    if (merge) merge.addEventListener("click", mergeShapes);
    if (reset) reset.addEventListener("click", resetFramework);
    if (helper) helper.addEventListener("click", toggleHelper);
  }

  window.addEventListener("pagehide", saveStateNow);
  window.addEventListener("beforeunload", saveStateNow);
  loadState();
  syncStaticFields();
  renderLines();
  bind();
  bindInputFocus();
}());
