import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('actual server starts on loopback and serves health without Supabase credentials', { timeout: 10_000 }, async (t) => {
  // Ask the OS for an available port, then release it for the real entry point.
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
      CORS_ORIGIN: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  });

  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes(`http://127.0.0.1:${port}`)) resolve();
    });
    // Drain stderr without printing environment-related diagnostics.
    child.stderr.resume();
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Server exited before startup (code ${code}).`)));
  });

  const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const issues = await fetch(`http://127.0.0.1:${port}/api/issues`, { signal: AbortSignal.timeout(2000) });
  assert.equal(issues.status, 503);
  assert.equal((await issues.json()).error.code, 'DATABASE_UNAVAILABLE');
});
