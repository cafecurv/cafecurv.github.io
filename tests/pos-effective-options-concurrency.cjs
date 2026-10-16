// NEW disposable loopback cluster only. Never reads production connection env.
// Two persistent psql processes hold genuinely overlapping transactions.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {nativeBaseline}=require('./public-submission-foundation-fixture.cjs');
const {seedPricingCatalog}=require('./public-pricing-engine-fixture.cjs');
const {install,id,request}=require('./menu-manager-product-save-fixture.cjs');
const bin=process.env.CURV_TEST_PG_BIN;if(!bin)throw Error('Set CURV_TEST_PG_BIN to local PostgreSQL binaries.');
const exe=n=>path.join(bin,n+(process.platform==='win32'?'.exe':''));
const work=fs.mkdtempSync(path.join(os.tmpdir(),'curv-pos-effective-')),data=path.join(work,'data');
const pause=ms=>new Promise(r=>setTimeout(r,ms));const quote=v=>"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
let port,server,log,A,B,count=0;
const run=(n,args,input)=>{const r=spawnSync(exe(n),args,{input,encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error(n+': '+r.stderr);return r.stdout.trim();};
const args=()=>['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'];
const query=(sql,params=[])=>{for(let i=params.length;i;i--)sql=sql.replaceAll('$'+i,params[i-1]===null?'NULL':quote(params[i-1]));return run('psql',args(),sql);};
const session=name=>{const p=spawn(exe('psql'),args(),{windowsHide:true,stdio:['pipe','pipe','pipe']});p.output='';p.errors='';p.stdin.on('error',()=>{});p.stdout.on('data',d=>p.output+=d);p.stderr.on('data',d=>p.errors+=d);p.stdin.write(`set application_name='${name}';select set_config('request.jwt.claim.sub','${id(1)}',false);set role authenticated;\n`);return p;};
const until=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await pause(10);}throw Error('Timed out waiting for independent session evidence');};
const check=(v,m)=>{assert.ok(v,m);count++;};
(async()=>{try{
 run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
 port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 log=fs.openSync(path.join(work,'server.log'),'a');server=spawn(exe('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port)],{windowsHide:true,stdio:['ignore',log,log]});
 for(let i=0;i<60;i++){try{query('select 1;');break;}catch(e){if(i===59)throw e;await pause(100);}}
 const db={query:async(s,p)=>query(s,p)};await nativeBaseline(db);
 query(`insert into auth.users values('${id(1)}');insert into admin_profiles(id,full_name) values('${id(1)}','Fixture Owner');`);
 query(require('./menu-manager-product-save-fixture.cjs').readSql('WEBSITE_PRICING_D0B3_ENGINE.sql'));await seedPricingCatalog(db);for(const f of ['WEBSITE_PRICING_D0B4_PREVIEW.sql','WEBSITE_SUBMISSION_D0B5_BACKEND.sql'])query(require('./menu-manager-product-save-fixture.cjs').readSql(f));await install(db);await require('./menu-manager-options-writer-fixture.cjs').install({exec:async s=>query(s)});

 const readSql=require('./menu-manager-product-save-fixture.cjs').readSql;
 for(const f of ['TIMEKEEPING_PHASE_T1_BACKEND.sql','POS_PHASE_P1A_SCHEMA.sql','POS_PHASE_P1A_BACKEND.sql','POS_PHASE_P1B_SCHEMA.sql','POS_PHASE_P1B_BACKEND.sql','POS_PHASE_P1C_BACKEND.sql'])query(readSql(f));
 const migration=readSql('POS_EFFECTIVE_OPTIONS_PHASE_P3.sql');
 const installed=query(migration.replace(/commit;\s*$/i,"select 'ORDER_LOCKS='||count(*) from pg_locks where pid=pg_backend_pid() and relation in ('public.orders'::regclass,'public.order_items'::regclass);commit;"));
 check(installed.includes('ORDER_LOCKS=0'),'migration takes no order table locks');check(installed.endsWith('COMMIT'),'native migration commits');
 const owner=sql=>query("select set_config('request.jwt.claim.sub','"+id(1)+"',false);set role authenticated;"+sql);
 const editor=()=>JSON.parse(owner("select public.menu_manager_get_product_editor('"+id(1001)+"');").split(/\r?\n/).find(l=>l.startsWith('{')));
 const save=(price,key)=>{const e=editor(),r=request(e,key);r.options=e.options;r.options.find(g=>g.option_group_id===id(2000)).choices.find(c=>c.option_choice_id===id(3001)).product_price_delta=price;return 'select public.menu_manager_save_product('+quote(r)+'::jsonb);';};
 const create=key=>"select public.pos_create_order('"+id(key)+"','"+id(1101)+"',array['"+id(3010)+"','"+id(3001)+"']::uuid[],1,'','Concurrency','dine_in','');";
 const json=p=>JSON.parse(p.output.split(/\r?\n/).find(l=>l.startsWith('{')));
 A=session('POS acceptance A');B=session('POS acceptance B');await until(()=>A.output.includes(id(1))&&B.output.includes(id(1)));A.output='';B.output='';
 A.stdin.write('begin;'+save(21,9810)+'\n');await until(()=>A.output.includes('"ok": true'));
 B.stdin.write('begin;'+create(9820)+'\n');await until(()=>query("select count(*) from pg_stat_activity where application_name='POS acceptance B' and wait_event_type='Lock'")==='1');check(true,'POS overlaps actual writer and waits');
 const read=JSON.parse(owner('select public.pos_get_catalog();').split(/\r?\n/).find(l=>l.startsWith('{')));
 check(read.products.find(p=>p.id===id(1001)).groups.find(g=>g.id===id(2000)).choices.find(c=>c.id===id(3001)).price_by_size[id(1101)]===25,'concurrent read sees committed old price');
 A.stdin.write('commit;\n');await until(()=>B.output.includes('"order_number"'));check(Number(json(B).total)===121,'waiting POS uses committed new price without mixed total');B.stdin.write('commit;\n');await until(()=>B.output.includes('COMMIT'));
 // Reverse lock order: POS holds catalog SHARE; owner save waits.
 const nextSave=save(22,9811);A.output='';B.output='';A.stdin.write('begin;'+create(9821)+'\n');await until(()=>A.output.includes('"order_number"'));check(Number(json(A).total)===121,'POS snapshot starts at committed charge');
 B.stdin.write('begin;'+nextSave+'\n');await until(()=>query("select count(*) from pg_stat_activity where application_name='POS acceptance B' and wait_event_type='Lock'")==='1');check(true,'writer overlaps POS and waits');A.stdin.write('commit;\n');await until(()=>B.output.includes('"ok": true'));B.stdin.write('commit;\n');await until(()=>B.output.includes('COMMIT'));check(query("select configuration_private.effective_choice_price('"+id(1001)+"','"+id(1101)+"','"+id(3001)+"')")==='22','writer progresses after POS without deadlock');
 check(query("select count(*) from orders where source='pos' and total=121")==='2','both persisted POS snapshots retain old price');
 // Controlled timeout aborts POS transaction and leaves no partial order.
 A.output='';B.output='';A.stdin.write('begin;'+save(23,9812)+'\n');await until(()=>A.output.includes('"ok": true'));
 const before=query('select count(*) from orders');B.stdin.write('\\set VERBOSITY verbose\nbegin;set local lock_timeout=\'100ms\';'+create(9822)+'\n');await until(()=>B.errors.includes('55P03'));check(B.errors.includes('lock timeout'),'controlled lock timeout SQLSTATE 55P03');check(query('select count(*) from orders')===before,'timeout creates no partial order');
 A.stdin.write('rollback;\n');await until(()=>A.output.includes('ROLLBACK'));check(query("select configuration_private.effective_choice_price('"+id(1001)+"','"+id(1101)+"','"+id(3001)+"')")==='22','rolled-back writer does not leak price');
 check(!A.errors.includes('deadlock')&&!B.errors.includes('deadlock'),'no deadlock in either lock direction');
 console.log('POS effective native PostgreSQL concurrency: '+count+' assertions passed (independent overlapping sessions)');
}finally{
 for(const p of [A,B])if(p){p.stdin.end('rollback;\n\\q\n');}
 if(server){run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
 if(log!==undefined)fs.closeSync(log);console.log('Disposable evidence: '+work);
}})().catch(e=>{console.error(e);process.exitCode=1;});
