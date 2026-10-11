// Starts a NEW disposable loopback-only PostgreSQL cluster. Never uses PGHOST,
// DATABASE_URL, existing clusters or production credentials. No dependencies downloaded.
// Requires CURV_TEST_PG_BIN (directory with initdb/postgres/pg_ctl) and node-postgres.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Client}=require('pg');
const {nativeBaseline}=require('./public-submission-foundation-fixture.cjs');
const {seedPricingCatalog,certify,id,line,readSql,engine}=require('./public-pricing-engine-fixture.cjs');
const bin=process.env.CURV_TEST_PG_BIN;
if(!bin)throw Error('Set CURV_TEST_PG_BIN to an installed disposable PostgreSQL runtime. This test does not connect to an existing server.');
const exe=n=>path.join(bin,n+(process.platform==='win32'?'.exe':''));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const workspace=fs.mkdtempSync(path.join(process.env.CURV_TEST_TMPDIR||os.tmpdir(),'curv-d0b3-'));
const report={workspace,tests:[],errors:[]};let server,log,owner,A,B,C,checks=0;const clients=[];
const check=(v,m)=>{assert.ok(v,m);checks++;};
const run=(name,args)=>{const r=spawnSync(exe(name),args,{encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error(name+' failed: '+(r.stderr||r.error||r.stdout));};
(async()=>{try{
 const data=path.join(workspace,'data');run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
 const port=await freePort();report.environment={host:'127.0.0.1',port,database:'postgres',disposable:true};
 log=fs.openSync(path.join(workspace,'server.log'),'a');
 server=spawn(exe('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','max_connections=12','-c','shared_buffers=32MB'],{windowsHide:true,stdio:['ignore',log,log]});
 const connect=async name=>{const c=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',application_name:name,connectionTimeoutMillis:1000});try{await c.connect();clients.push(c);return c;}catch(e){await c.end().catch(()=>{});throw e;}};
 for(let i=0;i<100;i++){try{owner=await connect('D0B3 observer');break;}catch(e){if(i===99)throw e;await pause(100);}}
 report.environment.version=(await owner.query('select version() v')).rows[0].v;
 await nativeBaseline(owner);await owner.query(readSql(engine));await seedPricingCatalog(owner);
 A=await connect('D0B3 catalog writer');B=await connect('D0B3 pricing reader');
 const pid=async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid;
 const pids={A:await pid(A),B:await pid(B)};check(pids.A!==pids.B,'independent native backends');report.sessions=pids;
 const cart=[line(1001,1101,[3001,3010])];
 const priced=async(c,items)=>(await c.query('select configuration_private.price_order_configuration($1::jsonb) result',[JSON.stringify(items)])).rows[0].result;
 const original=await priced(owner,cart);check(original.subtotal==='125.00','initial authoritative price');
 await A.query('begin;select pg_advisory_xact_lock(78301933)');await B.query('begin');
 const pending=B.query('with gate as materialized (select pg_advisory_xact_lock(78301933)) select configuration_private.price_order_configuration($1::jsonb) result from gate',[JSON.stringify(cart)]);pending.catch(()=>{});
 let evidence;for(let attempt=0;attempt<100;attempt++){
  const row=(await owner.query('select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[pids.B])).rows[0];
  if(row?.blockers.includes(pids.A)){evidence=row;break;}await pause(10);
 }
 check(!!evidence,'reader statement snapshot established before catalog mutation');
 await A.query('update product_sizes set price=200 where id=$1',[id(1101)]);
 await A.query('update option_choices set price_delta=50 where id=$1',[id(3001)]);
 await certify({query:(...args)=>A.query(...args)},1001);await A.query('commit');
 const snapshotResult=(await pending).rows[0].result;await B.query('commit');
 check(snapshotResult.subtotal==='125.00','in-flight read contains only pre-update catalog and certification');
 const latest=await priced(B,cart);check(latest.subtotal==='250.00','next statement sees coherent committed catalog');
 report.tests.push({name:'statement snapshot cannot mix old/new catalog',status:'PASS',evidence,oldSubtotal:original.subtotal,inFlightSubtotal:snapshotResult.subtotal,newSubtotal:latest.subtotal});
 // A larger unrelated catalog makes broad base-table scans visible in plans.
 await owner.query(`insert into products(id,category_id,name) select md5('d0b3background'||n)::uuid,'${id(999)}','Background '||n from generate_series(1,20000) n;
 insert into product_sizes(id,product_id,label,price) select md5('d0b3size'||n)::uuid,md5('d0b3background'||n)::uuid,'Each',10 from generate_series(1,20000) n;
 insert into product_option_groups(product_id,option_group_id) select md5('d0b3background'||n)::uuid,'${id(2002)}' from generate_series(1,20000) n;analyze;`);
 const body=readSql(engine).match(/-- PRICING_QUERY_BEGIN:[^\n]*\n([\s\S]*?)-- PRICING_QUERY_END/)[1]
  .replace(' into failure,result from error;',' from error;').replaceAll('p_items','$1::jsonb');
 const moderate=Array.from({length:30},(_,i)=>line(1001,1101,[3000,3010,3020,3021,3022,3023,3024,3025,3026,3027],1,'Distinct note '+i));
 const distinctRows=(await owner.query("select md5('d0b3background'||n)::uuid product_id,md5('d0b3size'||n)::uuid product_size_id from generate_series(1,30) n")).rows;
 await owner.query('update products set is_published=true where id=any($1::uuid[])',[distinctRows.map(row=>row.product_id)]);
 for(const row of distinctRows)await owner.query('select configuration_private.certify_product($1,configuration_private.catalog_structure($1),$2)',[row.product_id,'Reviewed synthetic performance product']);
 const distinct=distinctRows.map(row=>({...line(),...row,option_choice_ids:[3020,3021,3022,3023,3024,3025,3026,3027].map(id)}));
 const plans=[];
 for(const [name,items] of [['small',cart],['moderate',moderate],['distinct-products',distinct]]){
  const t=Date.now();const expected=await priced(owner,items);const explain=(await owner.query('explain(analyze,buffers,format json) '+body,[JSON.stringify(items)])).rows[0]['QUERY PLAN'][0];
  const indexes=[],scans=[];const walk=node=>{if(node['Index Name'])indexes.push(node['Index Name']);if(node['Relation Name'])scans.push({relation:node['Relation Name'],type:node['Node Type'],rows:node['Actual Rows'],loops:node['Actual Loops']});for(const child of node.Plans||[])walk(child);};walk(explain.Plan);
  check(expected.items.length===items.length,name+' cart fully priced');check(explain['Execution Time']<5000,name+' local query bounded under five-second smoke ceiling');
  plans.push({name,cartLines:items.length,selectedChoices:items.reduce((a,l)=>a+l.option_choice_ids.length,0),subtotal:expected.subtotal,executionMs:explain['Execution Time'],planningMs:explain['Planning Time'],wallMs:Date.now()-t,indexes:[...new Set(indexes)],scans,plan:explain});
 }
 report.performance=plans;report.status='FULL PASS';report.assertions=checks;
 console.log(checks+' native D0B3 snapshot/performance assertions passed. '+plans.map(p=>p.name+': '+p.executionMs+'ms').join('; '));
}catch(e){report.status='FAIL';report.errors.push({message:e.message,code:e.code,detail:e.detail});console.error(e);process.exitCode=1;}
finally{
 await Promise.allSettled(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));
 if(server){try{run('pg_ctl',['-D',path.join(workspace,'data'),'-m','fast','-w','stop']);}catch(e){report.shutdownError=e.message;server.kill();process.exitCode=1;}}
 if(log!==undefined)fs.closeSync(log);fs.writeFileSync(path.join(workspace,'results.json'),JSON.stringify(report,null,2));console.log('Evidence: '+path.join(workspace,'results.json'));
}})();
