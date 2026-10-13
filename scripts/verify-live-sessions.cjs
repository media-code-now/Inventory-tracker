// Opt-in live verification. Use a disposable project; this creates an auditable test item, then archives it.
const {createClient}=require('@supabase/supabase-js');
const {loadEnvConfig}=require('@next/env');const {readFileSync}=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
loadEnvConfig(process.cwd());
const needed=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','STOCKROOM_TEST_ADMIN_EMAIL','STOCKROOM_TEST_ADMIN_PASSWORD','STOCKROOM_TEST_STAFF_EMAIL','STOCKROOM_TEST_STAFF_PASSWORD'];
if(needed.some(k=>!process.env[k])||process.env.STOCKROOM_TEST_ALLOW_WRITES!=='disposable-project'){
 console.error('Live verification not run: configure a disposable Supabase project, two provisioned test accounts, and STOCKROOM_TEST_ALLOW_WRITES=disposable-project.');process.exit(2);
}
const moduleExports={};vm.runInNewContext(ts.transpileModule(readFileSync('lib/live-inventory.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:moduleExports,setTimeout,clearTimeout,setInterval,clearInterval});
const {createLiveInventory,AccessDenied}=moduleExports;
const clients=[],controllers=[];let itemId,admin;
async function until(fn,label){const limit=Date.now()+20000;while(Date.now()<limit){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);}
async function rpc(client,name,args){const r=await client.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;}
async function login(kind){const c=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:true}});clients.push(c);const r=await c.auth.signInWithPassword({email:process.env['STOCKROOM_TEST_'+kind+'_EMAIL'],password:process.env['STOCKROOM_TEST_'+kind+'_PASSWORD']});if(r.error)throw Error('Test account sign-in failed');return c;}
function observe(client){let current=null,online=true,status;const controller=createLiveInventory({online:()=>online,fetchSnapshot:async()=>{const r=await client.rpc('inventory_snapshot');if(r.error)throw Error('Snapshot request failed');if(!r.data)throw new AccessDenied('Not an active member');return r.data;},subscribe:(change,update)=>{const channel=client.channel('verify:'+randomUUID(),{config:{postgres_changes_options:{wait:true}}});for(const table of ['items','stock_balances','movements'])channel.on('postgres_changes',{event:'*',schema:'public',table},change);channel.subscribe(update);return()=>{void client.removeChannel(channel)};},apply:s=>current=s,status:s=>status=s,failure:()=>{},pollMs:60000});controllers.push(controller);controller.start();return{controller,snapshot:()=>current,offline(){online=false;controller.offline()},rejoin(){online=true;controller.reconnect()},status:()=>status};}
(async()=>{
 admin=await login('ADMIN');const staff=await login('STAFF');assert.equal(await rpc(admin,'office_role'),'admin');assert.equal(await rpc(staff,'office_role'),'staff');
 let initial=await rpc(admin,'inventory_snapshot');let locations=initial.locations.slice(0,2);
 while(locations.length<2){const name='Realtime verification '+randomUUID();const r=await admin.from('locations').insert({name,description:'Disposable two-session test location'}).select().single();if(r.error)throw Error('Cannot create test location');locations.push(r.data);}
 const a=observe(admin),b=observe(staff);await until(()=>a.controller.canPost()&&b.controller.canPost(),'two authenticated realtime subscriptions');
 itemId=randomUUID();await rpc(admin,'create_item',{p_id:itemId,p_name:'Realtime verification '+itemId,p_sku:'LIVE-'+itemId,p_category:'Test',p_unit:'units',p_minimum:1,p_cost:0,p_location:locations[0].id,p_description:'Disposable realtime verification fixture'});
 const post=(client,kind,amount,from,to)=>rpc(client,'post_movement',{p_request:randomUUID(),p_item:itemId,p_kind:kind,p_amount:amount,p_from:from,p_to:to,p_reason:'Two-session realtime verification'});
 const qty=o=>o.snapshot()?.items.find(i=>i.id===itemId)?.quantity;
 const converge=async expected=>{await until(()=>qty(a)===expected&&qty(b)===expected,'confirmed table/detail/dashboard quantity '+expected);for(const o of [a,b]){const snap=o.snapshot();assert.equal(snap.balances.filter(r=>r.item_id===itemId).reduce((n,r)=>n+r.quantity,0),expected);assert.ok(snap.confirmed_at);}};
 await post(admin,'add',2,null,locations[0].id);await converge(2);
 await post(staff,'remove',1,locations[0].id,null);await converge(1);
 await post(staff,'return',1,null,locations[0].id);await converge(2);
 await post(staff,'transfer',1,locations[0].id,locations[1].id);await until(()=>a.snapshot()?.balances.some(r=>r.item_id===itemId&&r.location_id===locations[1].id&&r.quantity===1)&&b.snapshot()?.balances.some(r=>r.item_id===itemId&&r.location_id===locations[1].id&&r.quantity===1),'transfer event on both sessions');await converge(2);
 await post(admin,'adjust',0,null,locations[1].id);await converge(1);
 const concurrent=await Promise.allSettled([post(admin,'remove',1,locations[0].id,null),post(staff,'remove',1,locations[0].id,null)]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);await converge(0);
 b.offline();assert.equal(b.controller.canPost(),false);const previous=b.snapshot().confirmed_at;
 await post(admin,'add',3,null,locations[0].id);await until(()=>qty(a)===3,'active session receives offline-period transaction');assert.equal(qty(b),0);
 b.rejoin();assert.equal(b.controller.canPost(),false);await until(()=>b.controller.canPost()&&qty(b)===3,'reconnect catches up missed transaction');assert.notEqual(b.snapshot().confirmed_at,previous);
 assert.ok(b.snapshot().movements.filter(m=>m.item_id===itemId).length>=7);
 const count=b.snapshot().movements.length;b.controller.stop();await post(admin,'return',1,null,locations[0].id);await until(()=>qty(a)===4,'remaining session continues after other cleanup');assert.equal(b.snapshot().movements.length,count);
 console.log('PASS: two separate authenticated Supabase sessions, all transaction types, simultaneous withdrawals, disconnect/read-only gate, reconnect catch-up, confirmed quantities/activity, and subscription cleanup');
})().catch(e=>{console.error('Live verification failed: '+e.message);process.exitCode=1}).finally(async()=>{
 for(const c of controllers)c.stop();
 if(admin&&itemId){try{const snapshot=await rpc(admin,'inventory_snapshot');const item=snapshot.items.find(i=>i.id===itemId);if(item)await rpc(admin,'set_item_archived',{p_item:itemId,p_archived:true,p_expected_updated_at:item.updated_at});}catch{console.error('Test fixture remains; archive it through the admin screen.');}}
 for(const c of clients){await c.removeAllChannels();await c.auth.signOut();}
});
