import {NextRequest,NextResponse} from 'next/server';
import {cookieName,hash,officeRpc,sameOrigin,sessionCookie} from '../../../../lib/office-server';
export async function POST(request:NextRequest){
 try{
  if(!sameOrigin(request))return NextResponse.json({error:'Origin not allowed'},{status:403});
  const token=request.cookies.get(cookieName)?.value;
  if(token)await officeRpc('office_session_delete',{p_hash:hash(token)});
  const response=NextResponse.json({ok:true});response.cookies.set(cookieName,'',sessionCookie(0));return response;
 }catch{return NextResponse.json({error:'Unable to end office session. Try again.'},{status:503});}
}
