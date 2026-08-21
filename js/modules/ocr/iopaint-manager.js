/* 鑫洋助理 OCR 子模块：iopaintManager（v2.2.58） */
(function (global) {
  "use strict";

  if (global.XinyangIopaintManager) return;

  global.XinyangIopaintManager = {
    create: function (deps) {
      deps = deps || {};
      var state = deps.state;
      var $ = deps.$;
      var cs = deps.cs;
      var setStatus = deps.setStatus;
      var humanError = deps.humanError;
      var setOcrBusy = deps.setOcrBusy;
      var storageSet = deps.storageSet;
      var LOCAL_IOPAINT_URL = deps.LOCAL_IOPAINT_URL;
      var IOPAINT_PACKAGE_VERSION = deps.IOPAINT_PACKAGE_VERSION;
      var IOPAINT_MODEL_URL = deps.IOPAINT_MODEL_URL;
      var IOPAINT_MODEL_MD5 = deps.IOPAINT_MODEL_MD5;
      var STORAGE_KEYS = deps.STORAGE_KEYS;
      var getNodeRequire = deps.getNodeRequire;
      var nodeTransportAvailable = deps.nodeTransportAvailable;
      var probeLamaCandidate = deps.probeLamaCandidate;
      var renderLocalLamaStatus = deps.renderLocalLamaStatus;

      function nodeFsHelpers() {
        var nodeRequire = getNodeRequire();
        if (!nodeRequire) throw new Error("当前 CEP 环境未启用 Node.js，无法安装本地模型");
        return {
          fs: nodeRequire("fs"),
          path: nodeRequire("path"),
          cp: nodeRequire("child_process"),
          crypto: nodeRequire("crypto"),
          url: nodeRequire("url"),
          http: nodeRequire("http"),
          https: nodeRequire("https"),
          os: nodeRequire("os"),
          process: nodeRequire("process")
        };
      }

      function fsExists(filePath) {
        return new Promise(function (resolve) {
          var helpers;
          try { helpers = nodeFsHelpers(); } catch (error) { resolve(false); return; }
          helpers.fs.stat(filePath, function (error, stat) {
            resolve(!error && !!stat);
          });
        });
      }

      function fsMkdir(directory) {
        return new Promise(function (resolve, reject) {
          var helpers = nodeFsHelpers();
          helpers.fs.mkdir(directory, { recursive: true }, function (error) {
            if (error && error.code !== "EEXIST") reject(error);
            else resolve(directory);
          });
        });
      }

      function fsRename(source, target) {
        return new Promise(function (resolve, reject) {
          var helpers = nodeFsHelpers();
          function renameNow() {
            helpers.fs.rename(source, target, function (error) {
              if (error) reject(error); else resolve(target);
            });
          }
          helpers.fs.unlink(target, function (unlinkError) {
            if (unlinkError && unlinkError.code !== "ENOENT") { reject(unlinkError); return; }
            renameNow();
          });
        });
      }

      function fsUnlink(filePath) {
        return new Promise(function (resolve, reject) {
          var helpers = nodeFsHelpers();
          helpers.fs.unlink(filePath, function (error) {
            if (error && error.code !== "ENOENT") reject(error); else resolve();
          });
        });
      }

      function fsWriteJson(filePath, value) {
        return new Promise(function (resolve, reject) {
          var helpers = nodeFsHelpers();
          helpers.fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8", function (error) {
            if (error) reject(error); else resolve(filePath);
          });
        });
      }

      function managedIopaintPaths(root) {
        var helpers = nodeFsHelpers();
        var runtimeDir = helpers.path.join(root, "runtime");
        var isWindows = String(helpers.os.platform()).toLowerCase() === "win32";
        return {
          root: root,
          runtimeDir: runtimeDir,
          venvPython: isWindows
            ? helpers.path.join(runtimeDir, "Scripts", "python.exe")
            : helpers.path.join(runtimeDir, "bin", "python"),
          iopaintExe: isWindows
            ? helpers.path.join(runtimeDir, "Scripts", "iopaint.exe")
            : helpers.path.join(runtimeDir, "bin", "iopaint"),
          modelRoot: helpers.path.join(root, "models"),
          modelFile: helpers.path.join(root, "models", "hub", "checkpoints", "big-lama.pt"),
          markerFile: helpers.path.join(root, "install.json"),
          logFile: helpers.path.join(root, "iopaint-service.log")
        };
      }

      function pickIopaintInstallFolder() {
        if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) {
          throw new Error("当前 CEP 环境无法打开文件夹选择器");
        }
        var result = window.cep.fs.showOpenDialogEx(
          false, true, "选择 LaMa 本地模型安装位置", "", []
        );
        if (!result || result.err !== 0 || !result.data || !result.data.length) return "";
        var selected = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!selected) return "";
        var helpers = nodeFsHelpers();
        return /XinyangAssistant-LaMa$/i.test(String(selected))
          ? String(selected)
          : helpers.path.join(String(selected), "XinyangAssistant-LaMa");
      }

      function renderIopaintProgress(visible, percent, text, mode) {
        var box = $("#iopaint-download-progress");
        var label = $("#iopaint-progress-text");
        var percentNode = $("#iopaint-progress-percent");
        var track = $("#iopaint-progress-track");
        var bar = $("#iopaint-progress-bar");
        if (!box || !label || !percentNode || !track || !bar) return;
        box.hidden = !visible;
        var value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        label.textContent = String(text || "准备下载");
        percentNode.textContent = mode === "indeterminate" ? "…" : value + "%";
        track.setAttribute("aria-valuenow", String(value));
        track.classList.toggle("indeterminate", mode === "indeterminate");
        track.classList.toggle("error", mode === "error");
        bar.style.width = mode === "indeterminate" ? "34%" : value + "%";
      }

      function spawnCapture(command, args, options, onOutput) {
        return new Promise(function (resolve, reject) {
          var helpers = nodeFsHelpers();
          var child;
          var stdout = "";
          var stderr = "";
          try {
            child = helpers.cp.spawn(command, args || [], Object.assign({ windowsHide: true }, options || {}));
          } catch (error) { reject(error); return; }
          function collect(target) {
            return function (chunk) {
              var text = String(chunk || "");
              if (target === "stdout") stdout += text; else stderr += text;
              if (onOutput) onOutput(text, target);
            };
          }
          if (child.stdout) child.stdout.on("data", collect("stdout"));
          if (child.stderr) child.stderr.on("data", collect("stderr"));
          child.on("error", reject);
          child.on("close", function (code) {
            if (Number(code) === 0) resolve({ stdout: stdout, stderr: stderr, code: code });
            else reject(new Error((stderr || stdout || (command + " 执行失败，退出码 " + code)).trim().slice(-1600)));
          });
        });
      }

      function findPythonExecutable() {
        /*
         * Windows 上新版 Python 常不会注册 py.exe，或 PATH 仍优先指向
         * 不受 IOPaint 支持的 3.12+。先检查标准的每用户/系统 3.11、3.10
         * 安装目录，并在探测脚本中强制校验主次版本，不能再误把 3.12 当作
         * 可用运行时而导致后续 pip 或服务启动失败。
         */
        var probe = "import sys;v=sys.version_info[:2];assert v in ((3,10),(3,11)), 'Python %d.%d is unsupported; require 3.10 or 3.11' % v;print(sys.executable)";
        var helpers = nodeFsHelpers();
        var env = helpers.process.env || {};
        var installRoots = [env.LOCALAPPDATA, env.ProgramFiles, env["ProgramFiles(x86)"]];
        var candidates = [];
        installRoots.forEach(function (root) {
          if (!root) return;
          ["Python311", "Python310"].forEach(function (folder) {
            candidates.push({ command: helpers.path.join(root, "Programs", "Python", folder, "python.exe"), args: ["-c", probe] });
            candidates.push({ command: helpers.path.join(root, folder, "python.exe"), args: ["-c", probe] });
          });
        });
        candidates = candidates.concat([
          { command: "py.exe", args: ["-3.11", "-c", probe] },
          { command: "py.exe", args: ["-3.10", "-c", probe] },
          { command: "python.exe", args: ["-c", probe] },
          { command: "python", args: ["-c", probe] }
        ]);
        function attempt(index, lastError) {
          if (index >= candidates.length) {
            throw new Error("未找到 Python 3.10/3.11。请先安装 64 位 Python，并勾选 Add Python to PATH。" + (lastError ? " " + humanError(lastError) : ""));
          }
          var candidate = candidates[index];
          return spawnCapture(candidate.command, candidate.args).then(function (result) {
            var lines = String(result.stdout || "").trim().split(/\r?\n/);
            return lines[lines.length - 1] || candidate.command;
          }).catch(function (error) { return attempt(index + 1, error); });
        }
        return Promise.resolve().then(function () { return attempt(0, null); });
      }

      function fileMd5(filePath) {
        return new Promise(function (resolve, reject) {
          var helpers = nodeFsHelpers();
          var hash = helpers.crypto.createHash("md5");
          var stream = helpers.fs.createReadStream(filePath);
          stream.on("data", function (chunk) { hash.update(chunk); });
          stream.on("error", reject);
          stream.on("end", function () { resolve(hash.digest("hex")); });
        });
      }

      function downloadToFile(url, destination, onProgress, redirectCount) {
        return new Promise(function (resolve, reject) {
          var helpers = nodeFsHelpers();
          var partPath = destination + ".part";
          helpers.fs.stat(partPath, function (statError, stat) {
            var existing = !statError && stat ? Number(stat.size) || 0 : 0;
            var parsed = helpers.url.parse(url);
            var transport = parsed.protocol === "https:" ? helpers.https : helpers.http;
            var headers = { "User-Agent": "XinyangAssistant/2.2.05", "Accept": "application/octet-stream,*/*" };
            if (existing > 0) headers.Range = "bytes=" + existing + "-";
            var request = transport.get({
              protocol: parsed.protocol,
              hostname: parsed.hostname,
              port: parsed.port,
              path: parsed.path,
              headers: headers
            }, function (response) {
              var status = Number(response.statusCode) || 0;
              if (status >= 300 && status < 400 && response.headers.location && (redirectCount || 0) < 8) {
                response.resume();
                var nextUrl = helpers.url.resolve(url, response.headers.location);
                downloadToFile(nextUrl, destination, onProgress, (redirectCount || 0) + 1).then(resolve, reject);
                return;
              }
              if (status === 416 && existing > 0) {
                response.resume();
                fsRename(partPath, destination).then(resolve, reject);
                return;
              }
              if (status !== 200 && status !== 206) {
                response.resume();
                reject(new Error("模型下载服务器返回 HTTP " + status));
                return;
              }
              var append = status === 206 && existing > 0;
              if (!append) existing = 0;
              var total = existing + (Number(response.headers["content-length"]) || 0);
              var received = existing;
              var output = helpers.fs.createWriteStream(partPath, { flags: append ? "a" : "w" });
              output.on("error", reject);
              response.on("error", reject);
              response.on("data", function (chunk) {
                received += chunk.length;
                if (onProgress) onProgress(received, total);
              });
              response.pipe(output);
              output.on("finish", function () {
                output.close(function () {
                  fsRename(partPath, destination).then(resolve, reject);
                });
              });
            });
            request.setTimeout(60000, function () { request.destroy(new Error("模型下载连接超时")); });
            request.on("error", reject);
          });
        });
      }

      function refreshManagedIopaintInstallState() {
        if (!state.iopaintInstallPath || !nodeTransportAvailable()) {
          state.iopaintInstalled = false;
          renderLocalLamaStatus();
          return Promise.resolve(false);
        }
        if (state.iopaintInstallChecking) return Promise.resolve(state.iopaintInstalled);
        state.iopaintInstallChecking = true;
        renderLocalLamaStatus();
        var paths;
        try { paths = managedIopaintPaths(state.iopaintInstallPath); }
        catch (error) {
          state.iopaintInstallChecking = false;
          state.iopaintInstalled = false;
          renderLocalLamaStatus();
          return Promise.resolve(false);
        }
        return Promise.all([fsExists(paths.iopaintExe), fsExists(paths.modelFile)]).then(function (results) {
          state.iopaintInstalled = !!(results[0] && results[1]);
          return state.iopaintInstalled;
        }).catch(function () {
          state.iopaintInstalled = false;
          return false;
        }).then(function (installed) {
          state.iopaintInstallChecking = false;
          renderLocalLamaStatus();
          setOcrBusy(state.ocrBusy);
          return installed;
        });
      }

      function downloadLocalIopaint() {
        if (state.iopaintInstallBusy) return;
        var root;
        try { root = pickIopaintInstallFolder(); }
        catch (error) { setStatus("选择安装位置失败：" + humanError(error)); return; }
        if (!root) return;
        state.iopaintInstallPath = root;
        state.iopaintInstallBusy = true;
        state.iopaintInstalled = false;
        storageSet(STORAGE_KEYS.iopaintInstallPath, root);
        renderIopaintProgress(true, 2, "正在检查 Python 环境");
        renderLocalLamaStatus();
        setOcrBusy(state.ocrBusy);
        var paths = managedIopaintPaths(root);
        var pythonExe = "";
        var pipProgress = 18;
        fsMkdir(root).then(function () {
          return Promise.all([fsMkdir(paths.modelRoot), fsMkdir(nodeFsHelpers().path.dirname(paths.modelFile))]);
        }).then(function () {
          return findPythonExecutable();
        }).then(function (executable) {
          pythonExe = executable;
          renderIopaintProgress(true, 8, "正在创建独立运行环境");
          return fsExists(paths.venvPython);
        }).then(function (venvExists) {
          if (venvExists) return true;
          return spawnCapture(pythonExe, ["-m", "venv", paths.runtimeDir], { cwd: root });
        }).then(function () {
          renderIopaintProgress(true, 16, "正在安装 IOPaint 运行组件", "indeterminate");
          return spawnCapture(paths.venvPython, [
            "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
            "iopaint==" + IOPAINT_PACKAGE_VERSION
          ], { cwd: root }, function (text) {
            if (/Collecting|Downloading|Installing|Successfully installed/i.test(text)) {
              pipProgress = Math.min(34, pipProgress + 1);
              renderIopaintProgress(true, pipProgress, "正在安装 IOPaint 运行组件", "indeterminate");
            }
          });
        }).then(function () {
          renderIopaintProgress(true, 36, "正在检查 LaMa 模型");
          return fsExists(paths.modelFile);
        }).then(function (modelExists) {
          if (modelExists) {
            return fileMd5(paths.modelFile).then(function (md5) {
              return md5.toLowerCase() === IOPAINT_MODEL_MD5 ? true : false;
            });
          }
          return false;
        }).then(function (modelValid) {
          if (modelValid) return paths.modelFile;
          renderIopaintProgress(true, 38, "正在下载 LaMa 本地模型");
          return fsUnlink(paths.modelFile).then(function () {
            return downloadToFile(IOPAINT_MODEL_URL, paths.modelFile, function (received, total) {
            var modelPercent = total > 0 ? received / total : 0;
            var percent = total > 0 ? 38 + modelPercent * 56 : 50;
            var mb = (received / 1048576).toFixed(1);
            var totalText = total > 0 ? " / " + (total / 1048576).toFixed(1) + " MB" : " MB";
              renderIopaintProgress(true, percent, "正在下载 LaMa 模型 " + mb + totalText);
            });
          });
        }).then(function () {
          renderIopaintProgress(true, 96, "正在校验模型完整性");
          return fileMd5(paths.modelFile);
        }).then(function (md5) {
          if (String(md5).toLowerCase() !== IOPAINT_MODEL_MD5) {
            throw new Error("模型完整性校验失败，请重新下载");
          }
          return fsWriteJson(paths.markerFile, {
            product: "XinyangAssistant-LaMa",
            iopaintVersion: IOPAINT_PACKAGE_VERSION,
            model: "big-lama.pt",
            modelMd5: IOPAINT_MODEL_MD5,
            installedAt: new Date().toISOString()
          });
        }).then(function () {
          state.iopaintInstalled = true;
          renderIopaintProgress(true, 100, "本地模型下载完成");
          setStatus("LaMa 本地模型已下载；执行擦除时将按需启动服务");
          window.setTimeout(function () { renderIopaintProgress(false, 100, ""); }, 2200);
        }).catch(function (error) {
          state.iopaintInstalled = false;
          renderIopaintProgress(true, 0, "安装失败：" + humanError(error), "error");
          setStatus("本地模型安装失败：" + humanError(error));
        }).then(function () {
          state.iopaintInstallBusy = false;
          renderLocalLamaStatus();
          setOcrBusy(state.ocrBusy);
        });
      }

      function waitMilliseconds(milliseconds) {
        return new Promise(function (resolve) { window.setTimeout(resolve, milliseconds); });
      }

      function scheduleIopaintIdleStop() {
        window.clearTimeout(state.iopaintIdleTimer);
        state.iopaintIdleTimer = 0;
        if (!state.iopaintProcessPid) return;
        state.iopaintIdleTimer = window.setTimeout(function () {
          if (state.iopaintActiveRequests > 0) {
            scheduleIopaintIdleStop();
            return;
          }
          stopManagedIopaint("idle", true);
        }, Math.max(1, Number(state.iopaintIdleMinutes) || 10) * 60000);
      }

      function touchManagedIopaint() {
        if (state.iopaintProcessPid) scheduleIopaintIdleStop();
      }

      function stopManagedIopaint(reason, silent) {
        window.clearTimeout(state.iopaintIdleTimer);
        state.iopaintIdleTimer = 0;
        var pid = Number(state.iopaintProcessPid) || 0;
        var child = state.iopaintProcess;
        state.iopaintProcess = null;
        state.iopaintProcessPid = 0;
        state.iopaintStartPromise = null;
        if (child) {
          try { child.kill(); } catch (error) {}
        }
        if (pid && nodeTransportAvailable()) {
          try {
            var helpers = nodeFsHelpers();
            if (String(helpers.os.platform()).toLowerCase() === "win32") {
              helpers.cp.spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
                windowsHide: true, detached: true, stdio: "ignore"
              }).unref();
            } else {
              helpers.cp.spawn("kill", ["-TERM", String(pid)], { detached: true, stdio: "ignore" }).unref();
            }
          } catch (error2) {}
        }
        if (state.localLamaUrl === LOCAL_IOPAINT_URL && state.localLamaProtocol === "iopaint") {
          state.localLamaAvailable = false;
          state.localLamaReachable = false;
          state.localLamaRouteVerified = false;
          state.localLamaRouteNote = "";
          state.localLamaEngine = "";
          state.localLamaCheckedAt = 0;
        }
        renderLocalLamaStatus();
        if (!silent && pid) setStatus(reason === "idle" ? "LaMa 服务已因空闲自动关闭" : "LaMa 本地服务已停止");
      }

      function launchIopaintWatchdog(servicePid) {
        if (!servicePid || !nodeTransportAvailable() || !cs.getSystemPath || !window.SystemPath) return;
        try {
          var helpers = nodeFsHelpers();
          if (String(helpers.os.platform()).toLowerCase() !== "win32") return;
          var extensionPath = cs.getSystemPath(SystemPath.EXTENSION);
          var watchdog = helpers.path.join(extensionPath, "scripts", "iopaint_watchdog.ps1");
          helpers.cp.spawn("powershell.exe", [
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", watchdog,
            "-ParentPid", String(helpers.process.pid), "-ServicePid", String(servicePid)
          ], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
        } catch (error) {}
      }

      function pollManagedIopaint(attempt) {
        return probeLamaCandidate(LOCAL_IOPAINT_URL).then(function (found) {
          state.localLamaAvailable = true;
          state.localLamaReachable = true;
          state.localLamaRouteVerified = true;
          state.localLamaRouteNote = "IOPaint 接口可用";
          state.localLamaFault = "";
          state.localLamaFaultUrl = "";
          state.localLamaFaultAt = 0;
          state.localLamaUrl = LOCAL_IOPAINT_URL;
          state.localLamaProtocol = "iopaint";
          state.localLamaEngine = String((found.result || {}).name || (found.result || {}).model || "lama");
          state.localLamaCheckedAt = Date.now();
          storageSet(STORAGE_KEYS.lamaServiceUrl, LOCAL_IOPAINT_URL);
          renderLocalLamaStatus();
          touchManagedIopaint();
          return true;
        }).catch(function (error) {
          if (attempt >= 45 || !state.iopaintProcessPid) throw error;
          return waitMilliseconds(1000).then(function () { return pollManagedIopaint(attempt + 1); });
        });
      }

      function startManagedIopaint() {
        if (state.localLamaAvailable && state.localLamaProtocol === "iopaint") {
          touchManagedIopaint();
          return Promise.resolve(true);
        }
        if (state.iopaintStartPromise) return state.iopaintStartPromise;
        state.iopaintStartPromise = refreshManagedIopaintInstallState().then(function (installed) {
          if (!installed) throw new Error("请先在设置页下载 LaMa 本地模型");
          var helpers = nodeFsHelpers();
          var paths = managedIopaintPaths(state.iopaintInstallPath);
          var env = Object.assign({}, helpers.process.env || {});
          env.TORCH_HOME = paths.modelRoot;
          env.LAMA_MODEL_URL = paths.modelFile;
          env.LAMA_MODEL_MD5 = IOPAINT_MODEL_MD5;
          return fsMkdir(paths.modelRoot).then(function () {
            var child = helpers.cp.spawn(paths.iopaintExe, [
              "start", "--model=lama", "--device=cpu", "--port=8080", "--model-dir", paths.modelRoot
            ], { cwd: paths.root, env: env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
            state.iopaintProcess = child;
            state.iopaintProcessPid = Number(child.pid) || 0;
            state.localLamaUrl = LOCAL_IOPAINT_URL;
            state.localLamaProtocol = "iopaint";
            state.localLamaChecking = true;
            renderLocalLamaStatus();
            function appendLog(chunk) {
              try { helpers.fs.appendFile(paths.logFile, String(chunk || ""), function () {}); } catch (error) {}
            }
            if (child.stdout) child.stdout.on("data", appendLog);
            if (child.stderr) child.stderr.on("data", appendLog);
            child.on("error", function (error) {
              appendLog("\nSTART ERROR: " + humanError(error) + "\n");
            });
            child.on("exit", function () {
              if (state.iopaintProcessPid === Number(child.pid)) {
                state.iopaintProcess = null;
                state.iopaintProcessPid = 0;
                state.localLamaAvailable = false;
                state.localLamaReachable = false;
                state.localLamaRouteVerified = false;
                state.localLamaRouteNote = "";
                state.localLamaChecking = false;
                state.localLamaCheckedAt = 0;
                renderLocalLamaStatus();
              }
            });
            launchIopaintWatchdog(child.pid);
            return pollManagedIopaint(0);
          });
        }).then(function (available) {
          state.localLamaChecking = false;
          state.iopaintStartPromise = null;
          renderLocalLamaStatus();
          return available;
        }).catch(function (error) {
          state.localLamaChecking = false;
          state.iopaintStartPromise = null;
          stopManagedIopaint("start-failed", true);
          throw new Error("LaMa 本地服务启动失败：" + humanError(error));
        });
        return state.iopaintStartPromise;
      }

      return {
        nodeFsHelpers: nodeFsHelpers,
        fsExists: fsExists,
        fsMkdir: fsMkdir,
        fsRename: fsRename,
        fsUnlink: fsUnlink,
        fsWriteJson: fsWriteJson,
        managedIopaintPaths: managedIopaintPaths,
        pickIopaintInstallFolder: pickIopaintInstallFolder,
        renderIopaintProgress: renderIopaintProgress,
        spawnCapture: spawnCapture,
        findPythonExecutable: findPythonExecutable,
        fileMd5: fileMd5,
        downloadToFile: downloadToFile,
        refreshManagedIopaintInstallState: refreshManagedIopaintInstallState,
        downloadLocalIopaint: downloadLocalIopaint,
        waitMilliseconds: waitMilliseconds,
        scheduleIopaintIdleStop: scheduleIopaintIdleStop,
        touchManagedIopaint: touchManagedIopaint,
        stopManagedIopaint: stopManagedIopaint,
        launchIopaintWatchdog: launchIopaintWatchdog,
        pollManagedIopaint: pollManagedIopaint,
        startManagedIopaint: startManagedIopaint
      };
    }
  };
}(window));
