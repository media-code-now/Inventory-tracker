import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

// Hosted only in Supabase. No service key enters the Next.js build or responses.
Deno.serve(async (request: Request) => {
  const siteUrl = Deno.env.get('SITE_URL');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!siteUrl || !url || !anonKey || !serviceKey) return new Response('Server configuration required', { status: 503 });
  const origin = new URL(siteUrl).origin;
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const reply = (status: number, body: object) => {
    if(status>=500)console.error(JSON.stringify({event:'invitation_backend_failure',status}));
    return new Response(JSON.stringify(body), {status, headers});
  };
  if (request.headers.get('Origin') && request.headers.get('Origin') !== origin) return reply(403, {error:'Origin not allowed'});
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
  if (request.method !== 'POST') return reply(405, {error:'Method not allowed'});
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, {error:'Authentication required'});
  const caller = createClient(url, anonKey, {global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  // getUser validates the access token with Supabase Auth; JWT contents alone are never trusted.
  const {data:identity,error:authError} = await caller.auth.getUser(authorization.slice(7));
  if (authError || !identity.user) return reply(401, {error:'Invalid session'});
  const {data:role,error:roleError} = await caller.rpc('office_role');
  if (roleError || role !== 'admin') return reply(403, {error:'Active admin access required'});
  let payload;
  try {const body=await request.text();if(body.length>4096)return reply(413,{error:'Request too large'});payload=JSON.parse(body);} catch {return reply(400,{error:'Invalid request'});}
  const {email,name,role:inviteRole} = payload ?? {};
  if (typeof email!=='string' || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    || typeof name!=='string' || !name.trim() || name.length>100 || !['admin','staff','viewer'].includes(inviteRole)) {
    return reply(400, {error:'Enter a valid email, name, and role'});
  }
  // Recheck admin authorization under a membership lock inside the database operation.
  const {data:invitationId,error:prepareError}=await caller.rpc('prepare_invitation',{p_email:email,p_name:name,p_role:inviteRole});
  if (prepareError) return reply(400,{error:prepareError.message});
  const privileged=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
    // Redirect is server-owned, never taken from request data.
    const {data,error}=await privileged.auth.admin.inviteUserByEmail(email.trim().toLowerCase(),{redirectTo:origin+'/auth/accept-invite/'});
    if(error || !data.user) {
      await privileged.from('invitations').update({status:'failed'}).eq('id',invitationId).eq('status','sending');
      return reply(502,{error:'Invitation could not be sent. Check Auth email delivery settings and whether the account already exists.'});
    }
    const {error:finishError}=await privileged.rpc('finish_invitation',{p_invitation:invitationId,p_user:data.user.id});
    if(finishError) {
      await privileged.from('invitations').update({status:'failed'}).eq('id',invitationId).eq('status','sending');
      return reply(502,{error:'Invitation email was sent but access was not enabled. Ask the project owner to reconcile this invitation.'});
    }
    return reply(200,{invitation_id:invitationId,message:'Invitation sent'});
  } catch {
    // Leave uncertain outcomes in sending state for owner reconciliation; do not resend blindly.
    return reply(503,{error:'Invitation outcome is uncertain. Check invitation status before retrying.'});
  }
});
