'use strict';

const crypto = require('crypto');
const { RiskAnalyzer, RISK_LEVELS } = require('./risk-analyzer');
const { BatchOptimizer } = require('./batch-optimizer');

function unique(values) { return Array.from(new Set(values.filter(value => value !== undefined && value !== null).map(value => String(value)))); }

class ExecutionPlanner {
  constructor(options) {
    this.riskAnalyzer = options && options.riskAnalyzer || new RiskAnalyzer();
    this.batchOptimizer = options && options.batchOptimizer || new BatchOptimizer(options);
  }

  plan(command) {
    const operations = Array.isArray(command && command.operations) ? command.operations.slice() : [];
    const mode = String(command && command.mode || 'FAST').toUpperCase();
    const risks = this.riskAnalyzer.analyzeAll(operations);
    const highRisk = risks.filter(item => item.highRisk);
    const mediumRisk = risks.filter(item => item.risk === RISK_LEVELS.MEDIUM);
    const modules = unique(operations.map(operation => String(operation && operation.type || '').split('.')[0]).filter(Boolean));
    const layers = unique(operations.flatMap(operation => [operation && operation.layerId, ...(Array.isArray(operation && operation.layerIds) ? operation.layerIds : [])]));
    const texts = unique(operations.filter(operation => String(operation && operation.type || '').startsWith('text.')).map(operation => operation && operation.layerId));
    const smartObjects = unique(operations.filter(operation => String(operation && operation.type || '').startsWith('smartObject.')).map(operation => operation && operation.layerId));
    const groups = unique(operations.filter(operation => String(operation && operation.type || '').startsWith('group.')).flatMap(operation => [operation && operation.groupId, operation && operation.layerId]));
    const images = unique(operations.filter(operation => String(operation && operation.type || "") === "smartObject.replace").map(operation => operation && (operation.path || operation.assetPath || operation.imagePath)));
    const transforms = operations.map((operation, index) => ({ operation, index })).filter(item => /\.(move|resize|rotate|transform|scale|position)$/.test(String(item.operation && item.operation.type || "")) || item.operation && ["x", "y", "scaleX", "scaleY", "rotate"].some(key => item.operation[key] !== undefined)).map(item => ({ index: item.index, type: item.operation.type, layerId: item.operation.layerId === undefined ? null : item.operation.layerId }));
    const batchableOperations = risks.filter(item => item.batchable).map(item => item.index);
    const nonBatchableOperations = risks.filter(item => !item.batchable).map(item => item.index);
    const batches = this.batchOptimizer.optimize(operations, { mode });
    const previewStages = Array.isArray(command && command.previewStages) && command.previewStages.length ? command.previewStages.slice(0, 3) : ['structure', 'visual', 'final'];
    const checkpointRequired = operations.length >= 100 || highRisk.some(item => item.type.startsWith('smartObject.')) || command && command.checkpoint === true;
    return {
      planId: command && command.planId || `plan_${crypto.randomUUID()}`,
      documentId: command && command.documentId === undefined ? 'active' : command.documentId,
      mode,
      recommendedMode: highRisk.length && mode === 'FAST' ? 'SAFE' : mode,
      transaction: command && command.transaction !== false,
      modules,
      layers,
      texts,
      smartObjects,
      groups,
      images,
      transforms,
      batchableOperations,
      nonBatchableOperations,
      operationCount: operations.length,
      batchCount: batches.length,
      batches,
      risks,
      highRiskOperations: highRisk.map(item => item.index),
      mediumRiskOperations: mediumRisk.map(item => item.index),
      previewStages,
      previewCount: previewStages.length,
      checkpointRequired,
      verifyAfter: command && command.verifyAfter === true,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = { ExecutionPlanner };
