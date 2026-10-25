const {readFileSync}=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');const test=require('node:test');const ts=require('typescript');
const exportsObject={};vm.runInNewContext(ts.transpileModule(readFileSync('lib/live-inventory.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject,setTimeout,clearTimeout,setInterval,clearInterval});
const {createLiveInventory,AccessDenied}=exportsObject;
const wait=()=>new Promise(r=>setTimeout(r,30));
function session(database,pollMs=100000){let online=true,listener=null,removed=0,fetches=0,slow=null,error=null;const snapshots=[],statuses=[],failures=[];
 const controller=createLiveInventory({online:()=>online,fetchSnapshot:async()=>{fetches++;if(slow)await slow;if(error)throw error;return structuredClone(database);},subscribe:(change,status)=>{listener={change,status};queueMicrotask(()=>status('SUBSCRIBED'));return()=>{removed++;listener=null;};},apply:data=>snapshots.push(data),status:s=>statuses.push(s),failure:(message,denied)=>failures.push({message,denied}),pollMs,debounceMs:1});
 return{controller,snapshots,statuses,failures,get removed(){return removed},get fetches(){return fetches},event(){listener?.change()},setError:e=>error=e,setSlow:p=>slow=p,offline(){online=false;controller.offline()},online(){online=true;controller.reconnect()},listener:()=>listener};}
test('two authenticated-controller sessions receive confirmed balances, totals, and activity',async()=>{
 const db={quantity:4,balances:{a:4,b:0},movements:[]};const a=session(db),b=session(db);a.controller.start();b.controller.start();await wait();assert.ok(a.controller.canPost()&&b.controller.canPost());
 db.quantity=3;db.balances.a=3;db.movements.push('issue');a.event();b.event();await wait();assert.deepEqual(a.snapshots.at(-1),db);assert.deepEqual(b.snapshots.at(-1),db);
 db.balances.a=1;db.balances.b=2;db.movements.push('transfer');a.event();b.event();await wait();assert.equal(b.snapshots.at(-1).quantity,3);assert.equal(b.snapshots.at(-1).balances.b,2);assert.equal(b.snapshots.at(-1).movements.length,2);a.controller.stop();b.controller.stop();
});
test('connection interruption blocks posting; rejoin fetch recovers events missed while offline',async()=>{
 const db={quantity:5};const s=session(db);s.controller.start();await wait();const old=s.listener();s.offline();assert.equal(s.controller.canPost(),false);assert.equal(s.statuses.at(-1),'Offline');db.quantity=2;old.change();await wait();assert.equal(s.snapshots.at(-1).quantity,5);
 let release;const blocker=new Promise(r=>release=r);s.setSlow(blocker);s.online();assert.equal(s.controller.canPost(),false);release();await wait();assert.equal(s.snapshots.at(-1).quantity,2);assert.equal(s.controller.canPost(),true);s.controller.stop();
});
test('disconnect during fetch discards stale result; failed fetch keeps last confirmed snapshot read-only',async()=>{
 const db={quantity:5};const s=session(db);s.controller.start();await wait();s.setError(Error('Network failed'));await s.controller.refresh();assert.equal(s.snapshots.at(-1).quantity,5);assert.equal(s.controller.canPost(),false);assert.equal(s.failures.at(-1).denied,false);
 s.setError(null);s.online();await wait();let release;s.setSlow(new Promise(r=>release=r));const refresh=s.controller.refresh();s.offline();db.quantity=999;release();await refresh;assert.equal(s.snapshots.at(-1).quantity,5);s.controller.stop();
});
test('access denied never starts a subscription; stopping prevents late route/session callbacks',async()=>{
 const s=session({quantity:5});s.setError(new AccessDenied('Inactive member'));s.controller.start();await wait();assert.equal(s.listener(),null);assert.equal(s.failures[0].denied,true);s.controller.stop();
 const active=session({quantity:3});active.controller.start();await wait();const old=active.listener(),count=active.snapshots.length;active.controller.stop();old.change();old.status('SUBSCRIBED');await wait();assert.equal(active.snapshots.length,count);assert.ok(active.removed>0);assert.equal(active.controller.canPost(),false);
});
test('event bursts coalesce and a change during an in-flight fetch schedules a follow-up',async()=>{
 const db={quantity:1};const s=session(db);s.controller.start();await wait();const before=s.fetches;for(let n=0;n<10;n++)s.event();await wait();assert.equal(s.fetches,before+1);
 let release;s.setSlow(new Promise(r=>release=r));const r=s.controller.refresh();s.event();await wait();db.quantity=2;s.setSlow(null);release();await r;await wait();assert.equal(s.snapshots.at(-1).quantity,2);assert.ok(s.fetches>=before+3);s.controller.stop();
});
test('polling does not refetch while live, but retries after a failed refresh',async()=>{
 const s=session({quantity:1},10);s.controller.start();await wait();const before=s.fetches;await wait();await wait();assert.equal(s.fetches,before);
 s.setError(Error('Network failed'));await s.controller.refresh();s.setError(null);await wait();assert.ok(s.fetches>before+1);assert.equal(s.controller.canPost(),true);s.controller.stop();
});
