const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
function check(key,extra={}){
  const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://project.example',NEXT_PUBLIC_SUPABASE_ANON_KEY:key,...extra};
  return spawnSync(process.execPath,['scripts/check-public-config.mjs'],{env,encoding:'utf8'});
}
test('browser configuration rejects privileged keys and accepts only publishable/anon keys',()=>{
  for(const key of ['sb_secret_test_secret','header.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.test']){
    const result=check(key);assert.notEqual(result.status,0);assert.ok(!result.stdout.includes(key));assert.ok(!result.stderr.includes(key));
  }
  assert.equal(check('sb_publishable_test_publishable').status,0);
  assert.equal(check('header.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.test').status,0);
  assert.notEqual(check('sb_publishable_test_publishable',{NEXT_PUBLIC_SERVICE_ROLE_KEY:'fixture'}).status,0);
  assert.notEqual(check('sb_publishable_test_publishable',{NEXT_PUBLIC_SUPABASE_URL:''}).status,0);
});
test('production builds require complete HTTPS configuration; demo remains an explicit option',()=>{
 const run=(url,key)=>spawnSync(process.execPath,['scripts/check-public-config.mjs','--production'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:key},encoding:'utf8'});
 assert.notEqual(run('','').status,0);
 assert.notEqual(run('http://localhost:54321','sb_publishable_test_fixture').status,0);
 assert.equal(run('https://project.example','sb_publishable_test_fixture').status,0);
});
