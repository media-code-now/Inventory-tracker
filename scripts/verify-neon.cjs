// Integration fixtures live only on the explicitly selected disposable Neon branch.
// Supabase identity is simulated locally; all inventory, roles, files, and sessions use real Neon.
const {spawn}=require('node:child_process');const http=require('node:http');const assert=require('node:assert/strict');const {randomBytes,randomUUID}=require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());const {neon}=require('@neondatabase/serverless');
(async()=>{
 assert.equal(process.env.NEON_BRANCH,'inventory-neon-migration','Run only on the disposable inventory-neon-migration branch');
 const sql=neon(process.env.DATABASE_URL);const ids={admin:randomUUID(),staff:randomUUID(),viewer:randomUUID()};
 for(const [role,id] of Object.entries(ids)){await sql.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,role+'@fixture.example.test']);await sql.query('insert into public.members(id,name,role,active) values($1,$2,$3,true)',[id,'Neon integration '+role,role]);}
 const identity=http.createServer((req,res)=>{const token=req.headers.authorization?.replace('Bearer ','');const id=ids[token];res.setHeader('Content-Type','application/json');if(!id){res.statusCode=401;res.end('{}');return;}res.end(JSON.stringify({id,email:token+'@fixture.example.test',email_confirmed_at:new Date().toISOString()}));});
 await new Promise(resolve=>identity.listen(0,'127.0.0.1',resolve));
 const port=3119,password=randomBytes(24).toString('hex'),secret=randomBytes(32).toString('hex'),origin=`https://localhost:${port}`;let log='';
 const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],{env:{...process.env,OFFICE_PASSWORD:password,OFFICE_SESSION_SECRET:secret,OFFICE_APP_ORIGIN:origin,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${identity.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_local_integration_only'}});
 app.stdout.on('data',d=>log+=d);app.stderr.on('data',d=>log+=d);
 const request=(path,options={})=>fetch(`http://localhost:${port}${path}`,{...options,redirect:'manual',headers:{'x-forwarded-proto':'https',...options.headers}});
 let cookie;
 const rpc=(role,name,args={})=>request('/api/backend/rest/v1/rpc/'+name+'/',{method:'POST',headers:{origin,cookie,authorization:'Bearer '+role,'Content-Type':'application/json'},body:JSON.stringify(args)});
 try{
  let ready=false;for(let i=0;i<100;i++){try{await request('/robots.txt');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,'Server did not start');
  assert.equal((await request('/office-unlock/')).status,200);
  for(const path of ['/','/inventory/','/reports/','/inventory/?_rsc=test'])assert.equal((await request(path)).status,307);
  for(const path of ['/api/backend/rest/v1/rpc/inventory_snapshot/','/api/backend/storage/v1/object/item-images/private.png','/api/office/events/'])assert.equal((await request(path)).status,401);
  const signedIn=await request('/api/office/login/',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(signedIn.status,200,await signedIn.clone().text());cookie=signedIn.headers.get('set-cookie').split(';')[0];for(const flag of ['HttpOnly','Secure','SameSite=strict'])assert.ok(signedIn.headers.get('set-cookie').includes(flag));
  assert.equal((await rpc('forged','inventory_snapshot')).status,401);
  const before=await rpc('admin','inventory_snapshot');assert.equal(before.status,200,await before.clone().text());assert.equal((await before.json()).items.length,0);
  const locationResponse=await request('/api/backend/rest/v1/locations/',{method:'POST',headers:{origin,cookie,authorization:'Bearer admin','Content-Type':'application/json'},body:JSON.stringify({name:'Neon test location',description:'Disposable integration fixture'})});assert.equal(locationResponse.status,201,await locationResponse.clone().text());
  const snapshot=await (await rpc('admin','inventory_snapshot')).json(),location=snapshot.locations.find(l=>l.name==='Neon test location').id,item=randomUUID();
  const args={p_id:item,p_name:'Neon test paper',p_sku:'NEON-'+item,p_category:'Office supplies',p_unit:'units',p_minimum:2,p_cost:4.5,p_location:location,p_description:'Disposable fixture'};
  assert.equal((await rpc('viewer','create_item',args)).status,403);
  const created=await rpc('admin','create_item',args);assert.equal(created.status,200,await created.clone().text());
  const movement={p_request:randomUUID(),p_item:item,p_kind:'add',p_amount:7,p_from:null,p_to:location,p_reason:'Neon integration receipt',p_notes:null,p_recipient:null,p_reverses:null};
  const received=await rpc('staff','post_movement',movement);assert.equal(received.status,200,await received.clone().text());
  const confirmed=await (await rpc('staff','inventory_snapshot')).json();assert.equal(confirmed.balances.find(b=>b.item_id===item).quantity,7);assert.equal(confirmed.movements.find(m=>m.item_id===item).actor_id,ids.staff);assert.equal(confirmed.items.find(i=>i.id===item).cost,null);
  const filePath=`items/${item}/${randomUUID()}.png`,image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9kAAAAASUVORK5CYII=','base64');
  const upload=await request('/api/backend/storage/v1/object/item-images/'+filePath,{method:'POST',headers:{origin,cookie,authorization:'Bearer admin','Content-Type':'image/png'},body:image});assert.equal(upload.status,200,await upload.clone().text());
  const adminSnapshot=await (await rpc('admin','inventory_snapshot')).json(),row=adminSnapshot.items.find(i=>i.id===item);
  const bound=await rpc('admin','update_item',{p_item:item,p_name:row.name,p_sku:row.sku,p_barcode:null,p_category:row.category,p_unit:row.unit,p_minimum:row.minimum,p_cost:row.cost,p_location:location,p_description:row.description,p_supplier:null,p_image_path:filePath,p_expected_updated_at:row.updated_at});assert.equal(bound.status,200,await bound.clone().text());
  const download=await request('/api/backend/storage/v1/object/authenticated/item-images/'+filePath,{headers:{cookie,authorization:'Bearer viewer'}});assert.equal(download.status,200,await download.clone().text());assert.deepEqual(Buffer.from(await download.arrayBuffer()),image);
  const events=await request('/api/office/events/',{headers:{cookie}});assert.equal(events.status,200);const reader=events.body.getReader();await reader.read();
  assert.equal((await request('/api/office/logout/',{method:'POST',headers:{origin,cookie}})).status,200);
  assert.equal((await rpc('admin','inventory_snapshot')).status,401);
  const ended=await Promise.race([reader.read().then(r=>r.done),new Promise(r=>setTimeout(()=>r(false),12000))]);assert.equal(ended,true,'SSE must end after revocation');
  console.log('PASS: real Neon HTTP office login, cookie flags, direct URL/API/file denial, staff identity verification, inventory create/read/stock receipt, actor attribution, viewer permissions, cost isolation, image upload/download, SSE revocation, and logout replay');
 }catch(error){console.error(log);throw error;}finally{app.kill('SIGTERM');identity.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
