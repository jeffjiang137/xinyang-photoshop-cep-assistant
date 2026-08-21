/* 鑫洋助理 OCR 子模块：lamaClient（v2.2.58） */
(function (global) {
  "use strict";

  if (global.XinyangLamaClient) return;

  global.XinyangLamaClient = {
    create: function (deps) {
      deps = deps || {};
      var state = deps.state;
      var $ = deps.$;
      var setStatus = deps.setStatus;
      var humanError = deps.humanError;
      var setOcrBusy = deps.setOcrBusy;
      var storageSet = deps.storageSet;
      var LOCAL_LAMA_URL = deps.LOCAL_LAMA_URL;
      var LOCAL_IOPAINT_URL = deps.LOCAL_IOPAINT_URL;
      var STORAGE_KEYS = deps.STORAGE_KEYS;
      var getNodeRequire = deps.getNodeRequire;
      var arrayBufferToBase64 = deps.arrayBufferToBase64;
      var arrayBufferToText = deps.arrayBufferToText;
      var base64ToBlob = deps.base64ToBlob;
      var imageBase64FromJson = deps.imageBase64FromJson;
      var jsonRequest = deps.jsonRequest;

      function nodeTransportAvailable() {
        return !!getNodeRequire();
      }

      function normalizeServiceUrl(value, fallback) {
        var text = String(value || fallback || "").trim().replace(/\/+$/, "");
        if (!text) return "";
        if (!/^https?:\/\//i.test(text)) text = "http://" + text;
        return text.replace(/\/+$/, "");
      }

      function currentLamaUrl() {
        return normalizeServiceUrl(state.localLamaUrl, LOCAL_LAMA_URL);
      }

      function parseNodeHttpUrl(url) {
        var nodeRequire = getNodeRequire();
        if (!nodeRequire) throw new Error("CEP Node 通道不可用");
        var parsed = nodeRequire("url").parse(String(url || ""));
        if (!parsed.hostname) throw new Error("LaMa 服务地址无效");
        return {
          parsed: parsed,
          transport: parsed.protocol === "https:" ? nodeRequire("https") : nodeRequire("http")
        };
      }

      function lamaJsonValue(data) {
        var candidates = [];
        var result = data && data.result && typeof data.result === "object"
          ? data.result : {};
        var nested = data && data.data && typeof data.data === "object"
          ? data.data : {};

        function append(source) {
          if (!source || typeof source !== "object") return;
          [
            "image", "image_base64", "imageBase64", "data_url", "dataUrl",
            "base64", "url", "path", "file", "filename", "output",
            "output_path", "outputPath", "result_path", "resultPath"
          ].forEach(function (key) {
            if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
              candidates.push(source[key]);
            }
          });
        }

        append(data);
        append(result);
        append(nested);
        if (data && typeof data.data === "string") candidates.push(data.data);
        return candidates.length ? candidates[0] : "";
      }

      function nodeReadUrlBuffer(url, timeout, redirectCount) {
        return new Promise(function (resolve, reject) {
          var nodeRequire = getNodeRequire();
          if (!nodeRequire) {
            reject(new Error("CEP Node 通道不可用"));
            return;
          }
          var parsed;
          try {
            parsed = nodeRequire("url").parse(String(url || ""));
          } catch (error) {
            reject(error);
            return;
          }
          var protocol = parsed.protocol === "https:" ? nodeRequire("https") : nodeRequire("http");
          var request = protocol.request({
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.path || "/",
            method: "GET",
            headers: { "Accept": "image/png,image/jpeg,application/json,*/*" }
          }, function (response) {
            var status = Number(response.statusCode) || 0;
            if (status >= 300 && status < 400 && response.headers.location && (redirectCount || 0) < 3) {
              response.resume();
              var nextUrl = nodeRequire("url").resolve(url, response.headers.location);
              nodeReadUrlBuffer(nextUrl, timeout, (redirectCount || 0) + 1).then(resolve, reject);
              return;
            }
            var chunks = [];
            response.on("data", function (chunk) { chunks.push(chunk); });
            response.on("end", function () {
              var BufferCtor = nodeRequire("buffer").Buffer;
              var body = BufferCtor.concat(chunks);
              if (status < 200 || status >= 300) {
                reject(new Error("LaMa 图片地址返回 " + status +
                  (body.length ? "：" + body.toString("utf8", 0, 180) : "")));
                return;
              }
              resolve({ body: body, contentType: String(response.headers["content-type"] || "") });
            });
          });
          request.setTimeout(Number(timeout) || 300000, function () {
            request.destroy(new Error("读取 LaMa 图片超时"));
          });
          request.on("error", reject);
          request.end();
        });
      }

      function nodeLamaValueToBase64(value, timeout) {
        return new Promise(function (resolve, reject) {
          var nodeRequire = getNodeRequire();
          if (!nodeRequire) {
            reject(new Error("CEP Node 通道不可用"));
            return;
          }
          var fs = nodeRequire("fs");
          var BufferCtor = nodeRequire("buffer").Buffer;
          var text = String(value || "").trim();
          if (!text) {
            reject(new Error("LaMa 未返回修复图片"));
            return;
          }
          if (/^data:/i.test(text)) {
            resolve(text.split(",").pop());
            return;
          }
          if (/^https?:\/\//i.test(text)) {
            nodeReadUrlBuffer(text, timeout, 0).then(function (result) {
              resolve(result.body.toString("base64"));
            }, reject);
            return;
          }
          if (/^file:\/\//i.test(text)) {
            try { text = decodeURIComponent(text.replace(/^file:\/\//i, "")); } catch (error) {}
            if (/^\/[A-Za-z]:[\\/]/.test(text)) text = text.slice(1);
          }
          function resolveNonFileValue() {
            if (/^\//.test(text)) {
              nodeReadUrlBuffer(currentLamaUrl() + text, timeout, 0).then(function (result) {
                resolve(result.body.toString("base64"));
              }, reject);
              return;
            }
            /* 原始 Base64 结果。去掉空白后再写入，兼容服务换行输出。 */
            text = text.replace(/\s+/g, "");
            try {
              if (!text || BufferCtor.from(text, "base64").length === 0) {
                throw new Error("LaMa 返回的图片数据为空");
              }
              resolve(text);
            } catch (error) {
              reject(new Error("无法解析 LaMa 修复结果：" + error.message));
            }
          }

          /*
           * 旧版用 existsSync/statSync 判断 LaMa 返回值是否为文件路径。
           * 服务若直接返回很长的 Base64，主线程会把整段 Base64 当路径同步
           * 查询；网络盘或异常路径还可能拖住 CEP。仅对合理长度的绝对路径
           * 做异步 stat，并在不存在时回退到相对 URL / Base64 解析。
           */
          var looksLikeFilePath = text.length < 4096 && (
            /^[A-Za-z]:[\/]/.test(text) || /^\\/.test(text) || /^\//.test(text)
          );
          if (looksLikeFilePath) {
            fs.stat(text, function (statError, stats) {
              if (!statError && stats && stats.isFile()) {
                fs.readFile(text, function (readError, buffer) {
                  if (readError) reject(readError);
                  else resolve(buffer.toString("base64"));
                });
                return;
              }
              resolveNonFileValue();
            });
            return;
          }
          resolveNonFileValue();
        });
      }

      function nodeLamaRequest(options) {
        return new Promise(function (resolve, reject) {
          var nodeRequire = getNodeRequire();
          if (!nodeRequire) {
            reject(new Error("CEP Node 通道不可用"));
            return;
          }
          var endpoint;
          try {
            endpoint = parseNodeHttpUrl(currentLamaUrl() + "/inpaint");
          } catch (endpointError) {
            reject(endpointError);
            return;
          }
          var BufferCtor = nodeRequire("buffer").Buffer;
          var boundary = "----XinyangLama" + Date.now() + Math.floor(Math.random() * 1000000);
          var imageBuffer;
          var maskBuffer;
          try {
            imageBuffer = BufferCtor.from(String(options.imageBase64 || "").replace(/\s+/g, ""), "base64");
            maskBuffer = BufferCtor.from(String(options.maskBase64 || "").replace(/\s+/g, ""), "base64");
          } catch (error) {
            reject(new Error("无法读取待擦除图片数据"));
            return;
          }
          if (!imageBuffer.length) {
            reject(new Error("待擦除图片数据为空"));
            return;
          }
          if (!maskBuffer.length) {
            reject(new Error("LaMa 遮罩数据为空"));
            return;
          }

          function textPart(name, value) {
            return BufferCtor.from(
              "--" + boundary + "\r\n" +
              "Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" +
              String(value) + "\r\n",
              "utf8"
            );
          }
          var safeFilename = String(options.filename || "selected_layer.png")
            .replace(/[^A-Za-z0-9._-]/g, "_");
          var imageHead = BufferCtor.from(
            "--" + boundary + "\r\n" +
            "Content-Disposition: form-data; name=\"image\"; filename=\"" + safeFilename + "\"\r\n" +
            "Content-Type: image/png\r\n\r\n",
            "utf8"
          );
          var imageTail = BufferCtor.from("\r\n", "utf8");
          var maskHead = BufferCtor.from(
            "--" + boundary + "\r\n" +
            "Content-Disposition: form-data; name=\"mask\"; filename=\"lama_mask.png\"\r\n" +
            "Content-Type: image/png\r\n\r\n",
            "utf8"
          );
          var maskTail = BufferCtor.from("\r\n", "utf8");
          var ending = BufferCtor.from("--" + boundary + "--\r\n", "utf8");
          var body = BufferCtor.concat([
            imageHead,
            imageBuffer,
            imageTail,
            maskHead,
            maskBuffer,
            maskTail,
            textPart("mode", "lama"),
            textPart("x", Math.max(0, Math.floor(options.box.x))),
            textPart("y", Math.max(0, Math.floor(options.box.y))),
            textPart("width", Math.max(1, Math.ceil(options.box.width))),
            textPart("height", Math.max(1, Math.ceil(options.box.height))),
            ending
          ]);

          var request = endpoint.transport.request({
            protocol: endpoint.parsed.protocol,
            hostname: endpoint.parsed.hostname,
            port: endpoint.parsed.port,
            path: endpoint.parsed.path || "/inpaint",
            method: "POST",
            headers: {
              "Accept": "image/png,image/jpeg,application/json,*/*",
              "Content-Type": "multipart/form-data; boundary=" + boundary,
              "Content-Length": body.length,
              "Connection": "close"
            }
          }, function (response) {
            var chunks = [];
            response.on("data", function (chunk) { chunks.push(chunk); });
            response.on("end", function () {
              var responseBody = BufferCtor.concat(chunks);
              var status = Number(response.statusCode) || 0;
              if (status < 200 || status >= 300) {
                reject(new Error("本机 LaMa 服务返回 " + status +
                  (responseBody.length ? "：" + responseBody.toString("utf8", 0, 180) : "")));
                return;
              }
              var contentType = String(response.headers["content-type"] || "").toLowerCase();
              var text = responseBody.toString("utf8");
              if (contentType.indexOf("json") >= 0 || /^\s*[\{\[]/.test(text)) {
                try {
                  var data = JSON.parse(text || "{}");
                  if (data && data.ok === false) {
                    reject(new Error(data.error || data.message || "LaMa 擦除失败"));
                    return;
                  }
                  var value = lamaJsonValue(data);
                  if (!value) {
                    reject(new Error(data.error || data.message || "LaMa 未返回修复图片"));
                    return;
                  }
                  nodeLamaValueToBase64(value, options.timeout).then(resolve, reject);
                } catch (error) {
                  reject(new Error("LaMa 返回的 JSON 无法解析：" + error.message));
                }
                return;
              }
              if (!responseBody.length) {
                reject(new Error("LaMa 返回的修复图片为空"));
                return;
              }
              resolve(responseBody.toString("base64"));
            });
          });
          request.setTimeout(Number(options.timeout) || 300000, function () {
            request.destroy(new Error("本机 LaMa 擦除响应超时"));
          });
          request.on("error", function (error) {
            reject(new Error("无法通过本机通道读取 LaMa 修复结果：" + error.message));
          });
          request.write(body);
          request.end();
        });
      }

      function nodeLegacyLamaJsonRequest(options) {
        return createRectMaskBase64(options.imageBase64, options.box).then(function (maskBase64) {
          return new Promise(function (resolve, reject) {
            var nodeRequire = getNodeRequire();
            if (!nodeRequire) { reject(new Error("CEP Node 通道不可用")); return; }
            var endpoint;
            try { endpoint = parseNodeHttpUrl(currentLamaUrl() + "/inpaint"); }
            catch (endpointError) { reject(endpointError); return; }
            var BufferCtor = nodeRequire("buffer").Buffer;
            var box = options.box || {};
            var body = BufferCtor.from(JSON.stringify({
              image: String(options.imageBase64 || "").replace(/\s+/g, ""),
              mask: String(maskBase64 || "").replace(/\s+/g, ""),
              mode: "lama",
              x: Math.max(0, Math.floor(Number(box.x) || 0)),
              y: Math.max(0, Math.floor(Number(box.y) || 0)),
              width: Math.max(1, Math.ceil(Number(box.width) || 1)),
              height: Math.max(1, Math.ceil(Number(box.height) || 1)),
              box: {
                x: Math.max(0, Math.floor(Number(box.x) || 0)),
                y: Math.max(0, Math.floor(Number(box.y) || 0)),
                width: Math.max(1, Math.ceil(Number(box.width) || 1)),
                height: Math.max(1, Math.ceil(Number(box.height) || 1))
              }
            }), "utf8");
            var request = endpoint.transport.request({
              protocol: endpoint.parsed.protocol,
              hostname: endpoint.parsed.hostname,
              port: endpoint.parsed.port,
              path: endpoint.parsed.path || "/inpaint",
              method: "POST",
              headers: {
                "Accept": "image/png,image/jpeg,application/json,*/*",
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": body.length,
                "Connection": "close"
              }
            }, function (response) {
              var chunks = [];
              response.on("data", function (chunk) { chunks.push(chunk); });
              response.on("end", function () {
                var responseBody = BufferCtor.concat(chunks);
                var status = Number(response.statusCode) || 0;
                if (status < 200 || status >= 300) {
                  reject(new Error("LaMa JSON 通道返回 " + status + (responseBody.length ? "：" + responseBody.toString("utf8", 0, 220) : "")));
                  return;
                }
                var contentType = String(response.headers["content-type"] || "").toLowerCase();
                var text = responseBody.toString("utf8");
                if (contentType.indexOf("json") >= 0 || /^\s*[\{\[]/.test(text)) {
                  try {
                    var data = JSON.parse(text || "{}");
                    if (data && data.ok === false) throw new Error(data.error || data.message || "LaMa 擦除失败");
                    var value = lamaJsonValue(data);
                    if (!value) throw new Error(data.error || data.message || "LaMa 未返回修复图片");
                    nodeLamaValueToBase64(value, options.timeout).then(resolve, reject);
                  } catch (error) { reject(error); }
                  return;
                }
                if (!responseBody.length) { reject(new Error("LaMa JSON 通道返回空结果")); return; }
                resolve(responseBody.toString("base64"));
              });
            });
            request.setTimeout(Number(options.timeout) || 300000, function () { request.destroy(new Error("LaMa JSON 通道响应超时")); });
            request.on("error", function (error) { reject(new Error("LaMa JSON 通道失败：" + error.message)); });
            request.write(body);
            request.end();
          });
        });
      }

      function nodeLamaHealthRequest(baseUrl, path) {
        return new Promise(function (resolve, reject) {
          var nodeRequire = getNodeRequire();
          if (!nodeRequire) {
            reject(new Error("CEP Node 通道不可用"));
            return;
          }
          var endpoint;
          try {
            endpoint = parseNodeHttpUrl(normalizeServiceUrl(baseUrl, LOCAL_LAMA_URL) + path);
          } catch (endpointError) {
            reject(endpointError);
            return;
          }
          var request = endpoint.transport.request({
            protocol: endpoint.parsed.protocol,
            hostname: endpoint.parsed.hostname,
            port: endpoint.parsed.port,
            path: endpoint.parsed.path || path,
            method: "GET",
            headers: { "Accept": "application/json,text/plain,*/*", "Connection": "close" }
          }, function (response) {
            var chunks = [];
            response.on("data", function (chunk) { chunks.push(chunk); });
            response.on("end", function () {
              var BufferCtor = nodeRequire("buffer").Buffer;
              var body = BufferCtor.concat(chunks).toString("utf8");
              var status = Number(response.statusCode) || 0;
              if (status < 200 || status >= 300) {
                reject(new Error("本机 LaMa 服务返回 " + status));
                return;
              }
              try {
                resolve(body ? JSON.parse(body) : {});
              } catch (error) {
                resolve({ name: body || "LaMa" });
              }
            });
          });
          request.setTimeout(2400, function () {
            request.destroy(new Error("本机 LaMa 服务检测超时"));
          });
          request.on("error", reject);
          request.end();
        });
      }

      function nodeLamaEndpointProbe(baseUrl, path) {
        return new Promise(function (resolve, reject) {
          var nodeRequire = getNodeRequire();
          if (!nodeRequire) {
            resolve(true);
            return;
          }
          var endpoint;
          try {
            endpoint = parseNodeHttpUrl(normalizeServiceUrl(baseUrl, LOCAL_LAMA_URL) + path);
          } catch (endpointError) {
            reject(endpointError);
            return;
          }
          var request = endpoint.transport.request({
            protocol: endpoint.parsed.protocol,
            hostname: endpoint.parsed.hostname,
            port: endpoint.parsed.port,
            path: endpoint.parsed.path || path,
            method: "OPTIONS",
            headers: { "Accept": "*/*", "Connection": "close" }
          }, function (response) {
            var status = Number(response.statusCode) || 0;
            response.resume();
            /* 200/204 是正常 OPTIONS；405 表示路由存在但不允许 OPTIONS。 */
            if ((status >= 200 && status < 300) || status === 405) {
              resolve(true);
              return;
            }
            reject(new Error("LaMa 擦除接口不可用（HTTP " + status + "）"));
          });
          request.setTimeout(2400, function () {
            request.destroy(new Error("LaMa 擦除接口检测超时"));
          });
          request.on("error", reject);
          request.end();
        });
      }

      function loadBase64Image(base64, label) {
        return new Promise(function (resolve, reject) {
          var image = new Image();
          image.onload = function () { resolve(image); };
          image.onerror = function () {
            reject(new Error("无法解析" + (label || "LaMa 图片")));
          };
          image.src = "data:image/png;base64," + String(base64 || "").replace(/\s+/g, "");
        });
      }

      function canvasPngBase64(canvas) {
        var value = String(canvas.toDataURL("image/png") || "");
        var comma = value.indexOf(",");
        if (comma < 0 || !value.slice(comma + 1)) {
          throw new Error("无法生成 LaMa 裁剪图片");
        }
        return value.slice(comma + 1);
      }

      function createCroppedLamaSession(options) {
        return loadBase64Image(options.imageBase64, "待擦除图片").then(function (sourceImage) {
          var imageWidth = Math.max(1, sourceImage.naturalWidth || sourceImage.width || 1);
          var imageHeight = Math.max(1, sourceImage.naturalHeight || sourceImage.height || 1);
          var box = options.box || {};
          var boxWidth = Math.max(1, Math.ceil(Number(box.width) || 1));
          var boxHeight = Math.max(1, Math.ceil(Number(box.height) || 1));
          var paddingX = Math.max(64, Math.min(320, Math.ceil(boxWidth * 0.55)));
          var paddingY = Math.max(64, Math.min(256, Math.ceil(boxHeight * 1.8)));
          var left = Math.max(0, Math.floor((Number(box.x) || 0) - paddingX));
          var top = Math.max(0, Math.floor((Number(box.y) || 0) - paddingY));
          var right = Math.min(imageWidth, Math.ceil((Number(box.x) || 0) + boxWidth + paddingX));
          var bottom = Math.min(imageHeight, Math.ceil((Number(box.y) || 0) + boxHeight + paddingY));
          var cropWidth = Math.max(1, right - left);
          var cropHeight = Math.max(1, bottom - top);

          /* 本地 1.0.40 LaMa ONNX 服务使用固定 512×512 输入。旧版把
             原尺寸长图或不规则裁剪直接上传，会在 ONNX 推理前断开 socket。 */
          var modelSize = 512;
          var scaleX = modelSize / cropWidth;
          var scaleY = modelSize / cropHeight;
          var cropCanvas = document.createElement("canvas");
          var cropContext;
          cropCanvas.width = modelSize;
          cropCanvas.height = modelSize;
          cropContext = cropCanvas.getContext("2d");
          if (!cropContext) throw new Error("无法创建 LaMa 局部画布");
          cropContext.drawImage(sourceImage, left, top, cropWidth, cropHeight, 0, 0, modelSize, modelSize);
          var cropBase64 = canvasPngBase64(cropCanvas);
          cropCanvas.width = 1;
          cropCanvas.height = 1;

          return {
            options: {
              imageBase64: cropBase64,
              filename: "lama_512_" + Date.now() + ".png",
              box: {
                x: Math.max(0, Math.round(((Number(box.x) || 0) - left) * scaleX)),
                y: Math.max(0, Math.round(((Number(box.y) || 0) - top) * scaleY)),
                width: Math.max(1, Math.round(boxWidth * scaleX)),
                height: Math.max(1, Math.round(boxHeight * scaleY))
              },
              timeout: options.timeout
            },
            merge: function (repairedCropBase64) {
              return loadBase64Image(repairedCropBase64, "LaMa 局部修复结果").then(function (repairedImage) {
                var resultCanvas = document.createElement("canvas");
                var resultContext;
                resultCanvas.width = imageWidth;
                resultCanvas.height = imageHeight;
                resultContext = resultCanvas.getContext("2d");
                if (!resultContext) throw new Error("无法创建 LaMa 结果画布");
                resultContext.drawImage(sourceImage, 0, 0);
                resultContext.drawImage(repairedImage, 0, 0, repairedImage.naturalWidth || repairedImage.width, repairedImage.naturalHeight || repairedImage.height, left, top, cropWidth, cropHeight);
                var merged = canvasPngBase64(resultCanvas);
                resultCanvas.width = 1;
                resultCanvas.height = 1;
                try { sourceImage.src = ""; repairedImage.src = ""; } catch (error) {}
                return merged;
              });
            }
          };
        });
      }

      function isLamaTransportFailure(error) {
        return /(无法通过本机通道|无法连接 IOPaint|无法读取本机 LaMa|CEP Node 通道不可用|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|socket hang up|aborted|Parse Error|HPE_|413|request entity too large|too large|响应超时)/i
          .test(humanError(error));
      }

      function croppedLamaFallback(options, rawNodeRequest, rawXhrRequest) {
        return createCroppedLamaSession(options).then(function (session) {
          var requestPromise = nodeTransportAvailable()
            ? rawNodeRequest(session.options).catch(function (nodeError) {
                if (!rawXhrRequest || !isLamaTransportFailure(nodeError)) throw nodeError;
                return rawXhrRequest(session.options).catch(function (xhrError) {
                  throw new Error(humanError(nodeError) + "；局部兼容通道也失败：" + humanError(xhrError));
                });
              })
            : rawXhrRequest(session.options);
          return requestPromise.then(session.merge);
        });
      }

      function multipartLamaXhrRequest(options) {
        return new Promise(function (resolve, reject) {
          var request = new XMLHttpRequest();
          var form = new FormData();
          form.append(
            "image",
            base64ToBlob(options.imageBase64, "image/png"),
            options.filename || "selected_layer.png"
          );
          form.append(
            "mask",
            base64ToBlob(options.maskBase64, "image/png"),
            "lama_mask.png"
          );
          form.append("mode", "lama");
          form.append("x", String(Math.max(0, Math.floor(options.box.x))));
          form.append("y", String(Math.max(0, Math.floor(options.box.y))));
          form.append("width", String(Math.max(1, Math.ceil(options.box.width))));
          form.append("height", String(Math.max(1, Math.ceil(options.box.height))));

          request.open("POST", currentLamaUrl() + "/inpaint", true);
          request.timeout = Number(options.timeout) || 300000;
          request.responseType = "arraybuffer";
          request.onreadystatechange = function () {
            if (request.readyState !== 4 || request.status === 0) return;
            if (request.status < 200 || request.status >= 300) {
              var errorText = arrayBufferToText(request.response).slice(0, 180);
              reject(new Error(
                "本机 LaMa 服务返回 " + request.status +
                (errorText ? "：" + errorText : "")
              ));
              return;
            }
            try {
              var contentType = String(
                request.getResponseHeader("Content-Type") || ""
              ).toLowerCase();
              var responseText = arrayBufferToText(request.response);
              if (contentType.indexOf("json") >= 0 ||
                  /^\s*[\{\[]/.test(responseText)) {
                resolve(imageBase64FromJson(
                  JSON.parse(responseText || "{}")
                ));
                return;
              }
              var binaryBase64 = arrayBufferToBase64(request.response);
              if (!binaryBase64) {
                throw new Error("LaMa 返回的修复图片为空");
              }
              resolve(binaryBase64);
            } catch (error) {
              reject(error);
            }
          };
          request.onerror = function () {
            reject(new Error(
              "无法读取本机 LaMa 修复结果，请检查服务地址与跨域设置"
            ));
          };
          request.ontimeout = function () {
            reject(new Error("本机 LaMa 擦除响应超时"));
          };
          request.send(form);
        });
      }

      function createRectMaskBase64(imageBase64, box) {
        return new Promise(function (resolve, reject) {
          var image = new Image();
          image.onload = function () {
            try {
              var canvas = document.createElement("canvas");
              canvas.width = Math.max(1, image.naturalWidth || image.width || 1);
              canvas.height = Math.max(1, image.naturalHeight || image.height || 1);
              var context = canvas.getContext("2d");
              if (!context) throw new Error("无法创建 LaMa 蒙版画布");
              context.fillStyle = "#000000";
              context.fillRect(0, 0, canvas.width, canvas.height);
              var left = Math.max(0, Math.floor(Number(box && box.x) || 0));
              var top = Math.max(0, Math.floor(Number(box && box.y) || 0));
              var width = Math.max(1, Math.ceil(Number(box && box.width) || 1));
              var height = Math.max(1, Math.ceil(Number(box && box.height) || 1));
              width = Math.min(width, canvas.width - left);
              height = Math.min(height, canvas.height - top);
              context.fillStyle = "#ffffff";
              context.fillRect(left, top, Math.max(1, width), Math.max(1, height));
              resolve(String(canvas.toDataURL("image/png") || "").split(",").pop());
            } catch (error) {
              reject(error);
            }
          };
          image.onerror = function () {
            reject(new Error("无法解析待擦除图片，未生成 IOPaint 蒙版"));
          };
          image.src = "data:image/png;base64," + String(imageBase64 || "").replace(/\s+/g, "");
        });
      }

      function nodeIopaintRequest(options) {
        return createRectMaskBase64(options.imageBase64, options.box).then(function (maskBase64) {
          return new Promise(function (resolve, reject) {
            var nodeRequire = getNodeRequire();
            if (!nodeRequire) {
              reject(new Error("CEP Node 通道不可用"));
              return;
            }
            var endpoint;
            try {
              endpoint = parseNodeHttpUrl(currentLamaUrl() + "/api/v1/inpaint");
            } catch (endpointError) {
              reject(endpointError);
              return;
            }
            var BufferCtor = nodeRequire("buffer").Buffer;
            var requestBody = BufferCtor.from(JSON.stringify({
              image: String(options.imageBase64 || "").replace(/\s+/g, ""),
              mask: String(maskBase64 || "").replace(/\s+/g, ""),
              hd_strategy: "Crop",
              hd_strategy_crop_margin: 128,
              hd_strategy_crop_trigger_size: 800,
              hd_strategy_resize_limit: 1280
            }), "utf8");
            var request = endpoint.transport.request({
              protocol: endpoint.parsed.protocol,
              hostname: endpoint.parsed.hostname,
              port: endpoint.parsed.port,
              path: endpoint.parsed.path || "/api/v1/inpaint",
              method: "POST",
              headers: {
                "Accept": "image/png,image/jpeg,*/*",
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": requestBody.length,
                "Connection": "close"
              }
            }, function (response) {
              var chunks = [];
              response.on("data", function (chunk) { chunks.push(chunk); });
              response.on("end", function () {
                var body = BufferCtor.concat(chunks);
                var status = Number(response.statusCode) || 0;
                if (status < 200 || status >= 300) {
                  reject(new Error("IOPaint 返回 " + status + (body.length ? "：" + body.toString("utf8", 0, 240) : "")));
                  return;
                }
                if (!body.length) {
                  reject(new Error("IOPaint 返回的修复图片为空"));
                  return;
                }
                resolve(body.toString("base64"));
              });
            });
            request.setTimeout(Number(options.timeout) || 300000, function () {
              request.destroy(new Error("IOPaint 擦除响应超时"));
            });
            request.on("error", function (error) {
              reject(new Error("无法连接 IOPaint：" + error.message));
            });
            request.write(requestBody);
            request.end();
          });
        });
      }

      function xhrIopaintRequest(options) {
        return createRectMaskBase64(options.imageBase64, options.box).then(function (maskBase64) {
          return new Promise(function (resolve, reject) {
            var request = new XMLHttpRequest();
            request.open("POST", currentLamaUrl() + "/api/v1/inpaint", true);
            request.timeout = Number(options.timeout) || 300000;
            request.responseType = "arraybuffer";
            request.setRequestHeader("Content-Type", "application/json; charset=utf-8");
            request.onreadystatechange = function () {
              if (request.readyState !== 4 || request.status === 0) return;
              if (request.status < 200 || request.status >= 300) {
                reject(new Error("IOPaint 返回 " + request.status + "：" + arrayBufferToText(request.response).slice(0, 240)));
                return;
              }
              var result = arrayBufferToBase64(request.response);
              if (!result) reject(new Error("IOPaint 返回的修复图片为空"));
              else resolve(result);
            };
            request.onerror = function () { reject(new Error("无法连接 IOPaint 服务")); };
            request.ontimeout = function () { reject(new Error("IOPaint 擦除响应超时")); };
            request.send(JSON.stringify({
              image: String(options.imageBase64 || "").replace(/\s+/g, ""),
              mask: String(maskBase64 || "").replace(/\s+/g, ""),
              hd_strategy: "Crop",
              hd_strategy_crop_margin: 128,
              hd_strategy_crop_trigger_size: 800,
              hd_strategy_resize_limit: 1280
            }));
          });
        });
      }

      function multipartLamaRequest(options) {
        if (state.localLamaProtocol === "iopaint") {
          if (nodeTransportAvailable()) {
            return nodeIopaintRequest(options).catch(function (nodeError) {
              if (!isLamaTransportFailure(nodeError)) throw nodeError;
              return croppedLamaFallback(options, nodeIopaintRequest, xhrIopaintRequest);
            });
          }
          return xhrIopaintRequest(options);
        }

        /* 8867 旧版服务统一先生成 512×512 局部输入，避免长图与动态尺寸
           直接触发 ONNX 服务 socket hang up。multipart 失败后自动尝试 JSON。 */
        return createCroppedLamaSession(options).then(function (session) {
          function requestLegacy() {
            return createRectMaskBase64(session.options.imageBase64, session.options.box).then(function (maskBase64) {
              var requestOptions = Object.assign({}, session.options, { maskBase64: maskBase64 });
              if (!nodeTransportAvailable()) return multipartLamaXhrRequest(requestOptions);
              return nodeLamaRequest(requestOptions).catch(function (multipartError) {
              return new Promise(function (resolve) { window.setTimeout(resolve, 260); }).then(function () {
                return nodeLegacyLamaJsonRequest(session.options);
              }).catch(function (jsonError) {
                return multipartLamaXhrRequest(requestOptions).catch(function (xhrError) {
                  throw new Error(
                    "LaMa multipart：" + humanError(multipartError) +
                    "；JSON：" + humanError(jsonError) +
                    "；XHR：" + humanError(xhrError)
                  );
                });
              });
              });
            });
          }
          return requestLegacy().then(session.merge);
        });
      }

      function renderLocalLamaStatus() {
        var dot = $("#local-lama-dot");
        var title = $("#local-lama-state");
        var detail = $("#local-lama-detail");
        var installInput = $("#iopaint-install-path");
        var stopButton = $("#stop-local-iopaint");
        if (!dot || !title || !detail) return;
        var serviceUrl = currentLamaUrl();
        var protocolLabel = state.localLamaProtocol === "iopaint" ? "IOPaint" : "LaMa";
        var checking = state.localLamaChecking || state.iopaintInstallChecking || state.iopaintInstallBusy;
        var managedRunning = !!(state.iopaintProcess && state.iopaintProcessPid);
        var reachable = !!(state.localLamaReachable || state.localLamaAvailable);
        var faultFresh = !!(state.localLamaFault && Date.now() - state.localLamaFaultAt < 120000);

        if (installInput) {
          installInput.value = state.iopaintInstallPath || "";
          installInput.title = state.iopaintInstallPath || "尚未下载本地模型";
        }
        if (stopButton) stopButton.hidden = !managedRunning;

        dot.className = "service-dot " + (
          checking ? "checking"
            : reachable && state.localLamaRouteVerified && !faultFresh ? "online"
              : reachable ? "standby"
                : state.iopaintInstalled ? "standby" : "offline"
        );
        title.textContent = checking
          ? (state.iopaintInstallBusy ? "正在安装" : "正在检测")
          : reachable
            ? "已启动"
            : state.iopaintInstalled ? "已下载，待使用" : "未下载";
        detail.textContent = checking
          ? (state.iopaintInstallBusy ? "正在准备独立运行环境与 LaMa 模型" : "正在检测本地模型与服务")
          : reachable
            ? faultFresh
              ? serviceUrl + " 服务可达，但上次擦除失败：" + state.localLamaFault
              : state.localLamaRouteVerified
                ? serviceUrl + "，" + protocolLabel + " / " + (state.localLamaEngine || "lama") + " 可用；空闲 " + state.iopaintIdleMinutes + " 分钟自动关闭"
                : serviceUrl + " 服务已启动；" + (state.localLamaRouteNote || "擦除接口将在首次使用时验证")
            : state.iopaintInstalled
              ? "执行 LaMa 擦除时自动启动，空闲 " + state.iopaintIdleMinutes + " 分钟自动关闭"
              : "选择安装位置后下载本地运行环境与 LaMa 模型";
      }

      function lamaServiceCandidates() {
        var healthy = [];
        var faulted = [];
        var input = $("#lama-service-url");
        var configured = normalizeServiceUrl(input ? input.value : "", "");
        [configured, state.localLamaUrl, LOCAL_LAMA_URL, LOCAL_IOPAINT_URL].forEach(function (value) {
          value = normalizeServiceUrl(value, "");
          if (!value || healthy.indexOf(value) >= 0 || faulted.indexOf(value) >= 0) return;
          var faultFresh = state.localLamaFaultUrl === value && Date.now() - state.localLamaFaultAt < 120000;
          /* 实际擦除失败的地址仍保留为候选，只是排在其他服务之后，避免状态检测后永远无法重试。 */
          (faultFresh ? faulted : healthy).push(value);
        });
        return healthy.concat(faulted);
      }

      function probeLamaUrl(baseUrl, path) {
        if (nodeTransportAvailable()) return nodeLamaHealthRequest(baseUrl, path);
        return jsonRequest({
          method: "GET",
          url: normalizeServiceUrl(baseUrl, LOCAL_LAMA_URL) + path,
          timeout: 2400,
          label: "本机 LaMa 服务"
        });
      }

      function probeLamaCandidate(baseUrl) {
        var preferIopaint = /:8080(?:\/|$)/.test(baseUrl);

        function discoverOpenApi(healthResult) {
          return probeLamaUrl(baseUrl, "/openapi.json").then(function (spec) {
            var paths = spec && spec.paths ? spec.paths : {};
            if (paths["/api/v1/inpaint"]) {
              return {
                url: baseUrl, protocol: "iopaint", result: healthResult || {},
                verified: true, note: "已通过 OpenAPI 验证擦除接口"
              };
            }
            if (paths["/inpaint"]) {
              return {
                url: baseUrl, protocol: "legacy", result: healthResult || {},
                verified: true, note: "已通过 OpenAPI 验证擦除接口"
              };
            }
            throw new Error("OpenAPI 未声明擦除接口");
          });
        }

        function legacy() {
          var healthResult = null;
          return probeLamaUrl(baseUrl, "/health").catch(function () {
            return probeLamaUrl(baseUrl, "/inpaint/health");
          }).then(function (result) {
            healthResult = result || {};
            return discoverOpenApi(healthResult).catch(function () {
              /*
               * 一些旧版 Flask/FastAPI 服务不响应 OPTIONS，也不公开 OpenAPI，
               * 但健康页与真实 POST /inpaint 均可用。端点探测失败不能把已启动
               * 的模型误判为离线，真实能力在首次擦除时验证。
               */
              return nodeLamaEndpointProbe(baseUrl, "/inpaint").then(function () {
                return {
                  url: baseUrl, protocol: "legacy", result: healthResult || {},
                  verified: true, note: "已验证擦除路由"
                };
              }).catch(function (probeError) {
                return {
                  url: baseUrl, protocol: "legacy", result: healthResult || {},
                  verified: false,
                  note: "健康检查正常，服务不支持接口预检；首次擦除时自动验证"
                };
              });
            });
          });
        }
        function iopaint() {
          return probeLamaUrl(baseUrl, "/api/v1/model").then(function (result) {
            return {
              url: baseUrl, protocol: "iopaint", result: result || {},
              verified: true, note: "IOPaint 接口可用"
            };
          });
        }
        return preferIopaint
          ? iopaint().catch(legacy)
          : legacy().catch(iopaint);
      }

      function detectLocalLama(force, announce) {
        var fresh = Date.now() - state.localLamaCheckedAt < 15000;
        if (!force && fresh) return Promise.resolve(state.localLamaAvailable);
        if (state.localLamaPromise) return state.localLamaPromise;

        state.localLamaChecking = true;
        renderLocalLamaStatus();
        var candidates = lamaServiceCandidates();

        function nextCandidate(index, previousError) {
          if (index >= candidates.length) {
            return Promise.reject(previousError || new Error("未检测到 LaMa 服务"));
          }
          return probeLamaCandidate(candidates[index]).catch(function (error) {
            return nextCandidate(index + 1, error);
          });
        }

        state.localLamaPromise = nextCandidate(0).then(function (found) {
          var result = found.result || {};
          var foundUrl = normalizeServiceUrl(found.url, LOCAL_LAMA_URL);
          var keepRecentFault = state.localLamaFaultUrl === foundUrl &&
            state.localLamaFault && Date.now() - state.localLamaFaultAt < 120000;
          state.localLamaReachable = true;
          state.localLamaAvailable = true;
          state.localLamaRouteVerified = found.verified !== false;
          state.localLamaRouteNote = String(found.note || "");
          if (!keepRecentFault) {
            state.localLamaFault = "";
            state.localLamaFaultUrl = "";
            state.localLamaFaultAt = 0;
          }
          state.localLamaUrl = foundUrl;
          state.localLamaProtocol = found.protocol || "legacy";
          state.localLamaEngine = String(
            result.name || result.model || result.engine || "lama"
          );
          storageSet(STORAGE_KEYS.lamaServiceUrl, state.localLamaUrl);
          var input = $("#lama-service-url");
          if (input) input.value = state.localLamaUrl;
          if (announce) {
            setStatus((state.localLamaProtocol === "iopaint" ? "IOPaint" : "LaMa") +
              (state.localLamaRouteVerified ? " 服务可用：" : " 服务已启动，擦除接口待验证：") +
              state.localLamaEngine);
          }
          return true;
        }).catch(function () {
          state.localLamaReachable = false;
          state.localLamaAvailable = false;
          state.localLamaRouteVerified = false;
          state.localLamaRouteNote = "";
          state.localLamaEngine = "";
          if (announce) {
            setStatus("未检测到 LaMa/IOPaint；已保留其他三种擦除方式");
          }
          return false;
        }).then(function (available) {
          state.localLamaChecking = false;
          state.localLamaCheckedAt = Date.now();
          state.localLamaPromise = null;
          renderLocalLamaStatus();
          setOcrBusy(state.ocrBusy);
          return available;
        });
        return state.localLamaPromise;
      }

      function writeTempPng(base64, sourcePath) {
        if (!window.cep || !window.cep.fs || !window.cep.fs.writeFile) {
          throw new Error("当前 CEP 运行环境不支持保存 LaMa 修复图片");
        }
        var folder = String(sourcePath || "").replace(/[\\\/][^\\\/]+$/, "");
        var separator = folder.indexOf("\\") >= 0 ? "\\" : "/";
        var output = folder + separator + "ps_lama_inpaint_" +
          Date.now() + ".png";
        var result = window.cep.fs.writeFile(
          output,
          String(base64 || ""),
          window.cep.encoding.Base64
        );
        if (!result || result.err !== 0) {
          throw new Error("无法保存 LaMa 修复结果（错误码 " +
            (result ? result.err : "unknown") + "）");
        }
        return output;
      }

      return {
        nodeTransportAvailable: nodeTransportAvailable,
        normalizeServiceUrl: normalizeServiceUrl,
        currentLamaUrl: currentLamaUrl,
        parseNodeHttpUrl: parseNodeHttpUrl,
        lamaJsonValue: lamaJsonValue,
        nodeReadUrlBuffer: nodeReadUrlBuffer,
        nodeLamaValueToBase64: nodeLamaValueToBase64,
        nodeLamaRequest: nodeLamaRequest,
        nodeLegacyLamaJsonRequest: nodeLegacyLamaJsonRequest,
        nodeLamaHealthRequest: nodeLamaHealthRequest,
        nodeLamaEndpointProbe: nodeLamaEndpointProbe,
        loadBase64Image: loadBase64Image,
        canvasPngBase64: canvasPngBase64,
        createCroppedLamaSession: createCroppedLamaSession,
        isLamaTransportFailure: isLamaTransportFailure,
        croppedLamaFallback: croppedLamaFallback,
        multipartLamaXhrRequest: multipartLamaXhrRequest,
        createRectMaskBase64: createRectMaskBase64,
        nodeIopaintRequest: nodeIopaintRequest,
        xhrIopaintRequest: xhrIopaintRequest,
        multipartLamaRequest: multipartLamaRequest,
        renderLocalLamaStatus: renderLocalLamaStatus,
        lamaServiceCandidates: lamaServiceCandidates,
        probeLamaUrl: probeLamaUrl,
        probeLamaCandidate: probeLamaCandidate,
        detectLocalLama: detectLocalLama,
        writeTempPng: writeTempPng
      };
    }
  };
}(window));
