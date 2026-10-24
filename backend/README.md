# CivicPulse backend

Local Express API for the **RVCE campus maintenance pilot**, aligned with SDG 11.
The demo's administrators are campus maintenance staff. The team's existing frontend provides the RVCE map.
There are no invented campus coordinates, building locations, or boundaries in this backend, and no campus geofence.
Requires **Node.js 24** and npm. Everything for the backend lives in this directory.

## Install and start

From the repository root:

```sh
cd backend
npm ci
cp -n .env.example .env
# Edit .env locally using your editor; never paste secret keys into chat.
npm run dev
```

`npm run dev` restarts on source changes. `npm start` runs without watch mode.
The server binds exclusively to `127.0.0.1`, port 3001 by default.
Restart after editing `.env` (Ctrl+C, then start again).

The health endpoint starts even before Supabase is configured. Without valid database configuration,
issue endpoints return a sanitized HTTP 503. HTTP health is not a database readiness check.

## Configure Supabase manually

**Existing Milestone 1 project:** keep your existing `.env`, table, and saved complaints.
No schema migration is required for Milestone 2. Optionally run
[`supabase/migrations/002_duplicate_candidate_index.sql`](supabase/migrations/002_duplicate_candidate_index.sql)
in the existing SQL Editor for faster geographic prefiltering. It only adds an index, can be re-run,
and preserves all rows, columns, RLS, and grants. Do not run `schema.sql` again on an existing project.

For a **new** project only:

1. Create a Supabase project and wait for it to become ready.
2. Open the project's **SQL Editor**, create a new query, paste all of
   [`supabase/schema.sql`](supabase/schema.sql), and run it once. It creates `public.issues`,
   constraints, indexes, RLS, and role grants in one transaction. It intentionally fails if
   that table already exists; inspect an existing table before adapting the SQL. Do not drop teammate data.
3. Find the project URL in the project's connection/API settings and the **secret key** in
   **Settings → API Keys**. Use the backend secret key (`sb_secret_...`), not a publishable/anon key.
   A legacy `service_role` key also works for projects still using legacy keys.
4. Set the following values in **`backend/.env` on your computer**:

   ```dotenv
   PORT=3001
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_SECRET_KEY=YOUR_BACKEND_SECRET_KEY
   CORS_ORIGIN=http://localhost:5173
   ```

5. Restart the backend, create an issue using the curl command below, and list it to verify a real database round trip.

RLS is enabled with no browser access policies. Table privileges are explicitly revoked from
`PUBLIC`, `anon`, and `authenticated`. Express uses the secret key's `service_role`, which
bypasses RLS. Keep that key exclusively in the backend environment. See Supabase's official
[API key guide](https://supabase.com/docs/guides/getting-started/api-keys) and
[RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

Optional checks in the SQL Editor after schema creation (expect `true, false, false`):

```sql
select
  (select relrowsecurity from pg_class where oid = 'public.issues'::regclass) as rls_enabled,
  has_table_privilege('anon', 'public.issues', 'SELECT') as anon_can_select,
  has_table_privilege('authenticated', 'public.issues', 'INSERT') as authenticated_can_insert;
```

`.env`, `.env.*`, and `node_modules/` are ignored by `backend/.gitignore`; `.env.example` is safe to commit.
Do not put secret keys in frontend environment variables, frontend builds, screenshots, or Git.

## Test the API manually

With the server running in another terminal, use the commands below.
The zero coordinates are synthetic test data, not an RVCE location. Replace them with
the actual geographic coordinates supplied by the frontend team before creating a campus demo report.

```sh
curl -i http://127.0.0.1:3001/api/health

curl -i -X POST http://127.0.0.1:3001/api/issues \
  -H 'Content-Type: application/json' \
  -d '{"title":"Surface damage at selected map point","description":"Campus maintenance attention required.","category":"pothole","latitude":0,"longitude":0,"severity":4}'

curl -i -X POST http://127.0.0.1:3001/api/issues/check-duplicate \
  -H 'Content-Type: application/json' \
  -d '{"category":"pothole","latitude":0,"longitude":0}'

curl -i http://127.0.0.1:3001/api/issues
curl -i 'http://127.0.0.1:3001/api/issues?category=pothole&status=reported'
# Replace ISSUE_UUID with the id returned by POST:
curl -i http://127.0.0.1:3001/api/issues/ISSUE_UUID
```

Expect 200 from health, 201 from creation, then 200 from list and lookup.
The sample POST persists a real row when Supabase is configured. Repeating it creates another row.
Duplicate checking is read-only: it suggests unresolved same-category reports within **25 metres**,
without merging, rejecting, or deleting anything. The check uses a bounding box in Supabase and then
Haversine distance. A suggested match may be a different nearby problem; the reporter decides what to submit.

## Automated tests versus live database testing

```sh
cd backend  # omit if already here
npm test
```

Tests use the Node.js built-in runner and Supertest. The database query boundary is mocked;
real routes, controllers, validation, service logic, and priority calculation run in the tests.
No Supabase credentials, project, or network connection are required. Tests do not insert or delete live data.

Coverage includes health, creation and generated fields, all required fields, invalid categories/severities,
coordinates and text, list filters and database batching, UUID lookup and missing rows, database/network
failures, malformed/oversized bodies, and local CORS configuration. Priority tests cover all valid severities
and invalid inputs. A separate startup smoke test launches the actual server on a temporary loopback port,
checks health and the unconfigured-database response, and stops the child process afterward.
Milestone 2 coverage includes confirmation/age caps, UTC whole-day boundaries, resolved behavior,
current-score ranking across database batches, map coordinate normalization, duplicate distance boundaries,
category/status exclusions, empty results, validation, bounded query construction, and pole/dateline geometry.
Geographic test fixtures are synthetic and are not campus landmarks.

**Passing mocked tests does not verify the SQL, Supabase credentials, RLS, or live persistence.**
Use the manual setup and curl requests above to verify those against your own project.

## Frontend integration

Share [`API_CONTRACT.md`](API_CONTRACT.md) with both frontend teammates. It documents every endpoint,
request/response shape, errors, and copyable `fetch()` examples.
Use `http://127.0.0.1:3001` as the API base URL. Allow the frontend's exact local origin in `.env`.
For multiple local origins:

```dotenv
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000
```

Wildcards, public hosts, paths, and trailing slashes are rejected in the CORS configuration.
Requests without an Origin header (such as curl) work. CORS is a browser control, not authentication.
All teammates must run the backend locally or use their own local development arrangement;
the localhost binding does not accept connections from other machines.

## Structure and priority

`src/app.js` builds the HTTP app; `src/server.js` loads the environment and binds the server.
Routes call controllers for validation and responses; services perform Supabase operations.
`src/config/supabase.js` initializes the server-only client lazily.

`src/utils/priority.js` calculates `min(100, severity * 15 + min(confirmations * 3, 15) + min(days_unresolved * 2, 10))`.
Days are whole elapsed UTC 24-hour periods, clamped to zero for future creation times. Resolved issues have
zero age points; no resolution time is fabricated. Low is 0–44, Medium 45–74, High 75–100.
The clock is explicitly injected for deterministic tests; every list uses one evaluation timestamp.
These weights are prototype assumptions, not scientifically validated risk predictions.

Status starts as `reported`; confirmations start at 0. Creation cannot set confirmations or status.
Confirmations are intended to count independent people, but identity verification and confirmation submission
are not implemented yet. Only trusted setup should change counts until independence can be enforced.

The existing stored `priority_score` remains the M1 **initial snapshot**, preserving the schema and records.
It is not the source of current priority: all API responses recalculate from persisted input fields and add
`priority_level` and `priority_calculated_at`. The live score can differ from that old snapshot; frontend
markers, maintenance queues, and future exports must use the current calculation. Reads do not mutate records.
Lists are re-sorted using current scores across all database batches, then by creation time and ID.

`src/utils/geo.js` contains the 25-metre radius, Haversine calculation, and bounding box prefilter.
The radius is a pilot assumption kept in one constant; it is not a campus boundary. No map provider is needed
by the backend. Send map-supplied WGS84 `latitude`/`longitude`, never unconverted image pixels.

## Remaining work and deployment limits

This is a **local hackathon MVP**. Before any public deployment, add real authentication,
campus maintenance staff authorization, rate limiting and other abuse protection; configure hosting, HTTPS,
allowed production origins, and secret management deliberately. Do not expose this unauthenticated API publicly.

Not yet implemented: independent confirmation and status-update endpoints, maintenance workflows,
emergency overrides, AI categorization, uploads, campus tenancy, and accurate campus geofencing.
There is no hard-coded RVCE boundary. Existing records remain available even outside the pilot area.
Add campus IDs, isolation/authorization, and accurate map-team-supplied boundaries before scaling to multiple
campuses or cities. The current API supplies marker coordinates for the team's existing map.
Public API pagination and snapshot-consistent listing are also future work:
an all-issues response is suitable for a small demo, and simultaneous writes
during multi-batch reads can change results between batches.

No frontend files or existing Git history need to change. No GitHub push or merge is part of this setup.
