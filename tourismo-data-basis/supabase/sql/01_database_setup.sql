-- =====================================================================
--  TOURISMO · DATA BASIS PLATFORM
--  Step 1 — Database setup (tables, permissions, logic)
--  Version 1.0 · 2026-11-04
--
--  HOW TO RUN: Supabase → SQL Editor → New query → paste this whole
--  file → Run. Expected result: "Success. No rows returned".
--  Run it ONCE on a new, empty project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helper: "today" in Georgia (Supabase servers run in UTC)
-- ---------------------------------------------------------------------
create or replace function public.today_ge()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Tbilisi')::date;
$$;

-- =====================================================================
-- 1. TABLES
-- =====================================================================

-- 1.1 Team members (one row per login; created automatically on sign-up)
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text not null,
  full_name          text not null default '',
  short_name         text,                                   -- name as used in the old Excel, e.g. 'Gvantsa'
  role               text not null default 'member'
                     check (role in ('member', 'manager', 'admin')),
  can_open_no_prices boolean not null default false,          -- may open "!!!!!" (no prices) closures
  is_active          boolean not null default true,           -- false = ex-employee (cannot log in, no new tasks)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 1.2 Distribution systems (Jumbo, Dida, ...)
create table public.systems (
  id            serial primary key,
  code          text not null unique,                         -- short code, e.g. 'JUMBO'
  name          text not null,
  sort_order    int  not null default 0,
  update_method text not null default 'manual'
                check (update_method in ('manual', 'robot', 'api')),
  extranet_url  text,
  is_enabled    boolean not null default true,
  notes         text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id)
);

-- 1.3 Hotels
create table public.hotels (
  id             serial primary key,
  code           text unique,                                 -- e.g. 'H028' (from the master data file)
  name           text not null,
  city           text,
  country        text not null default 'GE',
  no_prices_lock boolean not null default false,              -- whole hotel closed: no prices ("!!!!!")
  is_active      boolean not null default true,               -- false = no longer worked with
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id)
);
create unique index hotels_name_uq on public.hotels (lower(name));

-- 1.4 Room types per hotel ("whole hotel" = no room type)
create table public.room_types (
  id         serial primary key,
  hotel_id   int  not null references public.hotels(id) on delete cascade,
  name       text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create unique index room_types_name_uq on public.room_types (hotel_id, lower(name));

-- 1.5 Hotel status in each system + responsible person
--   active     = sold in this system; changes must be applied there
--   inactive   = hotel is in this system but closed now
--   not_active = hotel is not in our account in this system at all
--   na         = not applicable (old Excel "N/A")
create table public.hotel_systems (
  hotel_id           int  not null references public.hotels(id) on delete cascade,
  system_id          int  not null references public.systems(id) on delete cascade,
  status             text not null default 'na'
                     check (status in ('active', 'inactive', 'not_active', 'na')),
  responsible_id     uuid references public.profiles(id),
  b2b_only           boolean not null default false,
  partner_hotel_code text,                                    -- hotel ID in that system (needed for robots later)
  notes              text,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id),
  primary key (hotel_id, system_id)
);

-- 1.6 Room codes in each system (needed for robots in Phase 2)
create table public.room_mappings (
  room_type_id       int  not null references public.room_types(id) on delete cascade,
  system_id          int  not null references public.systems(id) on delete cascade,
  partner_room_code  text not null,
  partner_rate_codes text[],
  verified_by        uuid references public.profiles(id),
  verified_at        timestamptz,
  primary key (room_type_id, system_id)
);

-- 1.7 Rules and notes (the old Excel cell comments)
create table public.hotel_rules (
  id         serial primary key,
  hotel_id   int  not null references public.hotels(id) on delete cascade,
  system_id  int  references public.systems(id) on delete cascade,  -- null = all systems
  rule_type  text not null default 'note'
             check (rule_type in ('b2b_only', 'close_threshold', 'price_leak_risk', 'active_only_in', 'note')),
  text       text not null,
  severity   text not null default 'warning' check (severity in ('info', 'warning')),
  is_active  boolean not null default true,
  source     text,                                                  -- e.g. 'Excel comment B241'
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

-- 1.8 Actions: one row each time someone submits the "New change" form
create table public.actions (
  id          bigserial primary key,
  operation   text not null check (operation in ('close', 'open')),
  reason      text not null default 'stop_sale' check (reason in ('stop_sale', 'no_prices')),
  comment     text,
  source_ref  text,                                   -- optional: "Email from hotel, 26.10, reservations@..."
  request     jsonb not null,                         -- what was selected in the form
  status      text not null default 'active' check (status in ('active', 'cancelled')),
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- 1.9 Tasks: one per system × hotel × room × continuous date range
create table public.tasks (
  id              bigserial primary key,
  action_id       bigint not null references public.actions(id) on delete cascade,
  hotel_id        int    not null references public.hotels(id) on delete cascade,
  room_type_id    int    references public.room_types(id) on delete cascade,   -- null = whole hotel
  system_id       int    not null references public.systems(id),
  operation       text   not null check (operation in ('close', 'open')),
  reason          text   not null default 'stop_sale' check (reason in ('stop_sale', 'no_prices')),
  date_from       date   not null,
  date_to         date   not null,
  mode            text   not null default 'manual' check (mode in ('manual', 'robot', 'api')),
  status          text   not null default 'pending'
                  check (status in ('pending', 'in_progress', 'done', 'failed', 'superseded', 'cancelled')),
  assigned_to     uuid   references public.profiles(id),     -- responsible person (owner)
  taken_by        uuid   references public.profiles(id),     -- who is working on it now ("I'll take this")
  done_by         uuid   references public.profiles(id),
  done_at         timestamptz,
  note            text,
  attempts        int    not null default 0,                 -- robots (Phase 2)
  last_error      text,                                      -- robots (Phase 2)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (date_to >= date_from)
);
create index tasks_status_idx   on public.tasks (status, system_id);
create index tasks_assigned_idx on public.tasks (assigned_to, status);
create index tasks_taken_idx    on public.tasks (taken_by, status);
create index tasks_hotel_idx    on public.tasks (hotel_id, date_from);

-- 1.10 Task history (who created / took / released / finished / reassigned)
create table public.task_events (
  id       bigserial primary key,
  task_id  bigint not null references public.tasks(id) on delete cascade,
  event    text   not null check (event in ('created', 'taken', 'released', 'done', 'reassigned', 'cancelled', 'superseded', 'failed')),
  by_user  uuid   references public.profiles(id),
  at       timestamptz not null default now(),
  detail   jsonb
);
create index task_events_task_idx on public.task_events (task_id);

-- 1.11 Current state: one row per CLOSED date per hotel/room/system.
--      A row exists = closed in that system. No row = open.
--      Updated when a task is marked done (= the extranet was really updated).
create table public.closures (
  id            bigserial primary key,
  hotel_id      int  not null references public.hotels(id) on delete cascade,
  room_type_id  int  references public.room_types(id) on delete cascade,   -- null = whole hotel
  system_id     int  not null references public.systems(id) on delete cascade,
  stay_date     date not null,
  reason        text not null default 'stop_sale' check (reason in ('stop_sale', 'no_prices')),
  task_id       bigint references public.tasks(id) on delete set null,     -- null = imported from Excel
  updated_at    timestamptz not null default now()
);
create unique index closures_uq on public.closures (hotel_id, coalesce(room_type_id, 0), system_id, stay_date);
create index closures_date_idx on public.closures (stay_date);

-- =====================================================================
-- 2. AUTOMATIC FIELDS
-- =====================================================================

-- updated_at / updated_by on every change
create or replace function public.tg_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'updated_by' then
    new := jsonb_populate_record(new, jsonb_build_object('updated_by', auth.uid()));
  end if;
  return new;
end $$;

create trigger touch_profiles      before update on public.profiles      for each row execute function public.tg_touch();
create trigger touch_systems       before update on public.systems       for each row execute function public.tg_touch();
create trigger touch_hotels        before update on public.hotels        for each row execute function public.tg_touch();
create trigger touch_room_types    before update on public.room_types    for each row execute function public.tg_touch();
create trigger touch_hotel_systems before update on public.hotel_systems for each row execute function public.tg_touch();
create trigger touch_tasks         before update on public.tasks         for each row execute function public.tg_touch();

-- New login → profile row. The very first user becomes Admin.
create or replace function public.tg_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, can_open_no_prices)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.profiles where role = 'admin') then 'member' else 'admin' end,
    not exists (select 1 from public.profiles where role = 'admin')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_new_user();

-- =====================================================================
-- 3. PERMISSION HELPERS
-- =====================================================================
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.is_member()        -- any active team member
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;

create or replace function public.is_manager()       -- manager or admin
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('manager', 'admin'), false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

create or replace function public.can_open_no_prices()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and is_active
                   and (can_open_no_prices or role in ('manager', 'admin')));
$$;

-- =====================================================================
-- 4. ROW LEVEL SECURITY
--    Reading: every active team member.
--    Changing hotels / rooms / matrix / rules: managers and admins.
--    Changing systems and users: admins.
--    Actions, tasks, closures: ONLY through the functions in section 5.
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.systems       enable row level security;
alter table public.hotels        enable row level security;
alter table public.room_types    enable row level security;
alter table public.hotel_systems enable row level security;
alter table public.room_mappings enable row level security;
alter table public.hotel_rules   enable row level security;
alter table public.actions       enable row level security;
alter table public.tasks         enable row level security;
alter table public.task_events   enable row level security;
alter table public.closures      enable row level security;

-- read access
create policy read_all on public.profiles      for select to authenticated using (public.is_member() or id = auth.uid());
create policy read_all on public.systems       for select to authenticated using (public.is_member());
create policy read_all on public.hotels        for select to authenticated using (public.is_member());
create policy read_all on public.room_types    for select to authenticated using (public.is_member());
create policy read_all on public.hotel_systems for select to authenticated using (public.is_member());
create policy read_all on public.room_mappings for select to authenticated using (public.is_member());
create policy read_all on public.hotel_rules   for select to authenticated using (public.is_member());
create policy read_all on public.actions       for select to authenticated using (public.is_member());
create policy read_all on public.tasks         for select to authenticated using (public.is_member());
create policy read_all on public.task_events   for select to authenticated using (public.is_member());
create policy read_all on public.closures      for select to authenticated using (public.is_member());

-- managers/admins edit the catalog
create policy mgr_insert on public.hotels        for insert to authenticated with check (public.is_manager());
create policy mgr_update on public.hotels        for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy mgr_delete on public.hotels        for delete to authenticated using (public.is_admin());
create policy mgr_insert on public.room_types    for insert to authenticated with check (public.is_manager());
create policy mgr_update on public.room_types    for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy mgr_delete on public.room_types    for delete to authenticated using (public.is_manager());
create policy mgr_insert on public.hotel_systems for insert to authenticated with check (public.is_manager());
create policy mgr_update on public.hotel_systems for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy mgr_delete on public.hotel_systems for delete to authenticated using (public.is_manager());
create policy mgr_insert on public.room_mappings for insert to authenticated with check (public.is_manager());
create policy mgr_update on public.room_mappings for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy mgr_delete on public.room_mappings for delete to authenticated using (public.is_manager());
create policy mgr_insert on public.hotel_rules   for insert to authenticated with check (public.is_manager());
create policy mgr_update on public.hotel_rules   for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy mgr_delete on public.hotel_rules   for delete to authenticated using (public.is_manager());

-- admins edit systems and team members
create policy adm_insert on public.systems  for insert to authenticated with check (public.is_admin());
create policy adm_update on public.systems  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adm_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- table privileges ("Automatically expose new tables" is OFF, so grant explicitly)
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.hotels, public.room_types, public.hotel_systems,
                                public.room_mappings, public.hotel_rules to authenticated;
grant insert, update on public.systems to authenticated;
grant update on public.profiles to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- the server-side key (used later by the import and the robots) gets full access
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- =====================================================================
-- 5. LOGIC (the website calls these functions)
-- =====================================================================

-- 5.1 Log a task event
create or replace function public._log(p_task bigint, p_event text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.task_events (task_id, event, by_user, detail) values (p_task, p_event, auth.uid(), p_detail);
$$;

-- 5.2 Submit a change (Close / Open). With p_dry_run = true nothing is saved:
--     the result is the preview ("this will create N tasks" + warnings).
--
--   p_operation   'close' | 'open'
--   p_reason      'stop_sale' | 'no_prices'
--   p_system_ids  systems selected in the form
--   p_hotel_ids   hotels selected in the form
--   p_room_ids    room types selected (empty/null = whole hotel for every selected hotel;
--                 a hotel with none of its rooms selected = whole hotel)
--   p_dates       the selected stay dates
create or replace function public.submit_action(
  p_operation  text,
  p_reason     text,
  p_system_ids int[],
  p_hotel_ids  int[],
  p_room_ids   int[],
  p_dates      date[],
  p_comment    text default null,
  p_source_ref text default null,
  p_dry_run    boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_action    bigint;
  v_dates     date[];
  v_warn      jsonb := '[]'::jsonb;
  v_skip      jsonb := '[]'::jsonb;
  v_tasks     jsonb := '[]'::jsonb;
  v_n         int := 0;
  h           record;
  s           record;
  rm          record;
  rg          record;
  v_rooms     int[];
  v_room      int;
  v_mode      text;
  v_assignee  uuid;
  v_task      bigint;
  v_dup       boolean;
  v_super     bigint;
begin
  -- who is calling
  if not public.is_member() then
    raise exception 'Not allowed: your account is not an active team member.';
  end if;
  if p_operation not in ('close', 'open') then raise exception 'Operation must be close or open.'; end if;
  if p_reason not in ('stop_sale', 'no_prices') then raise exception 'Unknown reason.'; end if;
  if coalesce(array_length(p_system_ids, 1), 0) = 0 then raise exception 'Choose at least one system.'; end if;
  if coalesce(array_length(p_hotel_ids, 1), 0) = 0 then raise exception 'Choose at least one hotel.'; end if;
  if coalesce(array_length(p_dates, 1), 0) = 0 then raise exception 'Choose at least one date.'; end if;

  -- dates: unique, sorted, not in the past
  select array_agg(distinct d order by d) into v_dates from unnest(p_dates) d;
  if v_dates[1] < public.today_ge() then
    raise exception 'Dates in the past cannot be changed (first selected date: %).', to_char(v_dates[1], 'DD.MM.YYYY');
  end if;

  -- rooms must belong to the selected hotels
  if exists (select 1 from unnest(coalesce(p_room_ids, '{}')) r
             where not exists (select 1 from room_types rt where rt.id = r and rt.hotel_id = any(p_hotel_ids))) then
    raise exception 'A selected room type does not belong to the selected hotels.';
  end if;

  if not p_dry_run then
    insert into actions (operation, reason, comment, source_ref, request, created_by)
    values (p_operation, p_reason, p_comment, p_source_ref,
            jsonb_build_object('systems', p_system_ids, 'hotels', p_hotel_ids, 'rooms', coalesce(p_room_ids, '{}'),
                               'dates', to_jsonb(v_dates)),
            v_user)
    returning id into v_action;
  end if;

  for h in select * from hotels where id = any(p_hotel_ids) order by name loop

    -- opening a "no prices" hotel / dates needs the special permission
    if p_operation = 'open' and not public.can_open_no_prices() then
      if h.no_prices_lock then
        raise exception '"%" is locked: no prices (!!!!!). Only people with the "open no-prices" permission can open it.', h.name;
      end if;
      if exists (select 1 from closures c where c.hotel_id = h.id and c.reason = 'no_prices'
                   and c.system_id = any(p_system_ids) and c.stay_date = any(v_dates)) then
        raise exception 'Some selected dates of "%" are closed because of no prices (!!!!!). Only people with the "open no-prices" permission can open them.', h.name;
      end if;
    end if;
    if p_operation = 'open' and h.no_prices_lock then
      v_warn := v_warn || jsonb_build_object('hotel', h.name, 'message', 'Hotel has the "no prices" lock. Remove the lock in the hotel settings if prices have arrived.');
    end if;

    -- rules / notes to show as warnings
    v_warn := v_warn || coalesce((
      select jsonb_agg(jsonb_build_object('hotel', h.name, 'system', sy.name, 'message', r.text, 'type', r.rule_type))
      from hotel_rules r left join systems sy on sy.id = r.system_id
      where r.hotel_id = h.id and r.is_active and (r.system_id is null or r.system_id = any(p_system_ids))), '[]'::jsonb);

    -- rooms for this hotel (none selected = whole hotel)
    select array_agg(rt.id order by rt.sort_order, rt.name) into v_rooms
    from room_types rt where rt.hotel_id = h.id and rt.id = any(coalesce(p_room_ids, '{}'));
    if v_rooms is null then v_rooms := array[null::int]; end if;

    for s in select sy.*, hs.status, hs.responsible_id, hs.b2b_only
             from systems sy left join hotel_systems hs on hs.system_id = sy.id and hs.hotel_id = h.id
             where sy.id = any(p_system_ids) order by sy.sort_order loop

      if not s.is_enabled then
        v_skip := v_skip || jsonb_build_object('hotel', h.name, 'system', s.name, 'why', 'System is switched off');
        continue;
      end if;
      if coalesce(s.status, 'na') <> 'active' then
        v_skip := v_skip || jsonb_build_object('hotel', h.name, 'system', s.name,
                  'why', case coalesce(s.status, 'na')
                           when 'inactive'   then 'Hotel is inactive (closed) in this system'
                           when 'not_active' then 'Hotel is not in this system'
                           else 'Not applicable (N/A)' end);
        continue;
      end if;
      if s.b2b_only then
        v_warn := v_warn || jsonb_build_object('hotel', h.name, 'system', s.name, 'message', 'B2B only in this system');
      end if;

      v_mode := case when s.update_method = 'manual' then 'manual' else s.update_method end;
      select id into v_assignee from profiles where id = s.responsible_id and is_active;
      if v_assignee is null then
        v_warn := v_warn || jsonb_build_object('hotel', h.name, 'system', s.name,
                  'message', 'No active responsible person — the task will be unassigned (anyone can take it).');
      end if;

      foreach v_room in array v_rooms loop
        -- continuous date ranges
        for rg in
          select min(d) as dfrom, max(d) as dto
          from (select d, d - (row_number() over (order by d))::int as grp from unnest(v_dates) d) x
          group by grp order by 1
        loop
          -- identical open task already exists → do not duplicate
          select exists (select 1 from tasks t
                         where t.hotel_id = h.id and t.room_type_id is not distinct from v_room and t.system_id = s.id
                           and t.operation = p_operation and t.status in ('pending', 'in_progress')
                           and t.date_from = rg.dfrom and t.date_to = rg.dto) into v_dup;
          if v_dup then
            v_skip := v_skip || jsonb_build_object('hotel', h.name, 'system', s.name,
                      'why', format('Same task already open (%s – %s)', to_char(rg.dfrom, 'DD.MM'), to_char(rg.dto, 'DD.MM')));
            continue;
          end if;

          v_n := v_n + 1;
          v_tasks := v_tasks || jsonb_build_object(
            'hotel', h.name,
            'room', coalesce((select name from room_types where id = v_room), 'Whole hotel'),
            'system', s.name, 'date_from', rg.dfrom, 'date_to', rg.dto,
            'assigned_to', (select coalesce(nullif(full_name, ''), email) from profiles where id = v_assignee));

          if not p_dry_run then
            -- opposite open tasks fully inside the new dates are replaced by the new one
            for v_super in
              select t.id from tasks t
              where t.hotel_id = h.id and t.room_type_id is not distinct from v_room and t.system_id = s.id
                and t.operation <> p_operation and t.status in ('pending', 'in_progress')
                and t.date_from >= rg.dfrom and t.date_to <= rg.dto
            loop
              update tasks set status = 'superseded', taken_by = null where id = v_super;
              perform public._log(v_super, 'superseded', jsonb_build_object('by_action', v_action));
            end loop;

            insert into tasks (action_id, hotel_id, room_type_id, system_id, operation, reason,
                               date_from, date_to, mode, assigned_to)
            values (v_action, h.id, v_room, s.id, p_operation, p_reason, rg.dfrom, rg.dto, v_mode, v_assignee)
            returning id into v_task;
            perform public._log(v_task, 'created', null);
          end if;

          -- opposite open tasks that only partly overlap: warn, do not touch
          if exists (select 1 from tasks t
                     where t.hotel_id = h.id and t.room_type_id is not distinct from v_room and t.system_id = s.id
                       and t.operation <> p_operation and t.status in ('pending', 'in_progress')
                       and t.date_from <= rg.dto and t.date_to >= rg.dfrom
                       and not (t.date_from >= rg.dfrom and t.date_to <= rg.dto)) then
            v_warn := v_warn || jsonb_build_object('hotel', h.name, 'system', s.name,
                      'message', 'There is an open opposite task for overlapping dates — please check the task list.');
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  if not p_dry_run and v_n = 0 then
    raise exception 'Nothing to do: no tasks would be created (see skipped systems in the preview).';
  end if;

  return jsonb_build_object(
    'action_id', v_action,
    'dry_run', p_dry_run,
    'tasks_count', v_n,
    'tasks', v_tasks,
    'skipped', v_skip,
    'warnings', v_warn);
end $$;

-- 5.3 "I'll take this" — take one or more open tasks
create or replace function public.take_tasks(p_task_ids bigint[])
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; t record;
begin
  if not public.is_member() then raise exception 'Not allowed.'; end if;
  for t in select * from tasks where id = any(p_task_ids) for update loop
    if t.status = 'pending' or (t.status = 'in_progress' and (t.taken_by = auth.uid() or public.is_manager())) then
      update tasks set status = 'in_progress', taken_by = auth.uid() where id = t.id;
      perform public._log(t.id, 'taken', jsonb_build_object('from', t.taken_by));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;   -- number of tasks actually taken (others were already taken or finished)
end $$;

-- 5.4 Give a task back (back to the open list)
create or replace function public.release_tasks(p_task_ids bigint[])
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; t record;
begin
  if not public.is_member() then raise exception 'Not allowed.'; end if;
  for t in select * from tasks where id = any(p_task_ids) and status = 'in_progress' for update loop
    if t.taken_by = auth.uid() or public.is_manager() then
      update tasks set status = 'pending', taken_by = null where id = t.id;
      perform public._log(t.id, 'released', null);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- 5.5 Mark tasks as Done (anyone can finish anyone's task) → updates the current state
create or replace function public.complete_tasks(p_task_ids bigint[], p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; t record;
begin
  if not public.is_member() then raise exception 'Not allowed.'; end if;
  for t in select * from tasks where id = any(p_task_ids) and status in ('pending', 'in_progress', 'failed') for update loop

    if t.operation = 'open' and not public.can_open_no_prices() and exists (
         select 1 from closures c
         where c.hotel_id = t.hotel_id
           and (t.room_type_id is null or c.room_type_id is not distinct from t.room_type_id)
           and c.system_id = t.system_id and c.reason = 'no_prices'
           and c.stay_date between t.date_from and t.date_to) then
      raise exception 'Task #% opens dates closed for no prices (!!!!!). Only people with the "open no-prices" permission can finish it.', t.id;
    end if;

    if t.operation = 'close' then
      insert into closures (hotel_id, room_type_id, system_id, stay_date, reason, task_id)
      select t.hotel_id, t.room_type_id, t.system_id, d::date, t.reason, t.id
      from generate_series(t.date_from, t.date_to, interval '1 day') d
      on conflict (hotel_id, coalesce(room_type_id, 0), system_id, stay_date)
      do update set reason = excluded.reason, task_id = excluded.task_id, updated_at = now();
    else
      -- opening the whole hotel also opens every room; opening a room opens only that room
      delete from closures c
      where c.hotel_id = t.hotel_id
        and (t.room_type_id is null or c.room_type_id is not distinct from t.room_type_id)
        and c.system_id = t.system_id and c.stay_date between t.date_from and t.date_to;
    end if;

    update tasks set status = 'done', done_by = auth.uid(), done_at = now(),
                     taken_by = coalesce(taken_by, auth.uid()),
                     note = coalesce(p_note, note)
    where id = t.id;
    perform public._log(t.id, 'done', jsonb_build_object('assigned_to', t.assigned_to, 'note', p_note));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 5.6 Reassign tasks to another person (managers/admins)
create or replace function public.reassign_tasks(p_task_ids bigint[], p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_ids bigint[];
begin
  if not public.is_manager() then raise exception 'Only managers can reassign tasks.'; end if;
  if p_user is not null and not exists (select 1 from profiles where id = p_user and is_active) then
    raise exception 'That person is not an active team member.';
  end if;
  with u as (
    update tasks set assigned_to = p_user,
                     taken_by = case when status = 'in_progress' then null else taken_by end,
                     status   = case when status = 'in_progress' then 'pending' else status end
    where id = any(p_task_ids) and status in ('pending', 'in_progress', 'failed')
    returning id)
  select array_agg(id) into v_ids from u;
  insert into task_events (task_id, event, by_user, detail)
  select unnest(coalesce(v_ids, '{}')), 'reassigned', auth.uid(), jsonb_build_object('to', p_user);
  return coalesce(array_length(v_ids, 1), 0);
end $$;

-- 5.7 Cancel tasks (managers/admins)
create or replace function public.cancel_tasks(p_task_ids bigint[], p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_ids bigint[];
begin
  if not public.is_manager() then raise exception 'Only managers can cancel tasks.'; end if;
  with u as (
    update tasks set status = 'cancelled', taken_by = null, note = coalesce(p_note, note)
    where id = any(p_task_ids) and status in ('pending', 'in_progress', 'failed')
    returning id)
  select array_agg(id) into v_ids from u;
  insert into task_events (task_id, event, by_user, detail)
  select unnest(coalesce(v_ids, '{}')), 'cancelled', auth.uid(), jsonb_build_object('note', p_note);
  return coalesce(array_length(v_ids, 1), 0);
end $$;

-- 5.8 When a person is made inactive (left the team): free their tasks
create or replace function public.tg_user_deactivated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_active and not new.is_active then
    update tasks set taken_by = null, status = 'pending'
     where taken_by = new.id and status = 'in_progress';
    update tasks set assigned_to = null
     where assigned_to = new.id and status in ('pending', 'in_progress', 'failed');
  end if;
  return new;
end $$;
create trigger on_user_deactivated after update of is_active on public.profiles
  for each row execute function public.tg_user_deactivated();

-- 5.9 Admins may not remove their own admin rights by accident
create or replace function public.tg_protect_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from profiles where role = 'admin' and is_active and id <> old.id) then
    raise exception 'There must always be at least one active admin.';
  end if;
  return new;
end $$;
create trigger protect_last_admin before update on public.profiles
  for each row execute function public.tg_protect_last_admin();

-- function privileges: logged-in users only
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.today_ge(), public.my_role(), public.is_member(), public.is_manager(), public.is_admin(),
  public.can_open_no_prices(),
  public.submit_action(text, text, int[], int[], int[], date[], text, text, boolean),
  public.take_tasks(bigint[]), public.release_tasks(bigint[]),
  public.complete_tasks(bigint[], text), public.reassign_tasks(bigint[], uuid),
  public.cancel_tasks(bigint[], text)
to authenticated;
grant execute on all functions in schema public to service_role;

-- =====================================================================
-- 6. VIEWS for the website (they respect the security rules above)
-- =====================================================================
create view public.v_tasks with (security_invoker = true) as
select t.*,
       h.name  as hotel_name, h.city,
       coalesce(rt.name, 'Whole hotel') as room_name,
       sy.name as system_name, sy.sort_order as system_sort,
       pa.full_name as assigned_name, pa.short_name as assigned_short,
       pt.full_name as taken_name,
       pd.full_name as done_name,
       a.comment as action_comment, a.source_ref, a.created_by as action_by, a.created_at as action_at,
       pc.full_name as action_by_name
from public.tasks t
join public.hotels h       on h.id = t.hotel_id
left join public.room_types rt on rt.id = t.room_type_id
join public.systems sy     on sy.id = t.system_id
join public.actions a      on a.id = t.action_id
left join public.profiles pa on pa.id = t.assigned_to
left join public.profiles pt on pt.id = t.taken_by
left join public.profiles pd on pd.id = t.done_by
left join public.profiles pc on pc.id = a.created_by;

create view public.v_matrix with (security_invoker = true) as
select h.id as hotel_id, h.code as hotel_code, h.name as hotel_name, h.city, h.no_prices_lock, h.is_active as hotel_active,
       sy.id as system_id, sy.name as system_name, sy.sort_order,
       coalesce(hs.status, 'na') as status, hs.responsible_id, p.full_name as responsible_name,
       p.is_active as responsible_active, hs.b2b_only
from public.hotels h
cross join public.systems sy
left join public.hotel_systems hs on hs.hotel_id = h.id and hs.system_id = sy.id
left join public.profiles p on p.id = hs.responsible_id;

grant select on public.v_tasks, public.v_matrix to authenticated, service_role;

-- =====================================================================
-- 7. STARTING DATA: the 16 systems from the old Excel
-- =====================================================================
insert into public.systems (code, name, sort_order) values
  ('TRIP',        'Trip',           1),
  ('GOGLOBAL',    'GoGlobal',       2),
  ('OSTROVOK',    'Ostrovok',       3),
  ('SMYROOMS',    'Smyrooms',       4),
  ('JUMBO',       'Jumbo',          5),
  ('DIDA',        'Dida Travel',    6),
  ('UTS',         'UTS',            7),
  ('HOTELBEDS',   'HotelBeds',      8),
  ('ACADEM',      'Academservices', 9),
  ('TRAVELLANDA', 'Travellanda',   10),
  ('RESTEL',      'Restel',        11),
  ('TBO',         'TBO',           12),
  ('EETGLOBAL',   'EETGlobal',     13),
  ('DNATA',       'Dnata',         14),
  ('DOTW',        'DOTW',          15),
  ('HEYTRIP',     'HeyTrip',       16);

-- Done. Check: select count(*) from public.systems;  → 16
