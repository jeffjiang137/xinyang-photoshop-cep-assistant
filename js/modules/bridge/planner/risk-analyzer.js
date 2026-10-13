'use strict';

const RISK_LEVELS = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });

const HIGH_RISK_TYPES = new Set([
  'layer.delete', 'layer.reorder',
  'smartObject.replace', 'smartObject.transform', 'smartObject.scale', 'smartObject.position',
  'group.create', 'group.move', 'group.duplicate', 'group.reorder',
  'shape.radius', 'shape.gradient'
]);

const MEDIUM_RISK_TYPES = new Set([
  'layer.duplicate', 'layer.resize', 'layer.rotate',
  'text.replaceAndStyle', 'text.replace', 'text.style',
  'shape.create', 'shape.fill', 'shape.stroke',
  'group.visibility', 'layer.move'
]);

const BATCHABLE_TYPES = new Set(["text.replaceAndStyle", "text.replace", "text.update", "text.style", "text.font", "text.size", "text.leading", "text.tracking", "text.color", "text.alignment", "text.position", "text.box", "text.boxSize", "layer.move", "layer.resize", "layer.rotate", "layer.opacity", "layer.visibility", "layer.rename", "layer.set", "layer.duplicate", "layer.delete", "layer.reorder", "shape.fill", "shape.stroke", "shape.opacity", "shape.style", "shape.create", "shape.gradient", "smartObject.replace", "smartObject.transform", "smartObject.quad", "smartObject.scale", "smartObject.position", "group.create", "group.add", "group.remove", "group.duplicate", "group.move", "group.reorder", "group.visibility", "group.rename", "document.save"]);

function operationType(operation) {
  return String(operation && operation.type || '').trim();
}

class RiskAnalyzer {
  analyze(operation, index) {
    const type = operationType(operation);
    const batchable = BATCHABLE_TYPES.has(type);
    const risk = !batchable || HIGH_RISK_TYPES.has(type) ? RISK_LEVELS.HIGH : MEDIUM_RISK_TYPES.has(type) ? RISK_LEVELS.MEDIUM : RISK_LEVELS.LOW;
    const layerIds = [];
    if (operation && operation.layerId !== undefined) layerIds.push(operation.layerId);
    if (operation && Array.isArray(operation.layerIds)) layerIds.push(...operation.layerIds);
    return {
      index,
      type,
      risk,
      batchable,
      highRisk: risk === RISK_LEVELS.HIGH,
      layerIds: Array.from(new Set(layerIds.map(value => String(value))))
    };
  }

  analyzeAll(operations) {
    return (operations || []).map((operation, index) => this.analyze(operation, index));
  }
}

module.exports = { RiskAnalyzer, RISK_LEVELS, HIGH_RISK_TYPES, MEDIUM_RISK_TYPES, BATCHABLE_TYPES };
