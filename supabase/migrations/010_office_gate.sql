begin;
create schema if not exists office_security;
revoke all on schema office_security from public,anon,authenticated;
create table office_security.sessions (
 token_hash text primary key, generation text not null, expires_at timestamptz not null
);
create table office_security.login_budget (id boolean primary key default true check(id),window_start timestamptz not null,attempts integer not null);
revoke all on all tables in schema office_security from public,anon,authenticated;

create function public.office_session_valid(p_hash text,p_generation text) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from office_security.sessions where token_hash=p_hash and generation=p_generation and expires_at>now())
$$;
create function public.office_session_create(p_hash text,p_generation text,p_seconds integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_seconds<60 or p_seconds>604800 then raise exception 'Invalid expiration';end if;
 delete from office_security.sessions where expires_at<=now();
 insert into office_security.sessions values(p_hash,p_generation,now()+make_interval(secs=>p_seconds));
end $$;
create function public.office_session_delete(p_hash text) returns void
language sql security definer set search_path='' as $$ delete from office_security.sessions where token_hash=p_hash $$;
create function public.office_login_attempt() returns boolean
language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
 -- Global budget prevents distributed guessing and does not trust client IP headers.
 insert into office_security.login_budget values(true,now(),1)
 on conflict(id) do update set
 attempts=case when office_security.login_budget.window_start<=now()-interval '15 minutes' then 1 else office_security.login_budget.attempts+1 end,
 window_start=case when office_security.login_budget.window_start<=now()-interval '15 minutes' then now() else office_security.login_budget.window_start end
 returning attempts<=20 into allowed;
 return allowed;
end $$;
revoke all on function public.office_session_valid(text,text),public.office_session_create(text,text,integer),public.office_session_delete(text),public.office_login_attempt() from public,anon,authenticated;
grant execute on function public.office_session_valid(text,text),public.office_session_create(text,text,integer),public.office_session_delete(text),public.office_login_attempt() to service_role;

create function public.office_gate_valid() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from office_security.sessions s where
 s.token_hash=encode(extensions.digest(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-office-session',''),'sha256'),'hex')
 and s.generation=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-office-generation','') and s.expires_at>now())
$$;
revoke all on function public.office_gate_valid() from public;
grant execute on function public.office_gate_valid() to anon,authenticated,service_role;

create function public.office_gate_pre_request() returns void
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claims',true)::jsonb->>'role'='service_role' then return;end if;
 if not public.office_gate_valid() then raise exception 'Office authorization required' using errcode='42501';end if;
end $$;
revoke all on function public.office_gate_pre_request() from public;
grant execute on function public.office_gate_pre_request() to anon,authenticated,service_role;
alter role authenticator set pgrst.db_pre_request='public.office_gate_pre_request';

create or replace function public.office_role() returns text language sql stable
security definer set search_path='' as $$
 select role from public.members where id=auth.uid() and active and public.office_gate_valid()
$$;
create or replace function public.require_office_role(allowed_roles text[]) returns void
language plpgsql security definer set search_path='' as $$
declare member_role text;
begin
 if not public.office_gate_valid() then raise exception 'Office authorization required' using errcode='42501';end if;
 select role into member_role from public.members where id=auth.uid() and active for share;
 if member_role is null or not(member_role=any(allowed_roles)) then raise exception 'Access denied' using errcode='42501';end if;
end $$;
-- Defense in depth for table access, including realtime and Storage API calls.
do $$ declare t record;begin
 for t in select tablename from pg_tables where schemaname='public' loop
 execute format('create policy office_gate_required on public.%I as restrictive for all to anon,authenticated using(public.office_gate_valid()) with check(public.office_gate_valid())',t.tablename);
 end loop;
end $$;
update storage.buckets set public=false where id='item-images';
create policy office_gate_required on storage.objects as restrictive for all to anon,authenticated
using(public.office_gate_valid()) with check(public.office_gate_valid());
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
