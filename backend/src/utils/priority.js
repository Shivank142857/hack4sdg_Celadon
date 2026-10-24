const DAY_MS = 86_400_000;
const STATUSES = new Set(['reported', 'assigned', 'in_progress', 'resolved']);

// Prototype weights for the campus pilot, not validated risk predictions.
export function calculateInitialPriority(severity) {
  if (!Number.isInteger(severity) || severity < 1 || severity > 5) {
    throw new RangeError('Severity must be an integer between 1 and 5.');
  }

  return severity * 15;
}

function utcMilliseconds(value) {
  // Reject timezone-less strings rather than interpreting them in local time.
  if (!(value instanceof Date)
    && (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value))) {
    throw new RangeError('Priority timestamps must include a UTC offset.');
  }
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new RangeError('Invalid priority timestamp.');
  return milliseconds;
}

// The caller supplies the clock so this calculation is pure and deterministic.
export function calculatePriority({ severity, confirmations, status, created_at }, now) {
  const severityPoints = calculateInitialPriority(severity);
  if (!Number.isSafeInteger(confirmations) || confirmations < 0) {
    throw new RangeError('Confirmations must be a nonnegative integer.');
  }
  if (!STATUSES.has(status)) throw new RangeError('Invalid issue status.');

  const elapsed = Math.max(0, utcMilliseconds(now) - utcMilliseconds(created_at));
  const daysUnresolved = status === 'resolved' ? 0 : Math.floor(elapsed / DAY_MS);
  return Math.min(100,
    severityPoints + Math.min(confirmations * 3, 15) + Math.min(daysUnresolved * 2, 10));
}

export function getPriorityLevel(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new RangeError('Priority score must be an integer from 0 to 100.');
  }
  if (score >= 75) return 'High';
  if (score >= 45) return 'Medium';
  return 'Low';
}
