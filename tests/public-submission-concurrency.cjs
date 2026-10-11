// Starts a NEW disposable loopback-only PostgreSQL cluster. Never uses PGHOST,
// DATABASE_URL, existing clusters or production credentials. No dependencies downloaded.
// Requires CURV_TEST_PG_BIN (directory with initdb/postgres/pg_ctl) and node-postgres.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Client}=require('pg');
const {nativeBaseline,canonicalVector,vectorHash}=require('./public-submission-foundation-fixture.cjs');
const bin=process.env.CURV_TEST_PG_BIN;
if(!bin)throw Error('Set CURV_TEST_PG_BIN to an installed disposable PostgreSQL runtime. This test does not connect to an existing server.');
const exe=n=>path.join(bin,n+(process.platform==='win32'?'.exe':''));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const workspace=fs.mkdtempSync(path.join(process.env.CURV_TEST_TMPDIR||os.tmpdir(),'curv-d0b2-'));
const report={workspace,tests:[],errors:[]};let server,log,owner,A,B,C,checks=0;const clients=[];
const check=(v,m)=>{assert.ok(v,m);checks++;};
const run=(name,args)=>{const r=spawnSync(exe(name),args,{encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error(name+' failed: '+(r.stderr||r.error||r.stdout));};
const payload=()=>({pricing_contract_version:2,submission_key:randomUUID(),customer_name:'Concurrency guest',customer_phone:'',fulfillment_type:'dine_in',payment_method:'counter',preparation_timing:'asap',requested_preparation_at:null,
 subtotal:100,total:100,items:[{product_id:'00000000-0000-4000-8000-000000000030',product_size_id:'00000000-0000-4000-8000-000000000040',option_choice_ids:[],quantity:1,item_note:null,product_name:'Test-only legacy insertion',unit_price:100,line_total:100}]});
const begin=async c=>{await c.query("begin isolation level read committed;set local statement_timeout='5s';set local role anon");};
const call=async(c,p)=>(await c.query('select d0b2_test.submit($1::jsonb) r',[JSON.stringify({payload:p})])).rows[0].r;
const states=async key=>(await owner.query('select order_number,public_submission_key,submission_fingerprint_version,customer_name,customer_id from orders where public_submission_key=$1',[key])).rows;
async function observeWait(pid,holder){
 const deadline=Date.now()+800;
 while(Date.now()<deadline){
  const wait=(await owner.query("select pid,state,wait_event_type,wait_event from pg_stat_activity where pid=$1",[pid])).rows[0];
  const locks=(await owner.query("select pid,locktype,granted from pg_locks where pid=$1 and locktype='advisory'",[holder])).rows;
  if(wait?.state==='active'&&wait.wait_event==='PgSleep'&&locks.some(l=>l.granted))return {wait,holderLocks:locks};
  await pause(5);
 }
 throw Error('Did not observe independent waiting session while holder retained advisory transaction lock');
}
(async()=>{try{
 const data=path.join(workspace,'data');run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
 const port=await freePort();report.environment={host:'127.0.0.1',port,database:'postgres',disposable:true};
 log=fs.openSync(path.join(workspace,'server.log'),'a');
 server=spawn(exe('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','max_connections=12','-c','shared_buffers=32MB'],{windowsHide:true,stdio:['ignore',log,log]});
 const connect=async name=>{const c=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',application_name:name,connectionTimeoutMillis:1000});try{await c.connect();clients.push(c);return c;}catch(e){await c.end().catch(()=>{});throw e;}};
 for(let i=0;i<100;i++){try{owner=await connect('D0B2 observer');break;}catch(e){if(i===99)throw e;await pause(100);}}
 report.environment.version=(await owner.query('select version() v')).rows[0].v;
 await nativeBaseline(owner);
 check((await owner.query('select submission_private.fingerprint_v2_intent($1::jsonb) h',[JSON.stringify(canonicalVector)])).rows[0].h===vectorHash,'native PostgreSQL agrees with frozen PGlite vector');
 // TEST ONLY consumer proves atomic replay + insertion while holding the lock.
 // Uses legacy submission solely to create legitimate fixture orders. It is NOT
 // an authoritative pricing implementation and is never in deployment SQL.
 await owner.query(`create schema d0b2_test;
 create table d0b2_test.customer_writes(action text);
 create function d0b2_test.audit_customer() returns trigger language plpgsql set search_path=pg_catalog as $$
 begin insert into d0b2_test.customer_writes values(TG_OP);return NEW;end $$;
 create trigger d0b2_test_customer_write after insert or update on public.customers for each row execute function d0b2_test.audit_customer();
 create function d0b2_test.submit(request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
 declare prepared jsonb; result jsonb;
 begin
   prepared:=submission_private.replay_or_prepare(request);
   if prepared->>'state'='replay' then return prepared->'result'; end if;
   result:=public.submit_public_order(request->'payload');
   update public.orders set public_submission_fingerprint=prepared->>'fingerprint',submission_fingerprint_version=2,
     pricing_contract_version=2,pricing_policy_version='TEST-ONLY-NO-PRICING-ENGINE',pricing_fingerprint_version=1,
     accepted_review_fingerprint=repeat('0',64),priced_at=clock_timestamp()
     where public_submission_key=(prepared->>'submission_key')::uuid;
   return result;
 end $$;
 revoke all on schema d0b2_test from public;grant usage on schema d0b2_test to anon;
 revoke all on function d0b2_test.submit(jsonb) from public;grant execute on function d0b2_test.submit(jsonb) to anon;`);
 A=await connect('D0B2 session A');B=await connect('D0B2 session B');C=await connect('D0B2 session C');
 const pid=async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid;
 const pids={A:await pid(A),B:await pid(B),C:await pid(C)};check(new Set(Object.values(pids)).size===3,'three independent PostgreSQL sessions');report.sessions=pids;
 // 1: B overlaps A; C can commit a different key while A is still uncommitted.
 const same={...payload(),customer_phone:'09171234567'};await begin(A);const ra=await call(A,same);await begin(B);
 const pending=call(B,{...same,total:999,review_fingerprint:'changed-review'});pending.catch(()=>{});
 const evidence=await observeWait(pids.B,pids.A);check(true,'B waiting while A holds lock');
 const different=payload();await begin(C);const rc=await call(C,different);await C.query('commit');check(!!rc.order_number,'unrelated key finishes while A still holds same-key lock');
 await A.query('commit');const rb=await pending;await B.query('commit');assert.deepEqual(rb,ra);checks++;
 const rows=await states(same.submission_key);check(rows.length===1,'exactly one order for concurrent same intent');
 check((await owner.query('select count(*)::int n from order_items where order_id=(select id from orders where public_submission_key=$1)',[same.submission_key])).rows[0].n===1,'one item only');
 check((await owner.query('select count(*)::int n from d0b2_test.customer_writes')).rows[0].n===1,'one C1B customer maintenance operation; replay does not update customer');
 report.tests.push({name:'same key same intent, unrelated key independent',status:'PASS',evidence,responses:{A:ra,B:rb,C:rc},orders:rows});
 // 2: Conflicting same key is serialized, then compares against committed winner.
 const conflict=payload();await begin(A);const winner=await call(A,conflict);await begin(B);
 const conflicting=call(B,{...conflict,customer_name:'Changed intent'}).then(r=>({r}),e=>({error:e}));
 const evidence2=await observeWait(pids.B,pids.A);await A.query('commit');const outcome=await conflicting;await B.query('rollback');
 check(outcome.error?.detail==='ORDER_SUBMISSION_KEY_CONFLICT'&&outcome.error.code==='P0001','conflict stable and no unique violation');
 const conflictRows=await states(conflict.submission_key);check(conflictRows.length===1&&conflictRows[0].customer_name===conflict.customer_name,'winner preserved');
 report.tests.push({name:'same key different intent',status:'PASS',evidence:evidence2,response:winner,error:{code:outcome.error.code,detail:outcome.error.detail},orders:conflictRows});
 // 3: Hold lock past budget. B cannot insert and is told to retry same key.
 const timeout=payload();await begin(A);await call(A,timeout);await begin(B);const start=Date.now();
 const error=await call(B,timeout).then(()=>null,e=>e);const elapsed=Date.now()-start;await B.query('rollback');
 check(error?.detail==='ORDER_RETRY_REQUIRED'&&error.code==='55P03','bounded contention produces retry error');check(elapsed>=900&&elapsed<2500,'wait approximately one second');
 await A.query('rollback');check((await states(timeout.submission_key)).length===0,'rollback discards held insertion');
 await begin(B);const retry=await call(B,timeout);await B.query('commit');check((await states(timeout.submission_key)).length===1,'transaction rollback released lock for retry');
 report.tests.push({name:'bounded wait and rollback release',status:'PASS',elapsedMs:elapsed,error:{code:error.code,detail:error.detail},response:retry,orders:await states(timeout.submission_key)});
 // 4: A rolls back while B is waiting; B observes no order and creates it once.
 const rollback=payload();await begin(A);await call(A,rollback);await begin(B);const afterRollback=call(B,rollback);afterRollback.catch(()=>{});
 await observeWait(pids.B,pids.A);await A.query('rollback');const recovered=await afterRollback;await B.query('commit');check((await states(rollback.submission_key)).length===1,'waiter inserts after holder rollback');
 report.tests.push({name:'waiter resumes after holder rollback',status:'PASS',response:recovered,orders:await states(rollback.submission_key)});
 check((await owner.query("select count(*)::int n from pg_locks where locktype='advisory' and pid=any($1::int[])",[Object.values(pids)])).rows[0].n===0,'no session lock leak');
 check((await owner.query('select count(*)::int n from customers')).rows[0].n===1,'only the supported-phone order creates a customer');
 report.status='FULL PASS';report.assertions=checks;console.log(checks+' native PostgreSQL D0B2 concurrency assertions passed across '+report.tests.length+' scenarios.');
}catch(e){report.status='FAIL';report.errors.push({message:e.message,code:e.code,detail:e.detail});console.error(e);process.exitCode=1;}
finally{
 await Promise.allSettled(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));
 if(server){try{run('pg_ctl',['-D',path.join(workspace,'data'),'-m','fast','-w','stop']);}catch(e){report.shutdownError=e.message;server.kill();process.exitCode=1;}}
 if(log!==undefined)fs.closeSync(log);fs.writeFileSync(path.join(workspace,'results.json'),JSON.stringify(report,null,2));console.log('Evidence: '+path.join(workspace,'results.json'));
}})();
