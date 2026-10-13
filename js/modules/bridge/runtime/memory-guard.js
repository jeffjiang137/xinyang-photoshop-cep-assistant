'use strict';

const os = require('os');
const { RuntimeError, RuntimeErrorCodes } = require('./runtime-error-codes');

class MemoryGuard {
  constructor(options) {
    this.config = options.config || {};
    this.sampleProvider = options.sampleProvider || null;
    this.onSample = options.onSample || null;
    this.lastSample = null;
    this.lastAssessment = { status: 'SAFE', warning: false, critical: false, emergency: false, degraded: false, reasons: [] };
  }

  async sample() {
    const total = Number(os.totalmem ? os.totalmem() : 0);
    const free = Number(os.freemem ? os.freemem() : 0);
    const processMemory = typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage() : {};
    const value = {
      timestamp: Date.now(),
      sampledAt: new Date().toISOString(),
      systemTotalMemoryMb: total ? Math.round(total / 1024 / 1024) : null,
      systemAvailableMemoryMb: free ? Math.round(free / 1024 / 1024) : null,
      systemAvailablePercent: total ? Number((free / total * 100).toFixed(2)) : null,
      bridgeRssMb: processMemory.rss ? Math.round(processMemory.rss / 1024 / 1024) : null,
      bridgeWorkingSetMb: processMemory.rss ? Math.round(processMemory.rss / 1024 / 1024) : null,
      bridgeHeapUsedMb: processMemory.heapUsed ? Math.round(processMemory.heapUsed / 1024 / 1024) : null,
      photoshopWorkingSetMb: null,
      photoshopPrivateCommitMb: null,
      photoshopPrivateMemoryMb: null,
      photoshopPrivateMb: null,
      openDocuments: null,
      activeTaskId: null
    };
    if (this.sampleProvider) Object.assign(value, await this.sampleProvider(value));
    const privateCommit = value.photoshopPrivateCommitMb !== null && value.photoshopPrivateCommitMb !== undefined
      ? value.photoshopPrivateCommitMb
      : value.photoshopPrivateMemoryMb !== null && value.photoshopPrivateMemoryMb !== undefined
        ? value.photoshopPrivateMemoryMb : value.photoshopPrivateMb;
    value.photoshopPrivateCommitMb = privateCommit === undefined ? null : privateCommit;
    value.photoshopPrivateMb = privateCommit === undefined ? null : privateCommit;
    value.photoshopPrivateMemoryMb = privateCommit === undefined ? null : privateCommit;
    if (value.bridgeWorkingSetMb === null || value.bridgeWorkingSetMb === undefined) value.bridgeWorkingSetMb = value.bridgeRssMb;
    this.lastSample = value;
    this.lastAssessment = this.assess(value);
    try { if (this.onSample) this.onSample(Object.assign({}, value)); } catch (ignore) {}
    return value;
  }

  assess(value) {
    const memory = this.config;
    const warningPercent = Number(memory.warningAvailablePercent || 20);
    const criticalPercent = Number(memory.criticalAvailablePercent || 10);
    const emergencyPercent = Number(memory.emergencyAvailablePercent || Math.max(1, criticalPercent / 2));
    const fallbackWarningPhotoshop = Number(memory.warningPhotoshopMb || 0);
    const fallbackCriticalPhotoshop = Number(memory.criticalPhotoshopMb || 0);
    const warningWorkingSet = Number(memory.warningPhotoshopWorkingSetMb || fallbackWarningPhotoshop);
    const criticalWorkingSet = Number(memory.criticalPhotoshopWorkingSetMb || fallbackCriticalPhotoshop);
    const emergencyWorkingSet = Number(memory.emergencyPhotoshopWorkingSetMb || (criticalWorkingSet > 0 ? criticalWorkingSet * 1.25 : 0));
    const warningPrivate = Number(memory.warningPhotoshopPrivateMb || fallbackWarningPhotoshop);
    const criticalPrivate = Number(memory.criticalPhotoshopPrivateMb || fallbackCriticalPhotoshop);
    const emergencyPrivate = Number(memory.emergencyPhotoshopPrivateMb || (criticalPrivate > 0 ? criticalPrivate * 1.1 : 0));
    const reasons = [];
    const signals = [];
    const available = numberOrNull(value.systemAvailablePercent);
    const workingSet = numberOrNull(value.photoshopWorkingSetMb);
    const privateCommit = numberOrNull(value.photoshopPrivateCommitMb !== null && value.photoshopPrivateCommitMb !== undefined
      ? value.photoshopPrivateCommitMb
      : value.photoshopPrivateMemoryMb !== null && value.photoshopPrivateMemoryMb !== undefined
        ? value.photoshopPrivateMemoryMb : value.photoshopPrivateMb);
    const privateCommitEmergency = privateCommit !== null && emergencyPrivate > 0 && privateCommit >= emergencyPrivate;
    const privateCommitCritical = privateCommit !== null && criticalPrivate > 0 && privateCommit >= criticalPrivate;
    const privateCommitWarning = privateCommit !== null && warningPrivate > 0 && privateCommit >= warningPrivate;
    const privateCommitAffectsAdmission = memory.privateCommitAffectsAdmission === true;
    if (privateCommitEmergency) signals.push('PHOTOSHOP_PRIVATE_COMMIT_EMERGENCY');
    else if (privateCommitCritical) signals.push('PHOTOSHOP_PRIVATE_COMMIT_CRITICAL');
    else if (privateCommitWarning) signals.push('PHOTOSHOP_PRIVATE_COMMIT_WARNING');
    let emergency = (available !== null && available < emergencyPercent)
      || (workingSet !== null && emergencyWorkingSet > 0 && workingSet >= emergencyWorkingSet)
      || (privateCommitAffectsAdmission && privateCommitEmergency);
    let critical = emergency
      || (available !== null && available < criticalPercent)
      || (workingSet !== null && criticalWorkingSet > 0 && workingSet >= criticalWorkingSet)
      || (privateCommitAffectsAdmission && privateCommitCritical);
    let warning = critical
      || (available !== null && available < warningPercent)
      || (workingSet !== null && warningWorkingSet > 0 && workingSet >= warningWorkingSet)
      || (privateCommitAffectsAdmission && privateCommitWarning);
    if (available !== null && available < emergencyPercent) reasons.push('SYSTEM_AVAILABLE_MEMORY_EMERGENCY');
    else if (available !== null && available < criticalPercent) reasons.push('SYSTEM_AVAILABLE_MEMORY_CRITICAL');
    else if (available !== null && available < warningPercent) reasons.push('SYSTEM_AVAILABLE_MEMORY_WARNING');
    if (workingSet !== null && emergencyWorkingSet > 0 && workingSet >= emergencyWorkingSet) reasons.push('PHOTOSHOP_WORKING_SET_EMERGENCY');
    else if (workingSet !== null && criticalWorkingSet > 0 && workingSet >= criticalWorkingSet) reasons.push('PHOTOSHOP_WORKING_SET_CRITICAL');
    else if (workingSet !== null && warningWorkingSet > 0 && workingSet >= warningWorkingSet) reasons.push('PHOTOSHOP_WORKING_SET_WARNING');
    if (privateCommitAffectsAdmission && privateCommitEmergency) reasons.push('PHOTOSHOP_PRIVATE_COMMIT_EMERGENCY');
    else if (privateCommitAffectsAdmission && privateCommitCritical) reasons.push('PHOTOSHOP_PRIVATE_COMMIT_CRITICAL');
    else if (privateCommitAffectsAdmission && privateCommitWarning) reasons.push('PHOTOSHOP_PRIVATE_COMMIT_WARNING');
    const fault = memory.faultInjection || {};
    if (fault.simulateMemoryCritical === true) {
      critical = true;
      warning = true;
      reasons.push('FAULT_INJECTION_MEMORY_CRITICAL');
    } else if (fault.simulateMemoryWarning === true) {
      warning = true;
      reasons.push('FAULT_INJECTION_MEMORY_WARNING');
    }
    const status = emergency ? 'EMERGENCY' : critical ? 'CRITICAL' : warning ? 'WARNING' : 'SAFE';
    return {
      status,
      warning,
      critical,
      emergency,
      degraded: warning || critical,
      reasons,
      signals,
      privateCommitAffectsAdmission,
      metrics: { systemAvailablePercent: available, photoshopWorkingSetMb: workingSet, photoshopPrivateCommitMb: privateCommit, photoshopPrivateMb: privateCommit },
      thresholds: {
        warningPercent, criticalPercent, emergencyPercent,
        warningWorkingSet, criticalWorkingSet, emergencyWorkingSet,
        warningPrivateCommit: warningPrivate, criticalPrivateCommit: criticalPrivate, emergencyPrivateCommit: emergencyPrivate,
        warningPrivate, criticalPrivate, emergencyPrivate
      }
    };
  }

  async gate({ heavy = false } = {}) {
    const sample = await this.sample();
    const assessment = this.lastAssessment;
    if (assessment.emergency) {
      throw new RuntimeError(RuntimeErrorCodes.PS_MEMORY_EMERGENCY, 'Memory guard is EMERGENCY; refusing new Photoshop work.', { sample, assessment, heavy });
    }
    return {
      sample,
      assessment,
      degraded: !!assessment.degraded,
      policy: assessment.degraded ? {
        mode: 'DEGRADED',
        maxBatchOperations: Number(this.config.degradedBatchOperations || 30),
        maxPreviewScale: Number(this.config.degradedPreviewScale || 0.25),
        checkpointRequired: true,
        skipLargeObjectCreation: true
      } : {
        mode: 'NORMAL',
        checkpointRequired: false
      }
    };
  }

  snapshot() { return { sample: this.lastSample, assessment: this.lastAssessment }; }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = { MemoryGuard };
