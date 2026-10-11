const {pricingFixture,seedPricingCatalog,certify,id,line,readSql,engine}=require('./public-pricing-engine-fixture.cjs');
const preview='WEBSITE_PRICING_D0B4_PREVIEW.sql',backend='WEBSITE_SUBMISSION_D0B5_BACKEND.sql';
const payload=(key,items=[line()],extra={})=>({pricing_contract_version:2,submission_key:id(key),customer_name:'V2 Guest',customer_phone:'',fulfillment_type:'dine_in',payment_method:'counter',preparation_timing:'asap',items,...extra});
const query=async(db,s,p=[])=>(await db.query(s,p)).rows;
const reviewed=async(db,p)=>{const r=(await query(db,'select public.quote_public_cart($1) v',[JSON.stringify({pricing_contract_version:2,items:p.items})]))[0].v;if(!r.ok)throw Error(JSON.stringify(r));return {...p,review_fingerprint:r.quote.review_fingerprint};};
const submit=async(db,p)=>(await query(db,'select public.submit_public_order_v2($1) v',[JSON.stringify({payload:p})]))[0].v;
async function v2Fixture(){const f=await pricingFixture();try{await f.db.exec(readSql(preview));await f.db.exec(readSql(backend));return f;}catch(e){await f.db.close();throw e;}}
module.exports={v2Fixture,seedPricingCatalog,certify,id,line,readSql,engine,preview,backend,payload,query,reviewed,submit};
