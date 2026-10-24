import { createClient } from '@supabase/supabase-js';

let client;

// Lazy initialization keeps health checks and mocked tests credential-free.
// Only this server-side module reads the secret key.
export function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    throw new Error('Configure SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env.');
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
