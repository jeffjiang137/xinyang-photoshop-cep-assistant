/* 鑫洋助理 OCR 子模块：ocrClient（v2.2.58） */
(function (global) {
  "use strict";

  if (global.XinyangOcrClient) return;

  global.XinyangOcrClient = {
    create: function (deps) {
      deps = deps || {};
      var state = deps.state;
      var $ = deps.$;
      var setStatus = deps.setStatus;
      var setOcrBusy = deps.setOcrBusy;
      var LOCAL_OCR_URL = deps.LOCAL_OCR_URL;
      var getNodeRequire = deps.getNodeRequire;

      function normalizedApiUrl() {
        var value = String($("#ocr-api-url").value || "").trim();
        if (!value) {
          throw new Error("本机 OCR 服务未启动，请先填写 OCR API 请求地址");
        }
        if (!/^https?:\/\//i.test(value)) {
          throw new Error("OCR API 地址必须以 http:// 或 https:// 开头");
        }
        return value;
      }

      function jsonRequest(options) {
        return new Promise(function (resolve, reject) {
          var request = new XMLHttpRequest();
          request.open(options.method || "GET", options.url, true);
          request.timeout = Number(options.timeout) || 8000;
          request.setRequestHeader("Accept", "application/json");
          if (options.payload !== undefined) {
            request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
          }
          if (options.apiKey) {
            request.setRequestHeader("Authorization", "Bearer " + options.apiKey);
          }

          request.onreadystatechange = function () {
            if (request.readyState !== 4) return;
            /*
             * CEP/CEF 在跨域请求被浏览器层拦截时会先进入 readyState 4，
             * 但 status 为 0，随后才触发 onerror。不要把 0 当成真实的
             * HTTP 状态码，否则用户只能看到误导性的“服务返回 0”。
             */
            if (request.status === 0) return;
            if (request.status < 200 || request.status >= 300) {
              reject(new Error(
                (options.label || "OCR 服务") + "返回 " + request.status +
                (request.responseText ? "：" + request.responseText.slice(0, 180) : "")
              ));
              return;
            }
            try {
              var parsed = request.responseText
                ? JSON.parse(request.responseText) : {};
              if (parsed && parsed.ok === false) {
                reject(new Error(
                  parsed.error || parsed.message ||
                  (options.label || "OCR 服务") + "识别失败"
                ));
                return;
              }
              resolve(parsed);
            } catch (error) {
              if (error && error.message &&
                  !/Unexpected|JSON|position|token/i.test(error.message)) {
                reject(error);
                return;
              }
              reject(new Error((options.label || "OCR 服务") + "返回的不是有效 JSON"));
            }
          };
          request.onerror = function () {
            reject(new Error("无法连接" + (options.label || " OCR 服务")));
          };
          request.ontimeout = function () {
            reject(new Error((options.label || "OCR 服务") + "响应超时"));
          };
          request.send(
            options.payload === undefined ? null : JSON.stringify(options.payload)
          );
        });
      }

      function normalizeBase64Data(value, label) {
        var text = String(value || "").trim();
        if (/^data:/i.test(text)) {
          var commaIndex = text.indexOf(",");
          text = commaIndex >= 0 ? text.slice(commaIndex + 1) : "";
        }
        text = text
          .replace(/^\uFEFF/, "")
          .replace(/\s+/g, "")
          .replace(/-/g, "+")
          .replace(/_/g, "/");

        if (!text) {
          throw new Error((label || "图片") + "数据为空");
        }
        if (/[^A-Za-z0-9+\/=]/.test(text)) {
          throw new Error((label || "图片") + "数据包含无效字符");
        }
        var remainder = text.length % 4;
        if (remainder === 1) {
          throw new Error((label || "图片") + " Base64 长度无效");
        }
        while (text.length % 4) text += "=";
        return text;
      }

      function base64ToBlob(base64, type) {
        var normalized = normalizeBase64Data(base64, "OCR 临时图片");
        var binary;
        try {
          binary = atob(normalized);
        } catch (error) {
          throw new Error("OCR 临时图片 Base64 解码失败");
        }
        var bytes = new Uint8Array(binary.length);
        for (var index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        if (
          bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 ||
          bytes[2] !== 78 || bytes[3] !== 71
        ) {
          throw new Error("OCR 临时图片不是有效的 PNG 文件");
        }
        return new Blob([bytes], { type: type || "image/png" });
      }

      function multipartOcrRequest(options) {
        return new Promise(function (resolve, reject) {
          var request = new XMLHttpRequest();
          var form = new FormData();
          form.append(
            "image",
            base64ToBlob(options.imageBase64, "image/png"),
            options.filename || "selected_layer.png"
          );
          if (options.group !== undefined) {
            form.append("group", options.group ? "true" : "false");
          }

          request.open("POST", options.url, true);
          request.timeout = Number(options.timeout) || 180000;
          request.setRequestHeader("Accept", "application/json");
          request.onreadystatechange = function () {
            if (request.readyState !== 4 || request.status === 0) return;
            if (request.status < 200 || request.status >= 300) {
              reject(new Error(
                (options.label || "OCR 服务") + "返回 " + request.status +
                (request.responseText ? "：" + request.responseText.slice(0, 180) : "")
              ));
              return;
            }
            try {
              var parsed = request.responseText
                ? JSON.parse(request.responseText) : {};
              if (parsed && parsed.ok === false) {
                reject(new Error(
                  parsed.error || parsed.message ||
                  (options.label || "OCR 服务") + "识别失败"
                ));
                return;
              }
              resolve(parsed);
            } catch (error) {
              if (error && error.message &&
                  !/Unexpected|JSON|position|token/i.test(error.message)) {
                reject(error);
                return;
              }
              reject(new Error((options.label || "OCR 服务") + "返回的不是有效 JSON"));
            }
          };
          request.onerror = function () {
            reject(new Error(
              "无法读取" + (options.label || " OCR 服务") +
              "的识别结果，请检查服务是否允许本机插件访问"
            ));
          };
          request.ontimeout = function () {
            reject(new Error((options.label || "OCR 服务") + "响应超时"));
          };
          request.send(form);
        });
      }

      function arrayBufferToBase64(buffer) {
        var bytes = new Uint8Array(buffer || new ArrayBuffer(0));
        var binary = "";
        var chunkSize = 8192;
        for (var offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode.apply(
            null,
            bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
          );
        }
        return btoa(binary);
      }

      function arrayBufferToText(buffer) {
        var bytes = new Uint8Array(buffer || new ArrayBuffer(0));
        var binary = "";
        var chunkSize = 8192;
        for (var offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode.apply(
            null,
            bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
          );
        }
        try {
          return decodeURIComponent(escape(binary));
        } catch (error) {
          return binary;
        }
      }

      function imageBase64FromJson(data) {
        var result = data && data.result ? data.result : {};
        var nestedData = data && data.data && typeof data.data === "object"
          ? data.data : {};
        var value =
          (data && (
            data.image || data.image_base64 ||
            data.data_url || data.dataUrl || data.base64 || data.url ||
            (typeof data.data === "string" ? data.data : "")
          )) ||
          result.image || result.image_base64 ||
          result.data_url || result.dataUrl || result.base64 || result.url ||
          nestedData.image || nestedData.image_base64 ||
          nestedData.data_url || nestedData.dataUrl ||
          nestedData.base64 || nestedData.url || "";
        value = String(value || "");
        if (/^data:/i.test(value)) return value.split(",").pop();
        if (/^https?:\/\//i.test(value)) {
          throw new Error("LaMa 返回了远程图片地址，当前插件只接受图片数据");
        }
        if (value) return value;
        throw new Error(
          (data && (data.error || data.message)) ||
          "LaMa 未返回可写入的修复图片"
        );
      }

      function renderLocalOcrStatus() {
        var dot = $("#local-ocr-dot");
        var title = $("#local-ocr-state");
        var detail = $("#local-ocr-detail");
        if (!dot || !title || !detail) return;

        dot.className = "service-dot " + (
          state.localOcrChecking
            ? "checking"
            : state.localOcrAvailable ? "online" : "offline"
        );
        title.textContent = state.localOcrChecking
          ? "正在检测"
          : state.localOcrAvailable ? "已启动" : "未检测到";
        detail.textContent = state.localOcrChecking
          ? "正在连接 " + LOCAL_OCR_URL
          : state.localOcrAvailable
            ? LOCAL_OCR_URL + "，" + (state.localOcrEngine || "PaddleOCR") + " 可用"
            : LOCAL_OCR_URL + " 当前不可用";
      }

      function detectLocalOcr(force, announce) {
        var fresh = Date.now() - state.localOcrCheckedAt < 15000;
        if (!force && fresh) return Promise.resolve(state.localOcrAvailable);
        if (state.localOcrPromise) return state.localOcrPromise;

        state.localOcrChecking = true;
        renderLocalOcrStatus();
        state.localOcrPromise = jsonRequest({
          method: "GET",
          url: LOCAL_OCR_URL + "/health",
          timeout: 2200,
          label: "本机 OCR 服务"
        }).then(function (result) {
          state.localOcrAvailable = true;
          state.localOcrEngine = String(
            result.engine || result.name || "PaddleOCR"
          );
          if (announce) {
            setStatus("本机 OCR 服务可用：" + state.localOcrEngine);
          }
          return true;
        }).catch(function () {
          state.localOcrAvailable = false;
          state.localOcrEngine = "";
          if (announce) {
            setStatus(
              $("#ocr-api-url").value.trim()
                ? "未检测到本机 OCR 服务，识别时将使用已配置 API"
                : "未检测到本机 OCR 服务；可启动现有服务或配置 OCR API"
            );
          }
          return false;
        }).then(function (available) {
          state.localOcrChecking = false;
          state.localOcrCheckedAt = Date.now();
          state.localOcrPromise = null;
          renderLocalOcrStatus();
          setOcrBusy(state.ocrBusy);
          return available;
        });
        return state.localOcrPromise;
      }

      function ocrRequest(payload) {
        function requestConfiguredApi() {
          var apiUrl = normalizedApiUrl();
          var apiKey = String($("#ocr-api-key").value || "").trim();
          return jsonRequest({
            method: "POST",
            url: apiUrl,
            payload: payload,
            apiKey: apiKey,
            timeout: 180000,
            label: "OCR API"
          }).then(function (response) {
            return { response: response, source: "API" };
          });
        }

        return detectLocalOcr(true, false).then(function (localAvailable) {
          if (localAvailable) {
            return multipartOcrRequest({
              url: LOCAL_OCR_URL + "/ocr",
              imageBase64: payload.image_base64,
              filename: payload.filename,
              group: payload.group,
              timeout: 180000,
              label: "本机 OCR 服务"
            }).then(function (response) {
              return { response: response, source: "本机" };
            }).catch(function (localError) {
              /*
               * 健康检查成功不代表识别端点一定可用。若用户已经配置 API，
               * 本机识别失败时继续执行远端回退；未配置时保留本机真实错误。
               */
              if (String($("#ocr-api-url").value || "").trim()) {
                return requestConfiguredApi();
              }
              throw localError;
            });
          }

          return requestConfiguredApi();
        });
      }

      function readFileBase64(path) {
        return new Promise(function (resolve, reject) {
          var filePath = String(path || "");
          if (!filePath) {
            reject(new Error("OCR 临时图片路径为空"));
            return;
          }

          /*
           * Photoshop 27 的部分 CEP 运行环境会忽略 cep.encoding.Base64，
           * 把 PNG 二进制按 UTF-8 文本返回，随后 atob() 会报 Invalid character。
           * 插件已启用 Node.js，因此优先用 fs 读取原始字节再转 Base64。
           */
          var nodeRequire = getNodeRequire();
          if (nodeRequire) {
            try {
              nodeRequire("fs").readFile(filePath, function (error, buffer) {
                if (error) {
                  reject(new Error("无法读取 OCR 临时图片：" + error.message));
                  return;
                }
                if (!buffer || buffer.length < 8) {
                  reject(new Error("OCR 临时图片为空或保存不完整"));
                  return;
                }
                if (
                  buffer[0] !== 137 || buffer[1] !== 80 ||
                  buffer[2] !== 78 || buffer[3] !== 71
                ) {
                  reject(new Error("OCR 临时图片不是有效的 PNG 文件"));
                  return;
                }
                try {
                  resolve(normalizeBase64Data(
                    buffer.toString("base64"),
                    "OCR 临时图片"
                  ));
                } catch (normalizeError) {
                  reject(normalizeError);
                }
              });
              return;
            } catch (nodeError) {
              /* Node 通道异常时继续尝试 CEP 文件接口。 */
            }
          }

          if (!window.cep || !window.cep.fs || !window.cep.fs.readFile) {
            reject(new Error("当前 CEP 运行环境不支持读取 OCR 临时图片"));
            return;
          }
          var encoding = window.cep.encoding && (
            window.cep.encoding.Base64 ||
            window.cep.encoding.BASE64 ||
            window.cep.encoding.base64
          ) || "Base64";
          var result = window.cep.fs.readFile(filePath, encoding);
          if (!result || result.err !== 0) {
            reject(new Error("无法读取 OCR 临时图片（错误码 " +
              (result ? result.err : "unknown") + "）"));
            return;
          }
          try {
            resolve(normalizeBase64Data(result.data, "OCR 临时图片"));
          } catch (error) {
            reject(new Error(
              "CEP 未能按 Base64 读取 OCR 临时图片，请重新安装 v2.2.05"
            ));
          }
        });
      }

      function deleteTempFile(path) {
        try {
          if (path && window.cep && window.cep.fs && window.cep.fs.deleteFile) {
            window.cep.fs.deleteFile(path);
          }
        } catch (error) {}
      }

      function cleanupOcrTemp() {
        if (state.ocrSource && state.ocrSource.tempPath) {
          deleteTempFile(state.ocrSource.tempPath);
        }
      }

      return {
        normalizedApiUrl: normalizedApiUrl,
        jsonRequest: jsonRequest,
        normalizeBase64Data: normalizeBase64Data,
        base64ToBlob: base64ToBlob,
        multipartOcrRequest: multipartOcrRequest,
        arrayBufferToBase64: arrayBufferToBase64,
        arrayBufferToText: arrayBufferToText,
        imageBase64FromJson: imageBase64FromJson,
        renderLocalOcrStatus: renderLocalOcrStatus,
        detectLocalOcr: detectLocalOcr,
        ocrRequest: ocrRequest,
        readFileBase64: readFileBase64,
        deleteTempFile: deleteTempFile,
        cleanupOcrTemp: cleanupOcrTemp
      };
    }
  };
}(window));
