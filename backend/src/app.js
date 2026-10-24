import express from 'express';
import cors from 'cors';
import { createIssuesRouter } from './routes/issues.js';
import { createIssuesService, DatabaseError } from './services/issuesService.js';

function parseOrigins(value) {
  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error('CORS_ORIGIN must contain an explicit local origin.');
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.origin !== origin) {
      throw new Error('CORS_ORIGIN must contain only explicit localhost origins without paths.');
    }
  }
  return new Set(origins);
}

export function createApp({
  issuesService = createIssuesService(),
  corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173',
} = {}) {
  const app = express();
  const allowedOrigins = parseOrigins(corsOrigin);
  app.disable('x-powered-by');

  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      const error = new Error('This origin is not allowed.');
      error.code = 'CORS_FORBIDDEN';
      callback(error);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/issues', createIssuesRouter(issuesService));
  app.use((_req, res) => res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
  }));

  app.use((error, _req, res, _next) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected server error occurred.';
    if (error instanceof DatabaseError) {
      status = 503;
      code = 'DATABASE_UNAVAILABLE';
      message = error.message;
    } else if (error.code === 'CORS_FORBIDDEN') {
      status = 403;
      code = 'CORS_FORBIDDEN';
      message = error.message;
    } else if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body must be valid JSON.';
    } else if (error.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body exceeds the 16 KB limit.';
    } else if (error.status === 415) {
      status = 415;
      code = 'UNSUPPORTED_MEDIA_TYPE';
      message = 'Use UTF-8 JSON with Content-Type: application/json.';
    }
    res.status(status).json({ error: { code, message } });
  });
  return app;
}
