import type {NextRequest} from 'next/server';
import {cookieName,settings} from './office-server';
import {database,rpcStatement,staffIdentity,staffQuery,StaffAccessError} from './neon-db';
export async function neonBackend(request:NextRequest,path:string[]){
 try{
  const identity=await staffIdentity(request);
  const query=(text:string,values:unknown[]=[])=>staffQuery(identity,request.cookies.get(cookieName)!.value,settings().generation,text,values);
  if(path[0]==='rest'&&path[2]==='rpc'&&path.length===4&&request.method==='POST'){
   const body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body))throw new StaffAccessError('Invalid arguments',400);
   const operation=rpcStatement(path[3],body);const rows=await query(operation.text,operation.values);
   return Response.json(rows[0].result);
  }
  if(path[0]==='rest'&&path[2]==='locations'&&path.length===3&&request.method==='POST'){
   const body=await request.json(),location=Array.isArray(body)&&body.length===1?body[0]:body;
   if(typeof location?.name!=='string'||!location.name.trim()||typeof location.description!=='string')throw new StaffAccessError('Invalid location',400);
   await query('insert into public.locations(name,description) values($1,$2)',[location.name,location.description]);
   return new Response(null,{status:201});
  }
  if(path[0]==='storage'&&path[2]==='object'){
   const offset=path[3]==='authenticated'?4:3,bucket=path[offset],name=path.slice(offset+1).join('/');
   if(bucket!=='item-images'||path.includes('sign')||path.includes('public'))throw new StaffAccessError('Unknown file operation',404);
   if(['GET','HEAD'].includes(request.method)&&name){
    const rows=await query("select encode(bytes,'base64') as content,content_type from storage.objects where bucket_id=$1 and name=$2",[bucket,name]);
    if(!rows.length)return new Response('File not found',{status:404});
    const bytes=Buffer.from(rows[0].content??'','base64');
    return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':rows[0].content_type??'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
   }
   if(request.method==='POST'&&name){
    // Serverless hosts reject bodies around 4.5 MB before this code runs; the client downsizes photos to ≤3 MB.
    if(Number(request.headers.get('content-length'))>4*1024*1024)throw new StaffAccessError('Image is too large to upload. Choose a smaller image.',413);
    let content:Buffer,type=request.headers.get('content-type')??'';
    if(type.startsWith('multipart/form-data')){const form=await request.formData();const file=Array.from(form.values()).find(value=>value instanceof Blob);if(!(file instanceof Blob))throw new StaffAccessError('Image required',400);type=file.type;content=Buffer.from(await file.arrayBuffer());}
    else content=Buffer.from(await request.arrayBuffer());
    if(!['image/jpeg','image/png','image/webp'].includes(type)||content.length>4*1024*1024)throw new StaffAccessError('Choose a JPEG, PNG, or WebP image up to 4 MB',400);
    const rows=await query("insert into storage.objects(bucket_id,name,content_type,bytes) values($1,$2,$3,decode($4,'base64')) returning id",[bucket,name,type,content.toString('base64')]);
    return Response.json({Id:rows[0].id,Key:bucket+'/'+name},{status:200});
   }
   if(request.method==='DELETE'&&!name){
    const {prefixes}=await request.json();if(!Array.isArray(prefixes)||prefixes.length>100||prefixes.some(p=>typeof p!=='string'))throw new StaffAccessError('Invalid file paths',400);
    const rows=await query('delete from storage.objects where bucket_id=$1 and name=any($2::text[]) returning name',[bucket,prefixes]);
    return Response.json(rows);
   }
  }
  if(path[0]==='functions'&&path[2]==='invite-user'&&path.length===3&&request.method==='POST'){
   const body=await request.json(),{email,name,role}=body;
   if(typeof email!=='string'||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())||typeof name!=='string'||!name.trim()||name.length>100||!['admin','staff','viewer'].includes(role))throw new StaffAccessError('Invalid invitation',400);
   const key=process.env.SUPABASE_SERVICE_ROLE_KEY,url=process.env.NEXT_PUBLIC_SUPABASE_URL;
   if(!key||!url)throw new StaffAccessError('Staff invitation email is not configured',503);
   const operation=rpcStatement('prepare_invitation',{p_email:email,p_name:name,p_role:role});const rows=await query(operation.text,operation.values);const id=rows[0].result;
   const sent=await fetch(`${url}/auth/v1/invite?redirect_to=${encodeURIComponent(settings().origin+'/auth/accept-invite/')}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({email:email.trim().toLowerCase()}),signal:AbortSignal.timeout(15000)});
   if(!sent.ok){await database().query("update public.invitations set status='failed' where id=$1 and status='sending'",[id]);throw new StaffAccessError('Invitation could not be sent. Check staff Auth email delivery settings.',502);}
   const user=await sent.json();if(!user.id)throw new StaffAccessError('Invitation outcome is uncertain; reconcile it before retrying.',503);
   const sql=database();await sql.transaction([
    sql.query('insert into auth.users(id,email,email_confirmed_at,invited_at) values($1,$2,$3,$4) on conflict(id) do update set email=excluded.email,invited_at=excluded.invited_at',[user.id,user.email,user.email_confirmed_at??null,user.invited_at??null]),
    sql.query('select public.finish_invitation($1,$2)',[id,user.id]),
   ]);
   return Response.json({invitation_id:id,message:'Invitation sent'});
  }
  return Response.json({error:'Unknown inventory endpoint'},{status:404});
 }catch(error){
  const databaseError=error as {code?:string;message?:string;detail?:string};
  if(error instanceof StaffAccessError)return Response.json({error:error.message},{status:error.status});
  // The database's office gate rejected the session; same response as the route-level check so the client returns to the unlock screen.
  if(databaseError.code==='42501'&&databaseError.message==='Office authorization required')return Response.json({error:'Office authorization required'},{status:401});
  if(databaseError.code){
   const status=databaseError.code==='42501'?403:['23505','40001'].includes(databaseError.code)?409:400;
   // Database validation messages are structured, never connection strings or SQL text.
   const safeCodes=['42501','23505','23514','22023','P0001','40001'];
   return Response.json({code:databaseError.code,message:safeCodes.includes(databaseError.code)?databaseError.message:'Inventory operation failed',details:databaseError.code==='P0001'?databaseError.detail:undefined},{status});
  }
  console.error(JSON.stringify({event:'neon_inventory_unavailable'}));
  return Response.json({error:'Inventory service is temporarily unavailable'},{status:503});
 }
}
