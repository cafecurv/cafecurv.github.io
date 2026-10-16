const fs=require('node:fs'),path=require('node:path');
const {configurationFixture}=require('./public-configuration-fixture.cjs');
const readSql=f=>fs.readFileSync(path.join(__dirname,'../admin',f),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
const foundation='WEBSITE_SUBMISSION_D0B2_FOUNDATION.sql';
const prerequisites=['CUSTOMER_PHASE_C1B_SCHEMA.sql','CUSTOMER_PHASE_C1B_BACKEND.sql','WEBSITE_DINE_IN_TIMING_SCHEMA.sql','WEBSITE_DINE_IN_TIMING_BACKEND.sql','WEBSITE_PRICING_D0B1_SCHEMA.sql'];
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const canonicalVector={pricing_contract_version:2,submission_key:id(8000),customer_name:'Guest',customer_phone:'09171234567',fulfillment_type:'dine_in',payment_method:'counter',preparation_timing:'asap',requested_preparation_at:null,
 items:[{product_id:id(30),product_size_id:id(40),option_choice_ids:[id(60),id(61)],quantity:2,item_note:'No ice'}]};
const vectorHash='cc6f41c3a9268bd30988bb7fff52a0c2604a6d63c87bbb2ee08bc703f8925853';
async function submissionFixture(){
 const f=await configurationFixture({applyPos:true});
 try{for(const file of prerequisites)await f.db.exec(readSql(file));return f;}
 catch(e){await f.db.close();throw e;}
}
// Native disposable cluster only. Same repository SQL; no live configuration.
async function nativeBaseline(client){
 await client.query(`create role anon;create role authenticated;create schema auth;create schema extensions;
 create extension pgcrypto with schema extensions;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const file of ['MENU_MANAGER_PHASE1_SCHEMA.sql','MENU_MANAGER_PHASE1S_B_ACCESS.sql','MENU_MANAGER_PHASE1_VARIANTS_ALTER.sql','OPTION_GROUPS_PHASE_A_SCHEMA.sql','CATEGORY_SECTIONS_PHASE_S1_SCHEMA.sql','INCOMING_ORDERS_PHASE_A_SCHEMA.sql','INCOMING_ORDERS_PHASE_D1_DELIVERY_SUPPORT.sql','INCOMING_ORDERS_PHASE_O7B_TRACKING_RPC.sql','INCOMING_ORDERS_PHASE_O9B_CANCEL_REQUEST_RPC.sql','INCOMING_ORDERS_PHASE_O12A_WEBSITE_ORDERING_STATUS.sql','INCOMING_ORDERS_PHASE_O14_DINE_IN.sql'])await client.query(readSql(file));
 await client.query('alter table public.products add column is_sold_out boolean not null default false,add column archived_at timestamptz');
 await client.query(readSql('WEBSITE_CONFIGURATION_D0A1_SCHEMA.sql'));
 for(const file of [...prerequisites,foundation])await client.query(readSql(file));
}
module.exports={submissionFixture,nativeBaseline,readSql,foundation,canonicalVector,vectorHash};
