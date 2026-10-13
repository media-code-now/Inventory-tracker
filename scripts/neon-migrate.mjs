import nextEnv from '@next/env';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
nextEnv.loadEnvConfig(process.cwd());
const url=process.env.DATABASE_URL_UNPOOLED;
if(!url||new URL(url).hostname.includes('-pooler'))throw Error('Migrations require DATABASE_URL_UNPOOLED from neon deploy.');
function execute(sql,quiet=false){
 const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-q','-t','-A'],{input:sql,encoding:'utf8',env:{...process.env,PGHOST:new URL(url).hostname,PGPORT:new URL(url).port||'5432',PGDATABASE:decodeURIComponent(new URL(url).pathname.slice(1)),PGUSER:decodeURIComponent(new URL(url).username),PGPASSWORD:decodeURIComponent(new URL(url).password),PGSSLMODE:'require'}});
 if(result.status!==0)throw Error((result.stderr??'PostgreSQL migration failed').replaceAll(url,'[redacted]'));
 if(!quiet&&result.stdout.trim())console.log(result.stdout.trim());
 return result.stdout.trim();
}
execute('create table if not exists public.app_schema_migrations(version text primary key,digest text not null,applied_at timestamptz not null default now());',true);
const applied=new Map(execute('select version||\' \'||digest from public.app_schema_migrations order by version;',true).split('\n').filter(Boolean).map(line=>line.split(' ')));
for(const name of readdirSync('neon/migrations').filter(n=>n.endsWith('.sql')).sort()){
 const source=readFileSync(join('neon/migrations',name),'utf8'),digest=createHash('sha256').update(source).digest('hex');
 if(applied.has(name)){if(applied.get(name)!==digest)throw Error('Applied migration changed: '+name);continue;}
 const sql=source.replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');
 execute(`begin;select pg_advisory_xact_lock(284217);${sql}\ninsert into public.app_schema_migrations(version,digest) values('${name}','${digest}');commit;`,true);
 console.log('Applied '+name);
}
console.log('PASS: Neon schema migrations applied; no inventory or staff accounts seeded.');
