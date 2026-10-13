'use strict';

function value(snapshot, privateKey, fallbackKey) {
  const primary = snapshot && snapshot[privateKey];
  const fallback = snapshot && snapshot[fallbackKey];
  const result = primary !== null && primary !== undefined ? primary : fallback;
  return result === null || result === undefined || !Number.isFinite(Number(result)) ? null : Number(result);
}

function privateCommitValue(snapshot) {
  if (!snapshot) return null;
  const value = snapshot.photoshopPrivateCommitMb !== null && snapshot.photoshopPrivateCommitMb !== undefined
    ? snapshot.photoshopPrivateCommitMb
    : snapshot.photoshopPrivateMb !== null && snapshot.photoshopPrivateMb !== undefined
      ? snapshot.photoshopPrivateMb : snapshot.photoshopPrivateMemoryMb;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
}

function recoveryDelta(before, after, config = {}) {
  const beforePrivate = privateCommitValue(before);
  const afterPrivate = privateCommitValue(after);
  const beforeWorking = value(before, 'photoshopWorkingSetMb', 'photoshopWorkingSetMb');
  const afterWorking = value(after, 'photoshopWorkingSetMb', 'photoshopWorkingSetMb');
  const beforeAvailable = value(before, 'systemAvailablePercent', null);
  const afterAvailable = value(after, 'systemAvailablePercent', null);
  const privateDropMb = beforePrivate === null || afterPrivate === null ? null : Number((beforePrivate - afterPrivate).toFixed(2));
  const workingSetDropMb = beforeWorking === null || afterWorking === null ? null : Number((beforeWorking - afterWorking).toFixed(2));
  const workingSetDropPercent = beforeWorking === null || beforeWorking <= 0 || workingSetDropMb === null
    ? null : Number((workingSetDropMb / beforeWorking * 100).toFixed(2));
  const systemAvailableIncreasePercent = beforeAvailable === null || afterAvailable === null
    ? null : Number((afterAvailable - beforeAvailable).toFixed(2));
  const privateThresholdMb = Number(config.recoverySuccessPrivateDropMb || 500);
  const workingSetThresholdPercent = Number(config.recoverySuccessWorkingSetDropPercent || 20);
  const availableThresholdPercent = Number(config.recoverySuccessSystemAvailableIncreasePercent || 5);
  const privateSuccess = config.recoveryPrivateCommitAffectsSuccess === true && privateDropMb !== null && privateDropMb > privateThresholdMb;
  const workingSetSuccess = workingSetDropPercent !== null && workingSetDropPercent > workingSetThresholdPercent;
  const availableSuccess = systemAvailableIncreasePercent !== null && systemAvailableIncreasePercent >= availableThresholdPercent;
  return {
    beforePrivateMb: beforePrivate,
    afterPrivateMb: afterPrivate,
    beforePrivateCommitMb: beforePrivate,
    afterPrivateCommitMb: afterPrivate,
    beforeWorkingSetMb: beforeWorking,
    afterWorkingSetMb: afterWorking,
    privateDropMb,
    privateCommitDropMb: privateDropMb,
    workingSetDropMb,
    workingSetDropPercent,
    systemAvailableIncreasePercent,
    thresholds: { privateDropMb: privateThresholdMb, workingSetDropPercent: workingSetThresholdPercent, systemAvailableIncreasePercent: availableThresholdPercent },
    success: privateSuccess || workingSetSuccess || availableSuccess,
    successBy: workingSetSuccess ? 'WORKING_SET' : availableSuccess ? 'SYSTEM_AVAILABLE' : privateSuccess ? 'PRIVATE_COMMIT' : null
  };
}

function isPressure(snapshot) {
  const status = String(snapshot && snapshot.assessment && snapshot.assessment.status || '').toUpperCase();
  return status === 'WARNING' || status === 'CRITICAL' || status === 'EMERGENCY';
}

module.exports = { recoveryDelta, isPressure };
