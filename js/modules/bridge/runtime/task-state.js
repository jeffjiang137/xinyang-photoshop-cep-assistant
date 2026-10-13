'use strict';

const TaskStates = Object.freeze({
  QUEUED: 'QUEUED',
  WAITING_FOR_LOCK: 'WAITING_FOR_LOCK',
  PRECHECK: 'PRECHECK',
  RUNNING: 'RUNNING',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  CANCELLING: 'CANCELLING',
  RECOVERING: 'RECOVERING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  ABORTED: 'ABORTED'
});

const TERMINAL_STATES = new Set([
  TaskStates.COMPLETED,
  TaskStates.FAILED,
  TaskStates.TIMEOUT,
  TaskStates.CANCELLED,
  TaskStates.ABORTED
]);

function isTerminal(state) { return TERMINAL_STATES.has(state); }

function transition(task, state, details) {
  task.state = state;
  task.stateHistory.push({ state, at: new Date().toISOString(), details: details || null });
  if (state === TaskStates.RUNNING) task.started_at = task.started_at || new Date().toISOString();
  if (isTerminal(state)) task.finished_at = task.finished_at || new Date().toISOString();
  return task;
}

module.exports = { TaskStates, TERMINAL_STATES, isTerminal, transition };
