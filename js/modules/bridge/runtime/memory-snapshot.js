'use strict';

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMemorySnapshot(sample, context) {
  const source = sample || {};
  const timestamp = Number(source.timestamp || Date.now());
  const privateCommitMb = source.photoshopPrivateCommitMb !== undefined && source.photoshopPrivateCommitMb !== null
    ? source.photoshopPrivateCommitMb
    : source.photoshopPrivateMb !== undefined && source.photoshopPrivateMb !== null
      ? source.photoshopPrivateMb : source.photoshopPrivateMemoryMb;
  const bridgeMb = source.bridgeWorkingSetMb !== undefined && source.bridgeWorkingSetMb !== null
    ? source.bridgeWorkingSetMb : source.bridgeRssMb;
  return {
    timestamp,
    sampledAt: source.sampledAt || new Date(timestamp).toISOString(),
    systemTotalMb: numberOrNull(source.systemTotalMb !== undefined ? source.systemTotalMb : source.systemTotalMemoryMb),
    systemAvailableMb: numberOrNull(source.systemAvailableMb !== undefined ? source.systemAvailableMb : source.systemAvailableMemoryMb),
    systemAvailablePercent: numberOrNull(source.systemAvailablePercent),
    photoshopWorkingSetMb: numberOrNull(source.photoshopWorkingSetMb),
    photoshopPrivateCommitMb: numberOrNull(privateCommitMb),
    photoshopPrivateMb: numberOrNull(privateCommitMb),
    photoshopPrivateMemoryMb: numberOrNull(privateCommitMb),
    bridgeWorkingSetMb: numberOrNull(bridgeMb),
    bridgeRssMb: numberOrNull(source.bridgeRssMb !== undefined ? source.bridgeRssMb : bridgeMb),
    bridgeHeapUsedMb: numberOrNull(source.bridgeHeapUsedMb),
    openDocuments: context && context.openDocuments !== undefined ? context.openDocuments : (source.openDocuments === undefined ? null : source.openDocuments),
    activeTaskId: context && context.activeTaskId !== undefined ? context.activeTaskId : (source.activeTaskId || null),
    assessment: context && context.assessment ? context.assessment : (source.assessment || null),
    probeError: context && context.probeError ? context.probeError : null
  };
}

function privateValue(snapshot) {
  if (!snapshot) return null;
  const value = snapshot.photoshopPrivateCommitMb !== null && snapshot.photoshopPrivateCommitMb !== undefined
    ? snapshot.photoshopPrivateCommitMb
    : snapshot.photoshopPrivateMb !== null && snapshot.photoshopPrivateMb !== undefined
      ? snapshot.photoshopPrivateMb : snapshot.photoshopPrivateMemoryMb;
  return numberOrNull(value);
}

function peakSnapshot(current, candidate) {
  if (!current) return candidate;
  const currentWorking = numberOrNull(current.photoshopWorkingSetMb);
  const candidateWorking = numberOrNull(candidate.photoshopWorkingSetMb);
  if (candidateWorking === null) return current;
  if (currentWorking === null || candidateWorking >= currentWorking) return candidate;
  return current;
}

function calculateMemoryDelta(beforeTask, peakTask, afterTask, afterCleanup) {
  const before = privateValue(beforeTask);
  const peak = privateValue(peakTask);
  const after = privateValue(afterTask);
  const cleanup = privateValue(afterCleanup);
  const beforeWorking = numberOrNull(beforeTask && beforeTask.photoshopWorkingSetMb);
  const peakWorking = numberOrNull(peakTask && peakTask.photoshopWorkingSetMb);
  const afterWorking = numberOrNull(afterTask && afterTask.photoshopWorkingSetMb);
  const cleanupWorking = numberOrNull(afterCleanup && afterCleanup.photoshopWorkingSetMb);
  const retainedDelta = before === null || cleanup === null ? null : Number((cleanup - before).toFixed(2));
  const peakDelta = before === null || peak === null ? null : Number((peak - before).toFixed(2));
  const recovered = after === null || cleanup === null ? null : Number((after - cleanup).toFixed(2));
  const workingSetRetainedDelta = beforeWorking === null || cleanupWorking === null ? null : Number((cleanupWorking - beforeWorking).toFixed(2));
  const workingSetPeakDelta = beforeWorking === null || peakWorking === null ? null : Number((peakWorking - beforeWorking).toFixed(2));
  const workingSetRecovered = afterWorking === null || cleanupWorking === null ? null : Number((afterWorking - cleanupWorking).toFixed(2));
  const workingSetRecoveredPercent = afterWorking === null || cleanupRecoveredMbIsInvalid(workingSetRecovered, afterWorking)
    ? null : Number((workingSetRecovered / Math.max(1, afterWorking) * 100).toFixed(2));
  return {
    // Legacy private-memory deltas are retained for callers; on Windows they describe commit size.
    taskPrivateDelta: retainedDelta,
    retainedDelta: workingSetRetainedDelta,
    peakDelta: workingSetPeakDelta,
    cleanupRecoveredMb: workingSetRecovered,
    cleanupRecoveredPercent: workingSetRecoveredPercent,
    privateCommitRetainedDelta: retainedDelta,
    privateCommitPeakDelta: peakDelta,
    privateCommitCleanupRecoveredMb: recovered,
    workingSetRetainedDelta,
    workingSetPeakDelta,
    workingSetCleanupRecoveredMb: workingSetRecovered,
    workingSetCleanupRecoveredPercent: workingSetRecoveredPercent
  };
}

function cleanupRecoveredMbIsInvalid(value, denominator) { return value === null || value === undefined || denominator === null || denominator === undefined; }

module.exports = { normalizeMemorySnapshot, peakSnapshot, calculateMemoryDelta, privateValue };
