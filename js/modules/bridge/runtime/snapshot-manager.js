'use strict';

function buildIndexes(layers) {
  const indexes = { layers: {}, groups: {}, texts: {}, smartObjects: {}, bounds: {} };
  const visit = (items, parentId) => {
    for (const layer of items || []) {
      if (!layer || layer.id === undefined || layer.id === null) continue;
      const id = String(layer.id);
      const normalized = Object.assign({}, layer, { parentId: layer.parentId === undefined ? parentId ?? null : layer.parentId });
      indexes.layers[id] = normalized;
      if (normalized.isGroup || normalized.type === 'group' || Array.isArray(normalized.children)) indexes.groups[id] = normalized;
      if (normalized.text) indexes.texts[id] = normalized.text;
      if (normalized.smartObject) indexes.smartObjects[id] = normalized.smartObject;
      if (normalized.bounds) indexes.bounds[id] = normalized.bounds;
      visit(normalized.children, normalized.id);
    }
  };
  visit(layers, null);
  return indexes;
}

function layerId(value) {
  return value && value.id !== undefined && value.id !== null ? String(value.id) : null;
}

function findLayer(items, id) {
  const target = String(id);
  for (const layer of items || []) {
    if (layerId(layer) === target) return layer;
    const found = findLayer(layer && layer.children, id);
    if (found) return found;
  }
  return null;
}

function mergeLayerPatch(items, patches, removedIds) {
  return (items || []).reduce((out, layer) => {
    const id = layerId(layer);
    if (id && removedIds.has(id)) return out;
    const patch = id ? patches.get(id) : null;
    const merged = patch ? Object.assign({}, layer, patch) : Object.assign({}, layer);
    if (Array.isArray(layer && layer.children)) merged.children = mergeLayerPatch(layer.children, patches, removedIds);
    out.push(merged);
    return out;
  }, []);
}

class SnapshotManager {
  constructor(options) {
    this.clock = options && options.clock || (() => Date.now());
    this.maxAgeMs = options && options.maxAgeMs || 15 * 60 * 1000;
    this.maxDocuments = Math.max(1, Number(options && options.maxDocuments) || 8);
    this.snapshots = new Map();
  }
  key(documentId) { return documentId === undefined || documentId === null ? 'active' : String(documentId); }
  get(documentId) { return this.snapshots.get(this.key(documentId)) || null; }
  getLayer(documentId, layerId) {
    const snapshot = this.get(documentId);
    return snapshot && snapshot.indexes && snapshot.indexes.layers[String(layerId)] || null;
  }
  put(documentId, snapshot) {
    // Manual Photoshop document closes do not pass through the bridge. Bound
    // retained layer trees even when no close notification reaches this cache.
    const now = this.clock();
    for (const [key, cached] of this.snapshots) {
      if (now - cached.cachedAt > this.maxAgeMs) this.snapshots.delete(key);
    }
    const base = Object.assign({}, snapshot, { documentId: snapshot && snapshot.documentId !== undefined ? snapshot.documentId : documentId, cachedAt: this.clock() });
    const value = Object.assign(base, { indexes: buildIndexes(base.layers) });
    this.snapshots.delete(this.key(documentId));
    this.snapshots.set(this.key(documentId), value);
    while (this.snapshots.size > this.maxDocuments) this.snapshots.delete(this.snapshots.keys().next().value);
    return value;
  }
  isStale(documentId, expectedRevision) {
    const value = this.get(documentId);
    if (!value) return true;
    if (expectedRevision !== undefined && expectedRevision !== null && Number(value.revision || 0) !== Number(expectedRevision)) return true;
    return this.clock() - Number(value.cachedAt || 0) > this.maxAgeMs;
  }
  async ensure(documentId, reader, options) {
    const expectedRevision = options && options.expectedRevision;
    if (!(options && options.force) && !this.isStale(documentId, expectedRevision)) return { snapshot: this.get(documentId), refreshed: false };
    if (typeof reader !== 'function') throw new Error('Snapshot reader is required for a refresh.');
    const snapshot = await reader();
    return { snapshot: this.put(documentId, Object.assign({}, snapshot, { revision: expectedRevision === undefined ? Number(snapshot && snapshot.revision || 0) : Number(expectedRevision) })), refreshed: true };
  }
  markRevision(documentId, revision, patch) {
    const current = this.get(documentId) || { documentId };
    const next = Object.assign({}, current, patch || {}, { revision });
    if (next.layers === undefined && current.layers !== undefined) next.layers = current.layers;
    return this.put(documentId, next);
  }
  patchLayers(documentId, layerPatches, options) {
    const current = this.get(documentId);
    if (!current) return null;
    const patches = new Map();
    for (const patch of layerPatches || []) {
      const id = layerId(patch);
      if (id) patches.set(id, Object.assign({}, patches.get(id) || {}, patch));
    }
    const removedIds = new Set((options && options.removedIds || []).map(value => String(value)));
    const layers = mergeLayerPatch(current.layers, patches, removedIds);
    const known = new Set(Object.keys(current.indexes && current.indexes.layers || {}));
    for (const patch of patches.values()) {
      const id = layerId(patch);
      if (!id || known.has(id) || removedIds.has(id)) continue;
      const parentId = patch.parentId === undefined ? null : patch.parentId;
      if (parentId === null || parentId === undefined) layers.push(Object.assign({}, patch));
      else {
        const parent = findLayer(layers, parentId);
        if (parent) {
          parent.children = Array.isArray(parent.children) ? parent.children : [];
          parent.children.push(Object.assign({}, patch));
        }
      }
    }
    const next = Object.assign({}, current, { layers });
    if (options && options.revision !== undefined) next.revision = options.revision;
    if (options && options.historyFingerprint) next.historyFingerprint = options.historyFingerprint;
    return this.put(documentId, next);
  }
  invalidate(documentId) { this.snapshots.delete(this.key(documentId)); }
  clear() { this.snapshots.clear(); }
  status() {
    return Array.from(this.snapshots.values()).map(snapshot => ({
      documentId: snapshot.documentId,
      revision: snapshot.revision || 0,
      cachedAt: snapshot.cachedAt,
      layerCount: snapshot.indexes ? Object.keys(snapshot.indexes.layers).length : Array.isArray(snapshot.layers) ? snapshot.layers.length : null,
      indexCounts: snapshot.indexes ? Object.fromEntries(Object.entries(snapshot.indexes).map(([key, value]) => [key, Object.keys(value).length])) : null
    }));
  }
}

module.exports = { SnapshotManager, buildIndexes, findLayer };
