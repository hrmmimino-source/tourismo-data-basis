// Tourismo Data Basis — server function "admin-users"
// Lets the platform admin create team accounts, reset passwords and (de)activate people.
// Runs on Supabase. Only signed-in, active ADMINS can use it (checked below).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// 12 random characters without look-alikes (0/O, 1/l/I) + a digit and a symbol
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('') + '7!';
}

const ROLES = ['member', 'manager', 'admin'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1. Who is calling? Must be a signed-in, active admin.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Please sign in again.' }, 401);
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', who.user.id).maybeSingle();
    if (!me || !me.is_active || me.role !== 'admin') return json({ error: 'Only admins can manage team accounts.' }, 403);

    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      // ---------------------------------------------------------- create account
      case 'create': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const fullName = String(body.full_name ?? '').trim();
        const role = ROLES.includes(body.role) ? body.role : 'member';
        if (!email.includes('@')) return json({ error: 'Please enter a valid email.' }, 400);
        if (!fullName) return json({ error: 'Please enter the full name.' }, 400);

        const password = tempPassword();
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName, must_change_password: true },
        });
        if (error) {
          const exists = /already|registered|exists/i.test(error.message);
          return json({ error: exists ? 'An account with this email already exists.' : error.message }, 400);
        }

        const { error: pErr } = await admin.from('profiles').update({
          full_name: fullName,
          short_name: body.short_name ? String(body.short_name).trim() : null,
          role,
          can_open_no_prices: !!body.can_open_no_prices,
        }).eq('id', data.user.id);
        if (pErr) return json({ error: 'Account created, but saving the details failed: ' + pErr.message }, 500);

        return json({ ok: true, user_id: data.user.id, temp_password: password });
      }

      // ---------------------------------------------------------- reset password
      case 'reset_password': {
        const userId = String(body.user_id ?? '');
        const { data: target } = await admin.auth.admin.getUserById(userId);
        if (!target?.user) return json({ error: 'Person not found.' }, 404);
        const password = tempPassword();
        const { error } = await admin.auth.admin.updateUserById(userId, {
          password,
          user_metadata: { ...(target.user.user_metadata ?? {}), must_change_password: true },
        });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, temp_password: password });
      }

      // ---------------------------------------------------------- activate / deactivate
      case 'set_active': {
        const userId = String(body.user_id ?? '');
        const active = !!body.active;
        if (userId === who.user.id && !active) return json({ error: 'You cannot deactivate your own account.' }, 400);

        // profile first: the database refuses if this would remove the last admin
        const { error: pErr } = await admin.from('profiles').update({ is_active: active }).eq('id', userId);
        if (pErr) return json({ error: pErr.message }, 400);

        // block / unblock sign-in
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: 'Unknown action.' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
