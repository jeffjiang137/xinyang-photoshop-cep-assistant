'use strict';

const { RuntimeErrorCodes } = require('./runtime-error-codes');

class RecoveryManager {
  constructor(options) {
    this.executeRaw = options.executeRaw;
    this.logger = options.logger || (() => {});
    this.documents = new Map();
    this.allowForceKill = options.allowForceKill === true;
  }

  registerDocument({ documentId, taskId, path, openedByAutomation }) {
    if (!openedByAutomation || documentId === null || documentId === undefined) return null;
    const record = { documentId: Number(documentId), taskId, path: path || null, openedByAutomation: true, openedAt: new Date().toISOString() };
    this.documents.set(`${taskId}:${record.documentId}`, record);
    return record;
  }

  unregisterDocument({ documentId, taskId }) {
    // A document is registered by the task that opened/created it, but an
    // explicit close normally arrives in a later task. Match the unique
    // Photoshop document id rather than requiring the closing task id to be
    // the original owner, otherwise closed sandbox/session documents remain
    // as stale recovery ownership records.
    const numericDocumentId = Number(documentId);
    for (const [key, record] of this.documents.entries()) {
      if (Number(record.documentId) === numericDocumentId) this.documents.delete(key);
    }
  }

  listOwned(taskId) { return [...this.documents.values()].filter(item => !taskId || item.taskId === taskId); }

  async recover({ taskId, reason }) {
    const owned = this.listOwned(taskId);
    const result = { status: 'SKIPPED', closed: [], failed: [], forceKill: false };
    if (!owned.length) return result;
    result.status = 'ATTEMPTED';
    for (const document of owned) {
      try {
        await this.executeRaw({ action: 'close_document', documentId: document.documentId });
        this.unregisterDocument(document);
        result.closed.push(document.documentId);
      } catch (error) {
        result.failed.push({ documentId: document.documentId, code: error.code || RuntimeErrorCodes.RECOVERY_FAILED, message: error.message || String(error) });
      }
    }
    if (result.failed.length) result.status = 'FAILED';
    this.logger('recovery.completed', { taskId, reason: reason || null, result });
    return result;
  }

  snapshot() { return { ownedDocuments: [...this.documents.values()], allowForceKill: this.allowForceKill }; }
}

module.exports = { RecoveryManager };
