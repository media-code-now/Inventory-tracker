import {NextRequest,NextResponse} from 'next/server';
import {cookieName,hash,newSession,officeRpc,passwordMatches,sameOrigin,sessionCookie,settings} from '../../../../lib/office-server';
export async function POST(request:NextRequest){
 try{
  if(!sameOrigin(request))return NextResponse.json({error:'Origin not allowed'},{status:403});
  // One shared, atomic database budget works across all server instances and IPs.
  if(!await officeRpc('office_login_attempt',{}))return NextResponse.json({error:'Too many attempts. Try again in 15 minutes.'},{status:429,headers:{'Retry-After':'900'}});
  if(Number(request.headers.get('content-length'))>4096)return NextResponse.json({error:'Request too large'},{status:413});
  const body=await request.text();
  if(body.length>4096)return NextResponse.json({error:'Request too large'},{status:413});
  let value;try{value=JSON.parse(body).password;}catch{return NextResponse.json({error:'Invalid request'},{status:400});}
  if(typeof value!=='string'||!passwordMatches(value))return NextResponse.json({error:'Incorrect office password'},{status:401});
  const old=request.cookies.get(cookieName)?.value;
  if(old)await officeRpc('office_session_delete',{p_hash:hash(old)});
  const response=NextResponse.json({ok:true});
  response.cookies.set(cookieName,await newSession(),sessionCookie(settings().ttl));
  return response;
 }catch{return NextResponse.json({error:'Office access is temporarily unavailable'},{status:503});}
}
