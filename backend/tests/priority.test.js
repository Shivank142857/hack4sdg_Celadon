import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateInitialPriority, calculatePriority, getPriorityLevel } from '../src/utils/priority.js';

test('initial priority is severity times 15 for every valid severity', () => {
  for (const severity of [1, 2, 3, 4, 5]) {
    assert.equal(calculateInitialPriority(severity), severity * 15);
  }
});

const base = { severity: 3, confirmations: 0, status: 'reported', created_at: '2026-10-01T12:00:00Z' };
const at = '2026-10-01T12:00:00Z';

test('smart priority combines severity, confirmations, and whole elapsed days', () => {
  assert.equal(calculatePriority({ ...base, confirmations: 2 }, '2026-10-04T12:00:00Z'), 57);
});

test('confirmation points cap at 15', () => {
  assert.equal(calculatePriority({ ...base, confirmations: 4 }, at), 57);
  assert.equal(calculatePriority({ ...base, confirmations: 5 }, at), 60);
  assert.equal(calculatePriority({ ...base, confirmations: 500 }, at), 60);
});

test('unresolved age points cap at 10 after five days', () => {
  assert.equal(calculatePriority(base, '2026-10-05T12:00:00Z'), 53);
  assert.equal(calculatePriority(base, '2026-10-06T12:00:00Z'), 55);
  assert.equal(calculatePriority(base, '2027-10-06T12:00:00Z'), 55);
});

test('maximum combined score is 100', () => {
  assert.equal(calculatePriority({ ...base, severity: 5, confirmations: 1000 }, '2026-10-30T00:00:00Z'), 100);
});

test('resolved issues have zero age points regardless of elapsed duration', () => {
  const resolved = { ...base, confirmations: 2, status: 'resolved' };
  assert.equal(calculatePriority(resolved, '2026-10-02T12:00:00Z'), 51);
  assert.equal(calculatePriority(resolved, '2030-10-02T12:00:00Z'), 51);
});

test('whole elapsed days do not round up at midnight or before 24 hours', () => {
  assert.equal(calculatePriority(base, '2026-10-02T11:59:59.999Z'), 45);
  assert.equal(calculatePriority(base, '2026-10-02T12:00:00Z'), 47);
  assert.equal(calculatePriority({ ...base, created_at: '2026-10-01T23:59:00Z' }, '2026-10-02T00:01:00Z'), 45);
});

test('UTC offsets describe equivalent instants and future creation dates get no age points', () => {
  assert.equal(calculatePriority(base, '2026-10-02T17:30:00+05:30'), 47);
  assert.equal(calculatePriority(base, new Date('2026-10-02T12:00:00Z')), 47);
  assert.equal(calculatePriority(base, '2026-09-30T12:00:00Z'), 45);
});

test('scoring is deterministic and does not mutate its inputs', () => {
  const frozen = Object.freeze({ ...base });
  assert.equal(calculatePriority(frozen, at), calculatePriority(frozen, at));
});

test('invalid scoring data is rejected instead of producing NaN or negative scores', () => {
  for (const confirmations of [-1, 1.5, '2', null, undefined, NaN, Infinity]) {
    assert.throws(() => calculatePriority({ ...base, confirmations }, at), RangeError);
  }
  for (const created_at of ['invalid', '2026-10-01T12:00:00', null]) {
    assert.throws(() => calculatePriority({ ...base, created_at }, at), RangeError);
  }
  assert.throws(() => calculatePriority({ ...base, status: 'unknown' }, at), RangeError);
  assert.throws(() => calculatePriority(base, new Date('invalid')), RangeError);
});

test('priority level boundaries are Low 0–44, Medium 45–74, High 75–100', () => {
  for (const [score, level] of [[0, 'Low'], [44, 'Low'], [45, 'Medium'], [74, 'Medium'], [75, 'High'], [100, 'High']]) {
    assert.equal(getPriorityLevel(score), level);
  }
  for (const score of [-1, 101, 44.5, NaN, '75']) assert.throws(() => getPriorityLevel(score), RangeError);
});

test('priority rejects invalid, non-integer, and non-numeric severities', () => {
  for (const severity of [0, 6, -1, 1.5, '3', null, undefined, NaN, Infinity]) {
    assert.throws(() => calculateInitialPriority(severity), RangeError);
  }
});
