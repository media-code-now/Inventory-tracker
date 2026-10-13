import subprocess,sys,json
host,port=sys.argv[1:];base=['psql','-h',host,'-p',port,'-d','postgres','-v','ON_ERROR_STOP=1','-At']
def run(sql):
 r=subprocess.run(base+['-c',sql],capture_output=True,text=True);assert r.returncode==0,r.stderr
 return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ''
def auth(sql):return "set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);"+sql
def opening(request,sku,location):return auth("select commit_inventory_import('%s','opening','%s',true);"%(request,json.dumps([dict(sku=sku,location=location,quantity='5',reason='Concurrent opening',notes='')]).replace("'","''")))
run("insert into locations(id,name,description) values('88888888-8888-8888-8888-888888888889','CSV concurrent','Test');")
run(auth("select create_item('Concurrent import A','CSV-RACE-A','Test','units',0,1,null,'');select create_item('Concurrent import B','CSV-RACE-B','Test','units',0,1,null,'');"))
# An uncertain same-key retry must return the original batch, even while its first request is committing.
processes=[subprocess.Popen(base+['-c',opening('88888888-8888-8888-8888-888888888883','CSV-RACE-A','CSV concurrent')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
for p in processes:
 out,err=p.communicate();assert p.returncode==0,err
assert run("select quantity from items where sku='CSV-RACE-A'")=='5'
assert run("select count(*) from movements where item_id=(select id from items where sku='CSV-RACE-A')")=='1'
# Different request IDs for the same opening condition cannot both add stock.
processes=[subprocess.Popen(base+['-c',opening(key,'CSV-RACE-B','CSV concurrent')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for key in ['88888888-8888-8888-8888-888888888884','88888888-8888-8888-8888-888888888885']]
results=[]
for p in processes:
 out,err=p.communicate();results.append((p.returncode,err))
assert sum(code==0 for code,err in results)==1,results
assert all(code==0 or 'Import validation failed' in err for code,err in results),results
assert run("select quantity from items where sku='CSV-RACE-B'")=='5'
assert run("select count(*) from movements where item_id=(select id from items where sku='CSV-RACE-B')")=='1'
# A failure in a later ledger insert rolls back earlier stock and the entire import record.
run(auth("select create_item('Atomic import A','CSV-ATOMIC-A','Test','units',0,1,null,'');select create_item('Atomic import B','CSV-ATOMIC-B','Test','units',0,1,null,'');"))
run("create function public.fail_csv_ledger() returns trigger language plpgsql as $$ begin if new.item_id=(select id from public.items where sku='CSV-ATOMIC-B') then raise exception 'Forced CSV ledger failure';end if;return new;end $$;create trigger fail_csv_ledger before insert on movements for each row execute function fail_csv_ledger();")
rows=json.dumps([dict(sku=sku,location='CSV concurrent',quantity='3',reason='Atomic import',notes='') for sku in ['CSV-ATOMIC-A','CSV-ATOMIC-B']])
r=subprocess.run(base+['-c',auth("select commit_inventory_import('88888888-8888-8888-8888-888888888886','opening','%s',true);"%rows)],capture_output=True,text=True)
assert r.returncode!=0 and 'Forced CSV ledger failure' in r.stderr,r.stderr
assert run("select sum(quantity) from items where sku in ('CSV-ATOMIC-A','CSV-ATOMIC-B')")=='0'
assert run("select count(*) from movements where item_id in (select id from items where sku in ('CSV-ATOMIC-A','CSV-ATOMIC-B'))")=='0'
assert run("select count(*) from inventory_imports where id='88888888-8888-8888-8888-888888888886'")=='0'
run('drop trigger fail_csv_ledger on movements;drop function fail_csv_ledger();')
print('PASS: concurrent identical imports post once, different-key duplicate openings are rejected, and later ledger failure rolls back the entire file')
