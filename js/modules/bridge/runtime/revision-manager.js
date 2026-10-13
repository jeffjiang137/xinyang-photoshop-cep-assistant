'use strict';

class RevisionConflictError extends Error {
  constructor(documentId, expectedRevision, actualRevision) {
    super(`Document revision conflict for ${documentId}: expected ${expectedRevision}, actual ${actualRevision}.`);
    this.name = 'RevisionConflictError';
    this.code = 'REVISION_CONFLICT';
    this.details = { documentId, expectedRevision, actualRevision };
  }
}

class RevisionManager {
  constructor() {
    this.revisions = new Map();
    this.fingerprints = new Map();
  }

  key(documentId) { return documentId === undefined || documentId === null ? 'active' : String(documentId); }
  get(documentId) { return this.revisions.get(this.key(documentId)) || 0; }
  set(documentId, revision) {
    const value = Math.max(0, Number(revision) || 0);
    this.revisions.set(this.key(documentId), value);
    return value;
  }
  getFingerprint(documentId) { return this.fingerprints.get(this.key(documentId)) || null; }
  setFingerprint(documentId, fingerprint) {
    if (fingerprint === undefined || fingerprint === null) return this.getFingerprint(documentId);
    this.fingerprints.set(this.key(documentId), fingerprint);
    return fingerprint;
  }
  fingerprintSnapshot() { return Object.fromEntries(this.fingerprints.entries()); }
  assert(documentId, expectedRevision) {
    if (expectedRevision === undefined || expectedRevision === null) return this.get(documentId);
    const actualRevision = this.get(documentId);
    if (Number(expectedRevision) !== actualRevision) throw new RevisionConflictError(documentId, Number(expectedRevision), actualRevision);
    return actualRevision;
  }
  advance(documentId) { return this.set(documentId, this.get(documentId) + 1); }
  clear(documentId) {
    this.revisions.delete(this.key(documentId));
    this.fingerprints.delete(this.key(documentId));
  }
  snapshot() { return Object.fromEntries(this.revisions.entries()); }
}

module.exports = { RevisionManager, RevisionConflictError };
