// One-off local helper: ensure the first admin exists in Supabase Auth. Not part of the app.
import nextEnv from '@next/env';
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
nextEnv.loadEnvConfig(process.cwd());
const email=process.argv[2],name=process.argv[3]||'Admin';
if(!email)throw Error('usage: node scripts/local-ensure-auth-user.mjs <email> [name]');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
const headers={apikey:key,Authorization:`Bearer ${key}`,'content-type':'application/json'};
const list=await (await fetch(`${url}/auth/v1/admin/users?per_page=100`,{headers})).json();
let user=(list.users??[]).find(u=>u.email?.toLowerCase()===email.toLowerCase());
if(user){
 console.log(`exists: ${user.id} confirmed=${Boolean(user.email_confirmed_at)}`);
 if(!user.email_confirmed_at){
  const r=await fetch(`${url}/auth/v1/admin/users/${user.id}`,{method:'PUT',headers,body:JSON.stringify({email_confirm:true})});
  if(!r.ok)throw Error('confirm failed: '+await r.text());
  console.log('email confirmed');
 }
}else{
 const password=randomBytes(18).toString('base64url');
 const r=await fetch(`${url}/auth/v1/admin/users`,{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:name}})});
 user=await r.json();
 if(!r.ok)throw Error('create failed: '+JSON.stringify(user));
 writeFileSync('.admin-initial-password.txt',`${email}\n${password}\n`,{mode:0o600});
 console.log(`created: ${user.id}; temporary password written to .admin-initial-password.txt`);
}
writeFileSync('/tmp/admin-id',user.id);
