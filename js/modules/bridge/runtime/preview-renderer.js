'use strict';

function mergeRegions(regions) {
  const valid = (regions || []).filter(region => region && Number(region.width) > 0 && Number(region.height) > 0);
  if (!valid.length) return null;
  const left = Math.min(...valid.map(region => Number(region.x) || 0));
  const top = Math.min(...valid.map(region => Number(region.y) || 0));
  const right = Math.max(...valid.map(region => (Number(region.x) || 0) + Number(region.width)));
  const bottom = Math.max(...valid.map(region => (Number(region.y) || 0) + Number(region.height)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

class PreviewRenderer {
  constructor(options) {
    this.render = options && options.render;
    this.profiler = options && options.profiler;
    this.dirtyTracker = options && options.dirtyTracker;
    this.maxStagePreviews = Number(options && options.maxStagePreviews || 3);
    this.counts = new Map();
    this.cache = new Map();
    this.revisions = new Map();
  }
  key(documentId) { return documentId === undefined || documentId === null ? 'active' : String(documentId); }
  resolveRequest(request) {
    const resolved = Object.assign({}, request || {});
    const stage = resolved.stage || 'visual';
    if (!resolved.region && stage !== 'final' && this.dirtyTracker && typeof this.dirtyTracker.snapshot === 'function') {
      const dirty = this.dirtyTracker.snapshot(resolved.documentId);
      const region = mergeRegions(dirty && dirty.dirtyRegions);
      if (region) {
        resolved.region = region;
        resolved._usesDirtyRegion = true;
      }
    }
    return resolved;
  }
  revision(documentId) { return this.revisions.get(this.key(documentId)) || 0; }
  cacheKey(documentKey, request) {
    return JSON.stringify([
      documentKey,
      this.revision(request.documentId),
      request.stage || 'visual',
      request.region || null,
      Number(request.scale === undefined ? 0.5 : request.scale),
      String(request.format || 'jpg').toLowerCase(),
      Number(request.quality === undefined ? 70 : request.quality),
      request.fullResolution === true,
      request.path || null
    ]);
  }
  async preview(request) {
    if (typeof this.render !== 'function') throw new Error('Preview renderer is not configured.');
    const resolved = this.resolveRequest(request);
    const stage = resolved.stage || 'visual';
    const documentKey = this.key(resolved.documentId);
    const cacheKey = this.cacheKey(documentKey, resolved);
    if (!resolved.force && this.cache.has(cacheKey)) return Object.assign({}, this.cache.get(cacheKey), { cached: true });
    const count = this.counts.get(documentKey) || 0;
    if (stage !== 'final' && count >= this.maxStagePreviews) {
      const error = new Error('Preview budget exceeded for ' + documentKey + '.');
      error.code = 'PREVIEW_BUDGET_EXCEEDED';
      throw error;
    }
    const started = Date.now();
    const renderRequest = Object.assign({ scale: 0.5, format: 'jpg', quality: 70 }, resolved);
    delete renderRequest._usesDirtyRegion;
    const result = await this.render(renderRequest);
    const durationMs = Date.now() - started;
    if (stage !== 'final') this.counts.set(documentKey, count + 1);
    if (this.profiler) this.profiler.recordPreview(durationMs, { stage, documentId: resolved.documentId, region: resolved.region || null });
    const value = Object.assign({ stage, durationMs, cached: false, region: resolved.region || null }, result || {});
    this.cache.set(cacheKey, value);
    if (resolved._usesDirtyRegion && this.dirtyTracker && typeof this.dirtyTracker.consume === 'function') this.dirtyTracker.consume(resolved.documentId);
    return value;
  }
  invalidate(documentId, { resetBudget = true } = {}) {
    const key = this.key(documentId);
    this.revisions.set(key, this.revision(documentId) + 1);
    this.cache.clear();
    if (resetBudget) this.counts.delete(key);
  }
  status() { return { counts: Object.fromEntries(this.counts.entries()), cacheSize: this.cache.size, revisions: Object.fromEntries(this.revisions.entries()), maxStagePreviews: this.maxStagePreviews }; }
  clear() { this.cache.clear(); this.counts.clear(); this.revisions.clear(); }
}

module.exports = { PreviewRenderer, mergeRegions };
