-- =====================================================================
--  TOURISMO · DATA BASIS PLATFORM
--  Step 3 — Hotels, room types, responsibility matrix, rules
--  Version 1.0 · 2026-11-04
-- =====================================================================

-- Name of the responsible person as written in the old Excel (e.g. 'Gvantsa').
-- When a team account with the same "Name in old Excel" exists, it is linked automatically.
alter table public.hotel_systems add column if not exists responsible_excel_name text;
alter table public.hotel_rules   add column if not exists source_date date;

create or replace function public.link_excel_names(p_profile uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update hotel_systems hs
     set responsible_id = p.id
    from profiles p
   where hs.responsible_id is null
     and hs.responsible_excel_name is not null
     and p.short_name is not null
     and lower(trim(p.short_name)) = lower(trim(hs.responsible_excel_name))
     and (p_profile is null or p.id = p_profile);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.tg_profile_link_names()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.short_name is not null and (tg_op = 'INSERT' or new.short_name is distinct from old.short_name) then
    perform public.link_excel_names(new.id);
  end if;
  return new;
end $$;
drop trigger if exists on_profile_short_name on public.profiles;
create trigger on_profile_short_name after insert or update of short_name on public.profiles
  for each row execute function public.tg_profile_link_names();

-- Matrix view now also shows the Excel name
drop view if exists public.v_matrix;
create view public.v_matrix with (security_invoker = true) as
select h.id as hotel_id, h.code as hotel_code, h.name as hotel_name, h.city, h.no_prices_lock, h.is_active as hotel_active,
       sy.id as system_id, sy.code as system_code, sy.name as system_name, sy.sort_order,
       coalesce(hs.status, 'na') as status, hs.responsible_id, hs.responsible_excel_name,
       p.full_name as responsible_name, p.short_name as responsible_short, p.is_active as responsible_active,
       hs.b2b_only, hs.partner_hotel_code
from public.hotels h
cross join public.systems sy
left join public.hotel_systems hs on hs.hotel_id = h.id and hs.system_id = sy.id
left join public.profiles p on p.id = hs.responsible_id;
grant select on public.v_matrix to authenticated, service_role;

grant execute on function public.link_excel_names(uuid) to service_role;

-- Done.
