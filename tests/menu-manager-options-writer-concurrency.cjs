// NEW disposable loopback cluster only. Never reads production connection env.
// Two persistent psql processes hold genuinely overlapping transactions.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {nativeBaseline}=require('./public-submission-foundation-fixture.cjs');
const {seedPricingCatalog}=require('./public-pricing-engine-fixture.cjs');
const {install,id,request}=require('./menu-manager-product-save-fixture.cjs');
const bin=process.env.CURV_TEST_PG_BIN;if(!bin)throw Error('Set CURV_TEST_PG_BIN to local PostgreSQL binaries.');
const exe=n=>path.join(bin,n+(process.platform==='win32'?'.exe':''));
const work=fs.mkdtempSync(path.join(os.tmpdir(),'curv-product-save-')),data=path.join(work,'data');
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
 A=session('MM editor A');B=session('MM editor B');
 const read=`select public.menu_manager_get_product_editor('${id(1001)}');\n`;
 A.stdin.write(read);B.stdin.write(read);await until(()=>A.output.includes('"version"')&&B.output.includes('"version"'));
 const editor=p=>JSON.parse(p.output.split(/\r?\n/).find(l=>l.startsWith('{')));
 const ea=editor(A),eb=editor(B);check(ea.version===eb.version,'independent sessions loaded same version');
 const ra=request(ea,9800),rb=request(eb,9801);ra.options=ea.options;rb.options=eb.options;ra.options.find(g=>g.option_group_id===id(2000)).choices.find(c=>c.option_choice_id===id(3001)).product_price_delta=21;rb.options.find(g=>g.option_group_id===id(2000)).choices.find(c=>c.option_choice_id===id(3001)).product_price_delta=22;
 A.stdin.write(`begin;select public.menu_manager_save_product(${quote(ra)}::jsonb);\n`);
 await until(()=>A.output.includes('"ok": true'));check(true,'A saved while transaction remains open');
 B.stdin.write(`begin;select public.menu_manager_save_product(${quote(rb)}::jsonb);\n`);
 await until(()=>query("select count(*) from pg_stat_activity where application_name='MM editor B' and wait_event_type='Lock';")==='1');
 check(true,'B overlaps A and waits on actual PostgreSQL lock');
 A.stdin.write('commit;\n');await until(()=>A.output.includes('COMMIT'));await until(()=>B.errors.includes('changed in another session'));
 check(B.errors.includes('changed in another session'),'second stale editor rejected');
 check(query(`select configuration_private.choice_delta('${id(1001)}','${id(1101)}','${id(3001)}');`)==='21','no lost update');
 check(query(`select count(*) from menu_save_private.requests;`)==='1','only winner recorded');
 query(`select configuration_private.assert_pricing_ready('${id(1001)}');`);check(true,'winner ready');
 // A fresh independent connection replays the exact request without a new write.
 const replay=query(`select set_config('request.jwt.claim.sub','${id(1)}',false);set role authenticated;select public.menu_manager_save_product(${quote(ra)}::jsonb);`);
 check(replay.includes('"ok": true'),'retry resolves committed save');
 check(query('select count(*) from menu_save_private.requests;')==='1','replay no duplicate operation');
 // Two overlapping callers with the same request must resolve to one committed operation.
 A.output='';A.stdin.write(read);await until(()=>A.output.includes('"version"'));
 const same=request(editor(A),9802);same.options=editor(A).options;
 same.options.find(g=>g.option_group_id===id(2000)).choices.find(c=>c.option_choice_id===id(3001)).product_price_delta=23;
 B=session('MM replay B');A.output='';
 A.stdin.write('begin;select public.menu_manager_save_product('+quote(same)+'::jsonb);\n');
 await until(()=>A.output.includes('"ok": true'));
 B.stdin.write('begin;select public.menu_manager_save_product('+quote(same)+'::jsonb);\n');
 await until(()=>query("select count(*) from pg_stat_activity where application_name='MM replay B' and wait_event_type='Lock';")==='1');
 check(true,'same-key calls overlap on actual lock');A.stdin.write('commit;\n');
 await until(()=>B.output.includes('"ok": true'));B.stdin.write('commit;\n');await until(()=>B.output.includes('COMMIT'));
 check(JSON.stringify(editor(A))===JSON.stringify(editor(B)),'overlapping identical requests return same result');
 check(query('select count(*) from menu_save_private.requests;')==='2','one additional ledger entry for both callers');
 check(query("select configuration_private.choice_delta('"+id(1001)+"','"+id(1101)+"','"+id(3001)+"');")==='23','same-key winner price preserved');
 let conflict=false;try{query("select set_config('request.jwt.claim.sub','"+id(1)+"',false);set role authenticated;select public.menu_manager_save_product("+quote({...same,product:{...same.product,name:'Changed replay'}})+"::jsonb);");}catch(e){conflict=e.message.includes('save request changed');}
 check(conflict,'changed payload with committed request key rejected');
 console.log('Phase 3B native PostgreSQL concurrency: '+count+' assertions passed (two independent overlapping sessions)');
}finally{
 for(const p of [A,B])if(p){p.stdin.end('rollback;\n\\q\n');}
 if(server){run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
 if(log!==undefined)fs.closeSync(log);
 console.log('Disposable evidence: '+work);
}})().catch(e=>{console.error(e);process.exitCode=1;});
