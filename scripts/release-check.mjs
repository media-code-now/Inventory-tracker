import {spawnSync} from 'node:child_process';
import {mkdirSync,existsSync} from 'node:fs';
const demo=process.argv.includes('--demo');
const unknown=process.argv.slice(2).filter(a=>a!=='--demo');
if(unknown.length)throw new Error('Use no flags for production, or --demo for an explicit demo release.');
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit',env:{...process.env}});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);}
run(process.execPath,['scripts/check-public-config.mjs',...(demo?['--demo']:['--production'])]);
if(demo)console.log('Preparing an explicitly labeled demo release; real database/authentication are not verified.');
const npm=process.platform==='win32'?'npm.cmd':'npm';
for(const script of ['typecheck','test:access','test:inventory','test:dashboard','test:realtime','test:csv','test:database'])run(npm,['run',script]);
run(npm,['audit','--omit=dev']);
run(npm,['run',demo?'build':'build:production']);
for(const path of ['out/index.html','out/login/index.html','out/inventory/index.html','out/reports/index.html','out/imports/index.html','out/auth/accept-invite/index.html','out/auth/reset-password/index.html']){
 if(!existsSync(path))throw new Error('Missing deployment route: '+path);
}
mkdirSync('release',{recursive:true});
const archive=demo?'release/stockroom-demo.tar.gz':'release/stockroom-production.tar.gz';
run('tar',['-czf',archive,'out','.openai/hosting.json']);
console.log('Release checks passed. Deployment archive: '+archive);
console.log(demo?'This archive is a demo release. Supabase production setup is still required.':'Build configuration is valid. Verify hosted Auth/SMTP/RLS and the two-session live test before office rollout.');
