'use strict';

const { RuntimeError, RuntimeErrorCodes } = require('./runtime-error-codes');

function runWithTimeout(operation, options) {
  const softTimeoutMs = Math.max(1, Number(options.softTimeoutMs));
  const hardTimeoutMs = Math.max(softTimeoutMs, Number(options.hardTimeoutMs));
  let softTimer;
  let hardTimer;
  let hardTimedOut = false;
  const underlying = Promise.resolve().then(operation);
  const timeout = new Promise((resolve, reject) => {
    softTimer = setTimeout(() => {
      if (options.onSoftTimeout) options.onSoftTimeout();
    }, softTimeoutMs);
    hardTimer = setTimeout(() => {
      hardTimedOut = true;
      const error = new RuntimeError(RuntimeErrorCodes.TASK_TIMEOUT, `Task exceeded hard timeout of ${hardTimeoutMs}ms.`, { hardTimeoutMs });
      if (options.onHardTimeout) options.onHardTimeout(error);
      reject(error);
    }, hardTimeoutMs);
  });
  const promise = Promise.race([underlying, timeout]);
  const cleanup = () => {
    clearTimeout(softTimer);
    clearTimeout(hardTimer);
  };
  underlying.then(cleanup, cleanup);
  return { promise, underlying, cleanup, get hardTimedOut() { return hardTimedOut; } };
}

module.exports = { runWithTimeout };
