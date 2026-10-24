import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createIssuesService } from '../src/services/issuesService.js';
import { EARTH_RADIUS_METERS } from '../src/utils/geo.js';

const TEST_NOW = '2026-10-24T12:00:00.000Z';

const input = {
  title: 'Pothole near the bus stop',
  description: 'A deep pothole is blocking the left lane.',
  category: 'pothole',
  latitude: 12.9716,
  longitude: 77.5946,
  severity: 4,
};
const issue = {
  id: '11d4d8ef-f8e4-4b58-8fe4-408ccf8cd250',
  ...input,
  status: 'reported',
  confirmations: 0,
  priority_score: 60,
  created_at: '2026-10-24T12:00:00.000Z',
};
const responseIssue = { ...issue, priority_level: 'Medium', priority_calculated_at: TEST_NOW };

// Script the Supabase query boundary, keeping real routes, validation,
// controllers, priority calculation, and services under test. No network/keys.
function setup(responses = [], now = () => new Date(TEST_NOW)) {
  const calls = [];
  const db = {
    from(table) {
      const call = { table, filters: [], orders: [], bounds: [] };
      calls.push(call);
      const query = {
        insert(value) { call.insert = value; return query; },
        select(columns, options) { call.select = { columns, options }; return query; },
        single() { call.single = true; return query; },
        maybeSingle() { call.maybeSingle = true; return query; },
        eq(key, value) { call.filters.push([key, value]); return query; },
        neq(key, value) { call.filters.push([key, value, 'neq']); return query; },
        gte(key, value) { call.bounds.push([key, value, 'gte']); return query; },
        lte(key, value) { call.bounds.push([key, value, 'lte']); return query; },
        order(key, options) { call.orders.push([key, options]); return query; },
        range(from, to) { call.range = [from, to]; return query; },
        async abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal);
          assert.ok(responses.length, 'Unexpected database query');
          const response = responses.shift();
          if (response instanceof Error) throw response;
          return response;
        },
      };
      return query;
    },
  };
  const service = createIssuesService({ getClient: () => db, now });
  return { app: createApp({ issuesService: service, corsOrigin: 'http://localhost:5173' }), calls };
}

test('GET health returns 200 without querying the database', async () => {
  const { app, calls } = setup();
  const res = await request(app).get('/api/health').expect(200);
  assert.deepEqual(res.body, { status: 'ok' });
  assert.equal(calls.length, 0);
});

test('POST valid issue trims text and calculates priority before inserting', async () => {
  const { app, calls } = setup([{ data: issue, error: null }]);
  const res = await request(app).post('/api/issues')
    .send({ ...input, title: ` ${input.title} `, description: ` ${input.description} ` }).expect(201);
  assert.deepEqual(res.body, { data: responseIssue });
  assert.equal(res.headers.location, `/api/issues/${issue.id}`);
  assert.equal(calls[0].table, 'issues');
  assert.deepEqual(calls[0].insert, {
    ...input, priority_score: 60, status: 'reported', confirmations: 0,
  });
  assert.equal(calls[0].single, true);
});

const invalidFields = [
  ['invalid category', { category: 'flood' }],
  ['severity below minimum', { severity: 0 }],
  ['severity above maximum', { severity: 6 }],
  ['fractional severity', { severity: 2.5 }],
  ['string severity', { severity: '4' }],
  ['latitude above maximum', { latitude: 91 }],
  ['latitude below minimum', { latitude: -91 }],
  ['longitude above maximum', { longitude: 181 }],
  ['longitude below minimum', { longitude: -181 }],
  ['string coordinate', { latitude: '12.9716' }],
  ['null coordinate', { longitude: null }],
  ['blank title', { title: '   ' }],
  ['long title', { title: 'x'.repeat(121) }],
  ['blank description', { description: '   ' }],
  ['long description', { description: 'x'.repeat(2001) }],
  ['client-supplied priority', { priority_score: 9999 }],
  ['client-supplied status', { status: 'resolved' }],
  ['client-supplied confirmations', { confirmations: 100 }],
];
for (const [name, override] of invalidFields) {
  test(`POST rejects ${name} before database access`, async () => {
    const { app, calls } = setup();
    const res = await request(app).post('/api/issues').send({ ...input, ...override }).expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.length);
    assert.equal(calls.length, 0);
  });
}

for (const field of Object.keys(input)) {
  test(`POST rejects missing required field: ${field}`, async () => {
    const { app, calls } = setup();
    const body = { ...input };
    delete body[field];
    const res = await request(app).post('/api/issues').send(body).expect(400);
    assert.ok(res.body.error.details.some((detail) => detail.path === field));
    assert.equal(calls.length, 0);
  });
}

test('POST accepts coordinate boundaries and lowest severity', async () => {
  const { app, calls } = setup([{ data: { ...issue, latitude: -90, longitude: 180, severity: 1, priority_score: 15 }, error: null }]);
  await request(app).post('/api/issues').send({ ...input, latitude: -90, longitude: 180, severity: 1 }).expect(201);
  assert.equal(calls[0].insert.priority_score, 15);
});

test('GET issues returns prioritized database results', async () => {
  const { app, calls } = setup([{ data: [issue], error: null, count: 1 }]);
  const res = await request(app).get('/api/issues').expect(200);
  assert.deepEqual(res.body, { data: [responseIssue] });
  assert.deepEqual(calls[0].filters, []);
  assert.deepEqual(calls[0].orders, [
    ['priority_score', { ascending: false }],
    ['created_at', { ascending: false }],
    ['id', { ascending: true }],
  ]);
});

test('GET issues applies category and status filters to the database query', async () => {
  const { app, calls } = setup([{ data: [issue], error: null, count: 1 }]);
  await request(app).get('/api/issues?category=pothole&status=reported').expect(200);
  assert.deepEqual(calls[0].filters, [['category', 'pothole'], ['status', 'reported']]);
});

test('GET issues reads all database pages, including a reduced Supabase row cap', async () => {
  const second = { ...issue, id: '320d0d3b-03e2-4a0c-a101-9eb932d1f716' };
  const { app, calls } = setup([
    { data: [issue], error: null, count: 2 },
    { data: [second], error: null, count: 2 },
  ]);
  const res = await request(app).get('/api/issues?category=pothole').expect(200);
  assert.deepEqual(res.body.data, [responseIssue, { ...responseIssue, id: second.id }]);
  assert.deepEqual(calls.map((call) => call.range), [[0, 999], [1, 1000]]);
  assert.deepEqual(calls[1].filters, [['category', 'pothole']]);
});

test('GET issues returns an empty array when there are no matches', async () => {
  const { app } = setup([{ data: [], error: null, count: 0 }]);
  const res = await request(app).get('/api/issues').expect(200);
  assert.deepEqual(res.body, { data: [] });
});

for (const query of ['category=invalid', 'status=invalid', 'category=pothole&category=garbage', 'unknown=value']) {
  test(`GET rejects invalid query: ${query}`, async () => {
    const { app, calls } = setup();
    const res = await request(app).get(`/api/issues?${query}`).expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(calls.length, 0);
  });
}

test('GET an existing issue by UUID', async () => {
  const { app, calls } = setup([{ data: issue, error: null }]);
  const res = await request(app).get(`/api/issues/${issue.id}`).expect(200);
  assert.deepEqual(res.body, { data: responseIssue });
  assert.deepEqual(calls[0].filters, [['id', issue.id]]);
  assert.equal(calls[0].maybeSingle, true);
});

test('GET a nonexistent issue returns 404', async () => {
  const { app } = setup([{ data: null, error: null }]);
  const res = await request(app).get(`/api/issues/${issue.id}`).expect(404);
  assert.deepEqual(res.body, { error: { code: 'ISSUE_NOT_FOUND', message: 'Issue not found.' } });
});

test('GET an invalid UUID returns 400 before database access', async () => {
  const { app, calls } = setup();
  await request(app).get('/api/issues/not-a-uuid').expect(400);
  assert.equal(calls.length, 0);
});

for (const method of ['post', 'list', 'get']) {
  test(`${method} database failures return sanitized 503 responses`, async () => {
    const { app } = setup([{ data: null, error: { message: 'private database detail', code: '42501' } }]);
    let pending;
    if (method === 'post') pending = request(app).post('/api/issues').send(input);
    else pending = request(app).get(method === 'list' ? '/api/issues' : `/api/issues/${issue.id}`);
    const res = await pending.expect(503);
    assert.deepEqual(res.body, {
      error: { code: 'DATABASE_UNAVAILABLE', message: 'The issue database is temporarily unavailable.' },
    });
  });
}

test('network exceptions are also sanitized', async () => {
  const { app } = setup([new Error('private network detail')]);
  const res = await request(app).get('/api/issues').expect(503);
  assert.equal(res.body.error.code, 'DATABASE_UNAVAILABLE');
  assert.ok(!JSON.stringify(res.body).includes('private'));
});

test('unconfigured database returns 503 while health remains available', async () => {
  const service = createIssuesService({ getClient() { throw new Error('Missing private configuration'); } });
  const app = createApp({ issuesService: service });
  await request(app).get('/api/health').expect(200);
  await request(app).get('/api/issues').expect(503);
});

test('malformed JSON returns a JSON 400 error', async () => {
  const { app, calls } = setup();
  const res = await request(app).post('/api/issues').set('Content-Type', 'application/json').send('{broken').expect(400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
  assert.equal(calls.length, 0);
});

test('oversized JSON returns 413 before database access', async () => {
  const { app, calls } = setup();
  const res = await request(app).post('/api/issues').send({ ...input, description: 'x'.repeat(17_000) }).expect(413);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(calls.length, 0);
});

test('non-JSON submissions return 415', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/issues').type('form').send(input).expect(415);
  assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('unknown endpoints return consistent JSON 404 errors', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/unknown').expect(404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('CORS allows configured local origin and preflight', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173').expect(200);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  const preflight = await request(app).options('/api/issues')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type').expect(204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('CORS rejects an unconfigured origin', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/health').set('Origin', 'https://untrusted.example').expect(403);
  assert.equal(res.body.error.code, 'CORS_FORBIDDEN');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('CORS accepts multiple explicit local origins', async () => {
  const app = createApp({ corsOrigin: 'http://localhost:5173, http://127.0.0.1:5173' });
  const res = await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:5173').expect(200);
  assert.equal(res.headers['access-control-allow-origin'], 'http://127.0.0.1:5173');
});

test('CORS configuration rejects wildcards, public origins, paths, and empty lists', () => {
  for (const corsOrigin of ['*', 'https://example.com', 'http://localhost:5173/path', '']) {
    assert.throws(() => createApp({ corsOrigin }));
  }
});

// These are synthetic geographic fixtures, not RVCE campus locations.
const duplicateInput = { category: 'pothole', latitude: 0, longitude: 0 };
const atMeters = (meters) => meters / EARTH_RADIUS_METERS * 180 / Math.PI;
const nearbyIssue = { ...issue, latitude: 0, longitude: atMeters(20) };

test('duplicate check returns a same-category unresolved complaint within 25 metres', async () => {
  const { app, calls } = setup([{ data: [nearbyIssue], error: null, count: 1 }]);
  const res = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(200);
  assert.deepEqual(res.body.data, [{
    id: issue.id, title: issue.title, category: 'pothole',
    latitude: 0, longitude: atMeters(20), status: 'reported',
    distance_meters: 20, priority_score: 60, priority_level: 'Medium', priority_calculated_at: TEST_NOW,
  }]);
  assert.deepEqual(calls[0].filters, [['category', 'pothole'], ['status', 'resolved', 'neq']]);
  assert.deepEqual(calls[0].bounds.map(([key, , op]) => [key, op]), [
    ['latitude', 'gte'], ['latitude', 'lte'], ['longitude', 'gte'], ['longitude', 'lte'],
  ]);
  for (const [, value] of calls[0].bounds) assert.ok(Math.abs(value) < 0.001);
  assert.equal(calls[0].insert, undefined); // Suggestions never create/merge/delete.
});

for (const meters of [0, 24.999, 25]) {
  test(`duplicate check includes ${meters} metres`, async () => {
    const { app } = setup([{ data: [{ ...nearbyIssue, longitude: atMeters(meters) }], error: null, count: 1 }]);
    const res = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(200);
    assert.equal(res.body.data.length, 1);
  });
}

for (const meters of [25.001, 26, 75, 101]) {
  test(`duplicate check excludes ${meters} metres, even if prefilter returned it`, async () => {
    const { app } = setup([{ data: [{ ...nearbyIssue, longitude: atMeters(meters) }], error: null, count: 1 }]);
    const res = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(200);
    assert.deepEqual(res.body, { data: [] });
  });
}

test('duplicate check excludes bounding-box corners outside the circular radius', async () => {
  const { app } = setup([{ data: [{ ...nearbyIssue, latitude: atMeters(20), longitude: atMeters(20) }], error: null, count: 1 }]);
  const res = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(200);
  assert.deepEqual(res.body, { data: [] });
});

for (const override of [{ category: 'garbage' }, { status: 'resolved' }]) {
  test(`duplicate check excludes ${JSON.stringify(override)}`, async () => {
    const { app } = setup([{ data: [{ ...nearbyIssue, ...override }], error: null, count: 1 }]);
    const res = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(200);
    assert.deepEqual(res.body, { data: [] });
  });
}

for (const status of ['reported', 'assigned', 'in_progress']) {
  test(`duplicate check includes unresolved status ${status}`, async () => {
    const { app } = setup([{ data: [{ ...nearbyIssue, status }], error: null, count: 1 }]);
    const res = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(200);
    assert.equal(res.body.data[0].status, status);
  });
}

test('duplicate check returns an empty array for an empty database', async () => {
  const { app } = setup([{ data: [], error: null, count: 0 }]);
  const res = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(200);
  assert.deepEqual(res.body, { data: [] });
});

test('duplicate check paginates bounded results and sorts by distance', async () => {
  const nearer = { ...nearbyIssue, id: '320d0d3b-03e2-4a0c-a101-9eb932d1f716', longitude: atMeters(10) };
  const { app, calls } = setup([
    { data: [nearbyIssue], error: null, count: 2 },
    { data: [nearer], error: null, count: 2 },
  ]);
  const res = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(200);
  assert.deepEqual(res.body.data.map((value) => value.distance_meters), [10, 20]);
  assert.deepEqual(calls.map((call) => call.range), [[0, 999], [1, 1000]]);
  assert.deepEqual(calls[1].bounds, calls[0].bounds);
  assert.deepEqual(calls[1].filters, calls[0].filters);
});

test('duplicate check finds neighbours across the antimeridian without returning IDs twice', async () => {
  const candidate = { ...nearbyIssue, longitude: -179.99995 };
  const { app, calls } = setup([
    { data: [candidate], error: null, count: 1 },
    { data: [candidate], error: null, count: 1 },
  ]);
  const res = await request(app).post('/api/issues/check-duplicate')
    .send({ ...duplicateInput, longitude: 179.99995 }).expect(200);
  assert.equal(res.body.data.length, 1);
  assert.ok(res.body.data[0].distance_meters < 12);
  assert.equal(calls.length, 2);
});

const invalidDuplicateBodies = [
  {}, { ...duplicateInput, category: 'invalid' }, { ...duplicateInput, latitude: 91 },
  { ...duplicateInput, latitude: -91 }, { ...duplicateInput, longitude: 181 },
  { ...duplicateInput, longitude: -181 }, { ...duplicateInput, latitude: '0' },
  { ...duplicateInput, longitude: null }, { category: 'pothole', longitude: 0 },
  { category: 'pothole', latitude: 0 }, { ...duplicateInput, radius: 100 },
];
for (const [index, body] of invalidDuplicateBodies.entries()) {
  test(`duplicate check rejects invalid request ${index + 1} before DB access`, async () => {
    const { app, calls } = setup();
    const res = await request(app).post('/api/issues/check-duplicate').send(body).expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(calls.length, 0);
  });
}

test('duplicate check rejects non-JSON and malformed JSON submissions', async () => {
  const { app, calls } = setup();
  await request(app).post('/api/issues/check-duplicate').type('form').send(duplicateInput).expect(415);
  await request(app).post('/api/issues/check-duplicate').type('json').send('{broken').expect(400);
  assert.equal(calls.length, 0);
});

test('duplicate check sanitizes database failures', async () => {
  const { app } = setup([{ data: null, error: { message: 'private database detail' } }]);
  const res = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(503);
  assert.deepEqual(res.body, {
    error: { code: 'DATABASE_UNAVAILABLE', message: 'The issue database is temporarily unavailable.' },
  });
});

test('list ranks by current score across pages rather than the stored initial score', async () => {
  const recentSevere = { ...issue, severity: 5, priority_score: 75 };
  const olderConfirmed = { ...issue, id: '320d0d3b-03e2-4a0c-a101-9eb932d1f716',
    confirmations: 3, created_at: '2026-10-19T12:00:00Z' };
  let clockCalls = 0;
  const { app } = setup([
    { data: [recentSevere], error: null, count: 2 },
    { data: [olderConfirmed], error: null, count: 2 },
  ], () => { clockCalls++; return new Date(TEST_NOW); });
  const res = await request(app).get('/api/issues').expect(200);
  assert.deepEqual(res.body.data.map((value) => value.priority_score), [79, 75]);
  assert.equal(res.body.data[0].id, olderConfirmed.id);
  assert.equal(clockCalls, 1);
  assert.ok(res.body.data.every((value) => value.priority_calculated_at === TEST_NOW));
});

test('list, lookup and duplicate suggestions return the same current score', async () => {
  const old = { ...nearbyIssue, confirmations: 9, created_at: '2026-10-01T00:00:00Z', priority_score: 1 };
  const { app } = setup([
    { data: [old], error: null, count: 1 },
    { data: old, error: null },
    { data: [old], error: null, count: 1 },
  ]);
  const list = await request(app).get('/api/issues').expect(200);
  const single = await request(app).get(`/api/issues/${old.id}`).expect(200);
  const duplicate = await request(app).post('/api/issues/check-duplicate').send(duplicateInput).expect(200);
  for (const result of [list.body.data[0], single.body.data, duplicate.body.data[0]]) {
    assert.equal(result.priority_score, 85);
    assert.equal(result.priority_level, 'High');
  }
});

test('map responses normalize numeric database coordinates to JSON numbers', async () => {
  const { app } = setup([{ data: [{ ...issue, latitude: '12.9716', longitude: '77.5946' }], error: null, count: 1 }]);
  const res = await request(app).get('/api/issues').expect(200);
  assert.equal(res.body.data[0].latitude, 12.9716);
  assert.equal(res.body.data[0].longitude, 77.5946);
});

test('malformed stored coordinates are not returned as invalid map markers', async () => {
  const { app } = setup([{ data: [{ ...issue, latitude: null }], error: null, count: 1 }]);
  const res = await request(app).get('/api/issues').expect(503);
  assert.equal(res.body.error.code, 'DATABASE_UNAVAILABLE');
});

test('resolved complaints receive no age bonus when fetched', async () => {
  const { app } = setup([{ data: { ...issue, status: 'resolved', confirmations: 2, created_at: '2020-01-01T00:00:00Z' }, error: null }]);
  const res = await request(app).get(`/api/issues/${issue.id}`).expect(200);
  assert.equal(res.body.data.priority_score, 66);
});
