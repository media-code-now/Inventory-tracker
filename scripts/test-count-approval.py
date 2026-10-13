import subprocess,sys
host,port=sys.argv[1:];base=['psql','-h',host,'-p',port,'-d','postgres','-v','ON_ERROR_STOP=1','-At']
def run(sql):
 r=subprocess.run(base+['-c',sql],capture_output=True,text=True)
 assert r.returncode==0,r.stderr
 return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ''
def auth(sql,actor='00000000-0000-0000-0000-000000000001'):
 return "set role authenticated;select set_config('request.jwt.claim.sub','%s',false);"%actor+sql
count='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';item='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';location='99999999-9999-9999-9999-999999999991'
run("update members set role='admin' where id='00000000-0000-0000-0000-000000000006';")
run(auth("select create_stock_count('%s','%s','Concurrent approval');select start_stock_count('%s');"%(count,location,count)))
# A new location item after the initial snapshot is explicitly rejected until added for recount.
run(auth("select create_item('New count item','COUNT-NEW','Test','units',0,0,'%s','',p_id=>'%s');select post_movement(gen_random_uuid(),'%s','add',4,null,'%s','New item after snapshot');"%(location,item,item,location)))
run(auth("do $$ declare l public.stock_count_lines%%rowtype;begin for l in select * from stock_count_lines where count_id='%s' loop perform save_counted_quantity(l.id,l.baseline_quantity,l.entry_version,'Counted');end loop;end $$;select submit_stock_count('%s');"%(count,count)))
r=subprocess.run(base+['-c',auth("select approve_stock_count('%s','Missing item approval');"%count)],capture_output=True,text=True)
assert r.returncode!=0 and 'New items appeared' in r.stderr,r.stderr
run(auth("select refresh_count_snapshot('%s','%s','New item requires a count');"%(count,item)))
run(auth("do $$ declare l public.stock_count_lines%%rowtype;begin select * into l from stock_count_lines where count_id='%s' and item_id='%s';perform save_counted_quantity(l.id,3,l.entry_version,'Physically counted');end $$;select submit_stock_count('%s');"%(count,item,count)))
run("create function public.test_count_failure() returns trigger language plpgsql as $$ begin if new.item_id='%s' and new.kind='adjust' then raise exception 'Forced count approval failure';end if;return new;end $$;create trigger test_count_failure before insert on movements for each row execute function public.test_count_failure();"%item)
r=subprocess.run(base+['-c',auth("select approve_stock_count('%s','Atomic failure test');"%count)],capture_output=True,text=True)
assert r.returncode!=0 and 'Forced count approval failure' in r.stderr,r.stderr
assert run("select state from stock_counts where id='%s'"%count)=='awaiting_approval'
assert run("select count(*) from stock_count_lines where count_id='%s' and adjustment_id is not null"%count)=='0'
assert run("select quantity from items where id='%s'"%item)=='4'
run('drop trigger test_count_failure on movements;drop function test_count_failure();')
# Two independently authenticated admin connections race the same approval.
processes=[]
for actor in ['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006']:
 processes.append(subprocess.Popen(base+['-c',auth("select approve_stock_count('%s','Concurrent verified approval');"%count,actor)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
for p in processes:
 out,err=p.communicate();assert p.returncode==0,err
assert run("select state from stock_counts where id='%s'"%count)=='completed'
assert run("select quantity from items where id='%s'"%item)=='3'
assert run("select count(*) from stock_count_lines where count_id='%s' and adjustment_id is not null"%count)=='2'
assert run("select count(*) from movements where notes like 'Count %s;%%'"%count)=='2'
print('PASS: new location items require recount, multi-item approval rollback is atomic, and two concurrent admins post one adjustment batch')
