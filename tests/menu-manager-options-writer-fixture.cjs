const base=require('./menu-manager-product-save-fixture.cjs');
async function install(db){
 const a=base.readSql('MENU_MANAGER_OPTION_POLICIES_PHASE3A.sql');
 await db.exec('create or replace view public.public_menu_option_choices with (security_invoker=true) as '+a.split('$reviewed_view$')[1]);
 await db.exec(a);await db.exec(base.readSql('MENU_MANAGER_CUSTOMER_OPTIONS_PHASE3B.sql'));
}
async function fixture(){const f=await base.fixture();try{await install(f.db);return f;}catch(e){await f.db.close();throw e;}}
module.exports={...base,fixture,install};
