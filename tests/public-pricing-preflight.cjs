const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture}=require('./pos-database.cjs');
const sql=f=>fs.readFileSync(path.join(__dirname,'../admin',f),'utf8').replace(/^\uFEFF/,'');
(async()=>{const {db}=await fixture({applyPos:false});let n=0;
const state=async()=>(await db.query(`select
 (select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c where relnamespace in ('public'::regnamespace,to_regnamespace('configuration_private'))) relations,
 (select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace in ('public'::regnamespace,to_regnamespace('configuration_private'))) columns,
 (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where pronamespace in ('public'::regnamespace,to_regnamespace('configuration_private'))) functions,
 (select jsonb_agg(to_jsonb(o) order by o.id) from orders o) orders,
 (select jsonb_agg(to_jsonb(i) order by i.id) from order_items i) items`)).rows;
const fails=async(file,setup,cleanup,detail)=>{
 await db.exec(setup);const before=await state();await assert.rejects(()=>db.exec(sql(file)),e=>e.detail===detail);n++;
 await db.exec('rollback');assert.deepEqual(await state(),before,'preflight failure must not apply DDL or mutate data');n++;await db.exec(cleanup);
};
try{
const a='WEBSITE_CONFIGURATION_D0A1_SCHEMA.sql',b='WEBSITE_PRICING_D0B1_SCHEMA.sql';
await fails(a,'alter table products rename column is_available to unavailable_column','alter table products rename column unavailable_column to is_available','D0A1_PREREQUISITE');
await fails(a,'alter table products rename column is_available to original_available;alter table products add column is_available text','alter table products drop column is_available;alter table products rename column original_available to is_available','D0A1_PREREQUISITE');
await fails(a,'create type product_option_choice_override_requirements as (dummy text)','drop type product_option_choice_override_requirements','D0A1_COLLISION');
await fails(a,'create index d0a1_override_product_choice on products(name)','drop index d0a1_override_product_choice','D0A1_COLLISION');
await fails(a,'create function get_public_configuration_compatibility(text) returns text language sql as $$select $1$$','drop function get_public_configuration_compatibility(text)','D0A1_COLLISION');
await fails(a,'alter role anon rename to missing_anon','alter role missing_anon rename to anon','D0A1_PREREQUISITE');
await db.exec(sql(a));
await db.exec(sql('CUSTOMER_PHASE_C1B_SCHEMA.sql'));await db.exec(sql('CUSTOMER_PHASE_C1B_BACKEND.sql'));
await db.exec(sql('WEBSITE_DINE_IN_TIMING_SCHEMA.sql'));await db.exec(sql('WEBSITE_DINE_IN_TIMING_BACKEND.sql'));
await fails(b,'create function configuration_private.validate_item_snapshot(text) returns text language sql as $$select $1$$','drop function configuration_private.validate_item_snapshot(text)','D0B1_COLLISION');
await fails(b,'create type configuration_private.product_pricing_certifications as (dummy text)','drop type configuration_private.product_pricing_certifications','D0B1_COLLISION');
await fails(b,'alter table orders add column accepted_review_fingerprint text','alter table orders drop column accepted_review_fingerprint','D0B1_COLLISION');
await fails(b,'alter table order_items add column pricing_configuration_snapshot jsonb','alter table order_items drop column pricing_configuration_snapshot','D0B1_COLLISION');
await fails(b,'alter table orders rename constraint orders_preparation_pair_check to missing_timing_check','alter table orders rename constraint missing_timing_check to orders_preparation_pair_check','D0B1_PREREQUISITE');
await fails(b,'alter index orders_public_submission_key_idx rename to missing_key_index','alter index missing_key_index rename to orders_public_submission_key_idx','D0B1_PREREQUISITE');
await fails(b,'alter index d0a1_override_size_choice rename to original_size_index;create unique index d0a1_override_size_choice on product_option_choice_price_overrides(id)','drop index d0a1_override_size_choice;alter index original_size_index rename to d0a1_override_size_choice','D0B1_PREREQUISITE');
await fails(b,'create index configuration_private_placeholder on orders(id);alter index configuration_private_placeholder rename to d0b1_order_pricing_metadata','drop index d0b1_order_pricing_metadata','D0B1_COLLISION');
console.log(n+' D0B1/D0A1 atomic preflight assertions passed');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
