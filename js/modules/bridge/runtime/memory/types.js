'use strict';

const MemoryStatus = Object.freeze({
  NORMAL: 'NORMAL',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  RECOVERING: 'RECOVERING',
  RECOVERY_SUCCESS: 'RECOVERY_SUCCESS',
  RECOVERY_FAILED: 'RECOVERY_FAILED'
});

function createRecoveryLock() {
  return {
    active: false,
    startTime: null,
    action: null,
    taskId: null,
    stopRequested: false
  };
}

module.exports = { MemoryStatus, createRecoveryLock };
