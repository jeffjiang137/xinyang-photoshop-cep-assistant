'use strict';

const { RuntimeError, RuntimeErrorCodes, asRuntimeError } = require('./runtime-error-codes');
const { runWithTimeout } = require('./timeout-controller');

class PhotoshopHealth {
  constructor(options) {
    this.probe = options.probe;
    this.timeoutMs = options.timeoutMs || 30000;
    this.now = options.now || (() => Date.now());
    this.status = 'READY';
    this.modal = 'UNKNOWN';
    this.lastBridgeHeartbeat = null;
    this.lastCepHeartbeat = null;
    this.lastPhotoshopProbe = null;
    this.lastProbeResult = null;
    this.lastError = null;
  }

  markBridgeHeartbeat() { this.lastBridgeHeartbeat = this.now(); }
  markCepHeartbeat() { this.lastCepHeartbeat = this.now(); }
  markPhotoshopProbe(result) {
    this.lastPhotoshopProbe = this.now();
    this.lastProbeResult = result || null;
    this.lastError = null;
    this.status = 'READY';
    this.modal = 'UNKNOWN';
  }
  markError(code, message) {
    this.status = code === RuntimeErrorCodes.PS_UNRESPONSIVE ? 'UNRESPONSIVE' : code === RuntimeErrorCodes.PS_BUSY || code === RuntimeErrorCodes.PS_MODAL ? 'BUSY' : 'OFFLINE';
    this.lastError = { code, message: message || code };
  }

  async check({ skipProbe = false } = {}) {
    if (skipProbe) return this.snapshot();
    if (typeof this.probe !== 'function') throw new RuntimeError(RuntimeErrorCodes.BRIDGE_UNHEALTHY, 'Photoshop health probe is not configured.');
    let timed;
    try {
      timed = runWithTimeout(() => this.probe(), { softTimeoutMs: Math.max(1, Math.floor(this.timeoutMs / 2)), hardTimeoutMs: this.timeoutMs });
      const result = await timed.promise;
      this.markPhotoshopProbe(result);
      if (result && result.busy === true) {
        this.status = 'BUSY';
        throw new RuntimeError(RuntimeErrorCodes.PS_BUSY, 'Photoshop reported a busy state.', { probe: result });
      }
      if (result && (result.modal === true || result.modal === 'OPEN' || result.modal === 'BUSY')) {
        this.status = 'BUSY';
        this.modal = 'OPEN';
        throw new RuntimeError(RuntimeErrorCodes.PS_MODAL, 'Photoshop reported a modal state.', { probe: result });
      }
      return this.snapshot();
    } catch (error) {
      const normalized = error.code === RuntimeErrorCodes.TASK_TIMEOUT || error.name === 'AbortError'
        ? new RuntimeError(RuntimeErrorCodes.PS_UNRESPONSIVE, 'Photoshop health probe timed out.', { cause: error.message })
        : asRuntimeError(error, RuntimeErrorCodes.PS_UNRESPONSIVE, 'Photoshop health probe failed.');
      // CEP evalScript has no cancellation primitive. Keep the underlying
      // probe attached so TaskManager can retain the global Photoshop lock
      // until the callback settles; otherwise a timed-out probe could be
      // followed by a second JSX call while Photoshop is still busy.
      if (timed && timed.underlying) normalized.pendingPromise = timed.underlying;
      this.markError(normalized.code, normalized.message);
      throw normalized;
    }
  }

  snapshot() {
    const now = this.now();
    const age = value => value === null ? null : Math.max(0, now - value);
    return {
      status: this.status,
      modal: this.modal,
      lastBridgeHeartbeat: this.lastBridgeHeartbeat ? new Date(this.lastBridgeHeartbeat).toISOString() : null,
      lastCepHeartbeat: this.lastCepHeartbeat ? new Date(this.lastCepHeartbeat).toISOString() : null,
      lastPhotoshopProbe: this.lastPhotoshopProbe ? new Date(this.lastPhotoshopProbe).toISOString() : null,
      agesMs: { bridge: age(this.lastBridgeHeartbeat), cep: age(this.lastCepHeartbeat), photoshop: age(this.lastPhotoshopProbe) },
      lastProbeResult: this.lastProbeResult,
      lastError: this.lastError
    };
  }
}

module.exports = { PhotoshopHealth };
