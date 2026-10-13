'use strict';

const { RuntimeErrorCodes } = require('./runtime-error-codes');
const { normalizeMemorySnapshot, peakSnapshot, calculateMemoryDelta } = require('./memory-snapshot');
const { MemoryStatus } = require('./memory/types');
const { MemoryStateMachine } = require('./memory/state-machine');
const { RecoveryLock } = require('./memory/recovery');
const { recoveryDelta } = require('./memory/monitor');
const { MemoryRecoveryLogger } = require('./memory/logger');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function privateValue(snapshot) {
  const value = snapshot && (snapshot.photoshopPrivateMb !== null && snapshot.photoshopPrivateMb !== undefined
    ? snapshot.photoshopPrivateMb : snapshot.photoshopPrivateMemoryMb);
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
}

function assessmentStatus(snapshot) {
  return String(snapshot && snapshot.assessment && snapshot.assessment.status || 'WARNING').toUpperCase();
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
    this.auditLogger = options.memoryLogger || new MemoryRecoveryLogger({ now: this.now, logger: this.logger });
    this.tasks = new Map();
    this.history = [];
    this.lastCleanup = null;
    this.lastMonitor = null;
    this.stateMachine = new MemoryStateMachine({ now: this.now, logger: this.logger });
    this.recoveryLock = new RecoveryLock({ now: this.now });
    this.retention = { consecutiveRetentionWarnings: 0, averageRetainedMb: 0, totalRetainedMb: 0, samples: 0, leakSuspected: false };
    this.highMemorySince = null;
    this.userConfirmationRequired = false;
    this.monitoring = false;
    this.resetVersion = 0;
  }

  get state() { return this.stateMachine.state; }

  _updateUserConfirmation(snapshot) {
    const workingSetMb = snapshot && snapshot.photoshopWorkingSetMb !== null && snapshot.photoshopWorkingSetMb !== undefined
      && Number.isFinite(Number(snapshot.photoshopWorkingSetMb)) ? Number(snapshot.photoshopWorkingSetMb) : null;
    const threshold = Number(this.config.userConfirmationWorkingSetMb || this.config.userConfirmationPrivateMb || 18000);
    const durationMs = Number(this.config.userConfirmationDurationMs || 60000);
    if (workingSetMb !== null && workingSetMb > threshold) {
      if (!this.highMemorySince) this.highMemorySince = this.now();
      if (this.now() - this.highMemorySince >= durationMs) this.userConfirmationRequired = true;
    } else {
      this.highMemorySince = null;
      this.userConfirmationRequired = false;
    }
    return {
      required: this.userConfirmationRequired,
      metric: 'photoshopWorkingSetMb',
      workingSetMb,
      thresholdMb: threshold,
      durationMs,
      sustainedMs: this.highMemorySince ? Math.max(0, this.now() - this.highMemorySince) : 0
    };
  }

  async _executePhotoshop(taskId, command) {
    if (typeof this.executeRaw !== 'function') throw Object.assign(new Error('executeRaw is not configured.'), { code: 'DOCUMENT_PROBE_UNAVAILABLE' });
    if (this.lock && this.lock.busy && this.lock.ownerTaskId !== taskId) {
      throw Object.assign(new Error('Photoshop execution lock is owned by another task.'), { code: RuntimeErrorCodes.PS_BUSY });
    }
    return this.executeRaw(command);
  }

  async _probeDocuments(activeTaskId, { allowWhenLockOwner = false } = {}) {
    if (typeof this.executeRaw !== 'function') return { openDocuments: null, probeError: { code: 'DOCUMENT_PROBE_UNAVAILABLE', message: 'executeRaw is not configured.' } };
    if (this.lock && this.lock.busy && (!allowWhenLockOwner || this.lock.ownerTaskId !== activeTaskId)) {
      return { openDocuments: null, activeDocumentId: null, probeError: { code: 'DOCUMENT_PROBE_DEFERRED', message: 'Photoshop execution is active; document probe was deferred.' } };
    }
    try {
      const result = await this._executePhotoshop(activeTaskId, { action: 'runtime_probe', reason: 'memory_snapshot' });
      return {
        openDocuments: result && result.documents !== undefined ? Number(result.documents) : null,
        activeDocumentId: result && result.activeDocumentId !== undefined ? result.activeDocumentId : null,
        probeResult: result || null
      };
    } catch (error) {
      return { openDocuments: null, probeError: { code: error.code || 'DOCUMENT_PROBE_FAILED', message: error.message || String(error) } };
    }
  }

  async capture(activeTaskId, label, { probe = true, allowProbeWhenOwner = false } = {}) {
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
    const documentProbe = probe ? await this._probeDocuments(activeTaskId, { allowWhenLockOwner: allowProbeWhenOwner }) : { openDocuments: null, activeDocumentId: null };
    const snapshot = normalizeMemorySnapshot(raw, {
      activeTaskId: activeTaskId || null,
      openDocuments: documentProbe.openDocuments,
      assessment,
      probeError: documentProbe.probeError || memoryError || null
    });
    snapshot.label = label || null;
    snapshot.activeDocumentId = documentProbe.activeDocumentId === undefined ? null : documentProbe.activeDocumentId;
    if (memoryError) snapshot.memoryError = memoryError;
    snapshot.userConfirmation = this._updateUserConfirmation(snapshot);
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
      recoveryCompleted: false,
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
      try { result.documentRecovery = await this._closeOwnedDocuments(record, reason); }
      catch (error) { result.documentRecovery = { status: 'FAILED', closed: [], failed: [{ code: error.code || 'DOCUMENT_RECOVERY_FAILED', message: error.message || String(error) }] }; }
    } else result.documentRecovery = { status: 'SKIPPED', closed: [], failed: [], reason: 'DOCUMENT_SESSION_PERSISTENCE' };
    try {
      const response = await this._executePhotoshop(record.taskId, { action: 'memory_cleanup', level: 'soft', taskId: record.taskId, reason: reason || 'TASK_FINISH' });
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
      const response = await this._executePhotoshop(record.taskId, { action: 'memory_cleanup', level: 'aggressive', requireZeroDocuments: this.config.aggressiveCleanupRequireZeroDocuments !== false, taskId: record.taskId, reason: reason || 'MEMORY_PRESSURE' });
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

  _actionFor({ reason, level, before }) {
    if (level === 'soft' || level === 'aggressive') return level;
    const critical = assessmentStatus(before) === 'CRITICAL' || String(reason || '').toUpperCase().includes('CRITICAL');
    return critical ? 'aggressive' : 'soft';
  }

  _failureCode(state) {
    if (this.userConfirmationRequired || state === MemoryStatus.CRITICAL) return RuntimeErrorCodes.PS_MEMORY_RESTART_REQUIRED;
    return RuntimeErrorCodes.MEMORY_PRESSURE;
  }

  async _runRecovery(record, { reason, level } = {}) {
    const latest = this.memoryGuard && this.memoryGuard.lastSample ? normalizeMemorySnapshot(this.memoryGuard.lastSample, { activeTaskId: record.taskId, openDocuments: record.samples.beforeTask && record.samples.beforeTask.openDocuments, assessment: this.memoryGuard.lastAssessment }) : null;
    const before = record.samples.recoveryBefore || latest || record.samples.beforeTask || await this.capture(record.taskId, 'recoveryBefore', { allowProbeWhenOwner: true });
    record.samples.recoveryBefore = before;
    const action = this._actionFor({ reason, level, before });
    if (this.userConfirmationRequired) {
      const state = this.stateMachine.completeRecovery(false, { reason: 'USER_CONFIRMATION_REQUIRED' });
      const result = { ready: false, status: state, state, code: RuntimeErrorCodes.PS_MEMORY_RESTART_REQUIRED, result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, reason: 'USER_CONFIRMATION_REQUIRED', action, before, after: before, delta: recoveryDelta(before, before, this.config) };
      record.lastRecovery = result;
      record.recoveryCompleted = true;
      return result;
    }
    if (!this.recoveryLock.acquire({ action: action === 'aggressive' ? 'purge' : 'soft_cleanup', taskId: record.taskId })) {
      return { ready: false, status: MemoryStatus.RECOVERING, state: MemoryStatus.RECOVERING, code: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, reason: 'RECOVERY_LOCK_ACTIVE', action, recoveryLock: this.recoveryLock.snapshot() };
    }
    const resetVersion = this.resetVersion;
    const startedAt = this.now();
    this.stateMachine.beginRecovery({ taskId: record.taskId, action: action === 'aggressive' ? 'purge' : 'soft_cleanup', reason: reason || null });
    record.recoveryStartedAt = new Date(startedAt).toISOString();
    let actionResult;
    let after = before;
    let delta = recoveryDelta(before, after, this.config);
    let timedOut = false;
    try {
      actionResult = action === 'aggressive'
        ? await this._aggressiveCleanup(record, before, reason)
        : await this._softCleanup(record, reason);
      const timeoutConfigured = this.config.recoveryTimeoutMs !== undefined;
      const timeoutMs = Number(timeoutConfigured ? this.config.recoveryTimeoutMs : 0);
      const pollMs = Number(this.config.recoveryPollIntervalMs || 0);
      const deadline = startedAt + Math.max(0, timeoutMs);
      do {
        if (this.recoveryLock.value.stopRequested) break;
        after = await this.capture(record.taskId, 'recoveryAfter', { allowProbeWhenOwner: true });
        record.samples.recoveryAfter = after;
        delta = recoveryDelta(before, after, this.config);
        if (delta.success) break;
        if (timeoutMs <= 0 || this.now() >= deadline) { timedOut = timeoutMs > 0; break; }
        await wait(Math.min(Math.max(1, pollMs), Math.max(1, deadline - this.now())));
      } while (this.now() <= deadline);
      const resetDuringRecovery = resetVersion !== this.resetVersion;
      const success = !resetDuringRecovery && delta.success;
      if (!delta.success && timeoutMs > 0 && this.now() >= deadline) timedOut = true;
      const state = resetDuringRecovery ? this.stateMachine.state : this.stateMachine.completeRecovery(success, { taskId: record.taskId, action, delta, timedOut, stopRequested: this.recoveryLock.value.stopRequested });
      const failureCode = this._failureCode(assessmentStatus(after));
      const result = {
        ready: success,
        status: state,
        state,
        code: success ? RuntimeErrorCodes.MEMORY_RECOVERY_SUCCESS : failureCode,
        result: success ? RuntimeErrorCodes.MEMORY_RECOVERY_SUCCESS : RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT,
        taskId: record.taskId,
        reason: resetDuringRecovery ? 'BRIDGE_RECONNECTED' : this.recoveryLock.value.stopRequested ? 'STOPPED_BY_USER' : reason || null,
        action: action === 'aggressive' ? 'purge' : 'soft_cleanup',
        before,
        after,
        delta,
        timedOut,
        waitedMs: Math.max(0, this.now() - startedAt),
        softCleanup: action === 'soft' ? actionResult : null,
        aggressiveCleanup: action === 'aggressive' ? actionResult : (before.openDocuments !== 0 ? { executed: false, skipped: true, reason: before.openDocuments === null ? 'DOCUMENT_COUNT_UNAVAILABLE' : 'USER_DOCUMENTS_OPEN' } : null),
        recoveryLock: this.recoveryLock.snapshot()
      };
      record.lastRecovery = result;
      record.recoveryCompleted = true;
      this.lastCleanup = { at: new Date(this.now()).toISOString(), taskId: record.taskId, state, result: result.code, recoveredMb: delta.workingSetDropMb, recoveredPercent: delta.workingSetDropPercent, privateCommitRecoveredMb: delta.privateCommitDropMb };
      this.auditLogger.record({ before, after, action: result.action, result: success ? 'success' : 'fail', delta, taskId: record.taskId, reason: result.reason, state, startedAt, error: success ? null : { code: result.code, message: result.timedOut ? 'Recovery timeout elapsed without the configured memory delta.' : 'Recovery delta did not meet the success threshold.' } });
      this.logger('memory.recovery.result', result);
      return result;
    } finally {
      this.recoveryLock.release();
    }
  }

  async attemptRecovery({ taskId, reason, level, manual = false } = {}) {
    const record = this.tasks.get(taskId);
    if (!record) return { ready: false, status: MemoryStatus.RECOVERY_FAILED, state: MemoryStatus.RECOVERY_FAILED, code: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, reason: 'TASK_SNAPSHOT_NOT_FOUND' };
    if (record.lastRecovery) return record.lastRecovery;
    if (this.stateMachine.state === MemoryStatus.RECOVERY_FAILED && !manual) return { ready: false, status: MemoryStatus.RECOVERY_FAILED, state: MemoryStatus.RECOVERY_FAILED, code: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, reason: 'RECOVERY_ALREADY_TERMINAL' };
    if (this.recoveryLock.value.active) return { ready: false, status: MemoryStatus.RECOVERING, state: MemoryStatus.RECOVERING, code: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, reason: 'RECOVERY_LOCK_ACTIVE', recoveryLock: this.recoveryLock.snapshot() };
    if (record.recoveryAttempts >= Number(this.config.maxRecoveryAttempts || 1)) return { ready: false, status: MemoryStatus.RECOVERY_FAILED, state: MemoryStatus.RECOVERY_FAILED, code: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, reason: 'RECOVERY_ATTEMPT_LIMIT' };
    record.recoveryAttempts += 1;
    return this._runRecovery(record, { reason, level });
  }

  async _finishCleanup(record) {
    const softCleanup = await this._softCleanup(record, 'TASK_FINISH');
    await wait(this.config.cleanupWaitMs || 0);
    const afterSoft = await this.capture(record.taskId, 'afterSoftCleanup');
    return { softCleanup, afterSoft, aggressiveCleanup: null, afterAggressive: null, afterCleanup: afterSoft };
  }

  _updateRetention(metrics) {
    const fault = this.config.faultInjection || {};
    const injectedRetention = fault.simulateRetentionMb === null || fault.simulateRetentionMb === undefined ? null : Number(fault.simulateRetentionMb);
    const useInjectedRetention = injectedRetention !== null && Number.isFinite(injectedRetention);
    const retained = useInjectedRetention ? injectedRetention : metrics.workingSetRetainedDelta;
    const threshold = Number(this.config.retentionWarningMb || 1024);
    const criticalThreshold = Number(this.config.retentionCriticalMb || 2048);
    if (retained !== null && retained >= threshold) {
      this.retention.consecutiveRetentionWarnings += 1;
      this.retention.totalRetainedMb = Number((this.retention.totalRetainedMb + retained).toFixed(2));
      this.retention.samples += 1;
    } else this.retention.consecutiveRetentionWarnings = 0;
    this.retention.averageRetainedMb = this.retention.samples ? Number((this.retention.totalRetainedMb / this.retention.samples).toFixed(2)) : 0;
    this.retention.leakSuspected = this.retention.consecutiveRetentionWarnings >= Number(this.config.retentionConsecutiveLimit || 3);
    this.retention.lastRetainedMb = retained;
    this.retention.criticalRetention = retained !== null && retained >= criticalThreshold;
    this.retention.simulated = useInjectedRetention;
    return Object.assign({}, this.retention);
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
    const cycle = record.recoveryCompleted
      ? { softCleanup: { executed: false, success: false, code: null, reason: 'RECOVERY_ALREADY_PERFORMED' }, afterSoft: null, aggressiveCleanup: null, afterAggressive: null, afterCleanup: record.samples.afterTask }
      : await this._finishCleanup(record);
    record.samples.afterCleanup = cycle.afterCleanup;
    const metrics = calculateMemoryDelta(record.samples.beforeTask, record.peakTask, record.samples.afterTask, record.samples.afterCleanup);
    const trend = this._updateRetention(metrics);
    const observed = assessmentStatus(cycle.afterCleanup);
    if (record.lastRecovery && record.lastRecovery.state === MemoryStatus.RECOVERY_SUCCESS) this.stateMachine.observe(cycle.afterCleanup.assessment, { reason: 'task_finish_after_recovery' });
    else this.stateMachine.observe(cycle.afterCleanup.assessment, { reason: 'task_finish' });
    const state = this.stateMachine.state;
    const resultCode = state === MemoryStatus.NORMAL || state === MemoryStatus.RECOVERY_SUCCESS ? RuntimeErrorCodes.MEMORY_RECOVERY_SUCCESS : state === MemoryStatus.CRITICAL ? RuntimeErrorCodes.PS_MEMORY_RESTART_REQUIRED : state === MemoryStatus.RECOVERY_FAILED ? RuntimeErrorCodes.RECOVERY_FAILED : RuntimeErrorCodes.MEMORY_PRESSURE;
    const report = {
      status: state === MemoryStatus.NORMAL ? 'READY' : state,
      state,
      legacyState: state === MemoryStatus.CRITICAL ? 'RESTART_RECOMMENDED' : state === MemoryStatus.WARNING ? 'MEMORY_PRESSURE' : state,
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
      recovery: record.lastRecovery || null,
      finishedAt: new Date(this.now()).toISOString(),
      observedStatus: observed,
      userConfirmation: this._updateUserConfirmation(cycle.afterCleanup)
    };
    this.lastCleanup = { at: report.finishedAt, taskId, state, result: resultCode, recoveredMb: metrics.workingSetCleanupRecoveredMb, recoveredPercent: metrics.workingSetCleanupRecoveredPercent, privateCommitRecoveredMb: metrics.privateCommitCleanupRecoveredMb };
    this.history.push(report);
    const maxHistory = Number(this.config.historyLimit || 50);
    if (this.history.length > maxHistory) this.history.splice(0, this.history.length - maxHistory);
    this.tasks.delete(taskId);
    this.logger('memory.recovery.completed', report);
    return report;
  }

  async monitor({ taskActive = false } = {}) {
    if (this.monitoring) return this.lastMonitor;
    this.monitoring = true;
    try {
      const snapshot = await this.capture(null, 'monitor', { probe: !taskActive });
      this.lastMonitor = { snapshot, state: this.stateMachine.observe(snapshot.assessment, { reason: 'monitor' }), userConfirmation: snapshot.userConfirmation, recoveryLock: this.recoveryLock.snapshot() };
      return this.lastMonitor;
    } finally { this.monitoring = false; }
  }

  shouldAutoRecover() {
    return !this.userConfirmationRequired
      && !this.recoveryLock.value.active
      && this.stateMachine.state !== MemoryStatus.RECOVERING
      && this.stateMachine.state !== MemoryStatus.RECOVERY_FAILED
      && this.stateMachine.state !== MemoryStatus.RECOVERY_SUCCESS;
  }

  async recoverRuntime({ reason, level, manual = false } = {}) {
    if (!manual && (this.stateMachine.state === MemoryStatus.RECOVERY_FAILED || this.stateMachine.state === MemoryStatus.RECOVERY_SUCCESS)) {
      return { status: this.stateMachine.state, state: this.stateMachine.state, reason: 'RECOVERY_ALREADY_TERMINAL', result: this.stateMachine.state === MemoryStatus.RECOVERY_SUCCESS ? RuntimeErrorCodes.MEMORY_RECOVERY_SUCCESS : RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT };
    }
    if (this.lock && this.lock.busy) return { status: 'DEFERRED', state: this.state, reason: 'PHOTOSHOP_EXECUTION_BUSY', result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT };
    if (this.recoveryLock.value.active) return { status: MemoryStatus.RECOVERING, state: MemoryStatus.RECOVERING, reason: 'RECOVERY_LOCK_ACTIVE', result: RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, recoveryLock: this.recoveryLock.snapshot() };
    const taskId = `memory_recovery_${this.now()}`;
    let permit = null;
    if (this.lock) permit = await this.lock.acquire(taskId);
    let record = null;
    try {
      record = await this.beginTask({ taskId, operation: 'MEMORY_RECOVERY' });
      record.recoveryAttempts = 1;
      return await this._runRecovery(record, { reason: reason || 'RUNTIME_RECOVERY', level: level || 'aggressive' });
    } finally {
      if (record) { record.finalized = true; this._stopPeakSampling(record); this.tasks.delete(taskId); }
      if (permit) permit.release();
    }
  }

  async manualRecovery({ level = 'soft', reason = 'USER_SAFE_RELEASE' } = {}) {
    return this.recoverRuntime({ reason, level, manual: true });
  }

  stopRecovery() {
    const requested = this.recoveryLock.requestStop();
    return { requested, recoveryLock: this.recoveryLock.snapshot(), state: this.state };
  }

  reset() {
    if (this.recoveryLock.value.active) this.recoveryLock.requestStop();
    this.resetVersion += 1;
    this.stateMachine.reset({ reason: 'bridge_reconnected' });
    this.highMemorySince = null;
    this.userConfirmationRequired = false;
    this.lastMonitor = null;
    return this.snapshot();
  }

  exportLogs() { return this.auditLogger.exportRecords ? this.auditLogger.exportRecords() : []; }

  snapshot() {
    return {
      state: this.state,
      status: this.state,
      legacyState: this.state === MemoryStatus.CRITICAL ? 'RESTART_RECOMMENDED' : this.state === MemoryStatus.WARNING ? 'MEMORY_PRESSURE' : this.state,
      activeTasks: [...this.tasks.keys()],
      lastCleanup: this.lastCleanup,
      retentionTrend: Object.assign({}, this.retention),
      historyCount: this.history.length,
      lastRecovery: this.history.length ? this.history[this.history.length - 1].recovery || this.history[this.history.length - 1] : null,
      recoveryLock: this.recoveryLock.snapshot(),
      userConfirmation: { required: this.userConfirmationRequired, metric: 'photoshopWorkingSetMb', sustainedMs: this.highMemorySince ? Math.max(0, this.now() - this.highMemorySince) : 0, thresholdMb: Number(this.config.userConfirmationWorkingSetMb || this.config.userConfirmationPrivateMb || 18000), durationMs: Number(this.config.userConfirmationDurationMs || 60000) },
      stateMachine: this.stateMachine.snapshot(),
      lastMonitor: this.lastMonitor
    };
  }
}

module.exports = { MemoryRecoveryManager };
