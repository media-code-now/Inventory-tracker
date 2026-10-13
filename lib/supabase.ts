import { createClient } from '@supabase/supabase-js';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Only publishable/anon keys are allowed here. Privileged keys live in the Edge Function environment.
// scripts/check-public-config.mjs validates configuration before development and production builds.
export const supabase=url&&key?createClient(url,key,{auth:{flowType:'implicit',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}}):null;
