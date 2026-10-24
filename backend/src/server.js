import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

// Resolve relative to this file, so startup also works from the repository root.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const portValue = process.env.PORT ?? '3001';
const port = Number(portValue);
if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

if (!process.env.SUPABASE_URL?.trim() || !process.env.SUPABASE_SECRET_KEY?.trim()) {
  console.warn('Supabase is not configured. Health is available; issue endpoints return 503 until backend/.env is configured and the server is restarted.');
}

const server = createApp().listen(port, '127.0.0.1', () => {
  console.log(`CivicPulse API listening at http://127.0.0.1:${port}`);
});

server.on('error', (error) => {
  console.error(`Server could not listen (${error.code ?? 'unknown error'}). Check PORT and whether another process is using it.`);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => { process.exitCode = 0; });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
