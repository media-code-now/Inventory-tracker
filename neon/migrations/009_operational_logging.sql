-- Ported from supabase/migrations/009_operational_logging.sql. Neon uses server-side transactions, not PostgREST or replication.
begin;
-- Diagnostics deliberately exclude messages, URLs, payloads, email addresses and tokens.
create table public.application_errors(
 id uuid primary key,actor_id uuid not null references public.members(id),
 code text not null check(code in ('snapshot_failed','operation_failed','import_failed','count_failed','image_failed','ui_crash','auth_failed','realtime_failed','logout_failed')),
 area text not null check(area in ('auth','dashboard','inventory','item-details','stock-movements','stock-counts','storage-locations','reports','imports','team-settings','app')),
 created_at timestamptz not null default now()
);
create index application_error_actor_time on public.application_errors(actor_id,created_at);
alter table public.application_errors enable row level security;
create policy diagnostics_admin_read on public.application_errors for select to authenticated using(public.office_role()='admin');
revoke all on public.application_errors from public,anon,authenticated;
grant select on public.application_errors to authenticated;
create function public.record_application_error(p_id uuid,p_code text,p_area text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_office_role(array['admin','staff','viewer']);
 perform pg_advisory_xact_lock(hashtextextended('diagnostics:'||auth.uid()::text,0));
 if (select count(*) from public.application_errors where actor_id=auth.uid() and created_at>now()-interval '1 minute')>=10 then return;end if;
 insert into public.application_errors(id,actor_id,code,area) values(p_id,auth.uid(),p_code,p_area) on conflict(id) do nothing;
end $$;
revoke all on function public.record_application_error(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_application_error(uuid,text,text) to authenticated;
commit;
