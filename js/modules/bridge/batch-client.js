'use strict';
const http = require('http');

// The caller supplies its token. Do not log tokens or automatically retry writes.
exports.create = function (options) {
  options = options || {};
  if (!options.token) throw new Error('Bridge token required');
  const port = options.port || 32123;
  function call(command) {
    return new Promise(function (resolve, reject) {
      const body = Buffer.from(JSON.stringify({ token: options.token, command: command, timeoutMs: options.timeoutMs || 120000 }), 'utf8');
      const req = http.request({ hostname: '127.0.0.1', port: port, path: '/execute', method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } }, function (res) {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) { data += chunk; });
        res.on('end', function () {
          try {
            const result = JSON.parse(data);
            if (res.statusCode !== 200 || !result || result.ok === false) {
              const error = new Error(result && result.error || 'Bridge request failed');
              error.code = result && result.errorCode;
              error.details = result && result.details;
              return reject(error);
            }
            if (command.action === 'execute_batch' && (!result.verification || result.verification.refreshed !== true)) {
              const error = new Error('Batch committed but readback unavailable; inspect before continuing');
              error.code = 'BATCH_READBACK_REQUIRED'; error.details = result; return reject(error);
            }
            resolve(result);
          } catch (error) { reject(error); }
        });
        res.on('error', reject);
      });
      req.setTimeout((options.timeoutMs || 120000) + 10000, function () { req.destroy(new Error('Bridge response timeout; inspect task state before retrying')); });
      req.on('error', reject);
      req.end(body);
    });
  }
  async function chunks(items, size, command) {
    if (!Array.isArray(items) || !items.length) throw new Error('Nonempty items required');
    const completed = [];
    for (let offset = 0; offset < items.length; offset += size) {
      try { completed.push(await call(command(items.slice(offset, offset + size)))); }
      catch (error) { error.completedBatches = completed; error.failedOffset = offset; throw error; }
    }
    return completed;
  }
  function edit(documentId, operations, size) {
    documentTarget(documentId);
    return chunks(operations, size || 30, function (batch) {
      return { action: 'execute_batch', documentId: documentId, operations: batch, mode: 'SAFE', transaction: true, snapshotFirst: true, verifyAfter: true, refresh: false };
    });
  }
  function documentTarget(documentId) {
    if (!Number.isInteger(documentId) || documentId <= 0) throw new Error('Explicit documentId required');
    return documentId;
  }
  return {
    edit: edit,
    text: function (documentId, items) { return edit(documentId, items.map(item => ({ type: 'text.update', layerId: item.layerId, text: item.text }))); },
    visibility: function (documentId, items) { return edit(documentId, items.map(item => ({ type: 'layer.visibility', layerId: item.layerId, visible: item.visible }))); },
    smartObjects: function (documentId, items) { return edit(documentId, items.map(item => ({ type: 'smartObject.replace', layerId: item.layerId, path: item.path })), 5); },
    select: function (documentId, layerIds) { return call({ action: 'select_layers', documentId: documentTarget(documentId), layerIds: layerIds }); },
    find: function (documentId, queries) { return call({ action: 'find_layers_many', documentId: documentTarget(documentId), queries: queries }); },
    exports: function (documentId, items) { documentTarget(documentId); return chunks(items, 3, function (batch) { return { action: 'export_many', documentId: documentId, items: batch }; }); }
  };
};
