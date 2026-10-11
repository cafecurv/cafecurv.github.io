const assert=require('node:assert/strict');
const {pricingFixture}=require('./public-pricing-engine-fixture.cjs');
const {readSql,preview,backend}=require('./public-submission-v2-fixture.cjs');
(async()=>{const {db}=await pricingFixture();let n=0;
const q=async s=>(await db.query(s)).rows;
const baseline=()=>q(`select oid,pg_get_functiondef(oid) definition,proacl,proconfig,proowner from pg_proc where oid in
 ('public.submit_public_order(jsonb)'::regprocedure,'public.get_public_order_tracking(uuid)'::regprocedure,
 'customer_private.link_website_order(uuid)'::regprocedure,'configuration_private.price_order_configuration(jsonb)'::regprocedure)`);
const fails=async(setup,cleanup,code='D0B5_PREREQUISITE')=>{
 await db.exec(setup);const before=await baseline();await assert.rejects(()=>db.exec(readSql(backend)),e=>e.detail===code);n++;await db.exec('rollback');
 assert.deepEqual(await baseline(),before);n++;assert.equal((await q("select to_regprocedure('public.submit_public_order_v2(jsonb)') v"))[0].v,null);n++;
 assert.equal((await q("select to_regprocedure('submission_private.validate_current_order(jsonb)') v"))[0].v,null);n++;await db.exec(cleanup);
};
try{
 await db.exec(readSql(preview));
 await fails('alter function configuration_private.customer_pricing_review(jsonb) rename to missing_review','alter function configuration_private.missing_review(jsonb) rename to customer_pricing_review');
 await fails('alter index orders_public_submission_key_idx rename to missing_key_index','alter index missing_key_index rename to orders_public_submission_key_idx');
 await fails('alter table orders rename column preparation_timing to missing_timing','alter table orders rename column missing_timing to preparation_timing');
 await fails('alter function public.submit_public_order(jsonb) security invoker','alter function public.submit_public_order(jsonb) security definer');
 await fails('create function public.submit_public_order_v2(text) returns text language sql as $$select $1$$','drop function public.submit_public_order_v2(text)','D0B5_COLLISION');
 const before=await baseline();await db.exec(readSql(backend));assert.deepEqual(await baseline(),before);n++;
 console.log(n+' D0B5 preflight/baseline assertions passed.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
