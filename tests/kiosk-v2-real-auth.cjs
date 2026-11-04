// REAL local GoTrue/Auth + PostgREST rehearsal. No external project configuration.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {start}=require('./kiosk-v2-disposable-stack.cjs');const root=process.env.CURV_KIOSK_REPO_ROOT||path.resolve(__dirname,'..');const sourceRoot=process.env.CURV_KIOSK_SOURCE_ROOT||root;
const {nativeBaseline,canonicalVector,vectorHash}=require(root+'/tests/public-submission-foundation-fixture.cjs');
const v=require(root+'/tests/public-submission-v2-fixture.cjs');
const report={scope:'Real signed GoTrue JWTs and real PostgREST against a new Docker PostgreSQL database. No production. No browser mocks.',checks:[],groups:{},races:[],limitations:['Selected local migration chain does not prove deployed production grants.','No physical tablet acceptance; this backend suite does not exercise browser UI.','Fresh local HS256 signing configuration is not proof of a hosted project asymmetric signing configuration.']};
report.excludedIntegrationAssertions=12;report.excludedReason='D1 routing/courier/snapshot and D1-endpoint replay tests intentionally excluded; no D1/P5 migrations in this release.';
let stack,db,base,auth,group='setup',k=500000;const users={};
const j=JSON.stringify;const check=(x,m)=>{assert.ok(x,m);report.groups[group]=(report.groups[group]||0)+1;report.checks.push({group,label:m});};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);check(true,m);};
const q=async(s,p=[])=>(await db.query(s,p)).rows;
async function authCall(route,body,token,method='POST'){const r=await fetch(auth+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:j(body)})});const b=await r.json().catch(()=>({}));return {status:r.status,b};}
async function refresh(u){const r=await authCall('/token?grant_type=refresh_token',{refresh_token:u.refresh_token});if(r.status!==200)throw Error('Real Auth refresh failed: '+r.status);Object.assign(u,r.b);return r;}
async function api(u,name,args={},schema='kiosk',fresh=true){
 if(u&&fresh&&u.expires_at*1000-Date.now()<12000)await refresh(u);
 let adapted=false;
 if(schema==='kiosk'){
  const names={identity:'kiosk_test_identity',open_generation:'kiosk_begin',admit:'kiosk_admit',submit:'kiosk_submit',recover:'kiosk_recover',close_generation:'kiosk_close',staff_recover:'kiosk_owner_recover'};
  if(name==='actor'){const r=await get(u,'/devices?select=*','kiosk_private');return r;}
  const old=name;name=names[name]||name;schema='public';adapted=true;
  if(old==='admit')args={p_generation:args.g,p_payload:args.p};
  if(old==='submit')args={p_generation:args.g,p_key:args.p.submission_key};
  if(old==='recover'||old==='staff_recover')args={p_generation:args.g,p_key:args.k};
  if(old==='close_generation')args={p_generation:args.g};
 }
 const r=await fetch(base+'/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json','Content-Profile':schema,'Accept-Profile':schema,...(u?{Authorization:'Bearer '+u.access_token}:{})},body:j(args)});
 let data=await r.json().catch(()=>null);
 if(adapted&&r.ok){if(name==='kiosk_begin')data=data.generation_id;else if(data?.state==='accepted')data=data.receipt;}
 return {status:r.status,b:data};
}
async function get(u,route,schema='public'){if(u&&u.expires_at*1000-Date.now()<12000)await refresh(u);const r=await fetch(base+route,{headers:{'Accept-Profile':schema,...(u?{Authorization:'Bearer '+u.access_token}:{})}});return {status:r.status,b:await r.json().catch(()=>null)};}
async function okcall(u,n,a={},schema='kiosk'){const r=await api(u,n,a,schema);check(r.status===200||r.status===204,'HTTP success '+schema+'.'+n);return r.b;}
async function denied(u,n,a={},schema='kiosk',fresh=true){const r=await api(u,n,a,schema,fresh);check(r.status>=400&&r.status!==404,'HTTP permission/authorization denial (not missing endpoint) '+schema+'.'+n);return r;}
const payload=async(type='pickup',items)=>{const p=await v.reviewed(db,v.payload(k++,items||[v.line()]));return {kiosk_contract_version:1,submission_key:p.submission_key,customer_name:'Nickname <&> ♡',fulfillment_type:type,items:p.items,review_fingerprint:p.review_fingerprint,customer_notes:null};};
async function signup(label){const r=await authCall('/signup',{email:label+'@curv-test.invalid',password:stack.password});check(r.status===200&&!!r.b.access_token,'real Auth signup '+label);const u=r.b;users[label]=u;return u;}
const claims=u=>JSON.parse(Buffer.from(u.access_token.split('.')[1],'base64url'));
async function observe(pid,name){for(let i=0;i<160;i++){const r=(await q('select wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[pid]))[0];if(r&&(r.blockers.length||r.wait_event==='PgSleep')){report.races.push({name,...r});check(true,'real overlap '+name);return;}await stack.sleep(10);}throw Error('No observed overlap '+name);}
async function activity(name){for(let i=0;i<400;i++){const r=(await q("select pid from pg_stat_activity where wait_event='PgSleep' and state='active' and pid<>pg_backend_pid()"))[0];if(r)return r.pid;await stack.sleep(10);}throw Error('No HTTP transaction observed '+name);}
(async()=>{try{
 stack=await start();db=stack.client;
 stack.run(['exec','-i',stack.state.names.db,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:['authenticator','supabase_auth_admin'].map(r=>'alter role '+r+" with login password '"+stack.password+"';").join('\n')});
 await stack.services();base='http://127.0.0.1:'+stack.state.ports.rest;auth='http://127.0.0.1:'+stack.state.ports.auth;
 report.environment={images:stack.state.images,ports:stack.state.ports,network:stack.state.names.network,bind:'127.0.0.1',existingResources:'not reused',jwtLifetimeSeconds:60};
 const one=await signup('kiosk-one'),two=await signup('kiosk-two'),stranger=await signup('unapproved'),owner=await signup('fixture-owner');
 const adapter={query:async(s,p=[])=>{if(s.includes('create role anon;create role authenticated;create schema auth;'))return {rows:[]};return db.query(s,p);}};
 await nativeBaseline(adapter);
 await db.query(v.readSql('TIMEKEEPING_PHASE_T1_BACKEND.sql'));
 await db.query("insert into admin_profiles(id,full_name) values($1,'Disposable Fixture Owner')",[owner.user.id]);
 for(const f of ['POS_PHASE_P1A_SCHEMA.sql','POS_PHASE_P1A_BACKEND.sql',v.engine])await db.query(v.readSql(f));
 await v.seedPricingCatalog(db);for(const f of [v.preview,v.backend])await db.query(v.readSql(f));
 db.exec=s=>db.query(s);await require(root+'/tests/menu-manager-product-save-fixture.cjs').install(db);await require(root+'/tests/menu-manager-options-writer-fixture.cjs').install(db);
 for(const f of ['CUSTOMER_PHASE_C2A_BACKEND.sql','INVENTORY_PHASE_I2_FOUNDATION.sql'])await db.query(v.readSql(f));
 check((await q("select to_regnamespace('delivery_private') is null and to_regprocedure('public.submit_public_order_d1(jsonb)') is null ok"))[0].ok,'new D1 backend absent from standalone kiosk installation');
 const defRows=()=>q("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,md5(pg_get_functiondef(p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','submission_private','delivery_private','configuration_private') and p.prokind='f' and p.proname not like 'kiosk_%' order by 1,2,3");const original=await defRows();
 const historical=await v.submit(db,await v.reviewed(db,v.payload(k++)));check(!!historical.order_number,'historical actual v2 order');
 const historicalRows=await q('select to_jsonb(o) row from orders o');
 await db.query(fs.readFileSync(path.join(sourceRoot,'admin/KIOSK_V2_SCHEMA.sql'),'utf8'));
 await db.query(fs.readFileSync(path.join(sourceRoot,'admin/KIOSK_V2_BACKEND.sql'),'utf8'));
 await db.query("NOTIFY pgrst, 'reload schema'");await stack.sleep(1000);
 eq((await q('select mode from kiosk_private.settings'))[0].mode,'off','migration installs disabled by default');
 await denied(one,'kiosk_context',{},'public');
 await db.query("create function public.kiosk_test_identity() returns jsonb language sql stable set search_path=pg_catalog as $$select jsonb_build_object('uid',auth.uid(),'role',current_user,'session',auth.jwt()->>'session_id')$$;revoke all on function public.kiosk_test_identity() from public,anon;grant execute on function public.kiosk_test_identity() to authenticated;");
 const register=async u=>{const r=await api(owner,'kiosk_owner_device',{p_principal:u.user.id,p_active:true,p_valid_until:new Date(Date.now()+8*3600000).toISOString(),p_drain:false},'public');if(r.status!==200)throw Error('Device registration '+JSON.stringify(r.b));return r.b.device_id;};
 await db.query("NOTIFY pgrst, 'reload schema'");await stack.sleep(1000);
 const activated=await api(owner,'kiosk_owner_mode',{p_mode:'on'},'public');if(activated.status!==200)throw Error('Disposable mode setup failed');
 const d1=await register(one),d2=await register(two);
 await db.query("NOTIFY pgrst, 'reload schema'");await stack.sleep(1200);
 group='real-auth-jwt';
 for(const u of [one,two,stranger]){const [h,p,sig]=u.access_token.split('.');eq(crypto.createHmac('sha256',stack.secret).update(h+'.'+p).digest('base64url'),sig,'GoTrue-issued JWT signature verifies');const r=await okcall(u,'identity');eq(r.uid,u.user.id,'PostgREST propagates real subject');eq(r.role,'authenticated','PostgREST switches real DB role');eq(r.session,claims(u).session_id,'PostgREST propagates session claim');}
 const forgedParts=one.access_token.split('.');forgedParts[1]=Buffer.from(j({...claims(one),sub:owner.user.id})).toString('base64url');const forged={...one,access_token:forgedParts.join('.')};eq((await api(forged,'identity',{},'kiosk',false)).status,401,'forged owner subject rejected by real PostgREST');
 await denied(null,'open_generation');await denied(stranger,'open_generation');
 const beforeRefresh=one.refresh_token,oldSession=claims(one).session_id;await refresh(one);check(one.refresh_token!==beforeRefresh,'real Auth rotates refresh token');eq(claims(one).session_id,oldSession,'refresh preserves stable Auth session');eq((await okcall(one,'identity')).uid,one.user.id,'refreshed JWT works through real PostgREST');
 group='effective-permissions';
 eq((await api(one,'is_admin',{},'public')).b,false,'device not owner');
 eq((await q('select count(*)::int n from pos_staff_access where user_id=$1',[one.user.id]))[0].n,0,'device not POS staff');
 await db.query("insert into staff(id,name,pin_hash,created_by) values($1,'Public synthetic staff',extensions.crypt('6142',extensions.gen_salt('bf',4)),$2)",[v.id(600010),owner.user.id]);await db.query("insert into inventory_categories(name) values('Private synthetic inventory')");
 await db.query("insert into inventory_items(name,category_id,unit_id,created_by) select 'Private ingredient',c.id,u.id,$1 from inventory_categories c cross join inventory_units u limit 1",[owner.user.id]);
 const contact=await v.reviewed(db,v.payload(k++,undefined,{fulfillment_type:'pickup',preparation_timing:null,payment_method:'counter',customer_phone:'09171234567'}));await v.submit(db,contact);
 for(const table of ['orders','order_items','customers','staff','admin_profiles','inventory_categories','inventory_items']){const r=await get(one,'/'+table+'?select=*');check(r.status>=400||(Array.isArray(r.b)&&r.b.length===0),'real RLS/ACL protects '+table);}
 for(const table of ['orders','staff','inventory_categories']){const own=await get(owner,'/'+table+'?select='+(table==='staff'?'id,name,is_active,display_order':'*'));check(own.status===200&&own.b.length>0,'positive owner control confirms protected rows exist '+table);}
 const ownerCustomers=await api(owner,'customer_admin_list',{},'public');check(ownerCustomers.status===200&&ownerCustomers.b.total_count>0,'owner customer RPC confirms private contact records exist');
 const staffProjection=await get(one,'/staff?select=id,name,is_active,display_order');check(staffProjection.status>=400||staffProjection.b.length===0,'staff column grants still constrained by owner RLS');
 for(const [name,args] of [['pos_get_access',{}],['customer_admin_list',{}],['set_website_ordering_enabled',{p_enabled:false}]])await denied(one,name,args,'public');
 const sf=await api(one,'timekeeping_list_active_staff',{},'public'),sa=await api(null,'timekeeping_list_active_staff',{},'public');eq(sf.status,200,'staff picker existing authenticated access');eq(sa.status,200,'staff picker existing anonymous access');eq(sf.b,sa.b,'safe staff picker equally exposed by design');
 const badPin=await api(one,'timekeeping_get_staff_status',{p_staff_id:v.id(600010),p_pin:'0000'},'public');check(badPin.status>=400||!badPin.b?.ok,'wrong PIN provides no staff status');
 const clock=await api(one,'timekeeping_clock_in',{p_staff_id:v.id(600010),p_pin:'0000'},'public');check(clock.status>=400||!clock.b?.ok,'wrong PIN cannot mutate timekeeping');await denied(one,'timekeeping_correct_session',{p_session_id:v.id(901),p_corrected_in:null,p_corrected_out:null,p_reason:'Unauthorized test'},'public');
 const edit=await authCall('/user',{data:{role:'owner',kiosk:true}},stranger.access_token,'PUT');eq(edit.status,200,'user can change own user_metadata');eq((await api(stranger,'is_admin',{},'public')).b,false,'editable user metadata grants no owner authority');await denied(stranger,'open_generation');
 await refresh(stranger);eq(claims(stranger).user_metadata.role,'owner','real refreshed JWT contains attacker-controlled user metadata');eq(claims(stranger).role,'authenticated','user metadata does not change signed database role');eq((await api(stranger,'is_admin',{},'public')).b,false,'refreshed metadata still grants no owner authority');await denied(stranger,'open_generation');
 await denied(one,'staff_recover',{g:v.id(999),k:v.id(998)});await denied(one,'actor');
 await denied(one,'kiosk_owner_mode',{p_mode:'on'},'public');
 await denied(one,'kiosk_owner_device',{p_principal:one.user.id,p_active:true,p_valid_until:new Date(Date.now()+3600000).toISOString()},'public');
 await denied(one,'kiosk_owner_provenance',{p_order:v.id(999)},'public');
 await denied(owner,'kiosk_owner_device',{p_principal:owner.user.id,p_active:true,p_valid_until:new Date(Date.now()+3600000).toISOString()},'public');
 const raw=await get(one,'/attempts?select=*','kiosk_private');check(raw.status>=400,'private attempt table inaccessible through PostgREST');
 const payment=await fetch(base+'/orders?id=eq.'+(await q('select id from orders limit 1'))[0].id,{method:'PATCH',headers:{Authorization:'Bearer '+one.access_token,'Content-Type':'application/json',Prefer:'return=representation'},body:'{"payment_status":"paid"}'});const paymentBody=await payment.json().catch(()=>null);check(payment.status>=400||Array.isArray(paymentBody)&&paymentBody.length===0,'no real HTTP payment mutation');
 const track=await api(one,'get_public_order_tracking',{p_tracking_token:v.id(600099)},'public');check(track.status>=400||!j(track.b).includes(historical.order_number),'unknown token does not reveal other customer order');
 report.privileges={roles:await q("select rolname,rolsuper,rolbypassrls,rolcanlogin from pg_roles where rolname in ('anon','authenticated','authenticator','supabase_auth_admin')"),memberships:await q("select r.rolname role,m.rolname member from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where m.rolname in ('anon','authenticated','authenticator') order by 1,2"),policies:await q('select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies order by 1,2,3'),functions:await q("select p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','kiosk_private') and p.prokind='f' order by 1"),grants:await q("select grantee,table_schema,table_name,privilege_type from information_schema.role_table_grants where grantee in ('anon','authenticated') order by 1,2,3,4")};
 group='ordering-isolation';
 let currentG,currentP,currentReceipt;
 for(const type of ['dine_in','pickup']){
  const g=await okcall(one,'open_generation'),p=await payload(type);await okcall(one,'admit',{g,p});const r=await okcall(one,'submit',{g,p});check(/^C-\d+$/.test(r.order_number),'real server order number '+type);eq(Object.keys(r),['order_number'],'no tracking bearer token in kiosk receipt');
  const row=(await q('select * from orders where public_submission_key=$1',[p.submission_key]))[0];eq([row.fulfillment_type,row.customer_phone,row.customer_email,row.delivery_address,row.payment_method,row.payment_status,row.customer_id],[type,'',null,null,'counter','unpaid',null],'phone-free actual fulfillment and financial state '+type);eq(Number(row.subtotal),10.1,'server-authoritative total '+type);
  eq(await okcall(one,'submit',{g,p}),r,'real HTTP same-key replay '+type);eq(await okcall(one,'recover',{g,k:p.submission_key}),r,'real HTTP uncertain response recovery '+type);eq(await okcall(one,'open_generation'),g,'one generation across repeated/tab-loss open');
  await denied(two,'recover',{g,k:p.submission_key});await denied(stranger,'recover',{g,k:p.submission_key});
  await okcall(one,'close_generation',{g});const next=await okcall(one,'open_generation');check(next!==g,'next customer generation changes');eq(await okcall(one,'recover',{g,k:p.submission_key}),{state:'closed'},'closed generation discloses no old receipt');eq(await okcall(one,'recover',{g:next,k:p.submission_key}),{state:'unknown'},'old key cannot recover under new generation');
  currentG=next;
 }
 for(const patch of [{fulfillment_type:'delivery'},{payment_method:'gcash'},{payment_status:'paid'},{source:'kiosk'},{customer_name:'   '}])await denied(one,'admit',{g:currentG,p:{...await payload(),...patch}});
 const noPhone=await v.reviewed(db,v.payload(k++,undefined,{fulfillment_type:'pickup',preparation_timing:null,customer_phone:'',payment_method:'counter'}));const publicMissing=await api(null,'submit_public_order_v2',{p_request:{payload:noPhone}},'public');eq(publicMissing.b?.error?.code,'ORDER_CART_INVALID','ordinary anonymous pickup still requires phone');
 const noPhoneDelivery=await v.reviewed(db,v.payload(k++,undefined,{fulfillment_type:'delivery',preparation_timing:null,delivery_address:'Synthetic delivery address',delivery_option:'curv_rider',customer_phone:'',payment_method:'counter'}));const missingDelivery=await api(null,'submit_public_order_v2',{p_request:{payload:noPhoneDelivery}},'public');eq(missingDelivery.b?.error?.code,'ORDER_CART_INVALID','ordinary anonymous delivery still requires phone');
 group='owner-workflow';const staffOrder=(await q('select id,total from orders where submission_fingerprint_version=3 order by created_at desc limit 1'))[0];
 const staffPatch=async p=>{const r=await fetch(base+'/orders?id=eq.'+staffOrder.id,{method:'PATCH',headers:{Authorization:'Bearer '+owner.access_token,'Content-Type':'application/json',Prefer:'return=representation'},body:j(p)});return {status:r.status,b:await r.json().catch(()=>null)};};
 const acceptedByStaff=await staffPatch({status:'accepted'});check(acceptedByStaff.status===200&&acceptedByStaff.b?.[0]?.status==='accepted','real owner status action accepts kiosk order');const paidByStaff=await staffPatch({payment_status:'paid'});check(paidByStaff.status===200&&paidByStaff.b?.[0]?.payment_status==='paid','real owner payment action marks kiosk paid');eq((await q('select total from orders where id=$1',[staffOrder.id]))[0].total,staffOrder.total,'staff status/payment actions preserve authoritative total');group='ordering-isolation';
 currentP=await payload('pickup',[v.line(1001,1101,[3001,3010],2)]);await okcall(one,'admit',{g:currentG,p:currentP});
 await denied(one,'close_generation',{g:currentG});await denied(one,'admit',{g:currentG,p:await payload()});
 // DB rollback injection invoked through actual Auth/PostgREST. Never a production API.
 const before=(await q('select count(*)::int n from orders'))[0].n;
 await db.query("create function kiosk_private.inject_failure() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'TEST_ONLY_ROLLBACK';end$$;create trigger inject_kiosk_failure before insert on kiosk_private.provenance for each row execute function kiosk_private.inject_failure();");
 await denied(one,'submit',{g:currentG,p:currentP});await db.query('drop trigger inject_kiosk_failure on kiosk_private.provenance');eq((await q('select count(*)::int n from orders'))[0].n,before,'HTTP injected failure rolls back financial writes');
 currentReceipt=await okcall(one,'submit',{g:currentG,p:currentP});eq(Number((await q('select subtotal from orders where public_submission_key=$1',[currentP.submission_key]))[0].subtotal),250,'real engine validates options and pricing');
 check((await q('select pricing_configuration_snapshot is not null valid from order_items i join orders o on o.id=i.order_id where public_submission_key=$1',[currentP.submission_key]))[0].valid,'real authoritative item snapshot');
 group='http-concurrency';
 const results=await Promise.all([api(one,'submit',{g:currentG,p:currentP}),api(one,'submit',{g:currentG,p:currentP}),api(one,'recover',{g:currentG,k:currentP.submission_key})]);check(results.every(x=>x.status===200&&x.b.order_number===currentReceipt.order_number),'concurrent HTTP replay/recovery returns same number');eq((await q('select count(*)::int n from orders where public_submission_key=$1',[currentP.submission_key]))[0].n,1,'concurrent HTTP requests leave one order');
 await okcall(one,'close_generation',{g:currentG});currentG=await okcall(one,'open_generation');currentP=await payload();await okcall(one,'admit',{g:currentG,p:currentP});
 const editor=await okcall(owner,'menu_manager_get_product_editor',{p_product_id:v.id(1000)},'public');
 const savedRequest=require(root+'/tests/menu-manager-product-save-fixture.cjs').request(editor,k++);savedRequest.sizes.find(x=>x.id===v.id(1100)).price=11.10;
 const saved=await okcall(owner,'menu_manager_save_product',{p_request:savedRequest},'public');check(saved.ok,'real owner editor changes fixture price');
 const changedPrice=await api(one,'submit',{g:currentG,p:currentP});eq(changedPrice.b?.state,'price_changed','admitted price change requires fresh review');
 const stillAbsent=(await q('select count(*)::int n from orders where public_submission_key=$1',[currentP.submission_key]))[0].n;eq(stillAbsent,0,'price change creates no order');
 await denied(one,'admit',{g:currentG,p:{...currentP,customer_name:'Different customer'}});
 const confirmedPrice=await okcall(one,'kiosk_confirm_price',{p_generation:currentG,p_key:currentP.submission_key,p_review:changedPrice.b.quote.review_fingerprint},'public');eq(confirmedPrice.state,'admitted','same-key explicit updated review admitted');
 currentP.review_fingerprint=changedPrice.b.quote.review_fingerprint;
 // A test-only trigger pauses insertion while device share lock remains held.
 await db.query("create function kiosk_private.pause_order() returns trigger language plpgsql set search_path=pg_catalog as $$begin if new.customer_name='Race pause' then perform pg_sleep(3);end if;return new;end$$;create trigger kf_pause before insert on orders for each row execute function kiosk_private.pause_order();");
 // Existing admitted request cannot be mutated; use device two for fresh race attempt.
 const g2=await okcall(two,'open_generation');const p2={...await payload(),customer_name:'Race pause'};await okcall(two,'admit',{g:g2,p:p2});
 const submitting=api(two,'submit',{g:g2,p:p2});const httpPid=await activity('insert into public.orders');
 await observe(httpPid,'HTTP submission in test pause');
 const duplicate=api(two,'submit',{g:g2,p:p2});let duplicatePid;
 for(let i=0;i<160;i++){const x=(await q("select pid from pg_stat_activity where wait_event_type='Lock' and state='active' and usename='authenticator' and pid<>$1",[httpPid]))[0];if(x){duplicatePid=x.pid;break;}await stack.sleep(10);}
 check(!!duplicatePid,'second real HTTP submission overlaps first uncommitted order');await observe(duplicatePid,'duplicate first-write HTTP submission waits');
 const revoker=new (require('pg').Client)({host:'127.0.0.1',port:stack.state.ports.db,user:'postgres',password:stack.password,database:'postgres',ssl:false});await revoker.connect();
 const revokePid=(await revoker.query('select pg_backend_pid() p')).rows[0].p;const revoke=revoker.query('update kiosk_private.devices set active=false where id=$1',[d2]);await observe(revokePid,'revocation waits on real HTTP submission');const submitted=await submitting;const duplicated=await duplicate;await revoke;eq(submitted.status,200,'inflight HTTP order commits before serialized revoke');eq(duplicated.status,200,'concurrent duplicate admitted before revoke receives original result');eq(duplicated.b,submitted.b,'concurrent first-write HTTP results match exactly');eq((await q('select count(*)::int n from orders where public_submission_key=$1',[p2.submission_key]))[0].n,1,'concurrent first-write HTTP requests create exactly one order');await revoker.end();await denied(two,'recover',{g:g2,k:p2.submission_key});
 const recovered=await okcall(owner,'staff_recover',{g:g2,k:p2.submission_key});eq(recovered.order_number,submitted.b.order_number,'real owner JWT recovers revoked-device receipt');
 await db.query('update kiosk_private.devices set active=false where id=$1',[d1]);await denied(one,'submit',{g:currentG,p:currentP});eq((await q('select count(*)::int n from orders where public_submission_key=$1',[currentP.submission_key]))[0].n,0,'revoked-before-submit creates no order');
 await db.query('update kiosk_private.devices set active=true,drain=true where id=$1',[d1]);check(!!(await okcall(one,'submit',{g:currentG,p:currentP})).order_number,'pre-admitted HTTP attempt allowed during drain');await okcall(one,'close_generation',{g:currentG});await denied(one,'open_generation');await db.query('update kiosk_private.devices set drain=false where id=$1',[d1]);
 group='global-key-and-immutability';
 await okcall(owner,'kiosk_owner_device',{p_principal:two.user.id,p_active:true,p_valid_until:new Date(Date.now()+8*3600000).toISOString()},'public');
 await okcall(two,'close_generation',{g:g2});
 const raceClient=new (require('pg').Client)({host:'127.0.0.1',port:stack.state.ports.db,user:'postgres',password:stack.password,database:'postgres',ssl:false});await raceClient.connect();
 try {
  const ga=await okcall(one,'open_generation'),pa=await payload();await okcall(one,'admit',{g:ga,p:pa});
  const legacy={submission_key:pa.submission_key,customer_name:'Legacy fixture',customer_phone:'09171234567',fulfillment_type:'pickup',payment_method:'counter',subtotal:10.1,total:10.1,items:[{product_name:'Legacy fixture',quantity:1,unit_price:10.1,line_total:10.1}]};
  await raceClient.query('begin');await raceClient.query('select public.submit_public_order($1)',[j(legacy)]);
  const racePid=(await raceClient.query('select pg_backend_pid() p')).rows[0].p;
  eq((await q("select count(*)::int n from pg_locks where pid=$1 and locktype='advisory'",[racePid]))[0].n,0,'legacy v1 does not use the kiosk/v2 advisory lock');
  const loser=api(one,'submit',{g:ga,p:pa});let waiting;
  for(let i=0;i<160;i++){waiting=(await q("select pid from pg_stat_activity where usename='authenticator' and state='active' and wait_event_type='Lock'"))[0];if(waiting)break;await stack.sleep(10);}
  check(!!waiting,'actual HTTP kiosk overlaps uncommitted legacy writer');await raceClient.query('commit');const lost=await loser;check(lost.status>=400,'legacy unique-index winner rejects kiosk loser');
  eq((await q('select count(*)::int n from orders where public_submission_key=$1',[pa.submission_key]))[0].n,1,'legacy race leaves one order');eq((await q('select count(*)::int n from kiosk_private.provenance where key=$1',[pa.submission_key]))[0].n,0,'losing kiosk subtransaction leaves no provenance');
  const gb=await okcall(two,'open_generation'),pb=await payload();await okcall(two,'admit',{g:gb,p:pb});
  await raceClient.query('begin');await raceClient.query("select set_config('request.jwt.claims',$1,true)",[j(claims(two))]);await raceClient.query('set local role authenticated');await raceClient.query('select public.kiosk_submit($1,$2)',[gb,pb.submission_key]);
  const old=api(null,'submit_public_order',{order_payload:{...legacy,submission_key:pb.submission_key}},'public');
  waiting=null;for(let i=0;i<160;i++){waiting=(await q("select pid from pg_stat_activity where usename='authenticator' and state='active' and wait_event_type='Lock'"))[0];if(waiting)break;await stack.sleep(10);}
  check(!!waiting,'actual legacy HTTP overlaps uncommitted kiosk writer');await raceClient.query('commit');check((await old).status>=400,'legacy caller cannot replay kiosk fingerprint');
  eq((await q('select count(*)::int n from orders where public_submission_key=$1',[pb.submission_key]))[0].n,1,'reverse race leaves one order');
  const publicP=await v.reviewed(db,{...v.payload(k++),submission_key:pb.submission_key,customer_phone:'09171234567',fulfillment_type:'pickup',preparation_timing:null});
  const publicResult=await api(null,'submit_public_order_v2',{p_request:{payload:publicP}},'public');check(!!publicResult.b?.error&&!publicResult.b?.order_number,'public v2 fails closed on kiosk version');
  let immutable=false;try{await db.query('update order_items set quantity=quantity+1 where order_id=(select id from orders where public_submission_key=$1)',[pb.submission_key]);}catch(e){immutable=e.detail==='KIOSK_SNAPSHOT_IMMUTABLE';}check(immutable,'kiosk item snapshots immutable');
  for(const [sql,label] of [
   ["insert into order_items(order_id,product_name,quantity,unit_price,line_total) select id,'Unauthorized addition',1,1,1 from orders where public_submission_key=$1",'accepted snapshot rejects extra line'],
   ["update order_items set order_id=(select id from orders where public_submission_key=$1) where id=(select i.id from order_items i join orders o on o.id=i.order_id where o.submission_fingerprint_version<>3 limit 1)",'other line cannot move into accepted snapshot']
  ]){let blocked=false;try{await db.query(sql,[pb.submission_key]);}catch(e){blocked=e.detail==='KIOSK_SNAPSHOT_IMMUTABLE';}check(blocked,label);}
  await okcall(two,'close_generation',{g:gb});
 } finally {await raceClient.query('rollback').catch(()=>{});await raceClient.end();}
 group='expiry-signout';
 const expiry=await signup('expiry-only');const expiryClaims=claims(expiry);check(expiryClaims.exp-expiryClaims.iat===60,'actual signed JWT lifetime is 60 seconds');
 const wait=Math.max(0,expiryClaims.exp*1000-Date.now()+1500);console.log('Waiting '+Math.ceil(wait/1000)+' seconds for a real JWT to expire.');
 for(let left=wait;left>0;left-=10000)await stack.sleep(Math.min(left,10000));
 const firstExpiry=await api(expiry,'identity',{},'kiosk',false);report.jwtExpiry={firstStatus:firstExpiry.status,firstSecondsPastExp:(Date.now()-expiryClaims.exp*1000)/1000};
 let expired=firstExpiry;for(let i=0;i<9&&expired.status!==401;i++){await stack.sleep(5000);expired=await api(expiry,'identity',{},'kiosk',false);}
 report.jwtExpiry.finalStatus=expired.status;report.jwtExpiry.finalSecondsPastExp=(Date.now()-expiryClaims.exp*1000)/1000;
 eq(expired.status,401,'real expired JWT rejected after validator clock-skew window');await refresh(expiry);eq((await api(expiry,'identity',{},'kiosk',false)).status,200,'real refresh restores PostgREST access');
 await refresh(one);const stillValid={...one};const logout=await authCall('/logout',undefined,one.access_token);check(logout.status===204||logout.status===200,'real Auth signout succeeds');eq((await api(stillValid,'identity',{},'kiosk',false)).status,200,'issued unexpired JWT remains signature-valid after signout');await denied(stillValid,'open_generation',{},'kiosk',false);const postLogoutRefresh=await authCall('/token?grant_type=refresh_token',{refresh_token:stillValid.refresh_token});check(postLogoutRefresh.status>=400,'signed-out refresh session denied');
 group='compatibility';
 eq(await defRows(),original,'all existing application function definitions unchanged');eq((await q('select submission_private.fingerprint_v2_intent($1) h',[j(canonicalVector)]))[0].h,vectorHash,'historical canonical fingerprint unchanged');eq((await q('select to_jsonb(o) row from orders o where order_number=$1',[historical.order_number]))[0],historicalRows[0],'historical row unchanged');
 report.status='PASS';
}catch(e){report.status='FAIL';report.error={message:e.message,stack:e.stack};console.error('Rehearsal failed: '+e.message);process.exitCode=1;}
finally{report.total=Object.values(report.groups).reduce((a,b)=>a+b,0);if(stack)try{await stack.cleanup();report.dockerPreservation={existingPreserved:true,ownStackRemoved:true};}catch(e){report.cleanupError=e.message;process.exitCode=1;}
 if(process.env.CURV_KIOSK_RESULTS)fs.writeFileSync(process.env.CURV_KIOSK_RESULTS,j(report));console.log(j({status:report.status,total:report.total,groups:report.groups,races:report.races.length,error:report.error?.message,cleanup:report.cleanupError||'complete'}));}
})();
