import subprocess,sys,uuid
host,port=sys.argv[1:]
base=['psql','-h',host,'-p',port,'-d','postgres','-v','ON_ERROR_STOP=1','-At']
def run(sql):
 r=subprocess.run(base+['-c',sql],capture_output=True,text=True)
 assert r.returncode==0,r.stderr
 return r.stdout.strip().splitlines()[-1]
item='77777777-7777-7777-7777-777777777777';location='22222222-2222-2222-2222-222222222221'
run("insert into members(id,name,role) values ('00000000-0000-0000-0000-000000000006','Second staff','staff');insert into items(id,name,sku,category,quantity) values ('%s','Concurrent item','CONCURRENT','Office supplies',1);insert into stock_balances values ('%s','%s',1);select 1;"%(item,item,location))
def command(actor,key,kind,amount,hold=False):
 return "begin;set role authenticated;select set_config('request.jwt.claim.sub','%s',true);select post_movement('%s','%s','%s',%d,%s,%s,'Concurrent test');%scommit;"%(actor,key,item,kind,amount,"'%s'"%location if kind=='remove' else 'null',"'%s'"%location if kind=='add' else 'null','select pg_sleep(0.5);' if hold else '')
# Two independent PostgreSQL connections contend for the final unit.
p1=subprocess.Popen(base+['-c',command('00000000-0000-0000-0000-000000000002',str(uuid.uuid4()),'remove',1,True)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
p2=subprocess.Popen(base+['-c',command('00000000-0000-0000-0000-000000000006',str(uuid.uuid4()),'remove',1,True)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
results=[(p.communicate(),p.returncode) for p in [p1,p2]]
assert sorted(r[1] for r in results)==[0,1],results
assert 'Not enough stock at source location' in next(r[0][1] for r in results if r[1]),results
assert run("select quantity from items where id='%s'"%item)=='0'
assert run("select count(*) from movements where item_id='%s'"%item)=='1'
# Concurrent retries using the same actor/key must commit one addition and one row.
key=str(uuid.uuid4());sql=command('00000000-0000-0000-0000-000000000002',key,'add',3,True)
processes=[subprocess.Popen(base+['-c',sql],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
for p in processes:
 out,err=p.communicate();assert p.returncode==0,err
assert run("select quantity from items where id='%s'"%item)=='3'
assert run("select count(*) from movements where request_id='%s'"%key)=='1'
print('PASS: two simultaneous staff issues cannot consume the same final unit; simultaneous identical retries post once')
