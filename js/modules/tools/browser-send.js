(function () {
  "use strict";
  window.XinyangBrowserSend = {
    send: function (hostInvoke, extensionPath) {
      var nodeRequire = typeof require === "function" ? require : window.cep_node && window.cep_node.require;
      if (!nodeRequire) return Promise.reject(new Error("当前 CEP 未启用 Node.js"));
      var cp = nodeRequire("child_process");
      var fs = nodeRequire("fs");
      var path = nodeRequire("path");
      if (nodeRequire("os").platform() !== "win32") return Promise.reject(new Error("发送到浏览器目前仅支持 Windows"));
      var exported;
      return hostInvoke("toolsExportToBrowser", {}).then(function (result) {
        exported = result;
        return new Promise(function (resolve, reject) {
          cp.execFile("powershell.exe", ["-NoProfile", "-STA", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
            path.join(extensionPath, "scripts", "send-browser-image.ps1"), "-ImagePath", result.tempPath],
          { windowsHide: true, timeout: 15000, maxBuffer: 65536 }, function (error, stdout) {
            if (error) reject(new Error("浏览器粘贴未完成，请聚焦对话输入框后重试。" + String(stdout || "").trim()));
            else resolve(result);
          });
        });
      }).then(function (result) {
        try { fs.unlinkSync(exported.tempPath); } catch (ignoreCleanup) {}
        return result;
      }, function (error) {
        if (exported) try { fs.unlinkSync(exported.tempPath); } catch (ignoreCleanup) {}
        throw error;
      });
    }
  };
}());
