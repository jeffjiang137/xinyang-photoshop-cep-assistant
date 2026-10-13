'use strict';

const DEFAULT_OPERATION_PROFILES = Object.freeze({
  READ_LIGHT: { softTimeoutMs: 10000, hardTimeoutMs: 30000, kind: 'read' },
  DOCUMENT_SCAN: { softTimeoutMs: 60000, hardTimeoutMs: 180000, kind: 'heavy' },
  WRITE_LIGHT: { softTimeoutMs: 20000, hardTimeoutMs: 60000, kind: 'write' },
  WRITE_HEAVY: { softTimeoutMs: 45000, hardTimeoutMs: 120000, kind: 'heavy' },
  DOCUMENT_OPEN: { softTimeoutMs: 30000, hardTimeoutMs: 90000, kind: 'heavy' },
  SMART_OBJECT: { softTimeoutMs: 45000, hardTimeoutMs: 120000, kind: 'heavy' },
  EXPORT: { softTimeoutMs: 60000, hardTimeoutMs: 180000, kind: 'heavy' },
  FULL_PIPELINE: { softTimeoutMs: 180000, hardTimeoutMs: 600000, kind: 'heavy' }
});

const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  maxQueueSize: 4,
  maxTaskHistory: 100,
  idempotencyRetentionMs: 5 * 60 * 1000,
  maxFastBatchOperations: 100,
  maxSafeBatchOperations: 30,
  snapshotMaxAgeMs: 900000,
  saveCheckpointOperations: 100,
  maxStagePreviews: 3,
  allowForceKill: false,
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 15000,
  watchdogIntervalMs: 2000,
  memory: {
    warningAvailablePercent: 20,
    criticalAvailablePercent: 10,
    warningPhotoshopMb: 8192,
    criticalPhotoshopMb: 12288,
    warningPhotoshopWorkingSetMb: 8192,
    criticalPhotoshopWorkingSetMb: 12288,
    warningPhotoshopPrivateMb: 14000,
    criticalPhotoshopPrivateMb: 16384,
    emergencyAvailablePercent: 5,
    emergencyPhotoshopWorkingSetMb: 16384,
    emergencyPhotoshopPrivateMb: 18000,
    privateCommitAffectsAdmission: false,
    degradedPreviewScale: 0.25,
    degradedBatchOperations: 30,
     softCleanupEnabled: true,
     // A document created/opened by an automation session must survive the
     // request that created it. Cleanup may purge Photoshop caches, but the
     // session document is closed only by an explicit close action or failed
     // task recovery.
     preserveAutomationDocumentsOnTaskFinish: true,
     closeAutomationDocumentsOnTaskFinish: false,
     aggressiveCleanupEnabled: true,
    aggressiveCleanupRequireZeroDocuments: true,
    cleanupWaitMs: 3000,
    peakSampleIntervalMs: 1000,
    retentionWarningMb: 1024,
    retentionCriticalMb: 2048,
    retentionConsecutiveLimit: 3,
    maxRecoveryAttempts: 1,
     recoveryTimeoutMs: 30000,
     recoveryPollIntervalMs: 1000,
    recoverySuccessPrivateDropMb: 500,
    recoverySuccessWorkingSetDropPercent: 20,
    recoverySuccessSystemAvailableIncreasePercent: 5,
    recoveryPrivateCommitAffectsSuccess: false,
    userConfirmationPrivateMb: 18000,
    userConfirmationWorkingSetMb: 18000,
     userConfirmationDurationMs: 60000,
     logDir: null,
    historyLimit: 50,
    faultInjection: {
      simulateMemoryWarning: false,
      simulateMemoryCritical: false,
      simulateCleanupFailure: false,
      simulateRetentionMb: null
    }
  },
  operationProfiles: DEFAULT_OPERATION_PROFILES
});

function merge(base, override) {
  const result = Object.assign({}, base, override || {});
  Object.keys(base).forEach(key => {
    if (base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      result[key] = merge(base[key], override && override[key]);
    }
  });
  return result;
}

function operationProfile(operation, override, config) {
  const name = String(override && override.profile || operation || '').toUpperCase();
  const action = name.replace(/[^A-Z0-9_]/g, '_');
  let profileName = action;
  if (!config.operationProfiles[profileName]) {
    if (/DOCUMENT_INFO|DOCUMENT_SCAN/.test(action)) profileName = 'DOCUMENT_SCAN';
    else if (/INSPECT|LAYER_DETAILS|RUNTIME_PROBE|READ/.test(action)) profileName = 'READ_LIGHT';
    else if (/OPEN_DOCUMENT/.test(action)) profileName = 'DOCUMENT_OPEN';
    else if (/SMART|PLACE_IMAGE|REPLACE_SMART/.test(action)) profileName = 'SMART_OBJECT';
    else if (/EXPORT/.test(action)) profileName = 'EXPORT';
    else if (/PIPELINE|CANONICAL|ROUND_TRIP/.test(action)) profileName = 'FULL_PIPELINE';
    else if (/SAVE|CREATE_|SET_|UPSERT|TRANSFORM|MANAGE_|APPLY_|MOVE_|DUPLICATE|FLIP|ALIGN|SELECT|STROKE/.test(action)) profileName = 'WRITE_HEAVY';
    else profileName = 'WRITE_LIGHT';
  }
  const base = config.operationProfiles[profileName] || DEFAULT_OPERATION_PROFILES.WRITE_LIGHT;
  return Object.assign({ profileName }, base, override || {});
}

module.exports = { DEFAULT_OPERATION_PROFILES, DEFAULT_RUNTIME_CONFIG, merge, operationProfile };
