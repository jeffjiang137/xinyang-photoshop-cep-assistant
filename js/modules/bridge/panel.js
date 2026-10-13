(function () {
  'use strict';
  if (window.XinyangBridge) return;
  var service = null, timer = null, root = document.getElementById('bridge-panel'), working = false;
  function node(id) { return document.getElementById('bridge-' + id); }
  function message(text, error) { node('message').textContent = text; node('message').classList.toggle('is-error', !!error); }
  function render() {
    var status = service ? service.status() : { phase: 'STOPPED' };
    var ready = status.phase === 'READY', runtime = status.runtime || {}, active = runtime.activeTask;
    node('state').textContent = ready ? '已连接' : status.phase === 'STARTING' ? '正在启动' : status.phase === 'STOPPING' ? '正在停止' : '未启动';
    node('state').setAttribute('data-ready', ready ? 'true' : 'false');
    node('start').disabled = working || status.phase !== 'STOPPED';
    node('stop').disabled = working || !ready;
    ['inspect', 'ocr', 'copy', 'reconnect', 'release', 'stop-recovery', 'export-logs'].forEach(function (id) { node(id).disabled = working || !ready; });
    node('cancel').disabled = !active;
    node('task').textContent = active ? (active.operation + ' · ' + active.state) : '暂无运行任务';
    node('queue').textContent = String(runtime.queueLength || 0);
    var memory = runtime.memory || {}, sample = memory.sample || {}, recovery = runtime.memoryRecovery || {};
    var privateCommit = sample.photoshopPrivateCommitMb != null ? sample.photoshopPrivateCommitMb : sample.photoshopPrivateMemoryMb;
    node('memory').textContent = (recovery.status || recovery.state || '—')
      + (sample.photoshopWorkingSetMb != null ? ' · 工作集 ' + Math.round(sample.photoshopWorkingSetMb) + ' MB' : '')
      + (privateCommit != null ? ' · 提交量 ' + Math.round(privateCommit) + ' MB' : '');
  }
  function getService() {
    if (service) return service;
    var req = window.cep_node && window.cep_node.require ? window.cep_node.require : (typeof require === 'function' ? require : null);
    if (!req || !window.__adobe_cep__) throw new Error('请在 Photoshop 的鑫洋助理面板中启动桥接');
    var path = req('path');
    var extension = decodeURI(new CSInterface().getSystemPath(SystemPath.EXTENSION)).replace(/^file:\/\/+/, '');
    service = req(path.join(extension, 'js', 'modules', 'bridge', 'service.js')).create({
      invoke: function (command) { return window.XinyangRuntime.hostInvoke('toolsBridgeExecute', command); },
      onChange: render
    });
    return service;
  }
  function start() { return getService().start(); }
  function rememberAutoStart(value) {
    try { window.localStorage.setItem('longStitch.bridgeAutoStart', value); } catch (ignoreStorage) {}
  }
  function run(action, success) {
    if (working) return;
    working = true; render();
    Promise.resolve().then(action).then(function (data) {
      if (success) message(success);
      if (data && data.ok !== undefined) node('result').textContent = JSON.stringify(data, null, 2);
    }).catch(function (error) { message(error.message || String(error), true); }).then(function () { working = false; render(); });
  }
  function copyToken() {
    var token = getService().getToken();
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(token);
    var input = document.createElement('textarea'); input.value = token; input.style.position = 'fixed'; input.style.opacity = '0';
    root.appendChild(input); input.select();
    try { if (!document.execCommand('copy')) throw new Error('复制失败，请检查剪贴板权限'); } finally { root.removeChild(input); }
  }
  function showTimer(event) {
    if (event && event.detail && event.detail.panelId !== 'bridge-panel') { if (timer) window.clearInterval(timer); timer = null; return; }
    render(); if (!timer) timer = window.setInterval(render, 2000);
  }
  function init() {
    node('start').onclick = function () { rememberAutoStart('1'); run(start, '桥接已启动，本机 AI 工具现在可以连接 Photoshop。'); };
    node('stop').onclick = function () { rememberAutoStart('0'); run(function () { return getService().stop(); }, '桥接已停止。'); };
    node('copy').onclick = function () { run(copyToken, '访问令牌已复制。'); };
    node('inspect').onclick = function () { run(function () { return getService().execute({ action: 'inspect_document_v2' }); }, '已读取当前文档。'); };
    node('ocr').onclick = function () { run(function () { return getService().execute({ action: 'ocr_recognize', createTextLayers: false }, { timeoutMs: 300000 }); }, 'OCR 识别完成。'); };
    node('reconnect').onclick = function () { run(function () {
      var status = getService().status().runtime || {};
      if (status.activeTask || status.queueLength) throw new Error('请等待当前任务完成后重新连接');
      return window.XinyangRuntime.ensureHostScript(true).then(function () { return service.execute({ action: 'runtime_probe' }); });
    }, 'Photoshop 宿主连接已刷新。'); };
    node('release').onclick = function () { run(function () { return getService().releaseMemory(); }, '安全内存释放已完成。'); };
    node('stop-recovery').onclick = function () { getService().stopRecovery(); message('已请求停止恢复任务。'); render(); };
    node('cancel').onclick = function () { var active = service.status().runtime.activeTask; if (active) { service.cancel(active.taskId); message('已请求取消，正在等待当前 Photoshop 操作返回。'); } };
    node('export-logs').onclick = function () { run(function () {
      var blob = new Blob([JSON.stringify({ entries: getService().logs() }, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'xinyang-bridge-memory.json'; root.appendChild(link); link.click(); root.removeChild(link);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }, '日志导出已发起。'); };
    document.addEventListener('xinyang:panelchange', showTimer);
    document.addEventListener('xinyang:panelready', showTimer);
    window.addEventListener('beforeunload', function () { if (timer) window.clearInterval(timer); if (service) service.stop(true).catch(function () {}); });
    render();
  }
  window.XinyangBridge = { init: init, start: start, getState: function () { return service ? service.status() : { phase: 'STOPPED' }; } };
  if (root) init();
}());
