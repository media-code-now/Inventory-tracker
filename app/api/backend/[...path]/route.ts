import {NextRequest} from 'next/server';
import {cookieName,settings,validSession,sameOrigin} from '../../../../lib/office-server';
async function proxy(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
 try{
  if(!await validSession(request))return Response.json({error:'Office authorization required'},{status:401});
  if(!['GET','HEAD'].includes(request.method)&&!sameOrigin(request))return Response.json({error:'Origin not allowed'},{status:403});
  const {path}=await params;
  if(!['auth','rest','storage','functions'].includes(path[0])||path[1]!=='v1'||path.some(p=>p==='.'||p==='..'||p.includes('/')||p.includes('\\'))||path.includes('admin'))return new Response('Not found',{status:404});
  if(path[0]==='storage'&&path.includes('sign'))return new Response('Signed URLs are disabled',{status:403});
  // A fixed upstream prevents arbitrary fetches; never forward cookies or service credentials.
  // Private-bucket /object/:bucket GET preserves custom gate headers on Storage versions
  // whose /object/authenticated route filters headers during schema validation.
  // The supplied staff JWT and private bucket still require the same Storage RLS.
  const upstreamPath=path[0]==='storage'&&path[2]==='object'&&path[3]==='authenticated'?path.filter((_,i)=>i!==3):path;
  const target=new URL('/'+upstreamPath.map(encodeURIComponent).join('/')+request.nextUrl.search,process.env.NEXT_PUBLIC_SUPABASE_URL);
  const headers=new Headers();
  for(const name of ['authorization','content-type','range','prefer','accept','x-client-info','x-upsert']){const value=request.headers.get(name);if(value)headers.set(name,value);}
  headers.set('apikey',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  headers.set('x-office-session',request.cookies.get(cookieName)!.value);
  headers.set('x-office-generation',settings().generation);
  const upstream=await fetch(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(30000)});
  const output=new Headers({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive'});
  for(const name of ['content-type','content-range','content-disposition','range','retry-after']){const value=upstream.headers.get(name);if(value)output.set(name,value);}
  // Signed URLs could bypass the office gate; downloads use authenticated proxy requests only.
  return new Response(upstream.body,{status:upstream.status,headers:output});
 }catch{return Response.json({error:'Backend unavailable'},{status:503});}
}
export const GET=proxy,POST=proxy,PUT=proxy,PATCH=proxy,DELETE=proxy,HEAD=proxy;
