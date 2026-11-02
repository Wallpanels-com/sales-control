import { createClient } from '@supabase/supabase-js';
import { env } from './config.js';
import { observeSupabaseHttpStatus } from './services/databaseCircuit.js';

const monitoredFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  observeSupabaseHttpStatus(response.status);
  return response;
};

export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: monitoredFetch }
});

export async function must<T>(promise: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data == null) throw new Error('Supabase returned no data');
  return data;
}
