import nextEnv from '@next/env';import {neon} from '@neondatabase/serverless';
nextEnv.loadEnvConfig(process.cwd());
const id=process.env.NEON_ADMIN_USER_ID,name=process.env.NEON_ADMIN_NAME;
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!id||! /^[a-f0-9-]{36}$/i.test(id)||!name?.trim()||!url||!key||!process.env.DATABASE_URL)throw Error('Set the Neon URL, staff Auth URL/service key, NEON_ADMIN_USER_ID and NEON_ADMIN_NAME in ignored environment settings.');
const identity=await fetch(`${url}/auth/v1/admin/users/${id}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
if(!identity.ok)throw Error('Cannot verify the intended administrator with the existing identity provider.');
const user=await identity.json();if(user.id!==id||!user.email_confirmed_at)throw Error('Create and verify this staff account before bootstrapping.');
const sql=neon(process.env.DATABASE_URL);
await sql.transaction([
 sql.query('lock table public.members in exclusive mode'),
 sql.query('insert into auth.users(id,email,email_confirmed_at,invited_at) values($1,$2,$3,$4) on conflict(id) do update set email=excluded.email,email_confirmed_at=excluded.email_confirmed_at',[id,user.email,user.email_confirmed_at,user.invited_at??null]),
 sql.query("select set_config('stockroom.bootstrap_user_id',$1,true),set_config('stockroom.bootstrap_name',$2,true)",[id,name.trim()]),
 sql.query(`do $$ begin
 if exists(select 1 from public.members where role='admin' and active) then raise exception 'An active admin already exists; use admin-managed access';end if;
 insert into public.members(id,name,role,active) values(current_setting('stockroom.bootstrap_user_id')::uuid,current_setting('stockroom.bootstrap_name'),'admin',true);
 end $$`),
]);
console.log('PASS: verified staff identity bootstrapped as first Neon administrator.');
