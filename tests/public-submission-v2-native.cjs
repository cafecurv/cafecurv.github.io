// Genuine independent PostgreSQL sessions in a NEW loopback-only cluster.
// No existing server/environment credentials are used. No downloads.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {Client}=require('pg');
const {nativeBaseline}=require('./public-submission-foundation-fixture.cjs');
const {seedPricingCatalog,certify,id,line,readSql,engine,preview,backend,payload,query,reviewed,submit}=require('./public-submission-v2-fixture.cjs');
const bin=process.env.CURV_TEST_PG_BIN;if(!bin)throw Error('CURV_TEST_PG_BIN must identify a disposable PostgreSQL runtime');
const exe=n=>path.join(bin,n+(process.platform==='win32'?'.exe':'')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const workspace=fs.mkdtempSync(path.join(process.env.CURV_TEST_TMPDIR||os.tmpdir(),'curv-d0b5-'));
const report={workspace,tests:[],errors:[]};let server,log,owner,A,B,C,n=0,key=95000;const clients=[];
const check=(v,m)=>{assert.ok(v,m);n++;};
const run=(name,args)=>{const r=spawnSync(exe(name),args,{encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error(name+' failed: '+(r.stderr||r.error||r.stdout));};
const begin=c=>c.query("begin;set local statement_timeout='8s';set local role anon");
const q=(s,p=[])=>query(owner,s,p);
const evidence=async(name,keys)=>report.tests.push({name,status:'PASS',orders:await q('select id,order_number,public_submission_key,customer_id,customer_name,subtotal,total,submission_fingerprint_version,accepted_review_fingerprint from orders where public_submission_key=any($1::uuid[]) order by order_number',[keys]),items:await q('select i.order_id,i.product_name,i.quantity,i.unit_price,i.line_total,i.pricing_configuration_snapshot from order_items i join orders o on o.id=i.order_id where o.public_submission_key=any($1::uuid[]) order by i.order_id,i.sort_order',[keys]),customerWrites:await q('select * from d0b5_test.customer_writes')});
async function waitFor(pid,holder,advisory=false){for(let j=0;j<140;j++){
 const row=(await q('select state,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[pid]))[0];
 if(row?.blockers.includes(holder)||(advisory&&row?.state==='active'&&row.wait_event==='PgSleep'))return row;
 await pause(5);
}throw Error('Expected overlap not observed');}
(async()=>{try{
 const data=path.join(workspace,'data');run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);const port=await freePort();
 report.environment={host:'127.0.0.1',port,database:'postgres',disposable:true};log=fs.openSync(path.join(workspace,'server.log'),'a');
 server=spawn(exe('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','max_connections=12','-c','shared_buffers=32MB'],{windowsHide:true,stdio:['ignore',log,log]});
 const connect=async name=>{const c=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',application_name:name,connectionTimeoutMillis:1000});try{await c.connect();clients.push(c);return c;}catch(e){await c.end().catch(()=>{});throw e;}};
 for(let j=0;j<100;j++){try{owner=await connect('D0B5 observer');break;}catch(e){if(j===99)throw e;await pause(100);}}
 report.environment.version=(await q('select version() v'))[0].v;
 await nativeBaseline(owner);for(const sql of [engine])await owner.query(readSql(sql));await seedPricingCatalog(owner);for(const sql of [preview,backend])await owner.query(readSql(sql));
 await owner.query(`create schema d0b5_test;create table d0b5_test.customer_writes(action text,customer_id uuid);
 create function d0b5_test.audit_customer() returns trigger language plpgsql set search_path=pg_catalog as $$begin insert into d0b5_test.customer_writes values(TG_OP,new.id);return new;end$$;
 create trigger d0b5_test_audit after insert or update on customers for each row execute function d0b5_test.audit_customer();`);
 A=await connect('D0B5 session A');B=await connect('D0B5 session B');C=await connect('D0B5 session C');
 const pid=async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid;const pids={A:await pid(A),B:await pid(B),C:await pid(C)};report.sessions=pids;check(new Set(Object.values(pids)).size===3,'independent backends');
 const fresh=async(extra={})=>reviewed(owner,payload(key++,[line()],extra));
 // Same key, forged money ignored, unrelated key C commits while A holds lock.
 const same=await fresh({customer_phone:'09171234567'});await begin(A);const a=await submit(A,same);check(!!a.order_number,'A succeeds');await begin(B);
 const pending=submit(B,{...same,total:0,items:[{...same.items[0],unit_price:0,product_name:'Forged'}]});pending.catch(()=>{});await waitFor(pids.B,pids.A,true);check(true,'overlap observed');
 const unrelated=await fresh();await begin(C);const c=await submit(C,unrelated);await C.query('commit');check(!!c.order_number,'unrelated key completes while A/B overlap');await A.query('commit');const b=await pending;await B.query('commit');check(JSON.stringify(a)===JSON.stringify(b),'same result');
 check((await q('select count(*)::int n from orders where public_submission_key=$1',[same.submission_key]))[0].n===1,'one order');check((await q('select count(*)::int n from order_items i join orders o on o.id=i.order_id where public_submission_key=$1',[same.submission_key]))[0].n===1,'one item set');
 check((await q('select count(*)::int n from d0b5_test.customer_writes'))[0].n===1,'exactly one C1B maintenance');check(Number((await q('select total from orders where public_submission_key=$1',[same.submission_key]))[0].total)===10.1,'authoritative money');await evidence('same key + forged money + unrelated keys',[same.submission_key,unrelated.submission_key]);
 const different=await fresh();await begin(A);const da=await submit(A,different);await begin(B);const conflict=submit(B,{...different,customer_name:'Different intent'});conflict.catch(()=>{});await waitFor(pids.B,pids.A,true);await A.query('commit');const db=await conflict;await B.query('commit');check(db.error?.code==='ORDER_SUBMISSION_KEY_CONFLICT','different intent conflict');check(!!da.order_number,'one winner');await evidence('same key different intent',[different.submission_key]);
 // Rollback releases the lock and all writes; the waiting peer can create.
 const rolled=await fresh({customer_phone:'09173333333'});await begin(A);const ra=await submit(A,rolled);await begin(B);const retry=submit(B,rolled);retry.catch(()=>{});await waitFor(pids.B,pids.A,true);await A.query('rollback');const rb=await retry;await B.query('commit');check(!!rb.order_number&&ra.order_number!==rb.order_number,'rollback peer succeeds with sequence gap');check((await q('select count(*)::int n from orders where public_submission_key=$1',[rolled.submission_key]))[0].n===1,'rolled-back order absent');await evidence('rollback and retry',[rolled.submission_key]);
 // PRICE_CHANGED holds the key only until transaction completion; no allocation.
 const changed=await fresh();const seq=(await q('select last_value from order_number_seq'))[0].last_value;
 await owner.query('update product_sizes set price=12.10 where id=$1',[id(1100)]);await certify(owner,1000);
 await begin(A);const pc=await submit(A,changed);check(pc.error?.code==='PRICE_CHANGED','changed review rejected');check((await q('select last_value from order_number_seq'))[0].last_value===seq,'no number consumed');await begin(B);const retryReview=submit(B,{...changed,review_fingerprint:pc.quote.review_fingerprint});retryReview.catch(()=>{});await waitFor(pids.B,pids.A,true);await A.query('commit');const accepted=await retryReview;await B.query('commit');check(!!accepted.order_number,'explicitly reviewed same-key retry');await evidence('PRICE_CHANGED then reviewed retry',[changed.submission_key]);
 // Non-cooperating legacy writer: v2 misses its uncommitted row, then its final
 // key attachment waits on the REAL unique index. Matching stored v1 dispatch
 // returns winner; mismatch rolls back the whole attempted v2 order.
 for(const mismatch of [false,true]){
  const raw=await fresh();raw.subtotal=12.10;raw.total=12.10;raw.items=[{...line(),product_name:'Simple sushi',unit_price:12.10,line_total:12.10}];
  await begin(A);const legacy=(await A.query('select public.submit_public_order($1) v',[JSON.stringify({...raw,customer_name:mismatch?'Other winner':raw.customer_name})])).rows[0].v;
  await begin(B);const contender=submit(B,raw);contender.catch(()=>{});const wait=await waitFor(pids.B,pids.A);check(wait.blockers.includes(pids.A),'real unique-index overlap');await A.query('commit');const winner=await contender;await B.query('commit');
  check(mismatch?winner.error?.code==='ORDER_SUBMISSION_KEY_CONFLICT':JSON.stringify(winner)===JSON.stringify(legacy),'named unique backstop stored-version dispatch');
  check((await q('select count(*)::int n from orders where public_submission_key=$1',[raw.submission_key]))[0].n===1,'one legacy winner');
  check((await q('select count(*)::int n from orders where public_submission_key is null'))[0].n===0,'no orphan internal order');await evidence('unique backstop '+(mismatch?'conflict':'matching legacy replay'),[raw.submission_key]);
 }
 // Test-only statement gate around the real stable engine. It creates a real
 // old MVCC snapshot before another backend commits price + certification.
 await owner.query(`alter function configuration_private.price_order_configuration(jsonb) rename to d0b5_test_engine;
 create function configuration_private.price_order_configuration(p_items jsonb) returns jsonb language sql stable set search_path=pg_catalog as $$
 with gate as materialized(select pg_advisory_xact_lock(78555001)) select configuration_private.d0b5_test_engine(p_items) from gate$$;
 revoke all on function configuration_private.price_order_configuration(jsonb) from public,anon,authenticated;`);
 const snapshot=await fresh();await A.query('begin;select pg_advisory_xact_lock(78555001)');await begin(B);const reading=submit(B,snapshot);reading.catch(()=>{});await waitFor(pids.B,pids.A);
 await A.query('update product_sizes set price=22.10 where id=$1',[id(1100)]);await certify(A,1000);await A.query('commit');const saved=await reading;await B.query('commit');check(!!saved.order_number,'coherent in-flight reviewed snapshot accepted');check(Number((await q('select subtotal from orders where order_number=$1',[saved.order_number]))[0].subtotal)===12.10,'no mixed snapshot');
 const next=await submit(owner,{...snapshot,submission_key:id(key++)});check(next.error?.code==='PRICE_CHANGED'&&next.quote.subtotal==='22.10','next statement enforces new review');await evidence('concurrent catalog change',[snapshot.submission_key]);
 await owner.query('drop function configuration_private.price_order_configuration(jsonb);alter function configuration_private.d0b5_test_engine(jsonb) rename to price_order_configuration');
 // Actual elapsed-time replay: scheduled two seconds ahead, first success then
 // wait past it. Skip no rule; fail explicitly in the final seconds of Manila day.
 const scheduledAt=new Date(Date.now()+2000);const nowManila=new Date(Date.now()+8*3600000),thenManila=new Date(scheduledAt.getTime()+8*3600000);
 if(nowManila.toISOString().slice(0,10)!==thenManila.toISOString().slice(0,10))throw Error('Run elapsed-time fixture away from Manila midnight');
 const timed=await fresh({preparation_timing:'scheduled',requested_preparation_at:scheduledAt.toISOString()});const tr=await submit(owner,timed);check(!!tr.order_number,'scheduled before deadline');await pause(2100);check(JSON.stringify(await submit(owner,timed))===JSON.stringify(tr),'real elapsed-time replay');await evidence('replay after actual scheduled time',[timed.submission_key]);
 report.status='FULL PASS';report.assertions=n;console.log(n+' native D0B5 concurrency assertions passed across '+report.tests.length+' scenarios.');
}catch(e){report.status='FAIL';report.errors.push({message:e.message,code:e.code,detail:e.detail});console.error(e);process.exitCode=1;}
finally{await Promise.allSettled(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));
 if(server){try{run('pg_ctl',['-D',path.join(workspace,'data'),'-m','fast','-w','stop']);}catch(e){report.shutdownError=e.message;server.kill();process.exitCode=1;}}
 if(log!==undefined)fs.closeSync(log);fs.writeFileSync(path.join(workspace,'results.json'),JSON.stringify(report,null,2));console.log('Evidence: '+path.join(workspace,'results.json'));
}})();
