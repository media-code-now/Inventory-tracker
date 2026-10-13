import {database} from './neon-db';
import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import type {NextRequest} from 'next/server';
class OfficeConfigurationError extends Error {}
function configurationError(message:string):never {throw new OfficeConfigurationError(message);}
export function officeFailure(error:unknown){
 const message=error instanceof OfficeConfigurationError?error.message:'Office access is temporarily unavailable';
 // Only fixed messages are logged; never upstream responses, tokens, or environment values.
 console.error(JSON.stringify({event:'office_access_unavailable',message}));
 return message;
}
export const cookieName='__Host-office-session';
export function settings(){
 const password=process.env.OFFICE_PASSWORD, secret=process.env.OFFICE_SESSION_SECRET;
 const origin=process.env.OFFICE_APP_ORIGIN;
 const ttl=Number(process.env.OFFICE_SESSION_TTL_SECONDS??28800);
 if(!password)configurationError('Server setup required: OFFICE_PASSWORD is missing.');
 if(password.length<12)configurationError('Server setup required: OFFICE_PASSWORD must have at least 12 characters.');
 if(!secret)configurationError('Server setup required: OFFICE_SESSION_SECRET is missing.');
 if(secret.length<32)configurationError('Server setup required: OFFICE_SESSION_SECRET must have at least 32 characters.');
 if(!origin)configurationError('Server setup required: OFFICE_APP_ORIGIN is missing.');
 if(!URL.canParse(origin))configurationError('Server setup required: OFFICE_APP_ORIGIN must be a valid URL.');
 if(!Number.isInteger(ttl)||ttl<60||ttl>604800)configurationError('Server setup required: OFFICE_SESSION_TTL_SECONDS must be between 60 and 604800.');
 if(process.env.NODE_ENV==='production'&&new URL(origin).protocol!=='https:')configurationError('Server setup required: OFFICE_APP_ORIGIN must use HTTPS.');
 return {password,secret,origin:new URL(origin).origin,ttl,generation:createHmac('sha256',secret).update(password).digest('hex')};
}
export async function officeRpc(name:string,args:object){
 if(!process.env.DATABASE_URL)configurationError('Server setup required: DATABASE_URL is missing. Run neon deploy and configure the server environment.');
 const operations:Record<string,string[]>={office_session_valid:['p_hash','p_generation'],office_session_create:['p_hash','p_generation','p_seconds'],office_session_delete:['p_hash'],office_login_attempt:[]};
 const keys=operations[name];if(!keys)throw Error('Unknown office operation');
 try{
  const parameters=args as Record<string,unknown>;
  const rows=await database().query(`select public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) as result`,keys.map(key=>parameters[key]));
  return rows[0].result;
 }catch(error){
  if((error as {code?:string}).code==='42883')configurationError('Server setup required: Neon office session functions are missing. Run npm run neon:migrate.');
  if((error as {code?:string}).code==='28P01')configurationError('Server setup required: Neon rejected the database credentials. Refresh DATABASE_URL with neon deploy.');
  throw error;
 }
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
