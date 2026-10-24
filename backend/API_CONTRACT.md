# CivicPulse API contract

Local backend URL: **`http://127.0.0.1:3001`**. All paths below are relative to that URL.
This API supports a local **RVCE campus maintenance pilot**. Administrators in the demo represent
campus maintenance staff. It currently has no user authentication.
The frontend calls Express only; it must never receive a Supabase secret key.
The frontend team already owns the RVCE map. The backend does not provide campus coordinates,
building locations, boundaries, a map provider, or a geofence.

## Conventions

- Send `Content-Type: application/json` for POST requests.
- Successful issue responses use `{ "data": ... }`. Errors use `{ "error": { "code": "...", "message": "..." } }`.
- Coordinates and severity are JSON numbers, not strings. Coordinates use WGS84 latitude/longitude in decimal degrees.
- Category: `pothole`, `garbage`, `streetlight`, or `water_leak`.
- Status: `reported`, `assigned`, `in_progress`, or `resolved`.
- IDs are UUIDs; timestamps are ISO 8601 strings with a UTC offset.
- Only the six documented creation fields are accepted. The server sets ID, status, confirmations, score, and timestamp.
- No cookies, authorization headers, or Supabase credentials are needed in frontend requests.
- Existing response fields and envelopes are preserved. `priority_level` and `priority_calculated_at` are additive fields.
- Numeric coordinates in this document are synthetic examples, **not RVCE locations**. Send coordinates from the team's map.

## Endpoints

| Method | Path | Request | Success |
| --- | --- | --- | --- |
| GET | `/api/health` | No body | 200, `{ "status": "ok" }` |
| POST | `/api/issues` | Creation JSON below | 201, `{ "data": issue }` |
| POST | `/api/issues/check-duplicate` | Category and coordinates | 200, `{ "data": [suggestion, ...] }` |
| GET | `/api/issues` | Optional `category` and `status` query parameters | 200, `{ "data": [issue, ...] }` |
| GET | `/api/issues/:id` | UUID path parameter, no body | 200, `{ "data": issue }` |

### GET /api/health

```json
{ "status": "ok" }
```

This checks that the HTTP server is running. It does not verify Supabase connectivity.

### POST /api/issues

Request:

```json
{
  "title": "Surface damage at the selected map point",
  "description": "A deep pothole needs campus maintenance attention.",
  "category": "pothole",
  "latitude": 0,
  "longitude": 0,
  "severity": 4
}
```

| Field | Validation |
| --- | --- |
| title | Required string, trimmed, 1–120 characters |
| description | Required string, trimmed, 1–2000 characters |
| category | Required category from the list above |
| latitude | Required finite number, -90 through 90 inclusive |
| longitude | Required finite number, -180 through 180 inclusive |
| severity | Required integer, 1 through 5 inclusive |

The body must be a JSON object with no additional fields and at most 16 KB.
Successful response (201); the `Location` header is `/api/issues/<new-id>`:

```json
{
  "data": {
    "id": "11d4d8ef-f8e4-4b58-8fe4-408ccf8cd250",
    "title": "Surface damage at the selected map point",
    "description": "A deep pothole needs campus maintenance attention.",
    "category": "pothole",
    "latitude": 0,
    "longitude": 0,
    "severity": 4,
    "status": "reported",
    "confirmations": 0,
    "priority_score": 60,
    "priority_level": "Medium",
    "priority_calculated_at": "2026-10-24T12:00:00.000Z",
    "created_at": "2026-10-24T12:00:00+00:00"
  }
}
```

### GET /api/issues

Examples: `/api/issues`, `/api/issues?category=garbage`,
`/api/issues?status=reported`, `/api/issues?category=pothole&status=reported`.
Both filters together mean AND. Unknown filters, invalid values, and repeated filter keys return 400.

Returns `{ "data": [ ... ] }`, where each array element has exactly the issue shape shown above.
An empty result is `{ "data": [] }`, with HTTP 200.
Results are ordered by descending priority score, then newest creation time, then ascending ID.
Scores are recalculated and sorted across all database batches, using one UTC timestamp for the entire response.
The backend fetches database batches internally; there is currently no frontend pagination parameter.

### GET /api/issues/:id

Example: `/api/issues/11d4d8ef-f8e4-4b58-8fe4-408ccf8cd250`.
Returns the same `{ "data": issue }` shape as creation. A valid UUID with no matching record
returns 404; a malformed UUID returns 400.

### POST /api/issues/check-duplicate

Send exactly these three fields, using the **same selected coordinates and category** that you would send to creation:

```json
{
  "category": "pothole",
  "latitude": 0,
  "longitude": 0
}
```

Category and coordinate validation is identical to creation. An optional radius is not accepted;
the initial RVCE pilot radius is **25 metres**, inclusive. Resolved issues are excluded.
`reported`, `assigned`, and `in_progress` issues of the same category are eligible.

Example HTTP 200 response (a synthetic issue at the selected point):

```json
{
  "data": [
    {
      "id": "11d4d8ef-f8e4-4b58-8fe4-408ccf8cd250",
      "title": "Surface damage at the selected map point",
      "category": "pothole",
      "latitude": 0,
      "longitude": 0,
      "status": "reported",
      "distance_meters": 0,
      "priority_score": 60,
      "priority_level": "Medium",
      "priority_calculated_at": "2026-10-24T12:00:00.000Z"
    }
  ]
}
```

No matches returns HTTP 200 and `{ "data": [] }`. Matches are nearest first, with ID breaking distance ties.
Distance is calculated using the Haversine formula and a spherical Earth radius of 6,371,000 metres.
The unrounded distance determines inclusion; returned `distance_meters` is rounded to two decimals.
A 25-metre boundary uses only a negligible floating-point tolerance (0.0000001 metre).
A database bounding box, category filter, and unresolved-status filter narrow the candidates before exact distance checks.
Candidates are fetched in batches without a silent result cap. Dateline and pole cases are handled without campus assumptions.

These are **potential duplicate suggestions**. The endpoint never creates, rejects, merges, or deletes complaints.
Creation remains available even if suggestions exist. The UI can show nearby reports and let the reporter decide.
Errors use the existing 400/403/413/415/500/503 formats below.

## Current priority scores

```text
severity_points     = severity * 15
confirmation_points = min(confirmations * 3, 15)
days_unresolved     = max(0, floor((now_utc - created_at_utc) / 86,400 seconds))
age_points          = min(days_unresolved * 2, 10)
priority_score      = min(100, severity_points + confirmation_points + age_points)
```

For `resolved` issues, `age_points` is **zero**. This removes their age bonus and prevents further age growth;
it does not attempt to freeze an unknown resolution time. Other statuses accrue age until resolved.
Whole days mean full 24-hour elapsed periods, not calendar-date changes. Future timestamps receive zero age points.

| Score | `priority_level` |
| --- | --- |
| 0–44 | `Low` |
| 45–74 | `Medium` |
| 75–100 | `High` |

Every creation, list, lookup, and duplicate response uses the same pure scoring utility.
`priority_calculated_at` identifies the UTC evaluation time. Use the API's `priority_score` and `priority_level`
for markers and maintenance queues; do not recalculate a separate formula in the frontend.

The existing database `priority_score` column is retained as the **Milestone 1 creation-time snapshot**.
It is not a live score and can differ from the current API score. Current persisted inputs (severity,
confirmations, status, created_at) are authoritative; the API always replaces the snapshot with a fresh calculation
and ranks using that calculation. Reads do not update saved complaints or require a scheduled refresh.
Any future direct database dashboard or export must use the same current calculation rather than the legacy column.

Confirmations are intended to represent independent reporters. The API currently accepts no client-supplied count,
and this milestone does not implement identity verification or a confirmation endpoint. Existing counts must come
from trusted setup; enforcing one confirmation per independent person remains future work.
These weights are **prototype assumptions, not scientifically validated risk predictions**.

## Database upgrade

No required schema migration or data reset. Existing complaints and fields remain intact.
For faster duplicate candidate lookup, optionally run
[`supabase/migrations/002_duplicate_candidate_index.sql`](supabase/migrations/002_duplicate_candidate_index.sql)
in the existing project's SQL Editor. It only adds an index, can be re-run, and does not change access permissions.
Do **not** re-run the fresh-project `schema.sql` against your existing table.

## Error responses

Validation example (400):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [
      { "path": "severity", "message": "Too big: expected number to be <=5" }
    ]
  }
}
```

`details` is present for validation errors only. Its `path` identifies the invalid field;
an empty path represents the whole request. Message text may vary; use `code` and `path` in UI logic.

Database failure example (503):

```json
{
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "The issue database is temporarily unavailable."
  }
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid/missing field, malformed UUID, unknown field or query parameter |
| 400 | `INVALID_JSON` | Malformed JSON body |
| 403 | `CORS_FORBIDDEN` | Browser origin is not explicitly allowed |
| 404 | `ISSUE_NOT_FOUND` | No issue with that UUID |
| 404 | `NOT_FOUND` | Unknown endpoint |
| 413 | `PAYLOAD_TOO_LARGE` | Body exceeds 16 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | POST must use UTF-8 JSON and `Content-Type: application/json` |
| 500 | `INTERNAL_ERROR` | Unexpected server failure |
| 503 | `DATABASE_UNAVAILABLE` | Missing server configuration, schema/permission failure, database timeout, or database/network failure |

Database internals and credentials are never included in these errors. A database query times out after 10 seconds;
a list spanning multiple database batches can take longer overall.

## Frontend fetch examples

Configure the frontend origin in `backend/.env` as `CORS_ORIGIN=http://localhost:5173`.
If the frontend also runs at `http://127.0.0.1:5173`, include both origins separated by a comma.
An origin is exact: protocol, hostname, and port must match, with no trailing slash or path.

```js
const API_BASE = 'http://127.0.0.1:3001';

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error.message);
    error.code = body.error.code;
    error.details = body.error.details;
    throw error;
  }
  return body;
}

// Health
const health = await api('/api/health');
console.log(health.status);

// `selectedMapPoint` must come from the team's existing RVCE map.
// This function defines no default campus point or building location.
async function checkNearby(selectedMapPoint, category) {
  const { latitude, longitude } = selectedMapPoint;
  const { data } = await api('/api/issues/check-duplicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, latitude, longitude }),
  });
  return data;
}

async function createReport(selectedMapPoint, { title, description, category, severity }) {
  const { latitude, longitude } = selectedMapPoint;
  const { data } = await api('/api/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, category, latitude, longitude, severity }),
  });
  return data;
}

// List all
const { data: allIssues } = await api('/api/issues');

// Filter
const query = new URLSearchParams({ category: 'pothole', status: 'reported' });
const { data: filteredIssues } = await api(`/api/issues?${query}`);

// Fetch one
async function getReport(issueId) {
  const { data } = await api(`/api/issues/${issueId}`);
  return data;
}
```

## Display markers on the team's RVCE map

1. Capture geographic coordinates from the existing map's click/selection event. Send numbers in
   `{ latitude, longitude }`; never send pixel positions, building names, or a map's zoom coordinates.
   If the existing map uses a custom image/pixel CRS, the frontend team must supply an accurate transformation
   to WGS84 coordinates before this geographic API can be used. The backend does not invent that transformation.
2. Call `checkNearby(point, category)` and show optional suggestions. Call `createReport(point, formValues)`
   only when the user submits their report; checking suggestions does not submit it.
3. Fetch `GET /api/issues` (optionally filtered). Use each issue's `id` as the marker key,
   `latitude` and `longitude` as its position, and `priority_level` and `status` to style it.
   Display titles/descriptions as text, not unescaped HTML. Open detail using `GET /api/issues/:id`.
4. Honor your map library's coordinate order: Leaflet-style APIs often use `[latitude, longitude]`;
   GeoJSON uses `[longitude, latitude]`. The backend field names stay the same for both.
5. Refresh the API when the map/queue needs updated age scores. There is no push or automatic marker refresh.

Example adapter data (connect this to the map already implemented by the frontend team):

```js
const { data: issues } = await api('/api/issues');
const markerModels = issues.map((issue) => ({
  id: issue.id,
  latitude: issue.latitude,
  longitude: issue.longitude,
  title: issue.title,
  status: issue.status,
  priorityScore: issue.priority_score,
  priorityLevel: issue.priority_level,
}));
```

All returned issue coordinates are finite JSON numbers in geographic range. Valid coordinates outside RVCE
are not rejected, and existing rows are not relabelled or removed. There is currently no campus boundary,
campus ID, or campus-isolation filter. The frontend may keep its existing map viewport, but viewport restriction
is not server-side geofencing. Accurate boundaries and campus tenancy are future inputs for multi-campus scaling.
