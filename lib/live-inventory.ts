export type LiveStatus='Connecting'|'Live'|'Reconnecting'|'Offline'|'Access denied'|'Disconnected';
export class AccessDenied extends Error {}
type Options<T>={fetchSnapshot:()=>Promise<T>;subscribe:(change:()=>void,status:(s:string)=>void)=>()=>void;apply:(snapshot:T)=>void;status:(state:LiveStatus)=>void;failure:(message:string,denied:boolean)=>void;online:()=>boolean;loading?:(value:boolean)=>void;pollMs?:number;debounceMs?:number};
// A controller belongs to one authenticated route/session. While Live, change events drive refreshes; polling only recovers.
// Callbacks from removed channels are ignored.
export function createLiveInventory<T>(options:Options<T>){
 let stopped=false,subscribed=false,hasSnapshot=false,epoch=0,running:Promise<boolean>|null=null,dirty=false,remove:(()=>void)|null=null;
 let debounce:ReturnType<typeof setTimeout>|null=null,poll:ReturnType<typeof setInterval>|null=null;
 let state:LiveStatus='Connecting';
 const setStatus=(s:LiveStatus)=>{state=s;if(!stopped)options.status(s)};
 async function fetchCurrent():Promise<boolean>{
  if(stopped)return false;
  if(!options.online()){setStatus('Offline');return false;}
  if(running){dirty=true;return running;}
  const current=epoch;options.loading?.(true);
  running=(async()=>{
   try{
    const snapshot=await options.fetchSnapshot();
    if(stopped||current!==epoch||!options.online())return false;
    hasSnapshot=true;options.apply(snapshot);setStatus(subscribed?'Live':state==='Reconnecting'?'Reconnecting':'Connecting');return true;
   }catch(error){
    if(stopped||current!==epoch)return false;
    const denied=error instanceof AccessDenied;
    setStatus(denied?'Access denied':options.online()?'Reconnecting':'Offline');
    options.failure(error instanceof Error?error.message:'Unable to refresh inventory',denied);
    if(denied){epoch++;hasSnapshot=false;subscribed=false;remove?.();remove=null;}
    return false;
   }finally{
    running=null;if(!stopped)options.loading?.(false);
    if(dirty&&!stopped){dirty=false;queue();}
   }
  })();return running;
 }
 function queue(){if(stopped)return;if(debounce)clearTimeout(debounce);debounce=setTimeout(()=>{debounce=null;void fetchCurrent()},options.debounceMs??80);}
 function connect(){
  if(stopped)return;
  epoch++;subscribed=false;remove?.();remove=null;
  if(!options.online()){setStatus('Offline');return;}
  if(!hasSnapshot){void fetchCurrent().then(ok=>{if(ok&&!stopped)connect()});return;}
  setStatus('Connecting');const current=epoch;
  remove=options.subscribe(()=>{if(!stopped&&current===epoch)queue()},s=>{
   if(stopped||current!==epoch)return;
   if(s==='SUBSCRIBED'){subscribed=true;setStatus('Reconnecting');void fetchCurrent();}
   else {subscribed=false;setStatus(options.online()?'Reconnecting':'Offline');}
  });
  void fetchCurrent();
 }
 return {
  start(){connect();poll=setInterval(()=>{if(!stopped&&options.online()){if(!remove||(!subscribed&&state==='Reconnecting'))connect();else if(state!=='Live')void fetchCurrent()}},options.pollMs??15000);},
  refresh:fetchCurrent,
  reconnect(){connect();},
  offline(){epoch++;subscribed=false;remove?.();remove=null;setStatus('Offline');},
  canPost(){return !stopped&&options.online()&&subscribed&&state==='Live';},
  stop(){stopped=true;epoch++;subscribed=false;if(debounce)clearTimeout(debounce);if(poll)clearInterval(poll);remove?.();remove=null;},
 };
}
