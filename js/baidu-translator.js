(function () {
  "use strict";

  if (window.XinyangBaiduTranslator) return;

  var API_ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
  var STORAGE_PREFIX = "xinyang.baiduTranslator.";
  var SETTINGS_KEYS = {
    sourceLanguage: STORAGE_PREFIX + "sourceLanguage",
    targetLanguage: STORAGE_PREFIX + "targetLanguage"
  };
  var CREDENTIAL_FILE_NAME = "baidu-translator.credentials.json";
  var PREFERENCES_FILE_NAME = "baidu-translator.preferences.json";
  var LEGACY_SECRET_FILE_NAME = "baidu-translator-secret.json";
  var BufferCtor = null;
  var migrationChecked = false;
  var MAX_QUERY_CHARACTERS = 900;
  var MAX_BATCH_ITEMS = 20;
  var REQUEST_INTERVAL_MS = 1100;
  var lastRequestAt = 0;

  function safeRequire(name) {
    try {
      return window.require ? window.require(name) : null;
    } catch (error) {
      return null;
    }
  }

  function storageGet(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return value === null || value === undefined ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value === undefined || value === null ? "" : value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function normalizeLanguage(value, fallback) {
    var language = String(value || fallback || "").trim();
    var aliases = {
      "zh": "zh",
      "zh-cn": "zh",
      "zh_cn": "zh",
      "zh-hans": "zh",
      "zh-tw": "cht",
      "zh_tw": "cht",
      "zh-hant": "cht",
      "cht": "cht",
      "en": "en",
      "ja": "jp",
      "jp": "jp",
      "ko": "kor",
      "kor": "kor",
      "fr": "fra",
      "fra": "fra",
      "es": "spa",
      "spa": "spa",
      "vi": "vie",
      "vie": "vie",
      "de": "de",
      "it": "it",
      "ru": "ru",
      "th": "th",
      "auto": "auto"
    };
    return aliases[language.toLowerCase()] || language.toLowerCase();
  }

  function normalizeCepFilePath(value) {
    var text = String(value || "").trim();
    if (!text) return "";
    try { text = decodeURIComponent(text); } catch (ignoreDecode) {}
    if (/^file:\/\//i.test(text)) {
      text = text.replace(/^file:\/\//i, "");
      if (/^\/[A-Za-z]:[\\/]/.test(text)) text = text.slice(1);
    }
    text = text.replace(/\\/g, "/");
    return text;
  }

  function getUserDataPath() {
    try {
      if (typeof CSInterface !== "undefined" && typeof SystemPath !== "undefined") {
        return normalizeCepFilePath(new CSInterface().getSystemPath(SystemPath.USER_DATA));
      }
    } catch (error) {}
    var os = safeRequire("os");
    return os && os.homedir ? normalizeCepFilePath(os.homedir()) : "";
  }

  function environmentPath(name) {
    try {
      var processModule = window.process || safeRequire("process");
      var value = processModule && processModule.env ? processModule.env[name] : "";
      return normalizeCepFilePath(value || "");
    } catch (error) {
      return "";
    }
  }

  function getExtensionPath() {
    try {
      if (typeof CSInterface !== "undefined" && typeof SystemPath !== "undefined") {
        return normalizeCepFilePath(new CSInterface().getSystemPath(SystemPath.EXTENSION));
      }
    } catch (error) {}
    return "";
  }

  function ensureDirectory(directory) {
    var fs = safeRequire("fs");
    var path = safeRequire("path");
    if (!fs || !path || !directory) return false;
    if (fs.existsSync(directory)) return true;
    var parent = path.dirname(directory);
    if (parent && parent !== directory) ensureDirectory(parent);
    try {
      fs.mkdirSync(directory);
      return true;
    } catch (error) {
      return fs.existsSync(directory);
    }
  }

  function externalConfigRoot() {
    var path = safeRequire("path");
    if (!path) return "";
    var root = environmentPath("APPDATA") || getUserDataPath();
    if (!root) return "";
    return path.join(root, "XinyangAssistant", "credentials");
  }

  function credentialPath() {
    var path = safeRequire("path");
    var root = externalConfigRoot();
    return path && root ? path.join(root, CREDENTIAL_FILE_NAME) : "";
  }

  function preferencesPath() {
    var path = safeRequire("path");
    var root = externalConfigRoot();
    return path && root ? path.join(root, PREFERENCES_FILE_NAME) : "";
  }

  function legacyCredentialPaths() {
    var path = safeRequire("path");
    if (!path) return [];
    var output = [];
    var userData = getUserDataPath();
    var extension = getExtensionPath();
    if (userData) output.push(path.join(userData, "XinyangAssistant", "config", LEGACY_SECRET_FILE_NAME));
    if (extension) {
      output.push(path.join(extension, "config", LEGACY_SECRET_FILE_NAME));
      output.push(path.join(extension, LEGACY_SECRET_FILE_NAME));
    }
    return output;
  }

  function writeJsonAtomic(filePath, value) {
    var fs = safeRequire("fs");
    var path = safeRequire("path");
    if (!fs || !path || !filePath) throw new Error("当前 CEP 环境无法写入独立配置文件");
    ensureDirectory(path.dirname(filePath));
    var suffix = ".tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    var temporary = filePath + suffix;
    var backup = filePath + ".bak";
    try {
      if (fs.existsSync(filePath)) {
        try { fs.copyFileSync(filePath, backup); } catch (ignoreBackup) {}
      }
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 384 });
      try {
        fs.renameSync(temporary, filePath);
      } catch (renameError) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (ignoreRemove) {}
        fs.renameSync(temporary, filePath);
      }
      try { fs.chmodSync(filePath, 384); } catch (ignoreChmod) {}
    } finally {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (ignoreCleanup) {}
    }
  }

  function removeFileAndBackup(filePath) {
    var fs = safeRequire("fs");
    if (!fs || !filePath) return;
    [filePath, filePath + ".bak"].forEach(function (candidate) {
      try { if (fs.existsSync(candidate)) fs.unlinkSync(candidate); } catch (ignoreRemove) {}
    });
  }

  function runPowerShell(command, input) {
    var childProcess = safeRequire("child_process");
    if (!childProcess || !childProcess.spawnSync) return null;
    try {
      var result = childProcess.spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        { input: String(input || ""), encoding: "utf8", windowsHide: true, timeout: 8000 }
      );
      if (result && result.status === 0 && result.stdout !== undefined) {
        return String(result.stdout).replace(/[\r\n]+$/g, "");
      }
    } catch (error) {}
    return null;
  }

  function protectWithDpapi(plainText) {
    var command = [
      "$value=[Console]::In.ReadToEnd();",
      "$secure=ConvertTo-SecureString -String $value -AsPlainText -Force;",
      "ConvertFrom-SecureString -SecureString $secure"
    ].join(" ");
    return runPowerShell(command, plainText);
  }

  function unprotectWithDpapi(cipherText) {
    var command = [
      "$value=[Console]::In.ReadToEnd();",
      "$secure=ConvertTo-SecureString -String $value;",
      "$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);",
      "try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}",
      "finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}"
    ].join(" ");
    return runPowerShell(command, cipherText);
  }

  function fallbackKey() {
    var crypto = safeRequire("crypto");
    var os = safeRequire("os");
    if (!crypto) return null;
    var identity = "xinyang-baidu-translator|";
    try {
      identity += (os && os.hostname ? os.hostname() : "") + "|";
      identity += (os && os.userInfo ? os.userInfo().username : "");
    } catch (error) {}
    return crypto.createHash("sha256").update(identity, "utf8").digest();
  }

  function protectFallback(plainText) {
    var crypto = safeRequire("crypto");
    var key = fallbackKey();
    if (!crypto || !key || !crypto.createCipheriv) return null;
    var iv = crypto.randomBytes(16);
    var cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    BufferCtor = BufferCtor || (safeRequire("buffer") && safeRequire("buffer").Buffer);
    if (!BufferCtor) return null;
    var encrypted = BufferCtor.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
    return { iv: iv.toString("base64"), data: encrypted.toString("base64") };
  }

  function unprotectFallback(record) {
    var crypto = safeRequire("crypto");
    var key = fallbackKey();
    if (!crypto || !key || !record || !record.iv || !record.data) return "";
    try {
      BufferCtor = BufferCtor || (safeRequire("buffer") && safeRequire("buffer").Buffer);
      if (!BufferCtor) return "";
      var decipher = crypto.createDecipheriv("aes-256-cbc", key, BufferCtor.from(record.iv, "base64"));
      return BufferCtor.concat([
        decipher.update(BufferCtor.from(record.data, "base64")),
        decipher.final()
      ]).toString("utf8");
    } catch (error) {
      return "";
    }
  }

  function decodeCredentialRecord(record) {
    if (!record || typeof record !== "object") return { appId: "", secretKey: "" };
    try {
      var plain = "";
      if (record.method === "dpapi") plain = String(unprotectWithDpapi(record.data) || "");
      else if (record.method === "aes") plain = String(unprotectFallback(record) || "");
      var parsed = JSON.parse(plain || "{}");
      return {
        appId: String(parsed.appId || "").trim(),
        secretKey: String(parsed.secretKey || "").trim()
      };
    } catch (error) {
      return { appId: "", secretKey: "" };
    }
  }

  function readCredentialFile(filePath) {
    var fs = safeRequire("fs");
    if (!fs || !filePath) return { appId: "", secretKey: "" };
    try {
      if (!fs.existsSync(filePath)) return { appId: "", secretKey: "" };
      return decodeCredentialRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (error) {
      return { appId: "", secretKey: "" };
    }
  }

  function encodeCredentialRecord(appId, secretKey) {
    var plain = JSON.stringify({ appId: String(appId || "").trim(), secretKey: String(secretKey || "").trim() });
    var protectedText = protectWithDpapi(plain);
    if (protectedText) return { version: 2, method: "dpapi", data: protectedText, scope: "current-windows-user" };
    var fallback = protectFallback(plain);
    if (!fallback) throw new Error("无法加密保存百度翻译凭据");
    return { version: 2, method: "aes", iv: fallback.iv, data: fallback.data, scope: "current-device-user" };
  }

  function migrateLegacyCredentials() {
    if (migrationChecked) return;
    migrationChecked = true;
    var fs = safeRequire("fs");
    var currentPath = credentialPath();
    if (!fs || !currentPath || fs.existsSync(currentPath)) return;
    var candidates = legacyCredentialPaths();
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index];
      if (!candidate || candidate === currentPath || !fs.existsSync(candidate)) continue;
      var credentials = readCredentialFile(candidate);
      if (credentials.appId && credentials.secretKey) {
        writeJsonAtomic(currentPath, encodeCredentialRecord(credentials.appId, credentials.secretKey));
        return;
      }
    }
  }

  function writeCredentials(appId, secretKey) {
    var fs = safeRequire("fs");
    var filePath = credentialPath();
    if (!fs || !filePath) throw new Error("当前 CEP 环境无法保存百度翻译凭据");
    var appid = String(appId || "").trim();
    var key = String(secretKey || "").trim();
    if (!appid && !key) {
      removeFileAndBackup(filePath);
      legacyCredentialPaths().forEach(removeFileAndBackup);
      return;
    }
    writeJsonAtomic(filePath, encodeCredentialRecord(appid, key));
  }

  function readCredentials() {
    migrateLegacyCredentials();
    var filePath = credentialPath();
    var credentials = readCredentialFile(filePath);
    if ((!credentials.appId || !credentials.secretKey) && filePath) {
      var backup = readCredentialFile(filePath + ".bak");
      if (backup.appId && backup.secretKey) {
        try { writeJsonAtomic(filePath, encodeCredentialRecord(backup.appId, backup.secretKey)); } catch (ignoreRestore) {}
        return backup;
      }
    }
    return credentials;
  }

  function hasCredentials() {
    var credentials = readCredentials();
    return !!(credentials.appId && credentials.secretKey);
  }

  function maskedAppId(value) {
    var appid = String(value || "");
    if (!appid) return "";
    if (appid.length <= 6) return appid.slice(0, 2) + "***";
    return appid.slice(0, 3) + "***" + appid.slice(-3);
  }

  function readPreferences() {
    var fs = safeRequire("fs");
    var filePath = preferencesPath();
    var sourceLanguage = normalizeLanguage(storageGet(SETTINGS_KEYS.sourceLanguage, "auto"), "auto");
    var targetLanguage = normalizeLanguage(storageGet(SETTINGS_KEYS.targetLanguage, "en"), "en");
    if (fs && filePath) {
      try {
        if (fs.existsSync(filePath)) {
          var saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
          sourceLanguage = normalizeLanguage(saved.sourceLanguage, sourceLanguage);
          targetLanguage = normalizeLanguage(saved.targetLanguage, targetLanguage);
        } else if (fs.existsSync(filePath + ".bak")) {
          var backup = JSON.parse(fs.readFileSync(filePath + ".bak", "utf8"));
          sourceLanguage = normalizeLanguage(backup.sourceLanguage, sourceLanguage);
          targetLanguage = normalizeLanguage(backup.targetLanguage, targetLanguage);
          writeJsonAtomic(filePath, { version: 1, sourceLanguage: sourceLanguage, targetLanguage: targetLanguage });
        } else {
          writeJsonAtomic(filePath, { version: 1, sourceLanguage: sourceLanguage, targetLanguage: targetLanguage });
        }
      } catch (error) {}
    }
    if (!targetLanguage || targetLanguage === "auto") targetLanguage = "en";
    return { sourceLanguage: sourceLanguage || "auto", targetLanguage: targetLanguage };
  }

  function writePreferences(sourceLanguage, targetLanguage) {
    var source = normalizeLanguage(sourceLanguage, "auto") || "auto";
    var target = normalizeLanguage(targetLanguage, "en") || "en";
    if (target === "auto") target = "en";
    storageSet(SETTINGS_KEYS.sourceLanguage, source);
    storageSet(SETTINGS_KEYS.targetLanguage, target);
    var filePath = preferencesPath();
    if (filePath) writeJsonAtomic(filePath, { version: 1, sourceLanguage: source, targetLanguage: target });
  }

  function getStorageInfo() {
    return {
      location: "external-user-profile",
      credentialsPath: credentialPath(),
      preferencesPath: preferencesPath(),
      survivesPluginUpdate: true
    };
  }

  function getSettings() {
    var credentials = readCredentials();
    var preferences = readPreferences();
    return {
      sourceLanguage: preferences.sourceLanguage,
      targetLanguage: preferences.targetLanguage,
      hasCredentials: !!(credentials.appId && credentials.secretKey),
      maskedAppId: maskedAppId(credentials.appId),
      storageLocation: "external-user-profile"
    };
  }

  function emitSettingsChanged(settings) {
    try {
      var event;
      if (typeof CustomEvent === "function") {
        event = new CustomEvent("xinyang:baidu-settings-changed", { detail: settings });
      } else {
        event = document.createEvent("CustomEvent");
        event.initCustomEvent("xinyang:baidu-settings-changed", false, false, settings);
      }
      window.dispatchEvent(event);
    } catch (error) {}
  }

  function saveSettings(input) {
    var current = getSettings();
    var settings = input || {};
    var sourceLanguage = normalizeLanguage(settings.sourceLanguage !== undefined ? settings.sourceLanguage : current.sourceLanguage, "auto");
    var targetLanguage = normalizeLanguage(settings.targetLanguage !== undefined ? settings.targetLanguage : current.targetLanguage, "en");
    if (!targetLanguage || targetLanguage === "auto") throw new Error("请选择有效的目标语言");

    writePreferences(sourceLanguage || "auto", targetLanguage);

    if (settings.clearCredentials) {
      writeCredentials("", "");
    } else {
      var existing = readCredentials();
      var appId = String(settings.appId || "").trim() || existing.appId;
      var secretKey = String(settings.secretKey || "").trim() || existing.secretKey;
      if (String(settings.appId || "").trim() || String(settings.secretKey || "").trim()) {
        if (!appId || !secretKey) throw new Error("APPID 和密钥必须同时填写");
        writeCredentials(appId, secretKey);
      }
    }

    var saved = getSettings();
    emitSettingsChanged(saved);
    return saved;
  }

  function setLanguagePreferences(sourceLanguage, targetLanguage) {
    return saveSettings({ sourceLanguage: sourceLanguage, targetLanguage: targetLanguage });
  }

  function md5(value) {
    var crypto = safeRequire("crypto");
    if (!crypto) throw new Error("当前 CEP 环境缺少加密模块，无法生成百度翻译签名");
    return crypto.createHash("md5").update(String(value), "utf8").digest("hex");
  }

  function makeSalt() {
    var crypto = safeRequire("crypto");
    if (crypto && crypto.randomBytes) return Date.now().toString(36) + crypto.randomBytes(8).toString("hex");
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function formEncode(fields) {
    return Object.keys(fields).map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(String(fields[key] === undefined || fields[key] === null ? "" : fields[key]));
    }).join("&");
  }

  function parseBaiduError(code, message) {
    var map = {
      "52001": "百度翻译请求超时，请稍后重试",
      "52002": "百度翻译系统错误，请稍后重试",
      "52003": "百度翻译 APPID 不存在或尚未开通服务",
      "54000": "百度翻译请求参数不完整",
      "54001": "百度翻译签名错误，请检查 APPID 和密钥",
      "54003": "百度翻译请求过快；标准版每秒最多 1 次",
      "54004": "百度翻译本月免费额度已用完或账户余额不足",
      "54005": "翻译内容过长且请求过于频繁，请稍后重试",
      "58000": "百度翻译客户端 IP 校验失败，请检查控制台 IP 限制",
      "58001": "百度翻译不支持当前语言方向",
      "58002": "百度通用文本翻译服务尚未开通或已关闭",
      "58003": "当前 IP 暂时被百度翻译限制，请次日重试",
      "90107": "百度翻译认证尚未通过或尚未生效"
    };
    return new Error(map[String(code)] || ("百度翻译错误 " + code + (message ? "：" + message : "")));
  }

  function postForm(fields, timeoutMs) {
    var https = safeRequire("https");
    var URLCtor = safeRequire("url");
    if (!https || !URLCtor || !URLCtor.parse) {
      return Promise.reject(new Error("当前 CEP 环境未启用 Node.js，无法安全调用百度翻译"));
    }
    return new Promise(function (resolve, reject) {
      var payload = formEncode(fields);
      var parsed = URLCtor.parse(API_ENDPOINT);
      BufferCtor = BufferCtor || (safeRequire("buffer") && safeRequire("buffer").Buffer);
      if (!BufferCtor) { reject(new Error("当前 CEP 环境缺少 Buffer 支持")); return; }
      var options = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Content-Length": BufferCtor.byteLength(payload, "utf8"),
          "User-Agent": "XinyangAssistant/2.2.05"
        }
      };
      var settled = false;
      var request = https.request(options, function (response) {
        var chunks = [];
        response.on("data", function (chunk) { chunks.push(chunk); });
        response.on("end", function () {
          if (settled) return;
          settled = true;
          var text = BufferCtor.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error("百度翻译返回 HTTP " + response.statusCode));
            return;
          }
          try {
            var data = JSON.parse(text);
            if (data && data.error_code) {
              reject(parseBaiduError(data.error_code, data.error_msg));
              return;
            }
            resolve(data);
          } catch (error) {
            reject(new Error("百度翻译返回了无法解析的数据"));
          }
        });
      });
      request.on("error", function (error) {
        if (settled) return;
        settled = true;
        reject(new Error("无法连接百度翻译：" + (error && error.message ? error.message : "网络错误")));
      });
      request.setTimeout(Math.max(5000, Number(timeoutMs) || 18000), function () {
        if (settled) return;
        settled = true;
        request.destroy();
        reject(new Error("百度翻译请求超时，请检查网络"));
      });
      request.write(payload, "utf8");
      request.end();
    });
  }

  function waitForRateLimit() {
    var now = Date.now();
    var wait = Math.max(0, REQUEST_INTERVAL_MS - (now - lastRequestAt));
    return new Promise(function (resolve) {
      window.setTimeout(function () {
        lastRequestAt = Date.now();
        resolve();
      }, wait);
    });
  }

  function resolveCredentials(overrides) {
    var settings = getSettings();
    var stored = readCredentials();
    overrides = overrides || {};
    var appId = String(overrides.appId || stored.appId || "").trim();
    var secretKey = String(overrides.secretKey || stored.secretKey || "").trim();
    if (!appId || !secretKey) throw new Error("尚未配置百度翻译 APPID 和密钥，请到设置页完成配置");
    return {
      appId: appId,
      secretKey: secretKey,
      sourceLanguage: normalizeLanguage(overrides.sourceLanguage || settings.sourceLanguage, "auto"),
      targetLanguage: normalizeLanguage(overrides.targetLanguage || settings.targetLanguage, "en")
    };
  }

  function makeRequest(query, credentials) {
    var salt = makeSalt();
    var sign = md5(credentials.appId + query + salt + credentials.secretKey);
    return waitForRateLimit().then(function () {
      return postForm({
        q: query,
        from: credentials.sourceLanguage || "auto",
        to: credentials.targetLanguage,
        appid: credentials.appId,
        salt: salt,
        sign: sign
      }, 18000);
    });
  }

  function requestLines(lines, credentials) {
    var query = lines.join("\n");
    return makeRequest(query, credentials).then(function (data) {
      var results = data && data.trans_result;
      if (!Array.isArray(results) || !results.length) throw new Error("百度翻译返回结果为空");
      return results.map(function (item) { return String(item && item.dst !== undefined ? item.dst : ""); });
    });
  }

  function splitIntoBatches(values) {
    var batches = [];
    var current = [];
    var count = 0;
    values.forEach(function (entry) {
      var text = entry.text;
      if (text.length > MAX_QUERY_CHARACTERS) {
        throw new Error("单个文字图层超过 900 字符；百度标准版单次请求最长 1000 字符，请先拆分文字");
      }
      if (text.indexOf("\n") >= 0 || text.indexOf("\r") >= 0) {
        if (current.length) { batches.push(current); current = []; count = 0; }
        batches.push([entry]);
        return;
      }
      var nextCount = count + (current.length ? 1 : 0) + text.length;
      if (current.length && (current.length >= MAX_BATCH_ITEMS || nextCount > MAX_QUERY_CHARACTERS)) {
        batches.push(current);
        current = [];
        count = 0;
      }
      current.push(entry);
      count += (current.length > 1 ? 1 : 0) + text.length;
    });
    if (current.length) batches.push(current);
    return batches;
  }

  function translateBatch(texts, options) {
    var values = (texts || []).map(function (text, index) {
      return { index: index, text: String(text === undefined || text === null ? "" : text) };
    });
    if (!values.length) return Promise.resolve([]);
    var credentials;
    var batches;
    try {
      credentials = resolveCredentials(options);
      batches = splitIntoBatches(values.filter(function (entry) { return entry.text.length > 0; }));
    } catch (error) {
      return Promise.reject(error);
    }

    var output = values.map(function (entry) {
      return { text: entry.text ? "" : "", detectedLanguage: "", detectedScore: 0 };
    });
    var sequence = Promise.resolve();

    batches.forEach(function (batch) {
      sequence = sequence.then(function () {
        return requestLines(batch.map(function (entry) { return entry.text; }), credentials).then(function (translated) {
          if (batch.length === 1) {
            output[batch[0].index] = { text: translated.join("\n"), detectedLanguage: "", detectedScore: 0 };
            return;
          }
          if (translated.length !== batch.length) {
            var fallbackSequence = Promise.resolve();
            batch.forEach(function (entry) {
              fallbackSequence = fallbackSequence.then(function () {
                return requestLines([entry.text], credentials).then(function (single) {
                  output[entry.index] = { text: single.join("\n"), detectedLanguage: "", detectedScore: 0 };
                });
              });
            });
            return fallbackSequence;
          }
          batch.forEach(function (entry, index) {
            output[entry.index] = { text: translated[index], detectedLanguage: "", detectedScore: 0 };
          });
        });
      });
    });

    return sequence.then(function () { return output; });
  }

  function testConnection(input) {
    var settings = input || {};
    var source = normalizeLanguage(settings.sourceLanguage || "zh", "zh");
    if (source === "auto") source = "zh";
    var target = normalizeLanguage(settings.targetLanguage || "en", "en");
    if (target === source) target = target === "en" ? "zh" : "en";
    return translateBatch(["百度翻译连接测试"], {
      appId: settings.appId,
      secretKey: settings.secretKey,
      sourceLanguage: source,
      targetLanguage: target
    }).then(function (result) {
      return {
        translatedText: result[0] && result[0].text || "",
        sourceLanguage: source,
        targetLanguage: target
      };
    });
  }

  window.XinyangBaiduTranslator = {
    API_ENDPOINT: API_ENDPOINT,
    getSettings: getSettings,
    saveSettings: saveSettings,
    clearCredentials: function () { return saveSettings({ clearCredentials: true }); },
    setLanguagePreferences: setLanguagePreferences,
    translateBatch: translateBatch,
    testConnection: testConnection,
    normalizeLanguage: normalizeLanguage,
    getStorageInfo: getStorageInfo,
    _readCredentialsForTest: readCredentials,
    _secretPathForTest: credentialPath,
    _preferencesPathForTest: preferencesPath,
    _legacyCredentialPathsForTest: legacyCredentialPaths,
    _splitIntoBatchesForTest: splitIntoBatches,
    _md5ForTest: md5
  };
}());
