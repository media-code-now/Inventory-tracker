import nextEnv from '@next/env';
const {loadEnvConfig}=nextEnv;
const production=process.argv.includes('--production');
const demo=process.argv.includes('--demo');
loadEnvConfig(process.cwd(), process.argv.includes('--development'));
const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(demo&&(key||url))throw new Error('A demo release must have no Supabase configuration. Remove public Supabase variables for the demo build, or use the production release command.');
if(production&&(!key||!url))throw new Error('Production deployment requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Configure Supabase before building a production release.');
if(Boolean(key)!==Boolean(url))throw new Error('Set both public Supabase URL and publishable key, or leave both unset for isolated demo mode.');
if(key){
  if(!URL.canParse(url)||new URL(url).protocol!=='https:'){
    if(production||(!url?.startsWith('http://127.0.0.1:')&&!url?.startsWith('http://localhost:')))throw new Error('Supabase URL must use HTTPS (except local development).');
  }
  if(key.startsWith('sb_secret_'))throw new Error('A privileged Supabase key cannot be used in browser configuration.');
  if(!key.startsWith('sb_publishable_')){
    let role;
    try{role=JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;}catch{throw new Error('Use a Supabase publishable or legacy anon key.');}
    if(role!=='anon')throw new Error('Only legacy anon keys may be used in browser configuration.');
  }
}
// Also prevent accidentally public-prefixed privileged variables from entering the build.
if(Object.keys(process.env).some(name=>name.startsWith('NEXT_PUBLIC_')&&/SERVICE_ROLE|SECRET_KEY|DATABASE_URL/.test(name)))throw new Error('Remove privileged NEXT_PUBLIC_ configuration before building.');
console.log(key?'Public Supabase configuration validated.':'Isolated demo mode: Supabase is not configured.');
