'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child = require('child_process');

exports.create = function (options) {
  const createRuntime = options.createRuntime || require('./runtime').createRuntime;
  const port = options.port === undefined ? 32123 : options.port;
  const dataDir = options.dataDir || path.join(process.env.APPDATA, 'CodexPhotoshopBridge');
  const tokenFile = path.join(dataDir, 'token.txt');
  let server = null, runtime = null, token = '', phase = 'STOPPED', starting = null, pending = 0;
  function emit() { if (options.onChange) options.onChange(status()); }
  function status() {
    return { phase: phase, endpoint: 'http://127.0.0.1:' + (server && server.address() ? server.address().port : port), runtime: runtime ? runtime.status() : null };
  }
  function invokeRaw(command) {
    return Promise.resolve().then(function () { return options.invoke(command); }).then(function (data) {
      if (runtime) runtime.markCepHeartbeat();
      if (data && data.ok === false) {
        const message = typeof data.error === 'string' ? data.error : data.error && data.error.message;
        throw Object.assign(new Error(message || 'Photoshop 操作失败'), { code: data.errorCode || 'PHOTOSHOP_ACTION_FAILED', details: { failedIndex: data.failedIndex, completed: data.completed } });
      }
      return data;
    });
  }
  const ocr = require('./ocr').create(invokeRaw);
  function sampleMemory() {
    if (process.platform !== 'win32') return Promise.resolve({});
    return new Promise(function (resolve) {
      const script = "$p=Get-Process -Name Photoshop -ErrorAction SilentlyContinue | Select-Object -First 1; if($null -ne $p){$privateCommitMb=[math]::Round($p.PrivateMemorySize64/1MB,2);[pscustomobject]@{photoshopWorkingSetMb=[math]::Round($p.WorkingSet64/1MB,2);photoshopPrivateCommitMb=$privateCommitMb;photoshopPrivateMemoryMb=$privateCommitMb}|ConvertTo-Json -Compress}";
      child.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 3000, maxBuffer: 65536 }, function (error, stdout) {
        try { resolve(error ? {} : JSON.parse(String(stdout || '{}'))); } catch (ignore) { resolve({}); }
      });
    });
  }
  function execute(command, request) {
    if (phase !== 'READY') return Promise.reject(new Error('请先启动桥接'));
    if (!command || typeof command.action !== 'string') return Promise.reject(new Error('command.action 必填'));
    request = request || {};
    try {
    if (command.action === 'upsert_text_many' || command.action === 'replace_smart_objects') {
      if (!Number.isInteger(command.documentId) || command.documentId <= 0) return Promise.reject(new Error('批量操作必须明确指定 documentId'));
      if (!Array.isArray(command.items) || !command.items.length) return Promise.reject(new Error('items 必填'));
      const smart = command.action === 'replace_smart_objects';
      if (command.items.length > (smart ? 5 : 30)) return Promise.reject(new Error(smart ? '智能对象每批最多 5 项' : '文字每批最多 30 项'));
      command = Object.assign({}, command, {
        action: 'execute_batch', transaction: true, mode: 'SAFE',
        snapshotFirst: true, verifyAfter: true, refresh: false,
        operations: command.items.map(function (item) {
          if (!item || !Number.isInteger(item.layerId) || item.layerId <= 0) throw new Error('每项必须包含有效 layerId');
          if (smart) {
            if (typeof item.path !== 'string' || !item.path) throw new Error('智能对象素材路径必填');
            return { type: 'smartObject.replace', layerId: item.layerId, path: item.path };
          }
          if (typeof item.text !== 'string') throw new Error('文字内容必须为字符串');
          return { type: 'text.update', layerId: item.layerId, text: item.text };
        })
      });
      delete command.items;
    }
    } catch (validationError) { return Promise.reject(validationError); }
    pending++;
    return Promise.resolve().then(function () {
      if (command.action === 'execute_batch') return runtime.batchExecutor.execute(command, request);
      if (command.action === 'render_preview') return runtime.previewRenderer.preview(command);
      return runtime.manager.execute({
        command: command, operation: command.action, documentId: command.documentId,
        requestId: request.requestId, idempotencyKey: request.idempotencyKey,
        timeout: request.timeoutMs ? { hardTimeoutMs: Number(request.timeoutMs), softTimeoutMs: Math.max(1000, Number(request.timeoutMs) / 2) } : undefined,
        handler: function (ctx) {
          if (command.action === 'ocr_recognize' || command.action === 'recognize_text') return ocr(command, ctx);
          return invokeRaw(command).then(function (data) {
            if (data && data.documentId && ((command.action === 'open_document_session' && data.openedBySession) || command.action === 'create_empty_document')) ctx.registerDocument({ documentId: data.documentId, path: data.path || null, openedByAutomation: true });
            if (data && data.documentId && /^(close_document_session|close_document)$/.test(command.action)) ctx.unregisterDocument({ documentId: data.documentId });
            ctx.checkCancellation('after-' + command.action);
            return data;
          });
        }
      });
    }).then(function (data) { pending--; emit(); return data; }, function (error) { pending--; emit(); throw error; });
  }
  function reply(res, code, data) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  function errorReply(res, error) {
    reply(res, error.code === 'TASK_TIMEOUT' ? 408 : /LOCK|BUSY|QUEUE/.test(error.code || '') ? 409 : 500, { ok: false, error: error.message, errorCode: error.code || 'BRIDGE_ERROR', details: error.details || null });
  }
  function auth(req, body) {
    const candidate = String(req.headers['x-codex-token'] || (body && body.token) || '');
    return !!token && Buffer.byteLength(candidate) === Buffer.byteLength(token) && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
  }
  function handle(req, res) {
    if (runtime) runtime.markBridgeHeartbeat();
    if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: phase === 'READY', host: 'photoshop', owner: 'xinyang', runtime: { bridge: phase } });
    const taskPath = /^\/tasks\/([^/]+)(\/cancel)?$/.exec(req.url);
    if (req.method === 'GET') {
      if (!auth(req)) return reply(res, 401, { ok: false, errorCode: 'PHOTOSHOP_BRIDGE_UNAUTHORIZED' });
      if (!runtime) return reply(res, 503, { ok: false, errorCode: 'BRIDGE_BOOTSTRAPPING' });
      if (req.url === '/runtime/status') return reply(res, 200, { ok: true, runtime: runtime.status() });
      if (taskPath && !taskPath[2]) {
        const task = runtime.manager.getTask(taskPath[1]);
        return reply(res, task ? 200 : 404, { ok: !!task, task: task });
      }
    }
    if (req.method !== 'POST' || (req.url !== '/execute' && !(taskPath && taskPath[2]))) return reply(res, 404, { ok: false, errorCode: 'NOT_FOUND' });
    let chunks = [], size = 0, tooLarge = false;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > 1024 * 1024) { tooLarge = true; chunks = []; reply(res, 413, { ok: false, errorCode: 'BODY_TOO_LARGE' }); }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', function () {
      if (tooLarge) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (error) { return reply(res, 400, { ok: false, errorCode: 'INVALID_JSON' }); }
      if (!auth(req, body)) return reply(res, 401, { ok: false, errorCode: 'PHOTOSHOP_BRIDGE_UNAUTHORIZED' });
      if (phase !== 'READY') return reply(res, 503, { ok: false, errorCode: 'BRIDGE_BOOTSTRAPPING' });
      if (taskPath) { try { return reply(res, 200, { ok: true, task: runtime.manager.cancel(taskPath[1]) }); } catch (error) { return errorReply(res, error); } }
      if (!body || !body.command || typeof body.command.action !== 'string') return reply(res, 400, { ok: false, errorCode: 'INVALID_COMMAND' });
      execute(body.command, body).then(function (data) { reply(res, 200, data); }, function (error) { errorReply(res, error); });
    });
    req.on('error', function () {});
  }
  function removeOwnedToken() {
    try { if (token && fs.readFileSync(tokenFile, 'utf8') === token) fs.unlinkSync(tokenFile); } catch (ignore) {}
    token = '';
  }
  function start() {
    if (starting) return starting;
    if (phase === 'READY') return Promise.resolve(status());
    phase = 'STARTING'; emit();
    starting = new Promise(function (resolve, reject) {
      const candidate = http.createServer(handle);
      server = candidate;
      candidate.once('error', function (error) {
        phase = 'STOPPED'; server = null; emit();
        reject(new Error(error.code === 'EADDRINUSE' ? '端口 32123 已被占用，请停止旧 PS 桥接插件后重试' : error.message));
      });
      candidate.listen(port, '127.0.0.1', function () {
        // Claim the port before generating/writing a token: never break another bridge.
        try {
          fs.mkdirSync(dataDir, { recursive: true });
          token = crypto.randomBytes(24).toString('hex');
          fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 384 });
          runtime = createRuntime({ executeRaw: invokeRaw, probe: function () { return invokeRaw({ action: 'runtime_probe' }); }, sampleProvider: sampleMemory, memoryLogDir: path.join(dataDir, 'xinyang-memory'), logger: function () {} });
          runtime.manager.execute({ operation: 'runtime_probe', checkHealth: false, handler: function () { return invokeRaw({ action: 'runtime_probe' }); } }).then(function () {
            runtime.start(); phase = 'READY'; emit(); resolve(status());
          }).catch(failedStart);
        } catch (error) { failedStart(error); }
        function failedStart(error) {
          if (runtime) runtime.stop(); runtime = null;
          removeOwnedToken(); candidate.close(function () { server = null; phase = 'STOPPED'; emit(); reject(error); });
        }
      });
    }).then(function (value) { starting = null; return value; }, function (error) { starting = null; throw error; });
    return starting;
  }
  function stop(force) {
    if (starting) return starting.then(function () { return stop(force); }, function () {});
    const state = runtime && runtime.status();
    if (!force && (pending || state && (state.activeTask || state.queueLength))) return Promise.reject(new Error('还有任务正在执行，请等待完成或取消任务后再停止桥接'));
    phase = 'STOPPING'; emit();
    if (runtime) runtime.stop();
    return new Promise(function (resolve) {
      function done() { server = null; runtime = null; removeOwnedToken(); phase = 'STOPPED'; emit(); resolve(status()); }
      if (server) server.close(done); else done();
    });
  }
  return {
    start: start, stop: stop, status: status, execute: execute,
    getToken: function () { return token; },
    cancel: function (id) { return runtime.manager.cancel(id); },
    releaseMemory: function () { return runtime ? runtime.manualRecovery({ level: 'soft', reason: 'USER_SAFE_RELEASE' }) : Promise.reject(new Error('请先启动桥接')); },
    stopRecovery: function () { if (runtime) runtime.stopRecovery(); },
    logs: function () { return runtime ? runtime.exportMemoryLogs() : []; }
  };
};
