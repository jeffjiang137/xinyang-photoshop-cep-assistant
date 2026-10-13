'use strict';

function uniqueNumbers(values) {
  return Array.from(new Set((values || []).filter(value => value !== undefined && value !== null).map(Number).filter(Number.isFinite)));
}

class DirtyTracker {
  constructor() { this.documents = new Map(); }
  key(documentId) { return documentId === undefined || documentId === null ? 'active' : String(documentId); }
  entry(documentId) {
    const key = this.key(documentId);
    if (!this.documents.has(key)) this.documents.set(key, { dirtyLayers: [], dirtyGroups: [], dirtyRegions: [] });
    return this.documents.get(key);
  }
  mark(documentId, change) {
    const entry = this.entry(documentId);
    entry.dirtyLayers = uniqueNumbers(entry.dirtyLayers.concat(change && change.dirtyLayers));
    entry.dirtyGroups = uniqueNumbers(entry.dirtyGroups.concat(change && change.dirtyGroups));
    const regions = (change && change.dirtyRegions) || [];
    for (const region of regions) {
      if (!region) continue;
      const normalized = ['x', 'y', 'width', 'height'].reduce((out, key) => { out[key] = Number(region[key] || 0); return out; }, {});
      if (normalized.width > 0 && normalized.height > 0 && !entry.dirtyRegions.some(item => JSON.stringify(item) === JSON.stringify(normalized))) entry.dirtyRegions.push(normalized);
    }
    return this.snapshot(documentId);
  }
  collectOperations(operations) {
    const change = { dirtyLayers: [], dirtyGroups: [], dirtyRegions: [] };
    for (const operation of operations || []) {
      if (operation.layerId !== undefined) change.dirtyLayers.push(operation.layerId);
      if (operation.groupId !== undefined) change.dirtyGroups.push(operation.groupId);
      if (Array.isArray(operation.layerIds)) change.dirtyLayers.push(...operation.layerIds);
      if (operation.region) change.dirtyRegions.push(operation.region);
      if (operation.bounds) change.dirtyRegions.push({ x: operation.bounds[0], y: operation.bounds[1], width: operation.bounds[2] - operation.bounds[0], height: operation.bounds[3] - operation.bounds[1] });
    }
    return change;
  }
  markOperations(documentId, operations) { return this.mark(documentId, this.collectOperations(operations)); }
  snapshot(documentId) {
    const value = this.entry(documentId);
    return { dirtyLayers: value.dirtyLayers.slice(), dirtyGroups: value.dirtyGroups.slice(), dirtyRegions: value.dirtyRegions.map(region => Object.assign({}, region)) };
  }
  consume(documentId) {
    const value = this.snapshot(documentId);
    this.documents.set(this.key(documentId), { dirtyLayers: [], dirtyGroups: [], dirtyRegions: [] });
    return value;
  }
  clear(documentId) { this.documents.delete(this.key(documentId)); }
}

module.exports = { DirtyTracker };
