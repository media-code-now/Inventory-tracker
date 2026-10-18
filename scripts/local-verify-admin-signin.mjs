// One-off local check: real staff sign-in through the running app. Not part of the app.
import nextEnv from '@next/env';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
nextEnv.loadEnvConfig(process.cwd());
const [email,password]=readFileSync('.admin-initial-password.txt','utf8').trim().split('\n');
const port=3112,origin='https://office.example';
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],{env:{...process.env,OFFICE_APP_ORIGIN:origin},stdio:'ignore'});
const req=(path,o={})=>fetch(`http://localhost:${port}${path}`,{...o,redirect:'manual',headers:{'x-forwarded-proto':'https',origin,...o.headers}});
try{
 for(let i=0;i<40;i++){try{await fetch(`http://localhost:${port}/robots.txt`);break;}catch{await new Promise(r=>setTimeout(r,500));}}
 const office=await req('/api/office/login/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:process.env.OFFICE_PASSWORD})});
 assert.equal(office.status,200,'office login');const cookie=office.headers.get('set-cookie').split(';')[0];
 const token=await req('/api/backend/auth/v1/token/?grant_type=password',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({email,password})});
 const session=await token.json();assert.equal(token.status,200,'staff sign-in: '+JSON.stringify(session));
 const auth={cookie,authorization:`Bearer ${session.access_token}`,'content-type':'application/json'};
 const me=await req('/api/backend/auth/v1/user/',{headers:auth});assert.equal(me.status,200);assert.equal((await me.json()).email,email);
 const role=await req('/api/backend/rest/v1/rpc/office_role/',{method:'POST',headers:auth,body:'{}'});const roleBody=await role.text();assert.equal(role.status,200,'office_role: '+roleBody);
 const snap=await req('/api/backend/rest/v1/rpc/inventory_snapshot/',{method:'POST',headers:auth,body:'{}'});assert.equal(snap.status,200,'inventory_snapshot');
 console.log(`PASS: ${email} signed in via Supabase through the app; office_role=${roleBody}; inventory_snapshot readable (${(await snap.text()).length} bytes).`);
}finally{app.kill();}
