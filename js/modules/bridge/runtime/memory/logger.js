'use strict';

const fs = require('fs');
const path = require('path');

function compactSnapshot(snapshot) {
  const privateMemory = snapshot && (snapshot.photoshopPrivateCommitMb !== null && snapshot.photoshopPrivateCommitMb !== undefined
    ? snapshot.photoshopPrivateCommitMb
    : snapshot.photoshopPrivateMb !== null && snapshot.photoshopPrivateMb !== undefined
      ? snapshot.photoshopPrivateMb : snapshot.photoshopPrivateMemoryMb);
  return {
    timestamp: snapshot && (snapshot.sampledAt || snapshot.timestamp) || null,
    privateMemory: privateMemory === null || privateMemory === undefined ? null : Number(privateMemory),
    privateCommitMb: privateMemory === null || privateMemory === undefined ? null : Number(privateMemory),
    workingSet: snapshot && snapshot.photoshopWorkingSetMb === undefined ? null : Number(snapshot && snapshot.photoshopWorkingSetMb)
  };
}

class MemoryRecoveryLogger {
  constructor({ dir = null, now = () => Date.now(), logger = () => {} } = {}) {
    this.dir = dir || null;
    this.now = now;
    this.logger = logger;
    this.entries = [];
    if (this.dir) {
      try { fs.mkdirSync(this.dir, { recursive: true }); } catch (error) { this.logger('memory.log.init_failed', { message: error.message }); }
    }
  }

  record({ before, after, action, result, delta, taskId = null, reason = null, state = null, error = null, startedAt = null } = {}) {
    const entry = {
      time: new Date(this.now()).toISOString(),
      taskId,
      before: compactSnapshot(before),
      action: action || null,
      after: compactSnapshot(after),
      delta: delta || null,
      result: result || 'fail',
      state,
      reason,
      durationMs: startedAt ? Math.max(0, this.now() - startedAt) : null,
      error: error || null
    };
    this.entries.push(entry);
    if (this.entries.length > 200) this.entries.splice(0, this.entries.length - 200);
    if (this.dir) {
      try {
        const file = path.join(this.dir, 'memory-recovery.jsonl');
        fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch (writeError) {
        this.logger('memory.log.write_failed', { message: writeError.message, entry });
      }
    }
    this.logger('memory.recovery.audit', entry);
    return entry;
  }

  exportRecords() {
    return this.entries.slice();
  }
}

module.exports = { MemoryRecoveryLogger, compactSnapshot };
