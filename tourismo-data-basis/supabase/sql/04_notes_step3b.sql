-- =====================================================================
--  TOURISMO · DATA BASIS PLATFORM
--  Step 3b — notes for several systems at once + quick notes list
--  Version 1.0 · 2026-11-09
-- =====================================================================

-- A rule / note can now apply to several systems (empty = all systems)
alter table public.hotel_rules add column if not exists system_ids int[];
update public.hotel_rules set system_ids = array[system_id]
 where system_id is not null and system_ids is null;

-- Quick notes: one-click notes for every hotel page (managed by managers/admins)
create table if not exists public.quick_notes (
  id         serial primary key,
  text       text not null,
  rule_type  text not null default 'note'
             check (rule_type in ('b2b_only', 'close_threshold', 'price_leak_risk', 'active_only_in', 'note')),
  sort_order int  not null default 0,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.quick_notes enable row level security;
create policy read_all   on public.quick_notes for select to authenticated using (public.is_member());
create policy mgr_insert on public.quick_notes for insert to authenticated with check (public.is_manager());
create policy mgr_update on public.quick_notes for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy mgr_delete on public.quick_notes for delete to authenticated using (public.is_manager());
grant select, insert, update, delete on public.quick_notes to authenticated;
grant usage, select on sequence public.quick_notes_id_seq to authenticated;
grant all on public.quick_notes to service_role;
grant usage, select on sequence public.quick_notes_id_seq to service_role;

-- Starting list (the most common notes from the old Excel) — managers can change it in the platform
insert into public.quick_notes (text, rule_type, sort_order) values
  ('არ გვაქვს ფასი ამ პერიოდზე', 'note', 1),
  ('ფასი ჟონავს', 'price_leak_risk', 2),
  ('არ ვაღებთ', 'note', 3),
  ('კეთდება მხოლოდ პრიორიტეტულ სისტემებში', 'note', 4),
  ('სისტემამ წაშალა სასტუმრო', 'note', 5),
  ('ჯავშნები არაა', 'note', 6);

-- Done. Check: select * from public.quick_notes;  → 6 rows
