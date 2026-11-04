-- =====================================================================
--  TOURISMO · DATA BASIS PLATFORM
--  Step 2b — Temporary passwords visible to managers/admins
--  Version 1.0 · 2026-11-04
--
--  A temporary password is kept here only until the person sets their
--  own password; then it is deleted automatically. Only managers and
--  admins can read this table. Nobody can write to it from the website.
-- =====================================================================

create table public.temp_passwords (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  password   text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

alter table public.temp_passwords enable row level security;
create policy mgr_read on public.temp_passwords for select to authenticated using (public.is_manager());

revoke all on public.temp_passwords from anon, authenticated;
grant select on public.temp_passwords to authenticated;
grant all on public.temp_passwords to service_role;

-- When a password changes (the person chose their own, or an admin reset it),
-- the stored temporary password is removed. A reset stores the new one right after.
create or replace function public.tg_password_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    delete from public.temp_passwords where user_id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_password_changed
  after update of encrypted_password on auth.users
  for each row execute function public.tg_password_changed();

-- Done. Check: select count(*) from public.temp_passwords;  → 0
