// Safe production smoke check: creates/revokes one office session; creates no accounts or inventory.
const {spawn}=require('node:child_process');const {randomBytes}=require('node:crypto');const assert=require('node:assert/strict');
require('@next/env').loadEnvConfig(process.cwd());const {neon}=require('@neondatabase/serverless');
(async()=>{const port=3119,origin=`https://localhost:${port}`,password=randomBytes(24).toString('hex');let log='';
 const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],{env:{...process.env,OFFICE_APP_ORIGIN:origin,OFFICE_PASSWORD:password,OFFICE_SESSION_SECRET:randomBytes(32).toString('hex')}});app.stdout.on('data',d=>log+=d);app.stderr.on('data',d=>log+=d);
 const request=(path,options={})=>fetch(`http://localhost:${port}${path}`,{...options,redirect:'manual',headers:{'x-forwarded-proto':'https',...options.headers}});
 try{let ready=false;for(let i=0;i<100;i++){try{await request('/robots.txt');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
 assert.equal((await request('/office-unlock/')).status,200);
 assert.equal((await request('/inventory/')).status,307);
 const response=await request('/api/office/login/',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(response.status,200,await response.clone().text());const cookie=response.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/inventory/',{headers:{cookie}})).status,200);
 assert.equal((await request('/api/backend/rest/v1/rpc/inventory_snapshot/',{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:'{}'})).status,401,'Office password must not bypass staff login');
 assert.equal((await request('/api/office/logout/',{method:'POST',headers:{origin,cookie}})).status,200);
 assert.equal((await request('/inventory/',{headers:{cookie}})).status,307);
 const sql=neon(process.env.DATABASE_URL);console.log('Production database:',JSON.stringify(await sql`select (select count(*) from public.items) as items,(select count(*) from public.members) as staff,(select count(*) from public.app_schema_migrations) as migrations`));
 console.log('PASS: started Next server uses production Neon for office login/session checks/logout; staff login remains required.');
 }catch(error){console.error(log);throw error;}finally{app.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
