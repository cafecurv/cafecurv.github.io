const assert=require('node:assert/strict');
const {pricingFixture,readSql}=require('./public-pricing-engine-fixture.cjs');
(async()=>{const {db}=await pricingFixture();let n=0;
const q=async s=>(await db.query(s)).rows;
const sql=readSql('WEBSITE_PRICING_D0B4_PREVIEW.sql');
const baseline=()=>q(`select oid,pg_get_functiondef(oid) definition,proacl,proconfig,proowner from pg_proc where oid in
 ('public.submit_public_order(jsonb)'::regprocedure,'public.get_public_order_tracking(uuid)'::regprocedure,
 'configuration_private.price_order_configuration(jsonb)'::regprocedure)`);
const fails=async(setup,cleanup,code='D0B4_PREREQUISITE')=>{
 await db.exec(setup);const before=await baseline();await assert.rejects(()=>db.exec(sql),e=>e.detail===code);n++;await db.exec('rollback');
 assert.deepEqual(await baseline(),before);n++;
 assert.equal((await q("select to_regprocedure('configuration_private.customer_pricing_review(jsonb)') v"))[0].v,null);n++;
 assert.equal((await q("select to_regprocedure('public.quote_public_cart(jsonb)') v"))[0].v,null);n++;
 await db.exec(cleanup);
};
try{
 await fails('alter role anon rename to missing_anon','alter role missing_anon rename to anon');
 await fails('alter function extensions.digest(bytea,text) rename to missing_digest','alter function extensions.missing_digest(bytea,text) rename to digest');
 await fails('alter function configuration_private.price_order_configuration(jsonb) set search_path=public','alter function configuration_private.price_order_configuration(jsonb) set search_path=pg_catalog');
 await fails('alter function configuration_private.price_order_configuration(jsonb) volatile','alter function configuration_private.price_order_configuration(jsonb) stable');
 await fails('alter function configuration_private.price_order_configuration(jsonb) security definer','alter function configuration_private.price_order_configuration(jsonb) security invoker');
 await fails('grant usage on schema configuration_private to anon','revoke usage on schema configuration_private from anon');
 await fails('grant execute on function configuration_private.price_order_configuration(jsonb) to authenticated','revoke execute on function configuration_private.price_order_configuration(jsonb) from authenticated');
 await fails('create function public.quote_public_cart(text) returns text language sql as $$select $1$$','drop function public.quote_public_cart(text)','D0B4_COLLISION');
 await fails('create function configuration_private.customer_pricing_review(text) returns text language sql as $$select $1$$','drop function configuration_private.customer_pricing_review(text)','D0B4_COLLISION');
 const before=await baseline();await db.exec(sql);assert.deepEqual(await baseline(),before);n++;
 await assert.rejects(()=>db.exec(sql),e=>e.detail==='D0B4_COLLISION');n++;await db.exec('rollback');
 assert.deepEqual(await baseline(),before);n++;
 console.log(n+' D0B4 preflight/backend preservation assertions passed.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
