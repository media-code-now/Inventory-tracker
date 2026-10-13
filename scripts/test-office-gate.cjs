const test=require('node:test');const assert=require('node:assert/strict');const ts=require('typescript');const fs=require('node:fs');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {NextRequest}=require('next/server');const security=require('../lib/office-server.ts');const {middleware}=require('../middleware.ts');const login=require('../app/api/office/login/route.ts');const logout=require('../app/api/office/logout/route.ts');const backend=require('../app/api/backend/[...path]/route.ts');
process.env.OFFICE_PASSWORD='test-office-password-only';process.env.OFFICE_SESSION_SECRET='test-secret-with-at-least-thirty-two-characters';process.env.OFFICE_APP_ORIGIN='https://office.example';process.env.NEXT_PUBLIC_SUPABASE_URL='https://backend.example';process.env.SUPABASE_SERVICE_ROLE_KEY='test-server-key';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-anon-key';
const sessions=new Map();let attempts=0,upstreamCalls=0,lastHeaders;
global.fetch=async(input,init)=>{const url=new URL(input);if(url.hostname!=='backend.example')throw Error('Unexpected upstream');if(init.headers.apikey==='test-server-key'){const args=JSON.parse(init.body);const name=url.pathname.split('/').at(-1);let value;
 if(name==='office_session_valid')value=sessions.get(args.p_hash)===args.p_generation;
 else if(name==='office_session_create'){sessions.set(args.p_hash,args.p_generation);value=null;}
 else if(name==='office_session_delete'){sessions.delete(args.p_hash);value=null;}
 else if(name==='office_login_attempt')value=++attempts<=20;
 else throw Error('Unexpected RPC');return Response.json(value);
 }upstreamCalls++;lastHeaders=init.headers;return Response.json({items:['protected']});};
const req=(path,options={})=>new NextRequest('https://office.example'+path,options);
const post=(path,password)=>req(path,{method:'POST',headers:{origin:'https://office.example','content-type':'application/json'},body:JSON.stringify({password})});
const authenticated=(path,token)=>req(path,{headers:{cookie:`${security.cookieName}=${token}`}});
test('unauthenticated direct pages, APIs, downloads, and update connections are denied',async()=>{
 for(const path of ['/','/inventory/','/reports/','/login/','/item-details/','/secret.csv','/_next/data/build/inventory.json']){const r=await middleware(req(path));assert.equal(r.status,307);assert.ok(r.headers.get('location').includes('/office-unlock/'));assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');}
 for(const path of ['/api/backend/rest/v1/items','/api/backend/storage/v1/object/item-images/file','/api/office/events/','/api/unknown'])assert.equal((await middleware(req(path))).status,401);
 assert.equal((await backend.GET(req('/api/backend/rest/v1/items'),{params:Promise.resolve({path:['rest','v1','items']})})).status,401);assert.equal(upstreamCalls,0);
});
test('password checks, cookie flags, origin checks, proxy identity, rotation and logout',async()=>{
 assert.equal((await login.POST(post('/api/office/login/','wrong'))).status,401);
 assert.equal((await login.POST(req('/api/office/login/',{method:'POST',body:'{}'}))).status,403);
 const response=await login.POST(post('/api/office/login/',process.env.OFFICE_PASSWORD));assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=strict','Path=/','Max-Age=28800'])assert.ok(cookie.includes(flag));
 const token=cookie.split(';')[0].split('=')[1];assert.notEqual(token,process.env.OFFICE_PASSWORD);
 assert.equal((await middleware(authenticated('/inventory/',token))).status,200);
 const proxyRequest=req('/api/backend/rest/v1/items',{headers:{cookie:`${security.cookieName}=${token}`,authorization:'Bearer staff-jwt','x-office-session':'forged'}});
 assert.equal((await backend.GET(proxyRequest,{params:Promise.resolve({path:['rest','v1','items']})})).status,200);
 assert.equal(lastHeaders.get('authorization'),'Bearer staff-jwt');assert.equal(lastHeaders.get('x-office-session'),token);assert.equal(lastHeaders.get('apikey'),'test-anon-key');assert.equal(lastHeaders.get('cookie'),null);
 process.env.OFFICE_PASSWORD+='changed';assert.equal((await middleware(authenticated('/inventory/',token))).status,307);process.env.OFFICE_PASSWORD=process.env.OFFICE_PASSWORD.replace('changed','');
 const ended=await logout.POST(req('/api/office/logout/',{method:'POST',headers:{origin:'https://office.example',cookie:`${security.cookieName}=${token}`}}));assert.equal(ended.status,200);assert.equal((await middleware(authenticated('/inventory/',token))).status,307);
});
test('global rate limit survives client changes and fails closed on database outage',async()=>{
 attempts=20;assert.equal((await login.POST(post('/api/office/login/',process.env.OFFICE_PASSWORD))).status,429);
 const original=global.fetch;global.fetch=async()=>{throw Error('Offline')};assert.equal((await middleware(authenticated('/inventory/','a'.repeat(64)))).status,503);global.fetch=original;
});
