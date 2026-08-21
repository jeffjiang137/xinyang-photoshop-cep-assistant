(function () {
  "use strict";

  function CSEvent(type, scope, appId, extensionId) {
    this.type = type || "";
    this.scope = scope || "APPLICATION";
    this.appId = appId || "";
    this.extensionId = extensionId || "";
    this.data = "";
  }

  function CSInterface() {}

  CSInterface.prototype.evalScript = function (script, callback) {
    if (!window.__adobe_cep__) {
      if (callback) callback('{"ok":false,"error":"CEP 主机接口不可用"}');
      return;
    }
    window.__adobe_cep__.evalScript(script, callback || function () {});
  };

  CSInterface.prototype.getSystemPath = function (type) {
    if (!window.__adobe_cep__) return "";
    return decodeURI(window.__adobe_cep__.getSystemPath(type));
  };

  CSInterface.prototype.getExtensionID = function () {
    if (
      !window.__adobe_cep__ ||
      typeof window.__adobe_cep__.getExtensionId !== "function"
    ) {
      return "";
    }
    return window.__adobe_cep__.getExtensionId();
  };

  CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    var value = String(url || "");
    if (!value) return false;
    try {
      if (window.cep && window.cep.util && typeof window.cep.util.openURLInDefaultBrowser === "function") {
        window.cep.util.openURLInDefaultBrowser(value);
        return true;
      }
      if (window.__adobe_cep__ && typeof window.__adobe_cep__.invokeSync === "function") {
        window.__adobe_cep__.invokeSync("openURLInDefaultBrowser", value);
        return true;
      }
    } catch (error) {}
    return false;
  };

  CSInterface.prototype.requestOpenExtension = function (extensionId, params) {
    if (
      !window.__adobe_cep__ ||
      typeof window.__adobe_cep__.requestOpenExtension !== "function"
    ) {
      return false;
    }
    window.__adobe_cep__.requestOpenExtension(
      String(extensionId || ""),
      String(params || "")
    );
    return true;
  };


  CSInterface.prototype.addEventListener = function (type, listener, obj) {
    if (
      !window.__adobe_cep__ ||
      typeof window.__adobe_cep__.addEventListener !== "function"
    ) {
      return false;
    }
    window.__adobe_cep__.addEventListener(String(type || ""), listener, obj);
    return true;
  };

  CSInterface.prototype.removeEventListener = function (type, listener, obj) {
    if (
      !window.__adobe_cep__ ||
      typeof window.__adobe_cep__.removeEventListener !== "function"
    ) {
      return false;
    }
    window.__adobe_cep__.removeEventListener(String(type || ""), listener, obj);
    return true;
  };

  CSInterface.prototype.dispatchEvent = function (event) {
    if (
      !window.__adobe_cep__ ||
      typeof window.__adobe_cep__.dispatchEvent !== "function"
    ) {
      return false;
    }
    if (event && event.data && typeof event.data === "object") {
      event.data = JSON.stringify(event.data);
    }
    window.__adobe_cep__.dispatchEvent(event);
    return true;
  };

  window.SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
  };
  window.CSEvent = CSEvent;
  window.CSInterface = CSInterface;
})();
