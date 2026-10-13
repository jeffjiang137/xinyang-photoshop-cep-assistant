'use strict';

const { MemoryStatus } = require('./types');

function assessmentStatus(assessment) {
  const status = String(assessment && assessment.status || '').toUpperCase();
  if (status === 'EMERGENCY' || status === 'CRITICAL') return MemoryStatus.CRITICAL;
  if (status === 'WARNING') return MemoryStatus.WARNING;
  return MemoryStatus.NORMAL;
}

class MemoryStateMachine {
  constructor({ now = () => Date.now(), logger = () => {} } = {}) {
    this.now = now;
    this.logger = logger;
    this.state = MemoryStatus.NORMAL;
    this.history = [];
    this.lastTransitionAt = null;
  }

  transition(next, details = null) {
    if (!Object.values(MemoryStatus).includes(next)) throw new Error(`Unknown memory state: ${next}`);
    const previous = this.state;
    this.state = next;
    this.lastTransitionAt = new Date(this.now()).toISOString();
    if (previous !== next || details) {
      const item = { from: previous, to: next, at: this.lastTransitionAt, details };
      this.history.push(item);
      if (this.history.length > 50) this.history.splice(0, this.history.length - 50);
      this.logger('memory.state.transition', item);
    }
    return this.state;
  }

  observe(assessment, details = null) {
    const observed = assessmentStatus(assessment);
    // A failed recovery is latched while pressure remains. Sampling alone must
    // never schedule another purge; a safe sample or explicit reset can leave it.
    if (this.state === MemoryStatus.RECOVERY_FAILED) {
      if (observed === MemoryStatus.NORMAL) this.transition(MemoryStatus.NORMAL, { reason: 'safe_sample', details });
      return this.state;
    }
    if (this.state === MemoryStatus.RECOVERING) return this.state;
    if (this.state === MemoryStatus.RECOVERY_SUCCESS) {
      if (observed === MemoryStatus.NORMAL) this.transition(MemoryStatus.NORMAL, { reason: 'post_recovery_sample', details });
      else if (observed !== MemoryStatus.NORMAL) this.transition(observed, { reason: 'post_recovery_pressure', details });
      return this.state;
    }
    return this.transition(observed, details);
  }

  beginRecovery(details = null) {
    if (this.state === MemoryStatus.RECOVERING) return false;
    this.transition(MemoryStatus.RECOVERING, details);
    return true;
  }

  completeRecovery(success, details = null) {
    return this.transition(success ? MemoryStatus.RECOVERY_SUCCESS : MemoryStatus.RECOVERY_FAILED, details);
  }

  reset(details = null) {
    return this.transition(MemoryStatus.NORMAL, details || { reason: 'explicit_reset' });
  }

  snapshot() {
    return {
      state: this.state,
      status: this.state,
      lastTransitionAt: this.lastTransitionAt,
      history: this.history.slice()
    };
  }
}

module.exports = { MemoryStateMachine, assessmentStatus };
