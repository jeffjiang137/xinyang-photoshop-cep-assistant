(function (global) {
  "use strict";
  if (global.XinyangToolsBatch) return;
  global.XinyangToolsBatch = {
    create: function (deps) {
      deps = deps || {};
    var config = deps.config;
    var $ = deps.$;
    var isBusy = deps.isBusy;
    var status = deps.status;
    var humanError = deps.humanError;
    var hostInvoke = deps.hostInvoke;
    var readAdvancedConfig = deps.readAdvancedConfig;
    var setBusy = deps.setBusy;

    function batchRenameLayers() {
      if (isBusy()) return;
      readAdvancedConfig();
      setBusy(true, "正在批量重命名…");
      hostInvoke("toolsBatchRenameLayers", {
        pattern: config.renamePattern,
        start: config.renameStart,
        digits: config.renameDigits,
        sort: config.renameSort,
        includeChildren: config.renameChildren
      }).then(function (result) {
        status("已重命名 " + result.renamed + " 个图层");
      }).catch(function (error) {
        status("批量重命名失败：" + humanError(error));
      }).then(function () { setBusy(false); });
    }

    function findSimilarLayers() {
      if (isBusy()) return;
      readAdvancedConfig();
      if (!config.findCriteria.length) {
        status("请至少选择一个查找条件");
        return;
      }
      setBusy(true, "正在查找相同图层…");
      hostInvoke("toolsFindSimilarLayers", {
        criteria: config.findCriteria,
        tolerance: config.findSizeTolerance,
        action: config.findResultAction,
        label: config.findLabelColor
      }).then(function (result) {
        status("找到并选中 " + result.matched + " 个图层");
      }).catch(function (error) {
        status("查找失败：" + humanError(error));
      }).then(function () { setBusy(false); });
    }

    function applyRectangleSettings() {
      if (isBusy()) return;
      readAdvancedConfig();
      if (!config.rectApplySize && !config.rectApplyRadius && !config.rectApplyFill &&
          !config.rectApplyStroke && !config.rectApplyOpacity) {
        status("请至少勾选一个矩形设置项目");
        return;
      }
      setBusy(true, "正在批量设置形状图层…");
      hostInvoke("toolsApplyRectangleSettings", {
        applySize: config.rectApplySize,
        width: config.rectWidth,
        height: config.rectHeight,
        applyRadius: config.rectApplyRadius,
        radius: config.rectRadius,
        applyFill: config.rectApplyFill,
        fill: config.rectFill,
        applyStroke: config.rectApplyStroke,
        stroke: config.rectStroke,
        strokeWidth: config.rectStrokeWidth,
        applyOpacity: config.rectApplyOpacity,
        opacity: config.rectOpacity
      }).then(function (result) {
        var tail = result.radiusSkipped ? "；" + result.radiusSkipped + " 个圆角因版本限制未修改" : "";
        status("矩形设置完成：处理 " + result.processed + " 个，跳过 " + result.skipped + " 个" + tail);
      }).catch(function (error) {
        status("矩形设置失败：" + humanError(error));
      }).then(function () { setBusy(false); });
    }

    function runSmartObject(action) {
      if (isBusy()) return;
      var label = action === "convert" ? "转换为智能对象" : "栅格化智能对象";
      setBusy(true, "正在" + label + "…");
      hostInvoke("toolsSmartObject", { action: action }).then(function (result) {
        status(label + "完成：处理 " + result.processed + " 个，跳过 " + result.skipped + " 个");
      }).catch(function (error) {
        status(label + "失败：" + humanError(error));
      }).then(function () { setBusy(false); });
    }

      return {
      batchRenameLayers: batchRenameLayers,
      findSimilarLayers: findSimilarLayers,
      applyRectangleSettings: applyRectangleSettings,
      runSmartObject: runSmartObject
      };
    }
  };
}(window));
