'use strict';

const { RuntimeErrorCodes } = require('./runtime-error-codes');
const { normalizeMemorySnapshot, peakSnapshot, calculateMemoryDelta } = require('./memory-snapshot');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

class MemoryRecoveryManager {
  constructor(options) {
    this.config = options.config || {};
    this.memoryGuard = options.memoryGuard;
    this.executeRaw = options.executeRaw;
    this.recovery = options.recovery || null;
    this.lock = options.lock || null;
    this.logger = options.logger || (() => {});
    this.now = options.now || (() => Date.now());
    this.tasks = new Map();
    this.history = [];
    this.lastCleanup = null;
    this.state = 'NORMAL';
    this.retention = { consecutiveRetentionWarnings: 0, averageRetainedMb: 0, totalRetainedMb: 0, samples: 0, leakSuspected: false };
  }

  async _probeDocuments(activeTaskId) {
    if (typeof this.executeRaw !== 'function') return { openDocuments: null, probeError: { code: 'DOCUMENT_PROBE_UNAVAILABLE', message: 'executeRaw is not configured.' } };
    try {
      const result = await this.executeRaw({ action: 'runtime_probe', reason: 'memory_snapshot' });
      return {
        openDocuments: result && result.documents !== undefined ? Number(result.documents) : null,
        activeDocumentId: result && result.activeDocumentId !== undefined ? result.activeDocumentId : null,
        probeResult: result || null
      };
    } catch (error) {
      return { openDocuments: null, probeError: { code: error.code || 'DOCUMENT_PROBE_FAILED', message: error.message || String(error) } };
    }
  }

  async capture(activeTaskId, label) {
    let raw = {};
    let assessment = null;
    let memoryError = null;
    try {
      raw = await this.memoryGuard.sample();
      assessment = this.memoryGuard.lastAssessment;
    } catch (error) {
      memoryError = { code: error.code || 'MEMORY_SAMPLE_FAILED', message: error.message || String(error) };
      raw = this.memoryGuard.lastSample || {};
      assessment = this.memoryGuard.lastAssessment || null;
    }
    const probe = await this._probeDocuments(activeTaskId);
    const snapshot = normalizeMemorySnapshot(raw, {
      activeTaskId: activeTaskId || null,
      openDocuments: probe.openDocuments,
      assessment,
      probeError: probe.probeError || memoryError || null
    });
    snapshot.label = label || null;
    snapshot.activeDocumentId = probe.activeDocumentId === undefined ? null : probe.activeDocumentId;
    if (memoryError) snapshot.memoryError = memoryError;
    return snapshot;
  }

  async beginTask({ taskId, operation }) {
    if (!taskId) return null;
    const existing = this.tasks.get(taskId);
    if (existing) return existing;
    const record = {
      taskId,
      operation: operation || null,
      startedAt: new Date(this.now()).toISOString(),
      samples: {},
      peakTask: null,
      recoveryAttempts: 0,
      sampling: false,
      peakTimer: null,
      lastSamplePromise: null,
      finalized: false
    };
    this.tasks.set(taskId, record);
    record.samples.beforeTask = await this.capture(taskId, 'beforeTask');
    record.peakTask = record.samples.beforeTask;
    const interval = Number(this.config.peakSampleIntervalMs || 0);
    if (interval > 0) {
      record.peakTimer = setInterval(() => {
        this._samplePeak(record).catch(error => this.logger('memory.snapshot.error', { taskId, phase: 'peakTask', message: error.message || String(error) }));
      }, interval);
      if (record.peakTimer.unref) record.peakTimer.unref();
    }
    return record;
  }

  async _samplePeak(record) {
    if (!record || record.finalized || record.sampling) return;
    record.sampling = true;
    record.lastSamplePromise = this.capture(record.taskId, 'peakTask');
    try {
      const sample = await record.lastSamplePromise;
      record.peakTask = peakSnapshot(record.peakTask, sample);
      record.samples.peakTask = record.peakTask;
    } finally {
      record.sampling = false;
      record.lastSamplePromise = null;
    }
  }

  _stopPeakSampling(record) {
    if (!record) return;
    if (record.peakTimer) clearInterval(record.peakTimer);
    record.peakTimer = null;
  }

  async _closeOwnedDocuments(record, reason) {
    if (!this.recovery) return { status: 'SKIPPED', closed: [], failed: [], reason: 'RECOVERY_MANAGER_UNAVAILABLE' };
    const owned = this.recovery.listOwned(record.taskId);
    if (!owned.length) return { status: 'SKIPPED', closed: [], failed: [], reason: 'NO_AUTOMATION_DOCUMENTS' };
    return this.recovery.recover({ taskId: record.taskId, reason: reason || 'MEMORY_SOFT_CLEANUP' });
  }

  async _softCleanup(record, reason) {
    const result = { executed: false, success: false, code: null, documentRecovery: null, jsx: null };
    if (this.config.softCleanupEnabled === false) {
      result.code = 'MEMORY_SOFT_CLEANUP_DISABLED';
      return result;
    }
    result.executed = true;
    if (this.config.faultInjection && this.config.faultInjection.simulateCleanupFailure === true) {
      result.code = RuntimeErrorCodes.MEMORY_SOFT_CLEANUP_FAILED;
      result.error = { code: 'FAULT_INJECTION_CLEANUP_FAILURE', message: 'Cleanup failure was injected for testing.' };
      this.logger('memory.soft_cleanup', { taskId: record.taskId, reason: reason || null, result });
      return result;
    }
    if (this.config.closeAutomationDocumentsOnTaskFinish === true && this.config.preserveAutomationDocumentsOnTaskFinish !== true) {
      try {
        result.documentRecovery = await this._closeOwnedDocuments(record, reason);
      } catch (error) {
        result.documentRecovery = { status: 'FAILED', closed: [], failed: [{ code: error.code || 'DOCUMENT_RECOVERY_FAILED', message: error.message || String(error) }] };
      }
    } else {
      result.documentRecovery = { status: 'SKIPPED', closed: [], failed: [], reason: 'DOCUMENT_SESSION_PERSISTENCE' };
    }
    try {
      const response = await this.executeRaw({ action: 'memory_cleanup', level: 'soft', taskId: record.taskId, reason: reason || 'TASK_FINISH' });
      result.jsx = response;
      if (response && response.ok === false) throw Object.assign(new Error(response.error && response.error.message || 'Soft cleanup failed.'), { code: RuntimeErrorCodes.MEMORY_SOFT_CLEANUP_FAILED });
      result.success = true;
      result.code = RuntimeErrorCodes.MEMORY_SOFT_CLEANUP_OK;
    } catch (error) {
      result.code = RuntimeErrorCodes.MEMORY_SOFT_CLEANUP_FAILED;
      result.error = { code: error.code || result.code, message: error.message || String(error) };
    }
    this.logger('memory.soft_cleanup', { taskId: record.taskId, reason: reason || null, result });
    return result;
  }

  async _aggressiveCleanup(record, snapshot, reason) {
    const result = { executed: false, success: false, skipped: false, code: null, documents: snapshot ? snapshot.openDocuments : null, jsx: null };
    if (this.config.aggressiveCleanupEnabled === false) {
      result.skipped = true;
      result.code = RuntimeErrorCodes.MEMORY_AGGRESSIVE_CLEANUP_SKIPPED;
      result.reason = 'AGGRESSIVE_CLEANUP_DISABLED';
      return result;
    }
    if (this.config.aggressiveCleanupRequireZeroDocuments !== false && snapshot && snapshot.openDocuments !== 0) {
      result.skipped = true;
      result.code = RuntimeErrorCodes.MEMORY_AGGRESSIVE_CLEANUP_SKIPPED;
      result.reason = snapshot.openDocuments === null ? 'DOCUMENT_COUNT_UNAVAILABLE' : 'USER_DOCUMENTS_OPEN';
      return result;
    }
    result.executed = true;
    if (this.config.faultInjection && this.config.faultInjection.simulateCleanupFailure === true) {
      result.code = RuntimeErrorCodes.MEMORY_AGGRESSIVE_CLEANUP_FAILED;
      result.error = { code: 'FAULT_INJECTION_CLEANUP_FAILURE', message: 'Cleanup failure was injected for testing.' };
      this.logger('memory.aggressive_cleanup', { taskId: record.taskId, reason: reason || null, result });
      return result;
    }
    try {
      const response = await this.executeRaw({ action: 'memory_cleanup', level: 'aggressive', requireZeroDocuments: this.config.aggressiveCleanupRequireZeroDocuments !== false, taskId: record.taskId, reason: reason || 'MEMORY_PRESSURE' });
      result.jsx = response;
      result.documents = response && response.documents !== undefined ? Number(response.documents) : result.documents;
      if (response && response.skipped) {
        result.skipped = true;
        result.code = RuntimeErrorCodes.MEMORY_AGGRESSIVE_CLEANUP_SKIPPED;
        result.reason = response.reason || 'USER_DOCUMENTS_OPEN';
      } else if (response && response.ok === false) {
        throw Object.assign(new Error(response.error && response.error.message || 'Aggressive cleanup failed.'), { code: RuntimeErrorCodes.MEMORY_AGGRESSIVE_CLEANUP_FAILED });
      } else {
        result.success = true;
        result.code = RuntimeErrorCodes.MEMORY_AGGRESSIVE_CLEANUP_OK;
      }
    } catch (error) {
      result.code = RuntimeErrorCodes.MEMORY_AGGRESSIVE_CLEANUP_FAILED;
      result.error = { code: error.code || result.code, message: error.message || String(error) };
    }
    this.logger('memory.aggressive_cleanup', { taskId: record.taskId, reason: reason || null, result });
    return result;
  }

  async _cleanupCycle(record, reason) {
    this.state = 'RECOVERING';
    this.logger('memory.recovery.start', { taskId: record.taskId, reason: reason || null, state: this.state });
    const softCleanup = await this._softCleanup(record, reason);
    await wait(this.config.cleanupWaitMs || 0);
    const afterSoft = await this.capture(record.taskId, 'afterSoftCleanup');
    let aggressiveCleanup = null;
    let afterAggressive = null;
    const remainsPressured = afterSoft.assessment && afterSoft.assessment.status !== 'SAFE';
    if (remainsPressured) {
      aggressiveCleanup = await this._aggressiveCleanup(record, afterSoft, reason);
      if (aggressiveCleanup.executed && !aggressiveCleanup.skipped) {
        await wait(this.config.cleanupWaitMs || 0);
        afterAggressive = await this.capture(record.taskId, 'afterAggressiveCleanup');
      }
    }
    const afterCleanup = afterAggressive || afterSoft;
    return { softCleanup, afterSoft, aggressiveCleanup, afterAggressive, afterCleanup };
  }

  _setState(snapshot, trend) {
    const status = snapshot && snapshot.assessment ? snapshot.assessment.status : 'WARNING';
    if (status === 'CRITICAL' || status === 'EMERGENCY') this.state = 'RESTART_RECOMMENDED';
    else if (trend && trend.leakSuspected) this.state = 'MEMORY_LEAK_SUSPECTED';
    else if (status === 'WARNING') this.state = 'MEMORY_PRESSURE';
    else this.state = 'NORMAL';
    return this.state;
  }

  _updateRetention(metrics) {
    const fault = this.config.faultInjection || {};
    const injectedRetention = fault.simulateRetentionMb === null || fault.simulateRetentionMb === undefined ? null : Number(fault.simulateRetentionMb);
    const useInjectedRetention = injectedRetention !== null && Number.isFinite(injectedRetention);
    const retained = useInjectedRetention ? injectedRetention : metrics.retainedDelta;
    const threshold = Number(this.config.retentionWarningMb || 1024);
    const criticalThreshold = Number(this.config.retentionCriticalMb || 2048);
    if (retained !== null && retained >= threshold) {
      this.retention.consecutiveRetentionWarnings += 1;
      this.retention.totalRetainedMb = Number((this.retention.totalRetainedMb + retained).toFixed(2));
      this.retention.samples += 1;
    } else {
      this.retention.consecutiveRetentionWarnings = 0;
    }
    this.retention.averageRetainedMb = this.retention.samples ? Number((this.retention.totalRetainedMb / this.retention.samples).toFixed(2)) : 0;
    this.retention.leakSuspected = this.retention.consecutiveRetentionWarnings >= Number(this.config.retentionConsecutiveLimit || 3);
    this.retention.lastRetainedMb = retained;
    this.retention.criticalRetention = retained !== null && retained >= criticalThreshold;
    this.retention.simulated = useInjectedRetention;
    return Object.assign({}, this.retention);
  }

  async attemptRecovery({ taskId, reason }) {
    const record = this.tasks.get(taskId);
    if (!record) return { ready: false, state: 'MEMORY_PRESSURE', code: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, reason: 'TASK_SNAPSHOT_NOT_FOUND' };
    if (record.recoveryAttempts >= Number(this.config.maxRecoveryAttempts || 1)) {
      return { ready: false, state: this.state, code: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, reason: 'RECOVERY_ATTEMPT_LIMIT' };
    }
    record.recoveryAttempts += 1;
    const cycle = await this._cleanupCycle(record, reason || RuntimeErrorCodes.MEMORY_RECOVERY_START);
    const ready = !!(cycle.afterCleanup.assessment && cycle.afterCleanup.assessment.status === 'SAFE');
    const trend = this.retention;
    const state = ready ? 'NORMAL' : this._setState(cycle.afterCleanup, trend);
    const code = ready ? RuntimeErrorCodes.MEMORY_RECOVERY_SUCCESS : (state === 'RESTART_RECOMMENDED' ? RuntimeErrorCodes.PS_MEMORY_RESTART_REQUIRED : state === 'MEMORY_LEAK_SUSPECTED' ? RuntimeErrorCodes.MEMORY_LEAK_SUSPECTED : RuntimeErrorCodes.MEMORY_PRESSURE);
    const result = Object.assign({ ready, state, code, result: ready ? RuntimeErrorCodes.MEMORY_RECOVERY_SUCCESS : RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT }, cycle);
    record.lastRecovery = result;
    this.lastCleanup = { at: new Date(this.now()).toISOString(), taskId, state, result: code, recoveredMb: null };
    this.logger('memory.recovery.result', { taskId, reason: reason || null, result });
    return result;
  }

  async finishTask({ taskId, outcome }) {
    const record = this.tasks.get(taskId);
    if (!record) return { status: 'SKIPPED', state: this.state, reason: 'TASK_SNAPSHOT_NOT_FOUND' };
    record.finalized = true;
    this._stopPeakSampling(record);
    if (record.lastSamplePromise) await record.lastSamplePromise.catch(() => {});
    record.samples.afterTask = await this.capture(taskId, 'afterTask');
    record.peakTask = peakSnapshot(record.peakTask, record.samples.afterTask);
    record.samples.peakTask = record.peakTask;
    const cycle = await this._cleanupCycle(record, 'TASK_FINISH');
    record.samples.afterCleanup = cycle.afterCleanup;
    const metrics = calculateMemoryDelta(record.samples.beforeTask, record.peakTask, record.samples.afterTask, record.samples.afterCleanup);
    const trend = this._updateRetention(metrics);
    const state = this._setState(cycle.afterCleanup, trend);
    const resultCode = state === 'NORMAL' ? RuntimeErrorCodes.MEMORY_RECOVERY_SUCCESS : state === 'RESTART_RECOMMENDED' ? RuntimeErrorCodes.PS_MEMORY_RESTART_REQUIRED : state === 'MEMORY_LEAK_SUSPECTED' ? RuntimeErrorCodes.MEMORY_LEAK_SUSPECTED : RuntimeErrorCodes.MEMORY_PRESSURE;
    const report = {
      status: state === 'NORMAL' ? 'READY' : state,
      state,
      result: resultCode,
      taskId,
      operation: record.operation,
      outcome: outcome || null,
      snapshots: record.samples,
      peakTask: record.peakTask,
      deltas: metrics,
      retentionTrend: trend,
      softCleanup: cycle.softCleanup,
      aggressiveCleanup: cycle.aggressiveCleanup,
      recoveryAttempts: record.recoveryAttempts,
      finishedAt: new Date(this.now()).toISOString()
    };
    this.lastCleanup = {
      at: report.finishedAt,
      taskId,
      state,
      result: resultCode,
      recoveredMb: metrics.cleanupRecoveredMb,
      recoveredPercent: metrics.cleanupRecoveredPercent
    };
    this.history.push(report);
    const maxHistory = Number(this.config.historyLimit || 50);
    if (this.history.length > maxHistory) this.history.splice(0, this.history.length - maxHistory);
    this.tasks.delete(taskId);
    this.logger('memory.recovery.completed', report);
    return report;
  }

  async recoverRuntime({ reason }) {
    if (this.lock && this.lock.busy) return { status: 'DEFERRED', state: this.state, reason: 'PHOTOSHOP_EXECUTION_BUSY', result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT };
    const taskId = `memory_recovery_${this.now()}`;
    await this.beginTask({ taskId, operation: 'MEMORY_RECOVERY' });
    return this.finishTask({ taskId, outcome: reason || 'RUNTIME_RECOVERY' });
  }

  snapshot() {
    return {
      state: this.state,
      activeTasks: [...this.tasks.keys()],
      lastCleanup: this.lastCleanup,
      retentionTrend: Object.assign({}, this.retention),
      historyCount: this.history.length,
      lastRecovery: this.history.length ? this.history[this.history.length - 1] : null
    };
  }
}

module.exports = { MemoryRecoveryManager };
