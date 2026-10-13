'use strict';

const { merge, DEFAULT_RUNTIME_CONFIG } = require('./runtime-config');
const { PhotoshopHealth } = require('./photoshop-health');
const { MemoryGuard } = require('./memory-guard');
const { MemoryRecoveryManager } = require('./memory-recovery-manager-v2');
const { MemoryRecoveryLogger } = require('./memory/logger');
const { RecoveryManager } = require('./recovery-manager');
const { TaskManager } = require('./task-manager');
const { PhotoshopWatchdog } = require('./watchdog');
const { BatchExecutor } = require('./batch-executor');
const { SnapshotManager } = require('./snapshot-manager');
const { RevisionManager } = require('./revision-manager');
const { DirtyTracker } = require('./dirty-tracker');
const { SaveManager } = require('./save-manager');
const { PreviewRenderer } = require('./preview-renderer');
const { PerformanceProfiler } = require('./performance-profiler');
const { ExecutionPlanner } = require('../planner/execution-planner');
const { BatchOptimizer } = require('../planner/batch-optimizer');
const { RiskAnalyzer } = require('../planner/risk-analyzer');

function createRuntime(options) {
  const config = merge(DEFAULT_RUNTIME_CONFIG, options.config || {});
  const logger = options.logger || (() => {});
  const profiler = options.profiler || new PerformanceProfiler();
  const executeRaw = async command => {
    const startedAt = Date.now();
    try {
      const result = await options.executeRaw(command);
      profiler.recordCall('transport', Date.now() - startedAt, { action: command && command.action, skipDuration: command && ['execute_batch', 'document_info', 'render_preview', 'save_document'].includes(command.action) });
      return result;
    } catch (error) {
      profiler.recordCall('transport', Date.now() - startedAt, { action: command && command.action, skipDuration: command && ['execute_batch', 'document_info', 'render_preview', 'save_document'].includes(command.action) });
      throw error;
    }
  };
  executeRaw.__codexTransportProfiler = true;
  const profiledProbe = typeof options.probe === 'function' ? async () => {
    const startedAt = Date.now();
    try {
      const result = await options.probe();
      profiler.recordCall('transport', Date.now() - startedAt, { action: 'runtime_probe' });
      return result;
    } catch (error) {
      profiler.recordCall('transport', Date.now() - startedAt, { action: 'runtime_probe' });
      throw error;
    }
  } : () => executeRaw({ action: 'runtime_probe', reason: 'health_check' });
  const health = new PhotoshopHealth({
    probe: profiledProbe,
    timeoutMs: config.operationProfiles.READ_LIGHT.hardTimeoutMs,
    heartbeatTimeoutMs: config.heartbeatTimeoutMs
  });
  const memoryGuard = new MemoryGuard({ config: config.memory, sampleProvider: options.sampleProvider, onSample: sample => profiler.recordMemory(sample) });
  const recovery = new RecoveryManager({ executeRaw, logger, allowForceKill: config.allowForceKill });
  const manager = new TaskManager({ config, executeRaw, health, memoryGuard, recovery, logger });
  const memoryLogger = options.memoryLogger || new MemoryRecoveryLogger({ dir: config.memory.logDir || options.memoryLogDir || null, logger });
  const memoryRecovery = new MemoryRecoveryManager({ config: config.memory, memoryGuard, executeRaw, recovery, lock: manager.lock, logger, memoryLogger });
  manager.attachMemoryRecovery(memoryRecovery);
  const snapshotManager = options.snapshotManager || new SnapshotManager({ maxAgeMs: config.snapshotMaxAgeMs || 15 * 60 * 1000 });
  const revisionManager = options.revisionManager || new RevisionManager();
  const dirtyTracker = options.dirtyTracker || new DirtyTracker();
  const saveManager = options.saveManager || new SaveManager({ maxOperations: config.saveCheckpointOperations || 100 });
  const previewRenderer = options.previewRenderer || new PreviewRenderer({
    profiler,
    dirtyTracker,
    maxStagePreviews: config.maxStagePreviews || 3,
    render: request => manager.execute({
      operation: 'render_preview',
      profile: { profile: 'EXPORT' },
      documentId: request && request.documentId,
      checkHealth: true,
      handler: context => {
            const bounded = Object.assign({}, request, { action: 'render_preview' });
            if (context && context.memory && context.memory.mode === 'DEGRADED') {
              bounded.fullResolution = false;
              bounded.scale = Math.min(Number(bounded.scale || 0.5), Number(context.memory.maxPreviewScale || config.memory.degradedPreviewScale || 0.25));
            }
            return executeRaw(bounded);
          }
    })
  });
  const executionPlanner = options.executionPlanner || new ExecutionPlanner({
    riskAnalyzer: options.riskAnalyzer || new RiskAnalyzer(),
    batchOptimizer: options.batchOptimizer || new BatchOptimizer({
      maxFastOperations: config.maxFastBatchOperations || 100,
      maxSafeOperations: config.maxSafeBatchOperations || 30
    })
  });
  const batchExecutor = new BatchExecutor({
    taskManager: manager,
    executeRaw,
    snapshotManager,
    revisionManager,
    dirtyTracker,
    saveManager,
    profiler,
    previewRenderer,
    executionPlanner,
    maxFastOperations: config.maxFastBatchOperations || 100,
    maxSafeOperations: config.maxSafeBatchOperations || 30
  });
  const watchdog = new PhotoshopWatchdog({
    taskManager: manager,
    health,
    memoryGuard,
    memoryRecovery,
    intervalMs: config.watchdogIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    heartbeatTimeoutMs: config.heartbeatTimeoutMs,
    heartbeat: () => { const id = `heartbeat_${Date.now()}`; return manager.execute({ operation: 'runtime_probe', requestId: id, idempotencyKey: id, checkHealth: false, handler: () => profiledProbe() }).then(result => { health.markPhotoshopProbe(result); return result; }); },
    logger,
    onTrigger: options.onWatchdogTrigger
  });
  manager.attachWatchdog(watchdog);
  return {
    config, manager, health, memoryGuard, memoryRecovery, recovery, watchdog,
    batchExecutor, snapshotManager, revisionManager, dirtyTracker, saveManager, previewRenderer, profiler, executionPlanner,
    refreshDirty(documentId, refreshOptions) { return batchExecutor.refreshDirty(documentId, refreshOptions); },
    start() { health.markBridgeHeartbeat(); manager.start(); },
    stop() { manager.stop(); },
    markBridgeHeartbeat() { health.markBridgeHeartbeat(); },
    markCepHeartbeat() { health.markCepHeartbeat(); },
    manualRecovery(options) { return memoryRecovery.manualRecovery(options); },
    stopRecovery() { return memoryRecovery.stopRecovery(); },
    resetMemoryProtection() { return memoryRecovery.reset(); },
    exportMemoryLogs() { return memoryRecovery.exportLogs(); },
    save(saveOptions) {
      const request = saveOptions || {};
      const startedAt = Date.now();
      return saveManager.save(
        metadata => manager.execute({
          operation: 'save_document',
          documentId: request.documentId,
          handler: () => executeRaw({ action: 'save_document', documentId: request.documentId, path: request.path || null })
        }),
        request.kind || 'checkpoint',
        request
      ).then(result => {
        profiler.recordSave(Date.now() - startedAt, { kind: request.kind || 'checkpoint', documentId: request.documentId });
        return result;
      });
    },
    status() { if (memoryGuard.lastSample) profiler.recordMemory(memoryGuard.lastSample); return Object.assign(manager.runtimeStatus(), { batch: batchExecutor.status(), profiler: profiler.report() }); }
  };
}

module.exports = { createRuntime };
