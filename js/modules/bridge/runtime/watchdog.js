'use strict';

const { RuntimeErrorCodes } = require('./runtime-error-codes');

class PhotoshopWatchdog {
  constructor(options) {
    this.taskManager = options.taskManager;
    this.health = options.health;
    this.memoryGuard = options.memoryGuard;
    this.memoryRecovery = options.memoryRecovery || null;
    this.intervalMs = options.intervalMs || 2000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 5000;
    this.heartbeat = options.heartbeat || null;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 15000;
    this.logger = options.logger || (() => {});
    this.onTrigger = options.onTrigger || (() => {});
    this.timer = null;
    this.triggered = new Set();
    this.lastTickAt = null;
    this.lastHeartbeatAt = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(error => this.logger('watchdog.error', { message: error.message })); }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick() {
    this.lastTickAt = new Date().toISOString();
    const task = this.taskManager ? this.taskManager.activeTask : null;
    if (task && task.startedAtMs && Date.now() - task.startedAtMs > task.hardTimeoutMs) {
      await this.trigger('WATCHDOG_TASK_TIMEOUT', RuntimeErrorCodes.WATCHDOG_TRIGGERED, { taskId: task.taskId });
    }
    const health = this.health ? this.health.snapshot() : null;
    if (!task && this.heartbeat && (!this.lastHeartbeatAt || Date.now() - this.lastHeartbeatAt >= this.heartbeatIntervalMs)) {
      this.lastHeartbeatAt = Date.now();
      try { await this.heartbeat(); } catch (error) { if (this.health && this.health.markError) this.health.markError(error.code || RuntimeErrorCodes.CEP_UNRESPONSIVE, error.message); }
    }
    if (!task && health && health.lastCepHeartbeat && health.agesMs.cep > this.heartbeatTimeoutMs) {
      await this.trigger('WATCHDOG_CEP_LOST', RuntimeErrorCodes.CEP_UNRESPONSIVE, { ageMs: health.agesMs.cep });
    }
    if (this.memoryGuard) {
      let memory = this.memoryGuard.snapshot();
      let monitored = null;
      if (this.memoryRecovery && typeof this.memoryRecovery.monitor === 'function') {
        monitored = await this.memoryRecovery.monitor({ taskActive: !!task });
        if (monitored && monitored.snapshot) memory = { sample: monitored.snapshot, assessment: monitored.snapshot.assessment };
      }
      if (memory.assessment && memory.assessment.critical) {
        if (task) {
          this.logger('watchdog.memory_critical_deferred', { taskId: task.taskId, memory });
        } else {
          let recovery = null;
          if (this.memoryRecovery && this.memoryRecovery.shouldAutoRecover()) recovery = await this.memoryRecovery.recoverRuntime({ reason: 'WATCHDOG_MEMORY_CRITICAL', level: 'aggressive' }).catch(error => ({ status: 'FAILED', code: error.code || RuntimeErrorCodes.PS_MEMORY_CRITICAL, message: error.message || String(error) }));
          else if (this.memoryRecovery) recovery = { status: this.memoryRecovery.state, state: this.memoryRecovery.state, reason: this.memoryRecovery.snapshot().userConfirmation.required ? 'USER_CONFIRMATION_REQUIRED' : 'RECOVERY_ALREADY_TERMINAL' };
          await this.trigger('WATCHDOG_MEMORY_CRITICAL', RuntimeErrorCodes.PS_MEMORY_CRITICAL, { memory, recovery });
        }
      }
    }
    return this.snapshot();
  }

  async trigger(rule, code, details) {
    const key = `${rule}:${details && details.taskId || 'runtime'}`;
    if (this.triggered.has(key)) return;
    this.triggered.add(key);
    const payload = { rule, code, details: details || null, at: new Date().toISOString() };
    this.logger('watchdog.triggered', payload);
    await this.onTrigger(payload);
  }

  snapshot() { return { status: 'OK', lastTickAt: this.lastTickAt, lastHeartbeatAt: this.lastHeartbeatAt ? new Date(this.lastHeartbeatAt).toISOString() : null, triggered: [...this.triggered] }; }
}

module.exports = { PhotoshopWatchdog };
