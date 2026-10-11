const assert=require('node:assert/strict');
const {submissionFixture,readSql,foundation}=require('./public-submission-foundation-fixture.cjs');
const {engine}=require('./public-pricing-engine-fixture.cjs');
(async()=>{const {db}=await submissionFixture();let n=0;
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const baseline=()=>q(`select oid,pg_get_functiondef(oid) definition,proacl,proconfig,proowner from pg_proc
 where oid in ('public.submit_public_order(jsonb)'::regprocedure,'public.get_public_order_tracking(uuid)'::regprocedure,'customer_private.link_website_order(uuid)'::regprocedure)`);
const fails=async(setup,cleanup,code='D0B3_PREREQUISITE')=>{
 await db.exec(setup);const before=await baseline();await assert.rejects(()=>db.exec(readSql(engine)),e=>e.detail===code);n++;await db.exec('rollback');
 assert.deepEqual(await baseline(),before);n++;
 assert.equal((await q("select to_regprocedure('configuration_private.pricing_error(text)') f"))[0].f,null);n++;
 await db.exec(cleanup);
};
try{
 await db.exec(readSql(foundation));
 await fails('alter role anon rename to missing_anon','alter role missing_anon rename to anon');
 await fails('alter function submission_private.uuid_value(jsonb) rename to missing_uuid','alter function submission_private.missing_uuid(jsonb) rename to uuid_value');
 await fails('alter table product_sizes rename column price to original_price;alter table product_sizes add column price text','alter table product_sizes drop column price;alter table product_sizes rename column original_price to price');
 await fails('alter index d0a1_override_product_choice rename to missing_override_index','alter index missing_override_index rename to d0a1_override_product_choice');
 await fails('create function configuration_private.price_order_configuration(text) returns text language sql as $$select $1$$','drop function configuration_private.price_order_configuration(text)','D0B3_COLLISION');
 const before=await baseline();await db.exec(readSql(engine));assert.deepEqual(await baseline(),before);n++;
 const functions=(await q("select count(*)::int n from pg_proc where pronamespace='configuration_private'::regnamespace and proname in ('pricing_error','pricing_input_lines','price_order_configuration')"))[0].n;
 assert.equal(functions,3);n++;
 console.log(n+' D0B3 preflight/backend-preservation assertions passed.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
