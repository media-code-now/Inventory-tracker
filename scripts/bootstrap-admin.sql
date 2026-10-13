\set ON_ERROR_STOP on
-- Run via a trusted owner connection: psql "$DATABASE_URL" -v admin_user_id=UUID -v admin_name='Name' -f scripts/bootstrap-admin.sql
-- Create and verify the account in Supabase Auth first. There is no HTTP bootstrap endpoint.
begin;
select set_config('stockroom.bootstrap_user_id', :'admin_user_id', true);
select set_config('stockroom.bootstrap_name', :'admin_name', true);
lock table public.members in exclusive mode;
do $$
declare first_id uuid := current_setting('stockroom.bootstrap_user_id')::uuid;
  first_name text := trim(current_setting('stockroom.bootstrap_name'));
begin
  if exists(select 1 from public.members where role='admin' and active) then
    raise exception 'An active admin already exists; use admin-managed access';
  end if;
  if first_name='' then raise exception 'Admin name required'; end if;
  if not exists(select 1 from auth.users where id=first_id and email_confirmed_at is not null) then
    raise exception 'Create and verify the intended admin Auth account first';
  end if;
  insert into public.members(id,name,role,active) values(first_id,first_name,'admin',true);
end $$;
commit;
