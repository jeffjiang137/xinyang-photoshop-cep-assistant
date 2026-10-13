'use strict';

const SaveStates = Object.freeze({ CLEAN: 'CLEAN', DIRTY: 'DIRTY', CHECKPOINT_REQUIRED: 'CHECKPOINT_REQUIRED', FINAL_SAVE_REQUIRED: 'FINAL_SAVE_REQUIRED' });

class SaveManager {
  constructor(options) {
    this.maxOperations = Number(options && options.maxOperations || 100);
    this.state = SaveStates.CLEAN;
    this.operationCount = 0;
    this.lastSave = null;
  }
  markDirty(count) {
    this.operationCount += Number(count || 0);
    if (this.state === SaveStates.CLEAN) this.state = SaveStates.DIRTY;
    if (this.operationCount >= this.maxOperations) this.state = SaveStates.CHECKPOINT_REQUIRED;
    return this.snapshot();
  }
  requireFinal() { this.state = SaveStates.FINAL_SAVE_REQUIRED; return this.snapshot(); }
  shouldCheckpoint(options) { return !!(options && (options.force || this.state === SaveStates.CHECKPOINT_REQUIRED)); }
  async save(saveFn, kind, metadata) {
    if (typeof saveFn !== 'function') throw new Error('saveFn is required.');
    const result = await saveFn(Object.assign({ kind: kind || 'checkpoint' }, metadata || {}));
    this.state = SaveStates.CLEAN;
    this.operationCount = 0;
    this.lastSave = { kind: kind || 'checkpoint', at: new Date().toISOString(), result: result || null };
    return Object.assign({ result }, this.snapshot());
  }
  snapshot() { return { state: this.state, operationCount: this.operationCount, lastSave: this.lastSave }; }
}

module.exports = { SaveManager, SaveStates };
