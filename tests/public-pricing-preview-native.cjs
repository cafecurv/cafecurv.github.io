// Fresh loopback-only PostgreSQL cluster. Never uses existing database credentials.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {Client}=require('pg');
const {nativeBaseline}=require('./public-submission-foundation-fixture.cjs');
const {seedPricingCatalog,id,line,readSql,engine}=require('./public-pricing-engine-fixture.cjs');
const bin=process.env.CURV_TEST_PG_BIN;
if(!bin)throw Error('Set CURV_TEST_PG_BIN to a disposable PostgreSQL runtime. No existing server is used.');
const exe=n=>path.join(bin,n+(process.platform==='win32'?'.exe':''));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const workspace=fs.mkdtempSync(path.join(process.env.CURV_TEST_TMPDIR||os.tmpdir(),'curv-d0b4-'));
const report={workspace,performance:[],errors:[]};let server,log,db,checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const run=(name,args)=>{const r=spawnSync(exe(name),args,{encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error(name+' failed: '+(r.stderr||r.error||r.stdout));};
(async()=>{try{
 const data=path.join(workspace,'data');run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
 const port=await freePort();report.environment={host:'127.0.0.1',port,database:'postgres',disposable:true};
 log=fs.openSync(path.join(workspace,'server.log'),'a');
 server=spawn(exe('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','max_connections=8','-c','shared_buffers=32MB'],{windowsHide:true,stdio:['ignore',log,log]});
 for(let i=0;i<100;i++){
  const candidate=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',application_name:'D0B4 disposable preview test',connectionTimeoutMillis:1000});
  try{await candidate.connect();db=candidate;break;}catch(e){await candidate.end().catch(()=>{});if(i===99)throw e;await pause(100);}
 }
 report.environment.version=(await db.query('select version() v')).rows[0].v;
 await nativeBaseline(db);await db.query(readSql(engine));await seedPricingCatalog(db);await db.query(readSql('WEBSITE_PRICING_D0B4_PREVIEW.sql'));
 const request=items=>({pricing_contract_version:2,items});
 const call=async items=>(await db.query('select public.quote_public_cart($1) v',[JSON.stringify(request(items))])).rows[0].v;
 const simple=await call([line()]);check(simple.ok,'native preview succeeds');
 check(simple.quote.review_fingerprint==='6fa69d168e1b6ce3612232793989604560eab4b8551b7fa614364069e0cf5abd','frozen vector agrees on native PostgreSQL');
 await db.query('set role anon;begin read only');
 check((await call([line()])).ok,'anon preview works in READ ONLY transaction');await db.query('commit;reset role');
 await db.query('set role authenticated;begin read only');
 check((await call([line()])).ok,'authenticated preview works in READ ONLY transaction');await db.query('commit;reset role');
 await db.query(`insert into products(id,category_id,name) select md5('d0b4background'||n)::uuid,'${id(999)}','Background '||n from generate_series(1,20000) n;
 insert into product_sizes(id,product_id,label,price) select md5('d0b4size'||n)::uuid,md5('d0b4background'||n)::uuid,'Each',10 from generate_series(1,20000) n;
 insert into product_option_groups(product_id,option_group_id) select md5('d0b4background'||n)::uuid,'${id(2002)}' from generate_series(1,20000) n;analyze;`);
 const explain=async(kind,items)=>{
  const sql=kind==='engine'?'select configuration_private.price_order_configuration($1::jsonb)':'select public.quote_public_cart($1::jsonb)';
  const value=kind==='engine'?items:request(items);
  return (await db.query('explain(analyze,buffers,format json) '+sql,[JSON.stringify(value)])).rows[0]['QUERY PLAN'][0]['Execution Time'];
 };
 const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
 for(const count of [1,10,30]){
  const items=Array.from({length:count},(_,i)=>line(1001,1101,[3000,3010,3020,3021,3022,3023,3024,3025,3026,3027],1,'Line '+i));
  const result=await call(items);check(result.ok&&result.quote.items.length===count,count+' lines returned');
  const samples={engine:[],preview:[]};
  for(let i=0;i<15;i++)for(const kind of i%2?['preview','engine']:['engine','preview']){
   const ms=await explain(kind,items);if(i>=3)samples[kind].push(ms);
  }
  const engineMs=median(samples.engine),previewMs=median(samples.preview);
  check(previewMs<5000,count+' lines within generous local smoke ceiling');
  const row={lines:count,selectedChoices:count*10,engineMedianMs:engineMs,previewMedianMs:previewMs,overheadMs:previewMs-engineMs,samples};
  report.performance.push(row);console.log(JSON.stringify(row));
 }
 report.assertions=checks;report.status='FULL PASS';console.log(checks+' native public preview assertions passed.');
}catch(e){report.status='FAIL';report.errors.push({message:e.message,code:e.code,detail:e.detail});console.error(e);process.exitCode=1;}
finally{
 if(db){await db.query('rollback;reset role').catch(()=>{});await db.end();}
 if(server){try{run('pg_ctl',['-D',path.join(workspace,'data'),'-m','fast','-w','stop']);}catch(e){report.shutdownError=e.message;server.kill();process.exitCode=1;}}
 if(log!==undefined)fs.closeSync(log);fs.writeFileSync(path.join(workspace,'results.json'),JSON.stringify(report,null,2));console.log('Evidence: '+path.join(workspace,'results.json'));
}})();
