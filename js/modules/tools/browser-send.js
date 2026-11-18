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
      var phase = "photoshop-export";
      return hostInvoke("toolsExportToBrowser", {}).then(function (result) {
        exported = result;
        phase = "clipboard-and-browser";
        return new Promise(function (resolve, reject) {
          cp.execFile("powershell.exe", ["-NoProfile", "-STA", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
            path.join(extensionPath, "scripts", "send-browser-image.ps1"), "-ImagePath", result.tempPath],
          { windowsHide: true, timeout: 30000, maxBuffer: 65536 }, function (error, stdout, stderr) {
            if (error) {
              var details = String(stdout || stderr || (error.killed ? "图片传递超时" : error.message) || "未知错误").trim();
              var failure = new Error(details);
              failure.processDetails = { stdout: String(stdout || ""), stderr: String(stderr || ""),
                exitCode: error.code, signal: error.signal, timedOut: !!error.killed };
              reject(failure);
            }
            else resolve(result);
          });
        });
      }).then(function (result) {
        try { fs.unlinkSync(exported.tempPath); } catch (ignoreCleanup) {}
        return result;
      }, function (error) {
        if (window.XinyangDiagnostics && window.XinyangDiagnostics.log) {
          window.XinyangDiagnostics.log("error", "browser-send.failed", error.message || String(error), {
            phase: phase, error: error, process: error.processDetails || null,
            scope: exported && exported.scope, format: exported && exported.format,
            exportMode: exported && exported.exportMode
          });
        }
        if (exported) try { fs.unlinkSync(exported.tempPath); } catch (ignoreCleanup) {}
        throw error;
      });
    }
  };
}());
