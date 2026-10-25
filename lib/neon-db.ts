import {neon} from '@neondatabase/serverless';
import {createHash} from 'node:crypto';
import type {NextRequest} from 'next/server';
export class StaffAccessError extends Error {constructor(message:string,readonly status:number=403){super(message);}}
const connect=(url:string)=>neon(url,{fetchOptions:{cache:'no-store'}});
let client:{url:string;sql:ReturnType<typeof connect>}|null=null;
export function database(){const url=process.env.DATABASE_URL;if(!url)throw Error('DATABASE_URL is required');if(client?.url!==url)client={url,sql:connect(url)};return client.sql;}
const allowedRpc=new Set(['inventory_snapshot','movement_history','office_role','record_application_error','accept_invitation','prepare_invitation','revoke_invitation','create_item','update_item','set_item_archived','set_member','post_movement','create_stock_count','start_stock_count','save_counted_quantity','refresh_count_snapshot','submit_stock_count','approve_stock_count','validate_inventory_import','commit_inventory_import']);
export function rpcStatement(name:string,args:Record<string,unknown>){
 if(!allowedRpc.has(name))throw new StaffAccessError('Unknown inventory operation',404);
 const entries=Object.entries(args);
 if(entries.some(([key])=>!/^p_[a-z_]+$/.test(key)))throw new StaffAccessError('Invalid operation arguments',400);
 return {text:`select public.${name}(${entries.map(([key],i)=>`${key} => $${i+1}`).join(',')}) as result`,values:entries.map(([,value])=>value!==null&&typeof value==='object'?JSON.stringify(value):value)};
}
export type StaffIdentity={id:string;email:string|null;email_confirmed_at:string|null;invited_at:string|null};
// Verified identities are reused briefly instead of calling Supabase Auth on every request, never past the token's expiry.
// Membership and office access are still checked in the database on every query.
const identityCache=new Map<string,{identity:StaffIdentity;expires:number}>(),identityTtlMs=30000,identityCacheLimit=500;
function tokenExpiry(authorization:string){
 try{const exp=JSON.parse(Buffer.from(authorization.slice(7).split('.')[1],'base64url').toString()).exp;return typeof exp==='number'?exp*1000:0;}catch{return 0;}
}
export async function staffIdentity(request:NextRequest):Promise<StaffIdentity>{
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))throw new StaffAccessError('Staff login required',401);
 const key=createHash('sha256').update(authorization).digest('hex'),now=Date.now(),cached=identityCache.get(key);
 if(cached&&cached.expires>now)return cached.identity;
 identityCache.delete(key);
 const identity=await fetchStaffIdentity(authorization);
 const expires=Math.min(now+identityTtlMs,tokenExpiry(authorization));
 if(expires>now){
  if(identityCache.size>=identityCacheLimit)for(const [k,v] of identityCache)if(v.expires<=now||identityCache.size>=identityCacheLimit)identityCache.delete(k);
  identityCache.set(key,{identity,expires});
 }
 return identity;
}
async function fetchStaffIdentity(authorization:string):Promise<StaffIdentity>{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)throw new StaffAccessError('Staff authentication is not configured',503);
 const response=await fetch(`${url}/auth/v1/user`,{headers:{Authorization:authorization,apikey:key},cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new StaffAccessError('Invalid staff login',401);
 const user=await response.json();
 if(typeof user.id!=='string'||! /^[a-f0-9-]{36}$/i.test(user.id))throw new StaffAccessError('Invalid staff identity',401);
 return {id:user.id,email:typeof user.email==='string'?user.email:null,email_confirmed_at:user.email_confirmed_at??null,invited_at:user.invited_at??null};
}
// Identity and office headers come only from server validation, never user-supplied IDs or roles.
// SET LOCAL context and role live inside one HTTP transaction and cannot leak to another request.
export async function staffQuery(identity:StaffIdentity,officeToken:string,generation:string,text:string,values:unknown[]=[]){
 const sql=database();
 const results=await sql.transaction([
  sql.query('insert into auth.users(id,email,email_confirmed_at,invited_at) values($1,$2,$3,$4) on conflict(id) do update set email=excluded.email,email_confirmed_at=excluded.email_confirmed_at,invited_at=excluded.invited_at where (auth.users.email,auth.users.email_confirmed_at,auth.users.invited_at) is distinct from (excluded.email,excluded.email_confirmed_at,excluded.invited_at)',[identity.id,identity.email,identity.email_confirmed_at,identity.invited_at]),
  sql.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.headers',$3,true)",[identity.id,JSON.stringify({role:'authenticated',sub:identity.id}),JSON.stringify({'x-office-session':officeToken,'x-office-generation':generation})]),
  sql.query("select set_config('role','authenticated',true)"),
  sql.query('select public.office_gate_pre_request()'),
  sql.query(text,values),
 ]);
 return results[results.length-1];
}
