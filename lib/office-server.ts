import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import type {NextRequest} from 'next/server';
export const cookieName='__Host-office-session';
export function settings(){
 const password=process.env.OFFICE_PASSWORD, secret=process.env.OFFICE_SESSION_SECRET;
 const origin=process.env.OFFICE_APP_ORIGIN;
 const ttl=Number(process.env.OFFICE_SESSION_TTL_SECONDS??28800);
 if(!password||password.length<12||!secret||secret.length<32||!origin||!Number.isInteger(ttl)||ttl<60||ttl>604800)throw Error('Office security configuration required');
 if(process.env.NODE_ENV==='production'&&new URL(origin).protocol!=='https:')throw Error('HTTPS is required');
 return {password,secret,origin:new URL(origin).origin,ttl,generation:createHmac('sha256',secret).update(password).digest('hex')};
}
export async function officeRpc(name:string,args:object){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Office database configuration required');
 const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args),cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Office security database unavailable');
 return response.json();
}
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function passwordMatches(value:string){return timingSafeEqual(Buffer.from(hash(value)),Buffer.from(hash(settings().password)));}
export async function validSession(request:NextRequest){
 const token=request.cookies.get(cookieName)?.value;
 if(!token||!/^[a-f0-9]{64}$/.test(token))return false;
 return await officeRpc('office_session_valid',{p_hash:hash(token),p_generation:settings().generation})===true;
}
export function sameOrigin(request:NextRequest){return request.headers.get('origin')===settings().origin;}
export async function newSession(){const token=randomBytes(32).toString('hex'),s=settings();await officeRpc('office_session_create',{p_hash:hash(token),p_generation:s.generation,p_seconds:s.ttl});return token;}
export function sessionCookie(maxAge:number){return {httpOnly:true,secure:true,sameSite:'strict' as const,path:'/',maxAge};}
