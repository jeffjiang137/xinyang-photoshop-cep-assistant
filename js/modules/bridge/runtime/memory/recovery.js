'use strict';

const { createRecoveryLock } = require('./types');

class RecoveryLock {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.value = createRecoveryLock();
  }

  acquire({ action, taskId } = {}) {
    if (this.value.active) return false;
    this.value = {
      active: true,
      startTime: this.now(),
      action: action || 'unknown',
      taskId: taskId || null,
      stopRequested: false
    };
    return true;
  }

  requestStop() {
    if (!this.value.active) return false;
    this.value.stopRequested = true;
    return true;
  }

  release() {
    this.value = createRecoveryLock();
  }

  snapshot() {
    return Object.assign({}, this.value);
  }
}

module.exports = { RecoveryLock };
