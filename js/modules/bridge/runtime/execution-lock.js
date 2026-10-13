'use strict';

const { RuntimeError, RuntimeErrorCodes } = require('./runtime-error-codes');

class ExecutionLock {
  constructor() {
    this._tail = Promise.resolve();
    this._owner = null;
  }

  async acquire(taskId) {
    const previous = this._tail;
    let releaseWait;
    this._tail = new Promise(resolve => { releaseWait = resolve; });
    await previous;
    this._owner = taskId;
    let released = false;
    return {
      taskId,
      release: () => {
        if (released) return;
        released = true;
        if (this._owner === taskId) this._owner = null;
        releaseWait();
      }
    };
  }

  assertOwner(taskId) {
    if (this._owner !== taskId) throw new RuntimeError(RuntimeErrorCodes.TASK_LOCKED, 'Photoshop execution lock is not owned by this task.');
  }

  get ownerTaskId() { return this._owner; }
  get busy() { return this._owner !== null; }
}

module.exports = { ExecutionLock };
