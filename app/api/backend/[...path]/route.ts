import {neonBackend} from '../../../../lib/neon-backend';
import {NextRequest} from 'next/server';
import {validSession,sameOrigin,sessionToken} from '../../../../lib/office-server';
async function proxy(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
 try{
  if(!sessionToken(request))return Response.json({error:'Office authorization required'},{status:401});
  if(!['GET','HEAD'].includes(request.method)&&!sameOrigin(request))return Response.json({error:'Origin not allowed'},{status:403});
  const {path}=await params;
  if(!['auth','rest','storage','functions'].includes(path[0])||path[1]!=='v1'||path.some(p=>p==='.'||p==='..'||p.includes('/')||p.includes('\\'))||path.includes('admin'))return new Response('Not found',{status:404});
  // Inventory and file queries recheck the office session inside their own database transaction (office_gate_pre_request).
  if(path[0]!=='auth')return neonBackend(request,path);
  if(!await validSession(request))return Response.json({error:'Office authorization required'},{status:401});
  // Staff Auth is the only remaining upstream service. Inventory and files use Neon.
  const target=new URL('/'+path.map(encodeURIComponent).join('/')+request.nextUrl.search,process.env.NEXT_PUBLIC_SUPABASE_URL);
  const headers=new Headers();
  for(const name of ['authorization','content-type','range','prefer','accept','x-client-info','x-upsert']){const value=request.headers.get(name);if(value)headers.set(name,value);}
  headers.set('apikey',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const upstream=await fetch(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(30000)});
  const output=new Headers({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive'});
  for(const name of ['content-type','content-range','content-disposition','range','retry-after']){const value=upstream.headers.get(name);if(value)output.set(name,value);}
  return new Response(upstream.body,{status:upstream.status,headers:output});
 }catch{return Response.json({error:'Backend unavailable'},{status:503});}
}
export const GET=proxy,POST=proxy,PUT=proxy,PATCH=proxy,DELETE=proxy,HEAD=proxy;
