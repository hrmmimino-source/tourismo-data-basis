import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Calls the "admin-users" server function and returns its JSON, or throws a readable error.
export async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let message = error.message;
    try {
      const details = await error.context.json();
      if (details?.error) message = details.error;
    } catch { /* keep default message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Turns database errors into plain sentences.
export function niceError(err) {
  const msg = err?.message || String(err);
  if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/Failed to send a request|Failed to fetch|NetworkError/i.test(msg)) return 'No connection to the server. Check your internet and try again.';
  if (/row-level security|permission denied/i.test(msg)) return 'You do not have permission to do this.';
  return msg;
}
