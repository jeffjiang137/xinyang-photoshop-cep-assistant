(function (global) {
  "use strict";
  if (global.XinyangToolsTransform) return;
  global.XinyangToolsTransform = {
    create: function (deps) {
      deps = deps || {};
    var documentPresets = deps.documentPresets;
    var $ = deps.$;
    var isBusy = deps.isBusy;
    var status = deps.status;
    var humanError = deps.humanError;
    var hostInvoke = deps.hostInvoke;
    var setBusy = deps.setBusy;

    function runTransform(action) {
      if (isBusy()) return;
      var names = {
        flipHorizontal: "水平翻转",
        flipVertical: "垂直翻转",
        rotateLeft: "左转90°",
        rotateRight: "右转90°",
        swapPosition: "位置互换"
      };
      setBusy(true, "正在执行" + names[action] + "…");
      hostInvoke("toolsQuickTransform", { action: action }).then(function (result) {
        status("已完成" + names[action] + "，处理 " + result.processed + " 个图层");
      }).catch(function (error) {
        status(names[action] + "失败：" + humanError(error));
      }).then(function () {
        setBusy(false);
      });
    }

    function presetGuides(preset) {
      var guides = [];
      if (preset.safe > 0) {
        guides.push({ direction: "vertical", value: Math.round(preset.width * preset.safe / 100) });
        guides.push({ direction: "vertical", value: Math.round(preset.width * (100 - preset.safe) / 100) });
      }
      if (preset.width === 1920) guides.push({ direction: "vertical", value: 960 });
      return guides;
    }

    function renderDocumentPresets() {
      var list = $("#document-preset-list");
      list.innerHTML = documentPresets.map(function (preset) {
        var guideText = preset.safe ? "左右 " + preset.safe + "% 安全线" : "标准画布";
        return '<button class="preset-card" type="button" data-preset-id="' + preset.id + '">' +
          '<span class="preset-copy"><span class="preset-title-row"><strong>' + preset.name + '</strong>' +
          '<span class="preset-size">' + preset.width + " × " + preset.height + ' px</span></span>' +
          '<span class="preset-meta">' + guideText + '</span></span></button>';
      }).join("");
    }

    function createDocument(preset) {
      if (isBusy()) return;
      var payload = {
        name: preset.name,
        width: Number(preset.width),
        height: Number(preset.height),
        dpi: Number(preset.dpi || 72),
        background: preset.background || "white",
        guides: presetGuides(preset)
      };
      setBusy(true, "正在创建 “" + payload.name + "”…");
      hostInvoke("toolsCreateDocumentPreset", payload).then(function (result) {
        status("已创建 “" + result.name + "” ：" + result.width + " × " + result.height + " px，参考线 " + result.guides + " 条");
      }).catch(function (error) {
        status("创建文档失败：" + humanError(error));
      }).then(function () {
        setBusy(false);
      });
    }

    function createCustomDocument() {
      var preset = {
        name: $("#custom-doc-name").value.trim() || "自定义文档",
        width: Number($("#custom-doc-width").value),
        height: Number($("#custom-doc-height").value),
        dpi: Number($("#custom-doc-dpi").value) || 72,
        safe: Math.max(0, Math.min(49, Number($("#custom-doc-safe").value) || 0)),
        background: $("#custom-doc-background").value
      };
      if (!(preset.width > 0 && preset.height > 0)) {
        status("请输入有效的文档宽度和高度");
        return;
      }
      createDocument(preset);
    }

      return {
      runTransform: runTransform,
      presetGuides: presetGuides,
      renderDocumentPresets: renderDocumentPresets,
      createDocument: createDocument,
      createCustomDocument: createCustomDocument
      };
    }
  };
}(window));
