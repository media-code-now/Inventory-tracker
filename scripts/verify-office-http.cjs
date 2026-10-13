// Local HTTP integration against the actual built Next server and a disposable session backend.
const {spawn}=require('node:child_process');const http=require('node:http');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');
(async()=>{
 const sessions=new Map();let attempts=0;let log='';
 const backend=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const args=JSON.parse(text||'{}');let value;switch(req.url.split('/').at(-1)){
 case 'office_session_valid':value=sessions.get(args.p_hash)===args.p_generation;break;
 case 'office_session_create':sessions.set(args.p_hash,args.p_generation);value=null;break;
 case 'office_session_delete':sessions.delete(args.p_hash);value=null;break;
 case 'office_login_attempt':value=++attempts<=20;break;
 default:value={protected:true};}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));});
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
 const port=3119;const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],{env:{...process.env,OFFICE_PASSWORD:'local-integration-fixture-password',OFFICE_SESSION_SECRET:randomBytes(32).toString('hex'),OFFICE_APP_ORIGIN:`https://localhost:${port}`,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${backend.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'}});
 app.stdout.on('data',d=>log+=d);app.stderr.on('data',d=>log+=d);
 const request=(path,options={})=>fetch(`http://localhost:${port}${path}`,{...options,redirect:'manual',headers:{'x-forwarded-proto':'https',...options.headers}});
 try{
  let ready=false;for(let i=0;i<100;i++){try{await request('/robots.txt');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(ready,'Server did not start');
  for(const path of ['/','/inventory/','/reports/','/item-details/','/login/','/private.csv','/inventory/?_rsc=test'])assert.equal((await request(path)).status,307,path);
  for(const path of ['/api/backend/rest/v1/items/','/api/backend/storage/v1/object/authenticated/item-images/private.jpg','/api/office/events/'])assert.equal((await request(path)).status,401,path);
  const screen=await request('/office-unlock/');assert.equal(screen.status,200);const html=await screen.text();assert.ok(html.includes('Enter your office password'));assert.ok(!html.includes('Total inventory value'));assert.equal(screen.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
  const post=password=>request('/api/office/login/',{method:'POST',headers:{origin:`https://localhost:${port}`,'Content-Type':'application/json'},body:JSON.stringify({password})});
  assert.equal((await post('wrong')).status,401);
  const signedIn=await post('local-integration-fixture-password');assert.equal(signedIn.status,200);const cookie=signedIn.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/inventory/',{headers:{cookie}})).status,200);
  assert.equal((await request('/api/backend/rest/v1/items/',{headers:{cookie,authorization:'Bearer fixture-user'}})).status,200);
  assert.equal((await request('/api/office/logout/',{method:'POST',headers:{cookie,origin:`https://localhost:${port}`}})).status,200);
  assert.equal((await request('/api/backend/rest/v1/items/',{headers:{cookie}})).status,401);
  attempts=20;assert.equal((await post('wrong')).status,429);
  console.log('PASS: built Next HTTP direct URL/RSC/API/download/stream denial, clean password screen, login, protected proxy, logout replay, and rate limit');
 }catch(error){console.error(log);throw error;}finally{app.kill('SIGTERM');backend.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
