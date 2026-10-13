'use strict';

const crypto = require('crypto');
const { RuntimeError, RuntimeErrorCodes, asRuntimeError } = require('./runtime-error-codes');
const { DEFAULT_RUNTIME_CONFIG, merge, operationProfile } = require('./runtime-config');
const { TaskStates, isTerminal, transition } = require('./task-state');
const { ExecutionLock } = require('./execution-lock');
const { runWithTimeout } = require('./timeout-controller');
const { CancellationRegistry } = require('./cancellation');

class TaskManager {
  constructor(options) {
    this.config = merge(DEFAULT_RUNTIME_CONFIG, options.config || {});
    this.executeRaw = options.executeRaw;
    this.health = options.health;
    this.memoryGuard = options.memoryGuard;
    this.recovery = options.recovery;
    this.memoryRecovery = options.memoryRecovery || null;
    this.logger = options.logger || (() => {});
    this.lock = options.lock || new ExecutionLock();
    this.cancellations = new CancellationRegistry();
    this.tasks = new Map();
    this.dedupe = new Map();
    this.queue = [];
    this.activeTask = null;
    this.draining = false;
    this.watchdog = null;
    this.lastWatchdogTrigger = null;
  }

  attachWatchdog(watchdog) { this.watchdog = watchdog; }
  attachMemoryRecovery(memoryRecovery) { this.memoryRecovery = memoryRecovery; }

  start() { if (this.watchdog) this.watchdog.start(); }
  stop() { if (this.watchdog) this.watchdog.stop(); }

  execute(options) {
    this._pruneFinishedTasks();
    const requestId = options.requestId || `req_${crypto.randomUUID()}`;
    const idempotencyKey = options.idempotencyKey || requestId;
    const dedupeKey = `${idempotencyKey}`;
    const previous = this.dedupe.get(dedupeKey) || this.dedupe.get(`request:${requestId}`);
    if (previous) return previous.resultPromise;
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new RuntimeError(RuntimeErrorCodes.TASK_QUEUE_FULL, `Task queue is full (max ${this.config.maxQueueSize}).`, { maxQueueSize: this.config.maxQueueSize });
    }
    if (typeof options.handler !== 'function') throw new TypeError('Task handler is required.');
    const profile = operationProfile(options.operation || options.command && options.command.action || 'WRITE_LIGHT', options.timeout || options.profile, this.config);
    const taskId = options.taskId || `task_${crypto.randomUUID()}`;
    let resolveResult;
    let rejectResult;
    const resultPromise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const task = {
      taskId, requestId, idempotencyKey, dedupeKey,
      operation: options.operation || options.command && options.command.action || 'BRIDGE_COMMAND',
      command: options.command || null,
      documentId: options.documentId === undefined ? options.command && options.command.documentId || null : options.documentId,
      state: this.activeTask || this.queue.length ? TaskStates.WAITING_FOR_LOCK : TaskStates.QUEUED,
      queued_at: new Date().toISOString(), started_at: null, finished_at: null,
      queuedAtMs: Date.now(), startedAtMs: null, finishedAtMs: null,
      soft_timeout: profile.softTimeoutMs, hard_timeout: profile.hardTimeoutMs,
      softTimeoutMs: profile.softTimeoutMs, hardTimeoutMs: profile.hardTimeoutMs,
      soft_timeout_at: null, hard_timeout_at: null,
      profile: profile.profileName, phase: 'queued',
      stateHistory: [], errors: [], warning: null, recovery: null,
      createdAt: new Date().toISOString(), resultPromise, resolveResult, rejectResult,
      handler: options.handler, checkHealth: options.checkHealth !== false,
      kind: profile.kind, sandboxDocument: options.sandboxDocument || false
    };
    transition(task, task.state);
    this.tasks.set(taskId, task);
    this.dedupe.set(dedupeKey, task);
    this.dedupe.set(`request:${requestId}`, task);
    this.queue.push(task);
    this.logger('task.queued', this.snapshotTask(task));
    this._drain();
    return resultPromise;
  }

  async _drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const task = this.queue.shift();
        if (!task || isTerminal(task.state)) continue;
        await this._runTask(task);
      }
    } finally { this.draining = false; }
  }

  async _runTask(task) {
    const token = this.cancellations.create(task.taskId);
    let permit;
    this.activeTask = task;
    try {
      if (task.state !== TaskStates.WAITING_FOR_LOCK) transition(task, TaskStates.WAITING_FOR_LOCK);
      permit = await this.lock.acquire(task.taskId);
      if (this.memoryRecovery && task.kind === 'heavy') {
        try { task.memoryTracking = await this.memoryRecovery.beginTask({ taskId: task.taskId, operation: task.operation }); }
        catch (trackingError) { this.logger('memory.snapshot.error', { taskId: task.taskId, phase: 'beforeTask', message: trackingError.message || String(trackingError) }); }
      }
      token.check('before-precheck');
      transition(task, TaskStates.PRECHECK);
      task.phase = 'precheck';
      if (this.health && task.checkHealth && task.operation !== 'runtime_probe') await this.health.check();
      if (this.memoryGuard) await this._gateMemory(task);
      this._assertDocumentLock(task);
      token.check('after-precheck');
      transition(task, TaskStates.RUNNING);
      task.phase = 'execute';
      task.startedAtMs = Date.now();
      task.soft_timeout_at = new Date(task.startedAtMs + task.softTimeoutMs).toISOString();
      task.hard_timeout_at = new Date(task.startedAtMs + task.hardTimeoutMs).toISOString();
      this.logger('task.started', this.snapshotTask(task));
      const timed = runWithTimeout(
        () => task.handler(this._context(task, token)),
        {
          softTimeoutMs: task.softTimeoutMs,
          hardTimeoutMs: task.hardTimeoutMs,
          onSoftTimeout: () => {
            task.warning = { code: RuntimeErrorCodes.TASK_TIMEOUT_WARNING, at: new Date().toISOString(), elapsedMs: Date.now() - task.startedAtMs };
            this.logger('task.timeout_warning', this.snapshotTask(task));
          },
          onHardTimeout: error => { task.warning = { code: error.code, at: new Date().toISOString() }; }
        }
      );
      try {
        const value = await timed.promise;
        token.check('after-handler');
        this._complete(task, TaskStates.COMPLETED, value, null, { settle: false });
        await this._finishMemory(task, { status: 'completed' });
        this._settleResult(task, value, null);
      } catch (error) {
        const normalized = asRuntimeError(error, RuntimeErrorCodes.PHOTOSHOP_ACTION_FAILED, 'Photoshop task failed.');
        if (normalized.code === RuntimeErrorCodes.TASK_CANCELLED || token.requested) {
          transition(task, TaskStates.CANCELLING, { code: RuntimeErrorCodes.TASK_CANCELLED });
          this._complete(task, TaskStates.CANCELLED, null, normalized);
        } else if (normalized.code === RuntimeErrorCodes.TASK_TIMEOUT) {
          this._complete(task, TaskStates.TIMEOUT, null, normalized);
        } else {
          this._complete(task, TaskStates.FAILED, null, normalized, { settle: false });
        }
        try { await timed.underlying; } catch (ignored) {}
        await this._recover(task, normalized);
        await this._finishMemory(task, { status: 'failed', code: normalized.code });
        if (normalized.code !== RuntimeErrorCodes.TASK_CANCELLED && normalized.code !== RuntimeErrorCodes.TASK_TIMEOUT) this._settleResult(task, null, normalized);
      } finally { timed.cleanup(); }
    } catch (error) {
      const normalized = asRuntimeError(error, RuntimeErrorCodes.BRIDGE_UNHEALTHY, 'Runtime precheck failed.');
      if (normalized.code === RuntimeErrorCodes.TASK_CANCELLED || token.requested) this._complete(task, TaskStates.CANCELLED, null, normalized);
      else if ([RuntimeErrorCodes.PS_MEMORY_CRITICAL, RuntimeErrorCodes.PS_MEMORY_EMERGENCY, RuntimeErrorCodes.PS_MEMORY_WARNING, RuntimeErrorCodes.MEMORY_PRESSURE, RuntimeErrorCodes.MEMORY_LEAK_SUSPECTED, RuntimeErrorCodes.PS_MEMORY_RESTART_REQUIRED, RuntimeErrorCodes.PS_BUSY, RuntimeErrorCodes.PS_MODAL, RuntimeErrorCodes.PS_UNRESPONSIVE].includes(normalized.code)) this._complete(task, TaskStates.ABORTED, null, normalized, { settle: false });
      else this._complete(task, TaskStates.FAILED, null, normalized, { settle: false });
      await this._recover(task, normalized);
      await this._finishMemory(task, { status: 'aborted', code: normalized.code });
      if (normalized.code !== RuntimeErrorCodes.TASK_CANCELLED) this._settleResult(task, null, normalized);
      // A CEP evalScript timeout does not cancel the host-side operation.
      // Keep the lock until the underlying probe callback settles.
      if (normalized.pendingPromise) {
        try { await normalized.pendingPromise; } catch (ignored) {}
      }
    } finally {
      if (permit) permit.release();
      this.cancellations.remove(task.taskId);
      if (this.activeTask === task) this.activeTask = null;
      // Idempotency keeps the settled result, not the execution closure and
      // potentially large command payload. Only release after underlying work.
      task.handler = null;
      task.command = null;
      task.resolveResult = null;
      task.rejectResult = null;
      this.logger('task.finished', this.snapshotTask(task));
      this._pruneFinishedTasks();
    }
  }

  _context(task, token) {
    return {
      taskId: task.taskId,
      requestId: task.requestId,
      checkCancellation: checkpoint => token.check(checkpoint),
      setPhase: phase => { task.phase = phase; },
      memory: Object.assign({ mode: 'NORMAL' }, task.memoryPolicy || {}),
      registerDocument: record => this.recovery && this.recovery.registerDocument(Object.assign({ taskId: task.taskId }, record)),
      unregisterDocument: record => this.recovery && this.recovery.unregisterDocument(Object.assign({ taskId: task.taskId }, record))
    };
  }

  async _gateMemory(task) {
    // Keep bounded, read-only health/menu diagnostics available when memory is
    // high. Do not exempt general reads (which can scan a large document), or
    // accept a mismatched operation label for a different command.
    const diagnostic = task.operation === 'runtime_probe' || task.operation === 'native_snap_diagnostics';
    if (diagnostic && (!task.command || task.command.action === task.operation)) {
      const sample = await this.memoryGuard.sample();
      const assessment = this.memoryGuard.snapshot().assessment;
      task.memoryPolicy = { mode: 'DIAGNOSTIC_ONLY', checkpointRequired: false };
      if (assessment && assessment.emergency) task.warning = { code: RuntimeErrorCodes.PS_MEMORY_EMERGENCY, mode: 'DIAGNOSTIC_ONLY', at: new Date().toISOString() };
      return { sample, assessment, degraded: !!(assessment && assessment.degraded), policy: task.memoryPolicy };
    }
    let admission;
    try {
      admission = await this.memoryGuard.gate({ heavy: task.kind === 'heavy' });
    } catch (error) {
      const normalized = asRuntimeError(error, RuntimeErrorCodes.PS_MEMORY_WARNING, 'Photoshop memory gate failed.');
      if (normalized.code === RuntimeErrorCodes.PS_MEMORY_EMERGENCY) throw normalized;
      const assessment = normalized.details && normalized.details.assessment || this.memoryGuard.snapshot().assessment || {};
      admission = {
        sample: normalized.details && normalized.details.sample || this.memoryGuard.snapshot().sample || null,
        assessment,
        degraded: true,
        policy: {
          mode: 'DEGRADED',
          maxBatchOperations: Number(this.config.memory.degradedBatchOperations || 30),
          maxPreviewScale: Number(this.config.memory.degradedPreviewScale || 0.25),
          checkpointRequired: true,
          skipLargeObjectCreation: true
        }
      };
    }

    if (task.kind !== 'heavy' || !admission.degraded) {
      task.memoryPolicy = Object.assign({ mode: 'NORMAL' }, admission.policy || {});
      return admission;
    }

    task.memoryPolicy = Object.assign({
      mode: 'DEGRADED',
      status: admission.assessment && admission.assessment.status || 'WARNING',
      checkpointRequired: true,
      skipLargeObjectCreation: true,
      maxBatchOperations: Number(this.config.memory.degradedBatchOperations || 30),
      maxPreviewScale: Number(this.config.memory.degradedPreviewScale || 0.25)
    }, admission.policy || {});

    if (!this.memoryRecovery) {
      task.warning = { code: RuntimeErrorCodes.PS_MEMORY_WARNING, mode: 'DEGRADED_MEMORY', at: new Date().toISOString() };
      return admission;
    }

    let recovery;
    try {
      recovery = await this.memoryRecovery.attemptRecovery({ taskId: task.taskId, reason: admission.assessment && admission.assessment.critical ? RuntimeErrorCodes.PS_MEMORY_CRITICAL : RuntimeErrorCodes.PS_MEMORY_WARNING });
    } catch (recoveryError) {
      recovery = {
        ready: false,
        state: 'RECOVERY_FAILED',
        code: recoveryError.code || RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT,
        error: { code: recoveryError.code || RuntimeErrorCodes.MEMORY_RECOVERY_INSUFFICIENT, message: recoveryError.message || String(recoveryError) }
      };
    }
    task.memoryRecoveryPrecheck = recovery;
    this.logger('memory.recovery.gate', { taskId: task.taskId, recovery, mode: task.memoryPolicy.mode });

    if (recovery && recovery.ready) {
      const refreshed = await this.memoryGuard.gate({ heavy: false });
      task.memoryPolicy = Object.assign({}, task.memoryPolicy, refreshed.policy || {}, { mode: refreshed.degraded ? 'DEGRADED' : 'NORMAL' });
      return Object.assign({}, refreshed, { memoryRecovery: recovery });
    }

    task.warning = {
      code: recovery && recovery.code || RuntimeErrorCodes.MEMORY_PRESSURE,
      mode: 'DEGRADED_MEMORY',
      at: new Date().toISOString(),
      recovery: recovery || null
    };
    return Object.assign({}, admission, { memoryRecovery: recovery || null });
  }

  async _finishMemory(task, outcome) {
    if (!this.memoryRecovery || task.kind !== 'heavy') return null;
    try {
      task.memoryRecovery = await this.memoryRecovery.finishTask({ taskId: task.taskId, outcome });
      return task.memoryRecovery;
    } catch (error) {
      task.memoryRecovery = { status: 'RECOVERY_FAILED', state: 'MEMORY_PRESSURE', result: RuntimeErrorCodes.MEMORY_PRESSURE, error: { code: error.code || RuntimeErrorCodes.RECOVERY_FAILED, message: error.message || String(error) } };
      this.logger('memory.recovery.error', { taskId: task.taskId, error: task.memoryRecovery.error });
      return task.memoryRecovery;
    }
  }

  _assertDocumentLock(task) {
    if (task.documentId === null || task.documentId === undefined) return;
    const owner = this.activeTask;
    if (owner && owner.taskId !== task.taskId && !isTerminal(owner.state) && owner.documentId !== null && Number(owner.documentId) === Number(task.documentId)) {
      throw new RuntimeError(RuntimeErrorCodes.DOCUMENT_LOCK_CONFLICT, `Document ${task.documentId} is owned by another task.`, { documentId: task.documentId, ownerTaskId: owner.taskId });
    }
  }

  _pruneFinishedTasks() {
    const retentionMs = Math.max(0, Number(this.config.idempotencyRetentionMs || 0));
    const maxHistory = Math.max(0, Number(this.config.maxTaskHistory || 0));
    const now = Date.now();
    const terminal = Array.from(this.tasks.values()).filter(task => isTerminal(task.state));
    terminal.sort((left, right) => (left.finishedAtMs || 0) - (right.finishedAtMs || 0));
    const overflow = Math.max(0, terminal.length - maxHistory);
    for (let index = 0; index < terminal.length; index += 1) {
      const task = terminal[index];
      const expired = retentionMs === 0 || (task.finishedAtMs && now - task.finishedAtMs >= retentionMs);
      if (!expired && index >= overflow) continue;
      this.tasks.delete(task.taskId);
      if (this.dedupe.get(task.dedupeKey) === task) this.dedupe.delete(task.dedupeKey);
      if (this.dedupe.get(`request:${task.requestId}`) === task) this.dedupe.delete(`request:${task.requestId}`);
    }
  }

  async _recover(task, error) {
    if (!this.recovery) return;
    const owned = this.recovery.listOwned(task.taskId);
    if (!owned.length) return;
    task.recovery = { status: 'RECOVERING', startedAt: new Date().toISOString() };
    try {
      const recovery = await this.recovery.recover({ taskId: task.taskId, reason: error.code });
      task.recovery = Object.assign(task.recovery, recovery, { finishedAt: new Date().toISOString() });
    } catch (recoveryError) {
      task.recovery = { status: 'FAILED', error: { code: RuntimeErrorCodes.RECOVERY_FAILED, message: recoveryError.message } };
    }
  }

  _complete(task, state, value, error, options) {
    if (isTerminal(task.state)) return;
    transition(task, state, error ? { code: error.code } : null);
    task.finishedAtMs = Date.now();
    if (options && options.settle === false) return;
    this._settleResult(task, value, error);
  }

  _settleResult(task, value, error) {
    if (task.resultSettled) return;
    task.resultSettled = true;
    if (error) {
      task.errors.push({ code: error.code || RuntimeErrorCodes.BRIDGE_UNHEALTHY, message: error.message, details: error.details || null });
      task.rejectResult(Object.assign(error, { taskId: task.taskId }));
    } else task.resolveResult(value);
  }

  cancel(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw Object.assign(new Error(`Task ${taskId} not found.`), { code: 'TASK_NOT_FOUND' });
    if (isTerminal(task.state)) return this.snapshotTask(task);
    const token = this.cancellations.get(taskId);
    if (token) token.request();
    if (!this.activeTask || this.activeTask.taskId !== taskId) this._complete(task, TaskStates.CANCELLED, null, new RuntimeError(RuntimeErrorCodes.TASK_CANCELLED, `Task ${taskId} cancelled before execution.`));
    else if (task.state === TaskStates.RUNNING || task.state === TaskStates.PRECHECK) transition(task, TaskStates.CANCEL_REQUESTED);
    this.logger('task.cancel_requested', this.snapshotTask(task));
    return this.snapshotTask(task);
  }

  getTask(taskId) { const task = this.tasks.get(taskId); return task ? this.snapshotTask(task) : null; }

  runtimeStatus() {
    return {
      bridge: 'READY',
      photoshop: this.health ? this.health.snapshot().status : 'UNKNOWN',
      cep: this.health ? (this.health.snapshot().lastCepHeartbeat ? 'READY' : 'UNKNOWN') : 'UNKNOWN',
      queueLength: this.queue.filter(task => !isTerminal(task.state)).length,
      activeTask: this.activeTask ? this.snapshotTask(this.activeTask) : null,
      memory: this.memoryGuard ? this.memoryGuard.snapshot() : {},
      memoryRecovery: this.memoryRecovery ? this.memoryRecovery.snapshot() : null,
      watchdog: this.watchdog ? this.watchdog.snapshot() : { status: 'NOT_STARTED' },
      lock: { busy: this.lock.busy, ownerTaskId: this.lock.ownerTaskId },
      recovery: this.recovery ? this.recovery.snapshot() : null
    };
  }

  snapshotTask(task) {
    return {
      taskId: task.taskId, requestId: task.requestId, idempotencyKey: task.idempotencyKey,
      operation: task.operation, documentId: task.documentId, state: task.state, phase: task.phase,
      queued_at: task.queued_at, started_at: task.started_at, finished_at: task.finished_at,
      soft_timeout: task.soft_timeout, hard_timeout: task.hard_timeout,
      soft_timeout_at: task.soft_timeout_at, hard_timeout_at: task.hard_timeout_at,
      profile: task.profile, warning: task.warning, errors: task.errors.slice(), recovery: task.recovery,
      memory: task.memory || null,
      memoryTracking: task.memoryTracking ? { taskId: task.memoryTracking.taskId, startedAt: task.memoryTracking.startedAt } : null,
      memoryRecoveryPrecheck: task.memoryRecoveryPrecheck || null,
      memoryRecovery: task.memoryRecovery || null,
      stateHistory: task.stateHistory.slice()
    };
  }
}

module.exports = { TaskManager };
