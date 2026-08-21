(function (global) {
  "use strict";

  if (global.XinyangOcrService) return;

  function getNodeRequire() {
    try {
      if (typeof require === "function") return require;
    } catch (ignoreRequire) {}
    try {
      if (global.cep_node && typeof global.cep_node.require === "function") {
        return global.cep_node.require;
      }
    } catch (ignoreCepNodeRequire) {}
    return null;
  }

  function copyApi(target, source) {
    var key;
    source = source || {};
    for (key in source) {
      if (source.hasOwnProperty(key) && typeof source[key] === "function") {
        target[key] = source[key];
      }
    }
    return target;
  }

  global.XinyangOcrService = {
    create: function (deps) {
      deps = deps || {};
      if (!global.XinyangOcrClient || !global.XinyangLamaClient || !global.XinyangIopaintManager) {
        throw new Error("OCR 子模块加载不完整");
      }

      var childDeps = {};
      var key;
      for (key in deps) { if (deps.hasOwnProperty(key)) childDeps[key] = deps[key]; }
      childDeps.getNodeRequire = getNodeRequire;

      var ocr = global.XinyangOcrClient.create(childDeps);
      childDeps.arrayBufferToBase64 = ocr.arrayBufferToBase64;
      childDeps.arrayBufferToText = ocr.arrayBufferToText;
      childDeps.base64ToBlob = ocr.base64ToBlob;
      childDeps.imageBase64FromJson = ocr.imageBase64FromJson;
      childDeps.jsonRequest = ocr.jsonRequest;
      var lama = global.XinyangLamaClient.create(childDeps);

      childDeps.nodeTransportAvailable = lama.nodeTransportAvailable;
      childDeps.probeLamaCandidate = lama.probeLamaCandidate;
      childDeps.renderLocalLamaStatus = lama.renderLocalLamaStatus;
      var iopaint = global.XinyangIopaintManager.create(childDeps);

      function ensureLamaServiceReady() {
        return lama.detectLocalLama(true, false).then(function (available) {
          if (available) return true;
          return iopaint.refreshManagedIopaintInstallState().then(function (installed) {
            if (!installed) {
              throw new Error("未检测到外部 LaMa 服务，且本地模型尚未下载；请先在设置页下载本地模型");
            }
            deps.setStatus("正在按需启动 LaMa 本地服务…");
            return iopaint.startManagedIopaint();
          });
        });
      }

      var api = { getNodeRequire: getNodeRequire, ensureLamaServiceReady: ensureLamaServiceReady };
      copyApi(api, ocr);
      copyApi(api, lama);
      copyApi(api, iopaint);
      return api;
    }
  };
}(window));
