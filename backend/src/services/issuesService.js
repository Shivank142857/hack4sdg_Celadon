import { getSupabase } from '../config/supabase.js';
import { calculateInitialPriority, calculatePriority, getPriorityLevel } from '../utils/priority.js';
import { assertCoordinates, duplicateBoundingBox, DUPLICATE_RADIUS_METERS, haversineDistanceMeters } from '../utils/geo.js';

const ISSUE_COLUMNS = 'id,title,description,category,latitude,longitude,severity,status,confirmations,priority_score,created_at';
const BATCH_SIZE = 1000;
const DATABASE_TIMEOUT_MS = 10_000;

export class DatabaseError extends Error {
  constructor(cause) {
    super('The issue database is temporarily unavailable.', { cause });
    this.name = 'DatabaseError';
  }
}

function currentIssue(issue, now) {
  const coordinate = (value) => {
    if ((typeof value !== 'number' && typeof value !== 'string')
      || (typeof value === 'string' && value.trim() === '')) {
      throw new RangeError('Invalid stored coordinate.');
    }
    return Number(value);
  };
  const location = { latitude: coordinate(issue.latitude), longitude: coordinate(issue.longitude) };
  assertCoordinates(location);
  const score = calculatePriority(issue, now);
  return {
    ...issue,
    ...location,
    // The persisted M1 score is an initial snapshot, never a live ranking.
    priority_score: score,
    priority_level: getPriorityLevel(score),
    priority_calculated_at: now.toISOString(),
  };
}

function comparePriority(a, b) {
  return b.priority_score - a.priority_score
    || Date.parse(b.created_at) - Date.parse(a.created_at)
    || a.id.localeCompare(b.id);
}

export function createIssuesService({ getClient = getSupabase, now = () => new Date() } = {}) {
  async function withDatabase(operation) {
    try {
      return await operation(getClient());
    } catch (error) {
      // Do not send PostgREST details, URLs, or credentials to API clients.
      throw new DatabaseError(error);
    }
  }

  async function readAll(makeQuery) {
    const rows = [];
    while (true) {
      const { data, error, count } = await makeQuery()
        .range(rows.length, rows.length + BATCH_SIZE - 1)
        .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
      if (error) throw error;
      rows.push(...data);
      if (data.length === 0 || (count != null && rows.length >= count)) return rows;
    }
  }

  return {
    createIssue(input) {
      return withDatabase(async (db) => {
        const { data, error } = await db.from('issues')
          .insert({
            ...input,
            status: 'reported',
            confirmations: 0,
            priority_score: calculateInitialPriority(input.severity),
          })
          .select(ISSUE_COLUMNS)
          .single()
          .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
        if (error) throw error;
        return currentIssue(data, now());
      });
    },

    listIssues(filters) {
      return withDatabase(async (db) => {
        const at = now();
        // Fetch batches so Supabase's per-request row cap does not silently
        // truncate the API's list. Exact count also handles smaller row caps.
        const issues = await readAll(() => {
          let query = db.from('issues').select(ISSUE_COLUMNS, { count: 'exact' });
          if (filters.category) query = query.eq('category', filters.category);
          if (filters.status) query = query.eq('status', filters.status);
          return query
            .order('priority_score', { ascending: false })
            .order('created_at', { ascending: false })
            .order('id', { ascending: true });
        });
        // Re-sort across ALL pages using current scores, not stored snapshots.
        return issues.map((issue) => currentIssue(issue, at)).sort(comparePriority);
      });
    },

    getIssue(id) {
      return withDatabase(async (db) => {
        const { data, error } = await db.from('issues')
          .select(ISSUE_COLUMNS)
          .eq('id', id)
          .maybeSingle()
          .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
        if (error) throw error;
        return data ? currentIssue(data, now()) : null;
      });
    },

    checkDuplicates(input) {
      return withDatabase(async (db) => {
        const at = now();
        const bounds = duplicateBoundingBox(input);
        const matches = new Map();
        for (const [west, east] of bounds.longitudeRanges) {
          const candidates = await readAll(() => db.from('issues')
            .select(ISSUE_COLUMNS, { count: 'exact' })
            .eq('category', input.category)
            .neq('status', 'resolved')
            .gte('latitude', bounds.minLatitude)
            .lte('latitude', bounds.maxLatitude)
            .gte('longitude', west)
            .lte('longitude', east)
            .order('id', { ascending: true }));

          for (const candidate of candidates) {
            // Keep the semantic rules explicit as well as in the DB prefilter.
            if (candidate.category !== input.category || candidate.status === 'resolved') continue;
            const issue = currentIssue(candidate, at);
            const distance = haversineDistanceMeters(input, issue);
            if (distance > DUPLICATE_RADIUS_METERS + 1e-7) continue;
            matches.set(issue.id, { issue, distance });
          }
        }
        return [...matches.values()]
          .sort((a, b) => a.distance - b.distance || a.issue.id.localeCompare(b.issue.id))
          .map(({ issue, distance }) => ({
            id: issue.id,
            title: issue.title,
            category: issue.category,
            latitude: issue.latitude,
            longitude: issue.longitude,
            status: issue.status,
            distance_meters: Math.round(distance * 100) / 100,
            priority_score: issue.priority_score,
            priority_level: issue.priority_level,
            priority_calculated_at: issue.priority_calculated_at,
          }));
      });
    },
  };
}
