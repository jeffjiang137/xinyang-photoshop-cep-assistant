/* 鑫洋助理通用文件模块：按需读取二进制图片与安全删除临时文件（v2.2.58） */
(function (global) {
  "use strict";

  if (global.XinyangFileIO) return;

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

  function normalizeBase64(value) {
    var text = String(value || "").replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
    if (!text) throw new Error("临时图片数据为空");
    return text;
  }

  function readFileBase64(filePath, options) {
    options = options || {};
    var label = String(options.label || "临时图片");
    var validatePng = options.validatePng !== false;
    filePath = String(filePath || "");
    return new Promise(function (resolve, reject) {
      if (!filePath) {
        reject(new Error(label + "路径为空"));
        return;
      }

      var nodeRequire = getNodeRequire();
      if (nodeRequire) {
        try {
          nodeRequire("fs").readFile(filePath, function (error, buffer) {
            if (error) {
              reject(new Error("无法读取" + label + "：" + error.message));
              return;
            }
            if (!buffer || !buffer.length) {
              reject(new Error(label + "为空或保存不完整"));
              return;
            }
            if (validatePng && (
              buffer.length < 8 || buffer[0] !== 137 || buffer[1] !== 80 ||
              buffer[2] !== 78 || buffer[3] !== 71
            )) {
              reject(new Error(label + "不是有效的 PNG 文件"));
              return;
            }
            try {
              resolve(normalizeBase64(buffer.toString("base64")));
            } catch (normalizeError) {
              reject(normalizeError);
            }
          });
          return;
        } catch (nodeError) {
          /* Node 通道异常时继续尝试 CEP 文件接口。 */
        }
      }

      if (!global.cep || !global.cep.fs || !global.cep.fs.readFile) {
        reject(new Error("当前 CEP 运行环境不支持读取" + label));
        return;
      }
      var encoding = global.cep.encoding && (
        global.cep.encoding.Base64 ||
        global.cep.encoding.BASE64 ||
        global.cep.encoding.base64
      ) || "Base64";
      var result = global.cep.fs.readFile(filePath, encoding);
      if (!result || result.err !== 0) {
        reject(new Error("无法读取" + label + "（错误码 " +
          (result ? result.err : "unknown") + "）"));
        return;
      }
      try {
        resolve(normalizeBase64(result.data));
      } catch (error) {
        reject(new Error("CEP 未能按 Base64 读取" + label));
      }
    });
  }

  function deleteFile(filePath) {
    try {
      if (filePath && global.cep && global.cep.fs && global.cep.fs.deleteFile) {
        global.cep.fs.deleteFile(filePath);
      }
    } catch (ignoreDelete) {}
  }

  function dirname(filePath) {
    var value = String(filePath || "");
    if (!value) return "";
    var nodeRequire = getNodeRequire();
    if (nodeRequire) {
      try { return nodeRequire("path").dirname(value); } catch (ignorePath) {}
    }
    value = value.replace(/\\/g, "/").replace(/\/+$/, "");
    var index = value.lastIndexOf("/");
    return index > 0 ? value.slice(0, index) : "";
  }

  global.XinyangFileIO = {
    readFileBase64: readFileBase64,
    deleteFile: deleteFile,
    dirname: dirname
  };
}(window));
