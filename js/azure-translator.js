(function () {
  "use strict";

  if (window.XinyangAzureTranslator) return;

  var DEFAULT_ENDPOINT = "https://api.cognitive.microsofttranslator.com";
  var STORAGE_PREFIX = "xinyang.azureTranslator.";
  var SETTINGS_KEYS = {
    endpoint: STORAGE_PREFIX + "endpoint",
    region: STORAGE_PREFIX + "region",
    sourceLanguage: STORAGE_PREFIX + "sourceLanguage",
    targetLanguage: STORAGE_PREFIX + "targetLanguage"
  };
  var SECRET_FILE_NAME = "azure-translator-secret.json";
  var BufferCtor = null;
  var MAX_REQUEST_CHARACTERS = 50000;
  var MAX_REQUEST_ITEMS = 1000;

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
      zh: "zh-Hans",
      "zh-cn": "zh-Hans",
      "zh_cn": "zh-Hans",
      "zh-hans": "zh-Hans",
      "zh-tw": "zh-Hant",
      "zh_tw": "zh-Hant",
      "zh-hant": "zh-Hant"
    };
    return aliases[language.toLowerCase()] || language;
  }

  function normalizeEndpoint(value) {
    var endpoint = String(value || DEFAULT_ENDPOINT).trim();
    if (!endpoint) endpoint = DEFAULT_ENDPOINT;
    if (!/^https:\/\//i.test(endpoint)) throw new Error("Azure 终结点必须以 https:// 开头");
    return endpoint.replace(/\/+$/, "");
  }

  function normalizeRegion(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  }

  function getUserDataPath() {
    try {
      if (typeof CSInterface !== "undefined" && typeof SystemPath !== "undefined") {
        return new CSInterface().getSystemPath(SystemPath.USER_DATA).replace(/\\/g, "/");
      }
    } catch (error) {}
    var os = safeRequire("os");
    return os && os.homedir ? String(os.homedir()).replace(/\\/g, "/") : "";
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

  function secretPath() {
    var path = safeRequire("path");
    var root = getUserDataPath();
    if (!path || !root) return "";
    return path.join(root, "XinyangAssistant", "config", SECRET_FILE_NAME);
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
    var identity = "xinyang-azure-translator|";
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

  function writeSecret(apiKey) {
    var fs = safeRequire("fs");
    var path = secretPath();
    if (!fs || !path) throw new Error("当前 CEP 环境无法保存 Azure 密钥");
    ensureDirectory(safeRequire("path").dirname(path));
    var plain = String(apiKey || "").trim();
    if (!plain) {
      try { if (fs.existsSync(path)) fs.unlinkSync(path); } catch (error) {}
      return;
    }
    var protectedText = protectWithDpapi(plain);
    var record;
    if (protectedText) {
      record = { version: 1, method: "dpapi", data: protectedText };
    } else {
      var fallback = protectFallback(plain);
      if (!fallback) throw new Error("无法加密保存 Azure 密钥");
      record = { version: 1, method: "aes", iv: fallback.iv, data: fallback.data };
    }
    fs.writeFileSync(path, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 384 });
  }

  function readSecret() {
    var fs = safeRequire("fs");
    var path = secretPath();
    if (!fs || !path || !fs.existsSync(path)) return "";
    try {
      var record = JSON.parse(fs.readFileSync(path, "utf8"));
      if (record.method === "dpapi") return String(unprotectWithDpapi(record.data) || "").trim();
      if (record.method === "aes") return String(unprotectFallback(record) || "").trim();
    } catch (error) {}
    return "";
  }

  function hasSecret() {
    var fs = safeRequire("fs");
    var path = secretPath();
    try {
      return !!(fs && path && fs.existsSync(path) && fs.statSync(path).size > 0);
    } catch (error) {
      return false;
    }
  }

  function getSettings() {
    var endpoint;
    try {
      endpoint = normalizeEndpoint(storageGet(SETTINGS_KEYS.endpoint, DEFAULT_ENDPOINT));
    } catch (error) {
      endpoint = DEFAULT_ENDPOINT;
    }
    return {
      endpoint: endpoint,
      region: normalizeRegion(storageGet(SETTINGS_KEYS.region, "")),
      sourceLanguage: normalizeLanguage(storageGet(SETTINGS_KEYS.sourceLanguage, "auto"), "auto"),
      targetLanguage: normalizeLanguage(storageGet(SETTINGS_KEYS.targetLanguage, "en"), "en"),
      hasKey: hasSecret()
    };
  }

  function emitSettingsChanged(settings) {
    try {
      var event;
      if (typeof CustomEvent === "function") {
        event = new CustomEvent("xinyang:azure-settings-changed", { detail: settings });
      } else {
        event = document.createEvent("CustomEvent");
        event.initCustomEvent("xinyang:azure-settings-changed", false, false, settings);
      }
      window.dispatchEvent(event);
    } catch (error) {}
  }

  function saveSettings(input) {
    var current = getSettings();
    var settings = input || {};
    var endpoint = normalizeEndpoint(settings.endpoint !== undefined ? settings.endpoint : current.endpoint);
    var region = normalizeRegion(settings.region !== undefined ? settings.region : current.region);
    var sourceLanguage = normalizeLanguage(settings.sourceLanguage !== undefined ? settings.sourceLanguage : current.sourceLanguage, "auto");
    var targetLanguage = normalizeLanguage(settings.targetLanguage !== undefined ? settings.targetLanguage : current.targetLanguage, "en");
    if (!targetLanguage || targetLanguage === "auto") throw new Error("请选择有效的目标语言");

    storageSet(SETTINGS_KEYS.endpoint, endpoint);
    storageSet(SETTINGS_KEYS.region, region);
    storageSet(SETTINGS_KEYS.sourceLanguage, sourceLanguage || "auto");
    storageSet(SETTINGS_KEYS.targetLanguage, targetLanguage);
    if (settings.clearKey) writeSecret("");
    else if (String(settings.apiKey || "").trim()) writeSecret(settings.apiKey);

    var saved = getSettings();
    emitSettingsChanged(saved);
    return saved;
  }

  function setLanguagePreferences(sourceLanguage, targetLanguage) {
    var settings = getSettings();
    return saveSettings({
      endpoint: settings.endpoint,
      region: settings.region,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage
    });
  }

  function buildRequestUrl(endpoint, from, to) {
    var base = normalizeEndpoint(endpoint);
    var lower = base.toLowerCase();
    var path;
    if (/\/translate(?:\?|$)/i.test(base)) {
      path = base;
    } else if (lower.indexOf("microsofttranslator.com") >= 0) {
      path = base + "/translate";
    } else if (/\/translator\/text\/v3\.0$/i.test(base)) {
      path = base + "/translate";
    } else {
      path = base + "/translator/text/v3.0/translate";
    }
    var params = [];
    if (!/[?&]api-version=/i.test(path)) params.push("api-version=3.0");
    if (!/[?&]to=/i.test(path)) params.push("to=" + encodeURIComponent(normalizeLanguage(to, "en")));
    var source = normalizeLanguage(from, "auto");
    if (source && source !== "auto" && !/[?&]from=/i.test(path)) params.push("from=" + encodeURIComponent(source));
    if (!params.length) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + params.join("&");
  }

  function makeTraceId() {
    var crypto = safeRequire("crypto");
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    if (crypto && crypto.randomBytes) {
      var value = crypto.randomBytes(16);
      value[6] = (value[6] & 15) | 64;
      value[8] = (value[8] & 63) | 128;
      var hex = value.toString("hex");
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
    }
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function parseAzureError(statusCode, body) {
    var message = "Azure Translator 返回 HTTP " + statusCode;
    try {
      var parsed = JSON.parse(body || "{}");
      if (parsed && parsed.error && parsed.error.message) message = parsed.error.message;
    } catch (error) {}
    if (statusCode === 401 || statusCode === 403) {
      return new Error("Azure Translator 鉴权失败，请检查 API 密钥、区域和终结点");
    }
    if (statusCode === 429) {
      return new Error("Azure Translator 请求过快或已达到 F0 配额，请稍后重试");
    }
    if (statusCode >= 500) {
      return new Error("Azure Translator 服务暂时不可用（" + statusCode + "），请稍后重试");
    }
    return new Error(message);
  }

  function postJson(url, headers, body, timeoutMs) {
    var https = safeRequire("https");
    var URLCtor = safeRequire("url");
    if (!https || !URLCtor || !URLCtor.parse) {
      return Promise.reject(new Error("当前 CEP 环境未启用 Node.js，无法安全调用 Azure Translator"));
    }
    return new Promise(function (resolve, reject) {
      var payload = JSON.stringify(body);
      var parsed = URLCtor.parse(url);
      var options = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.path,
        method: "POST",
        headers: headers
      };
      BufferCtor = BufferCtor || (safeRequire("buffer") && safeRequire("buffer").Buffer);
      if (!BufferCtor) { reject(new Error("当前 CEP 环境缺少 Buffer 支持")); return; }
      options.headers["Content-Length"] = BufferCtor.byteLength(payload, "utf8");
      var settled = false;
      var request = https.request(options, function (response) {
        var chunks = [];
        response.on("data", function (chunk) { chunks.push(chunk); });
        response.on("end", function () {
          if (settled) return;
          settled = true;
          var text = BufferCtor.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(parseAzureError(response.statusCode, text));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(new Error("Azure Translator 返回了无法解析的数据"));
          }
        });
      });
      request.on("error", function (error) {
        if (settled) return;
        settled = true;
        reject(new Error("无法连接 Azure Translator：" + (error && error.message ? error.message : "网络错误")));
      });
      request.setTimeout(Math.max(5000, Number(timeoutMs) || 18000), function () {
        if (settled) return;
        request.destroy(new Error("timeout"));
        settled = true;
        reject(new Error("Azure Translator 请求超时，请检查网络或终结点"));
      });
      request.write(payload, "utf8");
      request.end();
    });
  }

  function chunkTexts(texts) {
    var chunks = [];
    var current = [];
    var count = 0;
    (texts || []).forEach(function (value) {
      var text = String(value === undefined || value === null ? "" : value);
      var length = text.length;
      if (length > MAX_REQUEST_CHARACTERS) {
        throw new Error("单段文字超过 Azure Translator 的 50,000 字符限制");
      }
      if (current.length && (current.length >= MAX_REQUEST_ITEMS || count + length > MAX_REQUEST_CHARACTERS)) {
        chunks.push(current);
        current = [];
        count = 0;
      }
      current.push(text);
      count += length;
    });
    if (current.length) chunks.push(current);
    return chunks;
  }

  function resolveCredentials(overrides) {
    var settings = getSettings();
    overrides = overrides || {};
    var apiKey = String(overrides.apiKey || readSecret() || "").trim();
    if (!apiKey) throw new Error("尚未配置 Azure Translator API 密钥，请到设置页完成配置");
    var endpoint = normalizeEndpoint(overrides.endpoint || settings.endpoint);
    var region = normalizeRegion(overrides.region !== undefined ? overrides.region : settings.region);
    return {
      apiKey: apiKey,
      endpoint: endpoint,
      region: region,
      sourceLanguage: normalizeLanguage(overrides.sourceLanguage || settings.sourceLanguage, "auto"),
      targetLanguage: normalizeLanguage(overrides.targetLanguage || settings.targetLanguage, "en")
    };
  }

  function translateBatch(texts, options) {
    var values = (texts || []).map(function (text) { return String(text === undefined || text === null ? "" : text); });
    if (!values.length) return Promise.resolve([]);
    var credentials;
    try {
      credentials = resolveCredentials(options);
    } catch (error) {
      return Promise.reject(error);
    }
    var chunks;
    try {
      chunks = chunkTexts(values);
    } catch (error) {
      return Promise.reject(error);
    }
    var output = [];
    var sequence = Promise.resolve();
    chunks.forEach(function (chunk) {
      sequence = sequence.then(function () {
        var url = buildRequestUrl(credentials.endpoint, credentials.sourceLanguage, credentials.targetLanguage);
        var headers = {
          "Ocp-Apim-Subscription-Key": credentials.apiKey,
          "Content-Type": "application/json; charset=UTF-8",
          "X-ClientTraceId": makeTraceId()
        };
        if (credentials.region) headers["Ocp-Apim-Subscription-Region"] = credentials.region;
        return postJson(url, headers, chunk.map(function (text) { return { Text: text }; }), 18000).then(function (data) {
          if (!Array.isArray(data) || data.length !== chunk.length) throw new Error("Azure Translator 返回结果数量不一致");
          data.forEach(function (item) {
            var translation = item && item.translations && item.translations[0];
            if (!translation || translation.text === undefined) throw new Error("Azure Translator 返回结果缺少译文");
            output.push({
              text: String(translation.text),
              detectedLanguage: item.detectedLanguage && item.detectedLanguage.language || "",
              detectedScore: item.detectedLanguage && item.detectedLanguage.score || 0
            });
          });
        });
      });
    });
    return sequence.then(function () { return output; });
  }

  function testConnection(input) {
    var settings = input || {};
    var source = normalizeLanguage(settings.sourceLanguage || "zh-Hans", "zh-Hans");
    if (source === "auto") source = "zh-Hans";
    var target = normalizeLanguage(settings.targetLanguage || "en", "en");
    if (target === source) target = target === "en" ? "zh-Hans" : "en";
    return translateBatch(["Azure 翻译连接测试"], {
      apiKey: settings.apiKey,
      endpoint: settings.endpoint,
      region: settings.region,
      sourceLanguage: source,
      targetLanguage: target
    }).then(function (result) {
      return {
        translatedText: result[0] && result[0].text || "",
        detectedLanguage: result[0] && result[0].detectedLanguage || "",
        sourceLanguage: source,
        targetLanguage: target
      };
    });
  }

  window.XinyangAzureTranslator = {
    DEFAULT_ENDPOINT: DEFAULT_ENDPOINT,
    getSettings: getSettings,
    saveSettings: saveSettings,
    clearKey: function () { return saveSettings({ clearKey: true }); },
    setLanguagePreferences: setLanguagePreferences,
    translateBatch: translateBatch,
    testConnection: testConnection,
    normalizeLanguage: normalizeLanguage,
    normalizeEndpoint: normalizeEndpoint,
    normalizeRegion: normalizeRegion,
    buildRequestUrl: buildRequestUrl,
    _readSecretForTest: readSecret,
    _secretPathForTest: secretPath
  };
}());
