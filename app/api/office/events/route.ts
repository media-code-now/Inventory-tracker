import {NextRequest} from 'next/server';
import {inventoryRevision} from '../../../../lib/office-server';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 // The baseline is read before the client's open-time snapshot, so changes after it are always signaled.
 let last=await inventoryRevision(request);
 if(last===null)return new Response('Unauthorized',{status:401});
 // Authenticated update ticks trigger fresh RLS-protected snapshots only when inventory data changed. No data is broadcast.
 const encoder=new TextEncoder();let timer:ReturnType<typeof setInterval>|undefined;
 const stream=new ReadableStream({start(controller){let stopped=false,running=false;const stop=()=>{if(stopped)return;stopped=true;clearInterval(timer);controller.close();};request.signal.addEventListener('abort',stop,{once:true});controller.enqueue(encoder.encode('retry: 5000\n\n'));timer=setInterval(async()=>{if(running||stopped)return;running=true;try{const revision=await inventoryRevision(request);if(revision===null){stop();return;}if(!stopped&&revision!==last)controller.enqueue(encoder.encode('data: refresh\n\n'));last=revision;}catch{stop();}finally{running=false;}},5000);},cancel(){clearInterval(timer);}});
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'private, no-store','X-Accel-Buffering':'no'}});
}
