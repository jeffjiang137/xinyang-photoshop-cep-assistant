(function (global) {
  "use strict";
  if (global.XinyangToolsImportExport) return;
  global.XinyangToolsImportExport = {
    create: function (deps) {
      deps = deps || {};
    var config = deps.config;
    var $ = deps.$;
    var cs = deps.cs;
    var isBusy = deps.isBusy;
    var status = deps.status;
    var humanError = deps.humanError;
    var hostInvoke = deps.hostInvoke;
    var saveConfig = deps.saveConfig;
    var selectTab = deps.selectTab;
    var selectDetail = deps.selectDetail;
    var restoreWordsUi = deps.restoreWordsUi;
    var setBusy = deps.setBusy;

    function pickImages() {
      var result = window.cep.fs.showOpenDialogEx(
        true,
        false,
        "选择需要导入的图片",
        "",
        ["jpg", "jpeg", "png", "webp", "psd", "psb", "tif", "tiff", "bmp"]
      );
      return result && result.err === 0 && result.data ? result.data : [];
    }

    function pickFolder() {
      var result = window.cep.fs.showOpenDialogEx(
        false,
        true,
        "选择导出文件夹",
        config.exportFolder || "",
        []
      );
      return result && result.err === 0 && result.data && result.data.length
        ? result.data[0]
        : "";
    }

    function readCommonConfigFromUi() {
      var node;
      node = $("#tool-import-mode"); if (node) config.importMode = node.value;
      node = $("#tool-import-layout"); if (node) config.importLayout = node.value;
      node = $("#tool-import-gap"); if (node) config.importGap = Number(node.value) || 0;
      node = $("#tool-import-fit"); if (node) config.importFit = node.value;
      node = $("#tool-export-target"); if (node) config.exportTarget = node.value;
      node = $("#tool-export-format"); if (node) config.exportFormat = node.value;
      node = $("#tool-export-folder"); if (node) config.exportFolder = node.value;
      node = $("#tool-export-quality"); if (node) config.exportQuality = Number(node.value) || 90;
      node = $("#tool-export-open-folder"); if (node) config.exportOpenFolder = node.checked;
      node = $("#slim-metadata"); if (node) config.slimMetadata = node.checked;
      node = $("#slim-empty-layers"); if (node) config.slimEmptyLayers = node.checked;
      node = $("#slim-empty-groups"); if (node) config.slimEmptyGroups = node.checked;
      node = $("#slim-hidden-layers"); if (node) config.slimHiddenLayers = node.checked;
      node = $("#slim-outside-layers"); if (node) config.slimOutsideLayers = node.checked;
      saveConfig();
    }

    function restoreUi() {
      var commonNode;
      commonNode = $("#tool-import-mode"); if (commonNode) commonNode.value = config.importMode;
      commonNode = $("#tool-import-layout"); if (commonNode) commonNode.value = config.importLayout;
      commonNode = $("#tool-import-gap"); if (commonNode) commonNode.value = config.importGap;
      commonNode = $("#tool-import-fit"); if (commonNode) commonNode.value = config.importFit;
      commonNode = $("#tool-export-target"); if (commonNode) commonNode.value = config.exportTarget;
      commonNode = $("#tool-export-format"); if (commonNode) commonNode.value = config.exportFormat;
      commonNode = $("#tool-export-folder"); if (commonNode) commonNode.value = config.exportFolder;
      commonNode = $("#tool-export-quality"); if (commonNode) commonNode.value = config.exportQuality;
      commonNode = $("#tool-export-open-folder"); if (commonNode) commonNode.checked = !!config.exportOpenFolder;
      commonNode = $("#slim-metadata"); if (commonNode) commonNode.checked = config.slimMetadata !== false;
      commonNode = $("#slim-empty-layers"); if (commonNode) commonNode.checked = config.slimEmptyLayers !== false;
      commonNode = $("#slim-empty-groups"); if (commonNode) commonNode.checked = config.slimEmptyGroups !== false;
      commonNode = $("#slim-hidden-layers"); if (commonNode) commonNode.checked = !!config.slimHiddenLayers;
      commonNode = $("#slim-outside-layers"); if (commonNode) commonNode.checked = !!config.slimOutsideLayers;
      selectTab();
      selectDetail(config.detail);
      updateExportFields();
    }

    function importImages() {
      if (isBusy()) return;
      var files = pickImages();
      if (!files.length) {
        status("未选择需要导入的图片");
        return;
      }
      readCommonConfigFromUi();
      setBusy(true, "正在导入 " + files.length + " 张图片…");
      hostInvoke("toolsImportImages", {
        files: files,
        mode: config.importMode,
        layout: config.importLayout,
        gap: config.importGap,
        fit: config.importFit
      }).then(function (result) {
        status("已导入 " + result.imported + " 张图片，排列方式：" + result.layoutName);
      }).catch(function (error) {
        status("导入失败：" + humanError(error));
      }).then(function () {
        setBusy(false);
      });
    }

    function fileSlimOptions() {
      readCommonConfigFromUi();
      return {
        slimSmartObject: !!config.slimMetadata,
        removeEmptyLayer: !!config.slimEmptyLayers,
        removeHideLayer: !!config.slimHiddenLayers
      };
    }

    function fileSlimSummary(result) {
      result = result || {};
      var parts = [];
      if (result.removed) {
        parts.push("删除 " + result.removed + " 项（空图层 " +
          (result.emptyLayers || 0) + "、空组 " + (result.emptyGroups || 0) +
          "、隐藏 " + (result.hiddenLayers || 0) + "）");
      } else {
        parts.push("图层清理 0 项");
      }
      if (result.documents || result.smartObjects || result.metadataCleaned) {
        parts.push("优化 " + (result.documents || 0) + " 个文档、" +
          (result.smartObjects || 0) + " 个智能对象");
      }
      if (result.skipped) parts.push("跳过 " + result.skipped + " 项");
      return parts.join("；");
    }

    function runFileSlim() {
      if (isBusy()) return;
      var options = fileSlimOptions();
      if (!options.slimSmartObject && !options.removeEmptyLayer &&
          !options.removeHideLayer) {
        status("请至少选择一个优化项目");
        return;
      }
      setBusy(true, options.slimSmartObject
        ? "正在清理图层并优化智能对象…"
        : "正在检查并清理当前文档图层…");
      hostInvoke("commonTools.fileSlim", options).then(function (result) {
        status("文件瘦身完成：" + fileSlimSummary(result));
      }).catch(function (error) {
        status("文件瘦身失败：" + humanError(error));
      }).then(function () {
        setBusy(false);
      });
    }

    function slimFileName(path) {
      var parts = String(path || "").replace(/\\/g, "/").split("/");
      return parts.length ? parts[parts.length - 1] : String(path || "PSD");
    }

    function runBatchFileSlim() {
      if (isBusy()) return;
      var options = fileSlimOptions();
      if (!options.slimSmartObject && !options.removeEmptyLayer &&
          !options.removeHideLayer) {
        status("请至少选择一个优化项目");
        return;
      }
      setBusy(true, "请选择需要批量优化的 PSD/PSB 文档…");
      hostInvoke("commonTools.getPsdFiles", {}).then(function (files) {
        files = files || [];
        if (!files.length) {
          status("未选择需要批量优化的文档");
          return null;
        }
        var index = 0;
        var succeeded = 0;
        var failed = [];
        var totals = { removed: 0, smartObjects: 0, documents: 0, skipped: 0 };

        function next() {
          if (index >= files.length) {
            var message = "批量优化完成：成功 " + succeeded + "/" + files.length +
              "，删除 " + totals.removed + " 项，优化 " + totals.smartObjects +
              " 个智能对象";
            if (totals.skipped) message += "，跳过 " + totals.skipped + " 项";
            if (failed.length) message += "；失败 " + failed.length + " 个";
            status(message);
            return Promise.resolve({ succeeded: succeeded, failed: failed });
          }
          var filePath = files[index];
          var current = index + 1;
          status("正在优化 " + current + "/" + files.length + "：" + slimFileName(filePath));
          index += 1;
          return hostInvoke("commonTools.batchSlimFile", {
            param: options,
            filePath: filePath
          }).then(function (result) {
            succeeded += 1;
            totals.removed += Number(result.removed) || 0;
            totals.smartObjects += Number(result.smartObjects) || 0;
            totals.documents += Number(result.documents) || 0;
            totals.skipped += Number(result.skipped) || 0;
          }).catch(function (error) {
            failed.push(slimFileName(filePath) + "：" + humanError(error));
          }).then(next);
        }
        return next();
      }).catch(function (error) {
        status("批量文件瘦身失败：" + humanError(error));
      }).then(function () {
        setBusy(false);
      });
    }

    function updateExportFields() {
      var format = $("#tool-export-format") ? $("#tool-export-format").value : "png";
      var quality = $("#tool-export-quality-row");
      if (quality) quality.style.display = format === "jpg" ? "flex" : "none";
    }

    function openFolder(path) {
      if (!path) return;
      try {
        cs.openURLInDefaultBrowser("file:///" + String(path).replace(/\\/g, "/"));
      } catch (error) {}
    }

    function runBatchExport() {
      if (isBusy()) return;
      readCommonConfigFromUi();
      if (!config.exportFolder) {
        status("请先选择导出文件夹");
        return;
      }
      setBusy(true, "正在导出图片…");
      hostInvoke("toolsBatchExport", {
        target: config.exportTarget,
        format: config.exportFormat,
        folder: config.exportFolder,
        quality: config.exportQuality,
        openFolder: config.exportOpenFolder
      }).then(function (result) {
        status("已导出 " + result.exported + " 个文件到：" + result.folder);
      }).catch(function (error) {
        status("导出失败：" + humanError(error));
      }).then(function () {
        setBusy(false);
      });
    }

      return {
      pickImages: pickImages,
      pickFolder: pickFolder,
      readCommonConfigFromUi: readCommonConfigFromUi,
      restoreUi: restoreUi,
      importImages: importImages,
      fileSlimOptions: fileSlimOptions,
      fileSlimSummary: fileSlimSummary,
      runFileSlim: runFileSlim,
      slimFileName: slimFileName,
      runBatchFileSlim: runBatchFileSlim,
      updateExportFields: updateExportFields,
      openFolder: openFolder,
      runBatchExport: runBatchExport
      };
    }
  };
}(window));
