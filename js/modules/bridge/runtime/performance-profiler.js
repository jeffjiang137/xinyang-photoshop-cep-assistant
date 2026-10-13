'use strict';

class PerformanceProfiler {
  constructor(options) {
    this.clock = options && options.clock || (() => Date.now());
    this.slowMs = Object.assign({ SLOW: 1000, VERY_SLOW: 5000, CRITICAL: 15000 }, options && options.slowMs);
    this.reset();
  }

  reset() {
    this.counters = {
      mcpCallCount: 0,
      batchCount: 0,
      operationCount: 0,
      snapshotRefreshCount: 0,
      previewCount: 0,
      saveCount: 0,
      psdScanCount: 0
    };
    this.durations = { planningMs: 0, transportMs: 0, photoshopMs: 0, previewMs: 0, saveMs: 0, otherMs: 0 };
    this.slowOperations = [];
    this.peakMemory = null;
    this.operationTimeMs = 0;
    this.operationSamples = 0;
    this.measuredOperationTimeMs = 0;
    this.operationLog = [];
    this.startedAt = this.clock();
  }

  start(kind) {
    const startedAt = this.clock();
    return { kind: kind || 'other', startedAt };
  }

  finish(handle, metadata) {
    const durationMs = Math.max(0, this.clock() - handle.startedAt);
    const kind = handle.kind || 'other';
    const key = kind + 'Ms';
    if (Object.prototype.hasOwnProperty.call(this.durations, key)) this.durations[key] += durationMs;
    else this.durations.otherMs += durationMs;
    const level = durationMs >= this.slowMs.CRITICAL ? 'CRITICAL'
      : durationMs >= this.slowMs.VERY_SLOW ? 'VERY_SLOW'
        : durationMs >= this.slowMs.SLOW ? 'SLOW' : null;
    if (level) this.slowOperations.push({ level, durationMs, kind, metadata: metadata || null });
    return durationMs;
  }

  operationLevel(durationMs) {
    return durationMs >= this.slowMs.CRITICAL ? "CRITICAL"
      : durationMs >= this.slowMs.VERY_SLOW ? "VERY_SLOW"
        : durationMs >= this.slowMs.SLOW ? "SLOW" : null;
  }

  recordOperation(operation, durationMs, metadata) {
    const value = Number(durationMs);
    if (!Number.isFinite(value)) return null;
    const item = Object.assign({}, typeof operation === "string" ? { type: operation } : operation || {}, { durationMs: value, level: this.operationLevel(value), metadata: metadata || null });
    this.operationLog.push(item);
    if (this.operationLog.length > 1000) this.operationLog.shift();
    this.operationSamples += 1;
    this.measuredOperationTimeMs += value;
    if (item.level) this.slowOperations.push(item);
    return item;
  }

  recordCall(kind, durationMs, metadata) {
    const details = metadata || {};
    if (details.transportRecorded !== true) this.counters.mcpCallCount += 1;
    if (kind === 'batch') this.counters.batchCount += 1;
    if (details.skipDuration !== true) this.finish({ kind: kind === 'batch' ? 'photoshop' : (kind || 'transport'), startedAt: this.clock() - Number(durationMs || 0) }, details);
    if (kind === 'batch') this.counters.operationCount += Number(details.operations || 0);
    return durationMs;
  }

  recordBatch(operations, durationMs, metadata) {
    const details = Object.assign({ operations }, metadata || {});
    if (details.transportRecorded !== true) this.counters.mcpCallCount += 1;
    this.counters.batchCount += 1;
    this.counters.operationCount += Number(operations || 0);
    this.operationTimeMs += Number(durationMs || 0);
    this.finish({ kind: 'photoshop', startedAt: this.clock() - Number(durationMs || 0) }, details);
  }

  recordSnapshot(refresh, durationMs, metadata) {
    if (refresh) {
      this.counters.snapshotRefreshCount += 1;
      this.counters.psdScanCount += 1;
      if (!(metadata && metadata.transportRecorded === true)) this.counters.mcpCallCount += 1;
    }

    if (durationMs !== undefined) this.finish({ kind: 'photoshop', startedAt: this.clock() - Number(durationMs || 0) }, Object.assign({ operation: 'snapshot' }, metadata || {}));
  }

  recordPreview(durationMs, metadata) {
    this.counters.previewCount += 1;
    if (durationMs !== undefined) this.finish({ kind: 'preview', startedAt: this.clock() - Number(durationMs || 0) }, metadata);
  }

  recordSave(durationMs, metadata) {
    this.counters.saveCount += 1;
    if (durationMs !== undefined) this.finish({ kind: 'save', startedAt: this.clock() - Number(durationMs || 0) }, metadata);
  }

  recordMemory(sample) {
    if (!sample || typeof sample !== 'object') return this.peakMemory;
    const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
    const workingSet = numberOrNull(sample.photoshopWorkingSetMb);
    const privateMb = numberOrNull(sample.photoshopPrivateCommitMb !== undefined ? sample.photoshopPrivateCommitMb : sample.photoshopPrivateMemoryMb === undefined ? sample.photoshopPrivateMb : sample.photoshopPrivateMemoryMb);
    const available = numberOrNull(sample.systemAvailablePercent);
    const previous = this.peakMemory || {};
    this.peakMemory = {
      sampleCount: Number(previous.sampleCount || 0) + 1,
      sampledAt: sample.sampledAt || new Date().toISOString(),
      timestamp: sample.timestamp || Date.now(),
      photoshopWorkingSetMb: workingSet === null ? (previous.photoshopWorkingSetMb ?? null) : Math.max(Number(previous.photoshopWorkingSetMb || 0), workingSet),
      photoshopPrivateCommitMb: privateMb === null ? (previous.photoshopPrivateCommitMb ?? null) : Math.max(Number(previous.photoshopPrivateCommitMb || 0), privateMb),
      photoshopPrivateMb: privateMb === null ? (previous.photoshopPrivateMb ?? null) : Math.max(Number(previous.photoshopPrivateMb || 0), privateMb),
      systemAvailablePercentMin: available === null ? (previous.systemAvailablePercentMin ?? null) : previous.systemAvailablePercentMin === null || previous.systemAvailablePercentMin === undefined ? available : Math.min(previous.systemAvailablePercentMin, available)
    };
    return this.peakMemory;
  }

  report(extra) {
    const total = Object.values(this.durations).reduce((sum, value) => sum + value, 0) || 1;
    const durations = Object.assign({}, this.durations);
    const percentages = Object.fromEntries(Object.entries(durations).map(([key, value]) => [key, Number((value / total * 100).toFixed(2))]));
    return {
      counters: Object.assign({}, this.counters),
      durations,
      percentages,
      slowOperations: this.slowOperations.slice().sort((left, right) => right.durationMs - left.durationMs).slice(0, 20),
      operationLog: this.operationLog.slice(),
      averageOperationMs: this.operationSamples ? Number((this.measuredOperationTimeMs / this.operationSamples).toFixed(2)) : this.counters.operationCount ? Number((this.operationTimeMs / this.counters.operationCount).toFixed(2)) : 0,
      peakMemory: extra && extra.peakMemory || this.peakMemory || null,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = { PerformanceProfiler };
