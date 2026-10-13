import { createClient } from '@supabase/supabase-js';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Do not consume invitation/recovery URL fragments until the office gate has opened.
const officeLocked=typeof window!=='undefined'&&window.location.pathname.startsWith('/office-unlock');
// Only publishable/anon keys are allowed here. Privileged keys live in the Edge Function environment.
// scripts/check-public-config.mjs validates configuration before development and production builds.
export const supabase=url&&key&&!officeLocked?createClient(url,key,{global:{fetch:async(input,init)=>{const upstream=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);const response=await fetch('/api/backend'+upstream.pathname+upstream.search,init);if(response.status===401&&response.headers.get('content-type')?.includes('application/json')){const body=await response.clone().json();if(body.error==='Office authorization required')window.location.replace('/office-unlock/');}return response;}},auth:{flowType:'implicit',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}}):null;
