const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const test=require('node:test');
const ts=require('typescript');
const source=readFileSync('supabase/functions/invite-user/index.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function harness({role='admin',validUser=true,prepareError=null,sendError=null,finishError=null,configured=true}={}){
  let handler,clients=0;const calls=[];
  const caller={auth:{getUser:async token=>{calls.push(['getUser',token]);return{data:{user:validUser?{id:'admin-id'}:null},error:validUser?null:Error('bad token')}}},rpc:async(name,args)=>{calls.push([name,args]);return name==='office_role'?{data:role,error:null}:{data:'invite-id',error:prepareError}}};
  const privileged={
    auth:{admin:{inviteUserByEmail:async(email,args)=>{
      calls.push(['send',email,args]);return{data:{user:sendError?null:{id:'invited-id'}},error:sendError};
    }}},
    rpc:async(name,args)=>{calls.push([name,args]);return{error:finishError};},
    from:name=>({update:value=>({eq:(key,value2)=>({eq:async(key2,value3)=>{
      calls.push(['update',name,value,key,value2,key2,value3]);return{error:null};
    }})})})
  };
  vm.runInNewContext(js,{exports:{},require:()=>({createClient:(_url,key,options)=>{clients++;calls.push(['client',key,options]);return key==='service-test-key'?privileged:caller}}),Deno:{env:{get:key=>configured?({SITE_URL:'https://office.example',SUPABASE_URL:'https://project.example',SUPABASE_ANON_KEY:'publishable-test-key',SUPABASE_SERVICE_ROLE_KEY:'service-test-key'})[key]:undefined},serve:fn=>{handler=fn}},Request,Response,URL});
  return{run:async({method='POST',origin='https://office.example',authorization='Bearer test-user-token',body={email:'Staff@Example.test',name:'Staff Person',role:'staff'}}={})=>{
    const headers={};if(origin)headers.Origin=origin;if(authorization)headers.Authorization=authorization;if(method==='POST')headers['Content-Type']='application/json';
    const response=await handler(new Request('https://project.example/functions/v1/invite-user',{method,headers,...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
    return{status:response.status,text:await response.text(),headers:response.headers};
  },calls,clients:()=>clients};
}
test('missing, forged, non-admin, or disabled identities never reach a privileged client',async()=>{
  for(const options of [{role:'staff'},{role:'viewer'},{role:null},{validUser:false}]){
    const h=harness(options),r=await h.run({body:{email:'victim@example.test',name:'Victim',role:'admin',user_id:'forged',invited_by:'forged'}});
    assert.ok([401,403].includes(r.status));assert.equal(h.clients(),1);assert.ok(!h.calls.some(c=>c[0]==='send'));
  }
  const h=harness();assert.equal((await h.run({authorization:null})).status,401);assert.equal(h.clients(),0);
});
test('origin, method, configuration, and payload are checked',async()=>{
  const h=harness();assert.equal((await h.run({origin:'https://attacker.example'})).status,403);assert.equal(h.clients(),0);
  assert.equal((await h.run({method:'GET'})).status,405);assert.equal((await h.run({method:'OPTIONS',authorization:null})).status,204);
  assert.equal((await harness({configured:false}).run()).status,503);
  assert.equal((await h.run({body:{email:'x',name:'X',role:'owner'}})).status,400);
  assert.equal((await h.run({body:'broken json'})).status,400);
});
test('membership revoked during the request is denied by the DB operation',async()=>{
  const h=harness({prepareError:{message:'Access denied'}});assert.equal((await h.run()).status,400);assert.equal(h.clients(),1);assert.ok(!h.calls.some(c=>c[0]==='send'));
});
test('only a validated admin sends a server-owned redirect and binds the returned Auth user',async()=>{
  const h=harness();const r=await h.run({body:{email:'Staff@Example.test',name:'Staff Person',role:'viewer',redirectTo:'https://attacker.example',user_id:'forged'}});
  assert.equal(r.status,200);assert.equal(h.clients(),2);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c[0]==='prepare_invitation'))),['prepare_invitation',{p_email:'Staff@Example.test',p_name:'Staff Person',p_role:'viewer'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c[0]==='send'))),['send','staff@example.test',{redirectTo:'https://office.example/auth/accept-invite/'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c[0]==='finish_invitation'))),['finish_invitation',{p_invitation:'invite-id',p_user:'invited-id'}]);
  assert.ok(!r.text.includes('service-test-key'));assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('failed delivery or finalization never produces success and disables the pending record',async()=>{
  for(const options of [{sendError:{message:'SMTP failure'}},{finishError:{message:'binding failure'}}]){
    const h=harness(options),r=await h.run();assert.equal(r.status,502);assert.ok(h.calls.some(c=>c[0]==='update'&&c[2].status==='failed'));
  }
});
