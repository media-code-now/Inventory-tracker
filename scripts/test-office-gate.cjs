const test=require('node:test');const assert=require('node:assert/strict');const ts=require('typescript');const fs=require('node:fs');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {NextRequest}=require('next/server');const db=require('../lib/neon-db.ts');const sessions=new Map();let attempts=0,lastIdentity;
db.database=()=>({query:async(text,values=[])=>{
 let result=null;if(text.includes('public.office_session_valid'))result=sessions.get(values[0])===values[1];
 else if(text.includes('public.office_session_create'))sessions.set(values[0],values[1]);
 else if(text.includes('public.office_session_delete'))sessions.delete(values[0]);
 else if(text.includes('public.office_login_attempt'))result=++attempts<=20;
 else if(text.includes('public.inventory_snapshot'))result={items:[]};
 return [{result}];},transaction:queries=>Promise.all(queries)});
db.staffQuery=async(identity,token,generation,text)=>{assert.equal(identity.id,'00000000-0000-0000-0000-000000000001');assert.ok(sessions.has(require('node:crypto').createHash('sha256').update(token).digest('hex')));return [{result:{items:[]}}];};
const security=require('../lib/office-server.ts');const {middleware}=require('../middleware.ts');const login=require('../app/api/office/login/route.ts');const logout=require('../app/api/office/logout/route.ts');const backend=require('../app/api/backend/[...path]/route.ts');
process.env.DATABASE_URL='postgresql://fixture-only';process.env.OFFICE_PASSWORD='test-office-password-only';process.env.OFFICE_SESSION_SECRET='test-secret-with-at-least-thirty-two-characters';process.env.OFFICE_APP_ORIGIN='https://office.example';process.env.NEXT_PUBLIC_SUPABASE_URL='https://identity.example';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-anon-key';
global.fetch=async(input,init)=>{assert.equal(new URL(input).pathname,'/auth/v1/user');lastIdentity=init.headers;return Response.json({id:'00000000-0000-0000-0000-000000000001',email:'fixture@example.test'});};
const req=(path,options={})=>new NextRequest('https://office.example'+path,options);
const post=(path,password)=>req(path,{method:'POST',headers:{origin:'https://office.example','content-type':'application/json'},body:JSON.stringify({password})});
const authenticated=(path,token)=>req(path,{headers:{cookie:`${security.cookieName}=${token}`}});
test('direct pages, APIs, files and update streams require office authorization',async()=>{
 for(const path of ['/','/inventory/','/reports/','/login/','/item-details/','/secret.csv','/_next/data/build/inventory.json'])assert.equal((await middleware(req(path))).status,307);
 for(const path of ['/api/backend/rest/v1/items','/api/backend/storage/v1/object/item-images/file','/api/office/events/'])assert.equal((await middleware(req(path))).status,401);
 assert.equal((await backend.GET(req('/api/backend/rest/v1/items'),{params:Promise.resolve({path:['rest','v1','items']})})).status,401);
});
test('password checks, secure cookies, validated staff identity, rotation and logout',async()=>{
 assert.equal((await login.POST(post('/api/office/login/','wrong'))).status,401);
 assert.equal((await login.POST(req('/api/office/login/',{method:'POST',body:'{}'}))).status,403);
 const response=await login.POST(post('/api/office/login/',process.env.OFFICE_PASSWORD));assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=strict','Path=/','Max-Age=28800'])assert.ok(cookie.includes(flag));
 const token=cookie.split(';')[0].split('=')[1];assert.equal((await middleware(authenticated('/inventory/',token))).status,200);
 const proxyRequest=req('/api/backend/rest/v1/rpc/inventory_snapshot',{method:'POST',headers:{origin:'https://office.example',cookie:`${security.cookieName}=${token}`,authorization:'Bearer staff-jwt','content-type':'application/json'},body:'{}'});
 assert.equal((await backend.POST(proxyRequest,{params:Promise.resolve({path:['rest','v1','rpc','inventory_snapshot']})})).status,200);
 assert.equal(lastIdentity.Authorization,'Bearer staff-jwt');assert.equal(lastIdentity.apikey,'test-anon-key');assert.equal(lastIdentity.cookie,undefined);
 process.env.OFFICE_PASSWORD+='changed';assert.equal((await middleware(authenticated('/inventory/',token))).status,307);process.env.OFFICE_PASSWORD=process.env.OFFICE_PASSWORD.replace('changed','');
 assert.equal((await logout.POST(req('/api/office/logout/',{method:'POST',headers:{origin:'https://office.example',cookie:`${security.cookieName}=${token}`}}))).status,200);assert.equal((await middleware(authenticated('/inventory/',token))).status,307);
});
test('shared guessing limit and database outages fail closed',async()=>{
 attempts=20;assert.equal((await login.POST(post('/api/office/login/',process.env.OFFICE_PASSWORD))).status,429);
 const original=db.database;db.database=()=>({query:async()=>{throw Error('Offline')}});assert.equal((await middleware(authenticated('/inventory/','a'.repeat(64)))).status,503);db.database=original;
});
test('missing Neon environment is reported without exposing secrets; SQL names are allowlisted',async()=>{
 const url=process.env.DATABASE_URL;delete process.env.DATABASE_URL;
 const response=await login.POST(post('/api/office/login/','wrong'));assert.equal(response.status,503);assert.ok((await response.json()).error.includes('DATABASE_URL'));process.env.DATABASE_URL=url;
 assert.throws(()=>db.rpcStatement('office_session_create',{}));assert.throws(()=>db.rpcStatement('create_item',{'p_id);drop table members;--':'x'}));
});
test('data requests reuse the verified identity briefly and rely on the database office gate',async()=>{
 attempts=0;const token=(await login.POST(post('/api/office/login/',process.env.OFFICE_PASSWORD))).headers.get('set-cookie').split(';')[0].split('=')[1];
 const jwt=exp=>'h.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.s';
 const original={fetch:global.fetch,query:db.database},seen={fetches:0,sessionChecks:0};
 global.fetch=async(input,init)=>{seen.fetches++;return original.fetch(input,init);};
 db.database=()=>{const sql=original.query();return {...sql,query:async(text,values)=>{if(text.includes('office_session_valid'))seen.sessionChecks++;return sql.query(text,values);}};};
 const call=bearer=>backend.POST(req('/api/backend/rest/v1/rpc/inventory_snapshot',{method:'POST',headers:{origin:'https://office.example',cookie:`${security.cookieName}=${token}`,authorization:'Bearer '+bearer,'content-type':'application/json'},body:'{}'}),{params:Promise.resolve({path:['rest','v1','rpc','inventory_snapshot']})});
 const live=jwt(Math.floor(Date.now()/1000)+3600);
 for(let n=0;n<3;n++)assert.equal((await call(live)).status,200);
 assert.equal(seen.fetches,1);assert.equal(seen.sessionChecks,0);
 const expired=jwt(Math.floor(Date.now()/1000)-10);await call(expired);await call(expired);assert.equal(seen.fetches,3);
 const staffQuery=db.staffQuery;db.staffQuery=async()=>{throw Object.assign(Error('Office authorization required'),{code:'42501'});};
 const rejected=await call(live);assert.equal(rejected.status,401);assert.equal((await rejected.json()).error,'Office authorization required');
 db.staffQuery=staffQuery;global.fetch=original.fetch;db.database=original.query;
});
test('update stream stays open and signals every tick before the revision migration is applied',async()=>{
 attempts=0;const token=(await login.POST(post('/api/office/login/',process.env.OFFICE_PASSWORD))).headers.get('set-cookie').split(';')[0].split('=')[1];
 const events=require('../app/api/office/events/route.ts');const original=db.database;
 db.database=()=>{const sql=original();return {...sql,query:async(text,values)=>{if(text.includes('office_inventory_revision'))throw Object.assign(Error('function does not exist'),{code:'42883'});return sql.query(text,values);}};};
 const error=console.error;console.error=()=>{};
 try{
  assert.equal((await events.GET(authenticated('/api/office/events/','b'.repeat(64)))).status,401);
  const controller=new AbortController();const response=await events.GET(new NextRequest('https://office.example/api/office/events/',{headers:{cookie:`${security.cookieName}=${token}`},signal:controller.signal}));
  assert.equal(response.status,200);controller.abort();
 }finally{db.database=original;console.error=error;}
});
