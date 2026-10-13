'use strict';

const crypto = require('crypto');
const { RuntimeError, RuntimeErrorCodes } = require('./runtime-error-codes');

function errorWithCode(code, message, details) {
  if (RuntimeError) return new RuntimeError(code, message, details);
  const error = new Error(message);
  error.code = code;
  error.details = details || null;
  return error;
}

class BatchExecutor {
  constructor(options) {
    this.taskManager = options.taskManager;
    this.executeRaw = options.executeRaw;
    this.snapshotManager = options.snapshotManager;
    this.revisionManager = options.revisionManager;
    this.dirtyTracker = options.dirtyTracker;
    this.saveManager = options.saveManager;
    this.profiler = options.profiler;
    this.previewRenderer = options.previewRenderer;
    this.executionPlanner = options.executionPlanner;
    this.maxFastOperations = Number(options.maxFastOperations || 100);
    this.maxSafeOperations = Number(options.maxSafeOperations || 30);
  }

  validate(command) {
    if (!command || !Array.isArray(command.operations) || !command.operations.length) throw errorWithCode('BATCH_OPERATIONS_REQUIRED', 'operations must contain at least one operation.');
    const mode = String(command.mode || 'FAST').toUpperCase();
    const max = mode === 'SAFE' ? this.maxSafeOperations : this.maxFastOperations;
    if (command.operations.length > max) throw errorWithCode('BATCH_TOO_LARGE', `Batch contains ${command.operations.length} operations; ${mode} limit is ${max}.`, { mode, max });
    if (command.transaction === false) throw errorWithCode('TRANSACTION_REQUIRED', 'execute_batch requires transaction:true.');
    return mode;
  }

  async recoverExternalConflict(documentId, command, error, transactionId) {
    const dirty = this.dirtyTracker.collectOperations(command.operations);
    let refresh = null;
    try {
      refresh = await this.refreshDirty(documentId, { dirty });
    } catch (refreshError) {
      refresh = { refreshed: false, status: 'SKIPPED', reason: 'DIRTY_REFRESH_UNAVAILABLE', error: { code: refreshError.code || 'DIRTY_REFRESH_FAILED', message: refreshError.message || String(refreshError) } };
    }
    return errorWithCode('REVISION_CONFLICT', 'Photoshop document changed outside the Runtime.', {
      transactionId,
      externalRevisionConflict: true,
      cause: { code: error && error.code || 'EXTERNAL_REVISION_CONFLICT', message: error && error.message || String(error) },
      refresh
    });
  }

  async execute(command, options) {
    const executionPlan = this.executionPlanner ? this.executionPlanner.plan(command) : null;
    if (executionPlan && executionPlan.nonBatchableOperations && executionPlan.nonBatchableOperations.length) throw errorWithCode("BATCH_OPERATION_UNSUPPORTED", "Batch contains unsupported operation types.", { operationIndexes: executionPlan.nonBatchableOperations, executionPlan });
    const mode = this.validate(command);
    const documentId = command.documentId === undefined ? 'active' : command.documentId;
    const expectedRevision = command.expectedRevision;
    this.revisionManager.assert(documentId, expectedRevision);
    const transactionId = command.transactionId || `tx_${crypto.randomUUID()}`;
    const handler = async context => {
      context.setPhase("batch.planned");
      if (command.snapshotFirst !== false && this.snapshotManager && !this.snapshotManager.get(documentId)) {
        const snapshotStarted = Date.now();
        let snapshotResult;
        try {
          snapshotResult = await this.executeRaw({ action: 'inspect_document_v2', documentId: command.documentId });
        } catch (error) {
          if (!String(error && error.code || error && error.message || error).includes('PHOTOSHOP_INSPECT_MODULE_NOT_LOADED')) throw error;
          snapshotResult = await this.executeRaw({ action: 'document_info', documentId: command.documentId });
        }
        const snapshotDocument = snapshotResult && (snapshotResult.document || snapshotResult.data && snapshotResult.data.document);
        if (!snapshotDocument) snapshotResult = await this.executeRaw({ action: 'document_info', documentId: command.documentId });
        const snapshotDurationMs = Date.now() - snapshotStarted;
        if (!snapshotResult || snapshotResult.ok === false || !(snapshotResult.document || snapshotResult.data && snapshotResult.data.document)) throw errorWithCode('SNAPSHOT_REFRESH_FAILED', 'Unable to establish the initial document snapshot.', { snapshotResult });
        const snapshotPayload = Object.assign({}, snapshotResult.document || snapshotResult.data.document, { documentId });
        const snapshotFingerprint = snapshotResult.historyFingerprint || snapshotResult.data && snapshotResult.data.historyFingerprint || snapshotDocument && snapshotDocument.historyFingerprint;
        if (snapshotFingerprint) {
          snapshotPayload.historyFingerprint = snapshotFingerprint;
          this.revisionManager.setFingerprint(documentId, snapshotFingerprint);
        }
        this.snapshotManager.put(documentId, snapshotPayload);
        if (this.profiler) this.profiler.recordSnapshot(true, snapshotDurationMs, { documentId, snapshotAction: 'inspect_document_v2', transportRecorded: this.executeRaw && this.executeRaw.__codexTransportProfiler === true });
      }
      const started = Date.now();
      const expectedHistoryFingerprint = this.revisionManager.getFingerprint(documentId);
      let raw;
      try {
        raw = await this.executeRaw(Object.assign({}, command, {
          action: 'execute_batch',
          transactionId,
          expectedRevision: this.revisionManager.get(documentId),
          expectedHistoryFingerprint: expectedHistoryFingerprint || undefined,
          refresh: false,
          suppressUIRefresh: command.suppressUIRefresh !== false,
          headlessLikeMode: command.headlessLikeMode !== false,
          verifyAfter: command.verifyAfter === true
        }));
      } catch (error) {
        if (error && error.code === 'EXTERNAL_REVISION_CONFLICT') throw await this.recoverExternalConflict(documentId, command, error, transactionId);
        throw error;
      }
      const durationMs = Date.now() - started;
      if (!raw || raw.ok === false || raw.status === 'failed') {
        const details = raw && (raw.error || raw.details) || {};
        if (details.code === 'EXTERNAL_REVISION_CONFLICT' || raw && raw.errorCode === 'EXTERNAL_REVISION_CONFLICT') {
          throw await this.recoverExternalConflict(documentId, command, details, transactionId);
        }
        throw errorWithCode(details.code || raw && raw.errorCode || 'BATCH_EXECUTION_FAILED', details.message || raw && raw.error || 'Photoshop batch execution failed.', Object.assign({ transactionId }, details));
      }
      if (this.profiler && Array.isArray(raw.operations)) {
        for (const item of raw.operations) {
          if (item && item.durationMs !== undefined) this.profiler.recordOperation({ operationIndex: item.operationIndex, type: item.type, layerId: item.layerId }, item.durationMs, { transactionId, documentId, mode });
        }
      }
      const returnedFingerprint = raw.historyFingerprint || raw.data && raw.data.historyFingerprint;
      if (returnedFingerprint) this.revisionManager.setFingerprint(documentId, returnedFingerprint);
      const revision = this.revisionManager.advance(documentId);
      const currentDirty = this.dirtyTracker.collectOperations(command.operations);
      const dirty = this.dirtyTracker.markOperations(documentId, command.operations);
      if (this.previewRenderer && typeof this.previewRenderer.invalidate === 'function') this.previewRenderer.invalidate(documentId);
      this.saveManager.markDirty(command.operations.length);
      if (this.snapshotManager) {
        const snapshotPatch = { lastBatchAt: Date.now() };
        const currentFingerprint = this.revisionManager.getFingerprint(documentId);
        if (currentFingerprint) snapshotPatch.historyFingerprint = currentFingerprint;
        if (Array.isArray(raw.layers)) snapshotPatch.layers = raw.layers;
        this.snapshotManager.markRevision(documentId, revision, snapshotPatch);
        const patches = [];
        for (const item of raw.operations || []) {
          const result = item && item.result || {};
          if (result.layer) patches.push(Object.assign({}, result.layer, result.text ? { text: result.text } : {}, result.shape ? { shape: result.shape } : {}));
          if (result.group) patches.push(result.group);
        }
        if (patches.length) this.snapshotManager.patchLayers(documentId, patches, { revision });
      }
      let verification = { refreshed: false, reason: 'VERIFY_DISABLED' };
      if (command.verifyAfter === true) {
        try {
          verification = await this.refreshDirty(documentId, { dirty: currentDirty, revision });
        } catch (error) {
          verification = { refreshed: false, status: 'SKIPPED', reason: 'DIRTY_REFRESH_UNAVAILABLE', error: { code: error.code || 'DIRTY_REFRESH_FAILED', message: error.message || String(error) } };
        }
      }
      if (this.profiler) this.profiler.recordBatch(command.operations.length, durationMs, { transactionId, documentId, mode, transportRecorded: this.executeRaw && this.executeRaw.__codexTransportProfiler === true });
      context.setPhase('batch.committed');
      return Object.assign({}, raw, { ok: true, status: 'committed', transactionId, revision, dirty, verification, save: this.saveManager.snapshot(), mode, executionPlan, metrics: { durationMs, operationCount: command.operations.length } });
    };
    return this.taskManager.execute({
      command,
      operation: 'execute_batch',
      profile: { profile: command.operations.some(operation => /^smartObject\./.test(operation.type)) ? 'SMART_OBJECT' : mode === 'SAFE' ? 'WRITE_LIGHT' : 'WRITE_HEAVY' },
      documentId: command.documentId,
      requestId: options && options.requestId,
      idempotencyKey: options && options.idempotencyKey,
      timeout: options && options.timeoutMs ? { hardTimeoutMs: Number(options.timeoutMs), softTimeoutMs: Math.min(Number(options.timeoutMs), Math.max(1000, Math.floor(Number(options.timeoutMs) * 0.5))) } : undefined,
      handler
    });
  }

  async preview(request) { return this.previewRenderer.preview(request); }
  async refreshDirty(documentId, options) {
    const dirty = options && options.dirty || this.dirtyTracker.snapshot(documentId);
    const layerIds = Array.from(new Set([...(dirty.dirtyLayers || []), ...(dirty.dirtyGroups || [])]));
    if (!layerIds.length) return { snapshot: this.snapshotManager && this.snapshotManager.get(documentId), refreshed: false, reason: 'NO_DIRTY_LAYERS' };
    if (!this.snapshotManager || !this.snapshotManager.get(documentId)) return { snapshot: null, refreshed: false, reason: 'SNAPSHOT_MISSING' };
    const result = await this.executeRaw({ action: 'get_layer_details_many', documentId, layerIds });
    const layers = result && (result.layers || result.data && result.data.layers) || [];
    const fingerprint = result && (result.historyFingerprint || result.data && result.data.historyFingerprint);
    if (fingerprint) this.revisionManager.setFingerprint(documentId, fingerprint);
    const patches = layers.map(item => Object.assign({}, item.layer || item, item.text ? { text: item.text } : {}, item.shape ? { shape: item.shape } : {}));
    const patchOptions = Object.assign({}, options, fingerprint ? { historyFingerprint: fingerprint } : {});
    const snapshot = this.snapshotManager.patchLayers(documentId, patches, patchOptions);
    return { snapshot, refreshed: true, layerCount: patches.length, dirty, historyFingerprint: fingerprint || null };
  }
  status() {
    return {
      revisions: this.revisionManager.snapshot(),
      revisionFingerprints: this.revisionManager.fingerprintSnapshot(),
      snapshots: this.snapshotManager.status(),
      dirty: Object.fromEntries(Array.from(this.dirtyTracker.documents.entries()).map(([key]) => [key, this.dirtyTracker.snapshot(key)])),
      save: this.saveManager.snapshot(),
      preview: this.previewRenderer.status(),
      profiler: this.profiler.report()
    };
  }
}

module.exports = { BatchExecutor };
