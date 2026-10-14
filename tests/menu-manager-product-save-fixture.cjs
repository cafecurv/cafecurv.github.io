const {v2Fixture,readSql,id}=require('./public-submission-v2-fixture.cjs');
const migration='MENU_MANAGER_PRODUCT_SAVE_PHASE1.sql';
async function install(db){
 const exec=s=>db.exec?db.exec(s):db.query(s);
 await exec(`alter table products add column badge_labels text[] not null default '{}';
   alter table product_sizes add column if not exists cost numeric;
   create table inventory_recipes(id uuid primary key default gen_random_uuid(),product_size_id uuid references product_sizes(id) on delete cascade);
   grant select,insert,update,delete on products,product_sizes,option_groups,option_choices,product_option_groups,product_option_defaults to authenticated;`);
 await exec(readSql('MENU_MANAGER_PHASE_M_P2C1_PRODUCT_SIZE_RECONCILIATION.sql'));
 // Added late baseline columns are included by to_jsonb; certify fixtures before
 // installing guards, exactly as the production reviewed baseline was prepared.
 await exec(`select configuration_private.certify_product(product_id,configuration_private.catalog_structure(product_id),'Fixture baseline') from configuration_private.product_pricing_certifications`);
 await exec(readSql(migration));
}
async function fixture(){const f=await v2Fixture();try{await install(f.db);return f;}catch(e){await f.db.close();throw e;}}
const fields=p=>Object.fromEntries(['name','category_id','category_section_id','description','image_url','notes','badge_labels','variant_group_name','is_available','is_sold_out','is_curv_pick','is_seasonal'].map(k=>[k,p[k]??(['is_sold_out','is_curv_pick','is_seasonal'].includes(k)?false:k==='is_available'?true:k==='badge_labels'?[]:null)]));
const request=(editor,key,action='save')=>({request_id:id(key),product_id:editor?.product.id||null,expected_version:editor?.version||null,action,
 product:fields(editor?.product||{name:'New cafe cake',category_id:id(999)}),sizes:editor?editor.product.product_sizes.map(({id,label,price,cost,sort_order})=>({id,label,price,cost,sort_order})):[{id:null,label:'Each',price:180,cost:null}]});
module.exports={fixture,install,id,request,readSql,migration};
