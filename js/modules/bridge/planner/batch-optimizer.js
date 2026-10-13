'use strict';

function chunk(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

class BatchOptimizer {
  constructor(options) {
    this.maxFastOperations = Number(options && options.maxFastOperations || 100);
    this.maxSafeOperations = Number(options && options.maxSafeOperations || 30);
  }

  optimize(operations, options) {
    const mode = String(options && options.mode || 'FAST').toUpperCase();
    const max = mode === 'SAFE' ? this.maxSafeOperations : this.maxFastOperations;
    return chunk(operations || [], Math.max(1, max)).map((batch, index) => ({
      index,
      mode,
      operationCount: batch.length,
      operationIndexes: batch.map((_, offset) => index * max + offset),
      operations: batch
    }));
  }
}

module.exports = { BatchOptimizer };
