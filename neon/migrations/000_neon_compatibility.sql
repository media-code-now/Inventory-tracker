begin;
-- Supabase Auth remains the identity provider. Only verified identity metadata is mirrored.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin;end if;
end $$;
grant authenticated,service_role to current_user;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,invited_at timestamptz);
revoke all on schema auth from public;
revoke all on auth.users from public,anon,authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create schema storage;
revoke all on schema storage from public;
create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,content_type text,bytes bytea check(octet_length(bytes)<=5242880),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select,insert,delete on storage.objects to authenticated;
commit;
