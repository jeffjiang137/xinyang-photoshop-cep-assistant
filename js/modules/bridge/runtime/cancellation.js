'use strict';

const { RuntimeError, RuntimeErrorCodes } = require('./runtime-error-codes');

class CancellationToken {
  constructor(taskId) {
    this.taskId = taskId;
    this.requested = false;
    this.requestedAt = null;
  }

  request() {
    this.requested = true;
    this.requestedAt = this.requestedAt || new Date().toISOString();
  }

  check(checkpoint) {
    if (!this.requested) return;
    throw new RuntimeError(RuntimeErrorCodes.TASK_CANCELLED, `Task ${this.taskId} cancelled at ${checkpoint || 'checkpoint'}.`, { taskId: this.taskId, checkpoint: checkpoint || null });
  }
}

class CancellationRegistry {
  constructor() { this.tokens = new Map(); }
  create(taskId) { const token = new CancellationToken(taskId); this.tokens.set(taskId, token); return token; }
  get(taskId) { return this.tokens.get(taskId); }
  remove(taskId) { this.tokens.delete(taskId); }
}

module.exports = { CancellationToken, CancellationRegistry };
