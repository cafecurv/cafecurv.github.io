const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {configurationFixture}=require('./public-configuration-fixture.cjs');
(async()=>{const {db,id}=await configurationFixture();let n=0;
const ok=(x,m)=>{assert(x,m);n++;};
const rejects=async(sql,code)=>{await assert.rejects(()=>db.exec(sql),e=>e.code===code||e.detail===code);n++;};
const delta=async(p=30,s=40,c=60)=>(await db.query('select configuration_private.choice_delta($1,$2,$3) d',[id(p),id(s),id(c)])).rows[0].d;
const override=(size,value)=>`insert into product_option_choice_price_overrides(product_id,product_size_id,option_choice_id,price_delta) values('${id(30)}',${size===null?'null':"'"+id(size)+"'"},'${id(60)}',${value})`;
try {
 ok(Number(await delta())===25,'default selection is not automatically free');
 await db.exec(override(null,0));ok(Number(await delta())===0,'recipe override includes premium milk');
 await db.exec(override(40,30));ok(Number(await delta())===30,'size override precedes product override');
 await rejects(override(40,45),'23505');await rejects(override(null,45),'23505');
 await db.exec(`update product_option_choice_price_overrides set is_active=false where product_size_id is not null`);
 ok(Number(await delta())===0,'inactive size override falls back');
 for(const value of [-1,1000000,0.001,"'NaN'","'Infinity'"])await rejects(override(40,value),'23514');
 await db.exec(`insert into products(id,category_id,name) values('${id(31)}','${id(20)}','Other');insert into product_sizes(id,product_id,label,price) values('${id(41)}','${id(31)}','Other',1)`);
 await rejects(override(41,30),'23503');
 await rejects(`select configuration_private.choice_delta('${id(30)}','${id(41)}','${id(60)}')`,'D0A1_INVALID_CONFIGURATION');
 for(const table of ['option_choices','option_groups','product_option_groups']){
  await db.exec(`update ${table} set is_active=false`);
  await rejects(`select configuration_private.choice_delta('${id(30)}','${id(40)}','${id(60)}')`,'D0A1_INVALID_CONFIGURATION');
  await rejects(override(40,5),'D0A1_INVALID_CHOICE');
  await db.exec(`update ${table} set is_active=true`);
 }
 await rejects(`insert into product_size_option_choice_compatibility values('${id(30)}','${id(40)}','${id(60)}',true)`,'D0A1_INVALID_TEMPERATURE');
 await db.exec(`update option_groups set group_key='temperature' where id='${id(50)}'`);
 await db.exec(`insert into product_size_option_choice_compatibility values('${id(30)}','${id(40)}','${id(60)}',true)`);
 await rejects(`insert into product_size_option_choice_compatibility values('${id(30)}','${id(41)}','${id(60)}',true)`,'23503');
 await rejects(`insert into product_size_option_choice_compatibility values('${id(30)}','${id(40)}','${id(60)}',true)`,'23505');
 await db.exec(`update option_groups set group_key='milk' where id='${id(50)}'`);
 await db.exec(`insert into option_choices(id,option_group_id,label,value,price_delta) values ('${id(62)}','${id(50)}','Breve','breve',50),('${id(63)}','${id(50)}','Coconut','coconut',30)`);
 // Explicit test-only mappings: no production identifiers are inferred.
 for(const [i,name] of ['Cloud Spanish Oat Latte','Cocoa Caramel Latte','CS Matcha Oat Latte','Matcha Sunrise'].entries()){
  const p=100+i,s=110+i,c=[60,62,60,63][i];
  await db.exec(`insert into products(id,category_id,name) values('${id(p)}','${id(20)}','${name}');insert into product_sizes(id,product_id,label,price) values('${id(s)}','${id(p)}','Each',100);insert into product_option_groups(product_id,option_group_id) values('${id(p)}','${id(50)}');insert into product_option_choice_price_overrides(product_id,option_choice_id,price_delta) values('${id(p)}','${id(c)}',0)`);
  ok(Number(await delta(p,s,c))===0,name+': product-specific inclusion');
 }
 await db.exec(`insert into option_choices(id,option_group_id,label,value,price_delta) values('${id(61)}','${id(50)}','Cheese','yes',0)`);
 for(const [i,pieces] of [4,8,12].entries()){
  const size=200+i;
  await db.exec(`insert into product_sizes(id,product_id,label,price) values('${id(size)}','${id(30)}','${pieces} pcs',100);insert into product_option_choice_price_overrides(product_id,product_size_id,option_choice_id,price_delta) values('${id(30)}','${id(size)}','${id(61)}',${pieces/4*30})`);
  ok(Number(await delta(30,size,61))===pieces/4*30,'cheese '+pieces);
 }
 await db.exec("update option_groups set group_key='temperature' where id='"+id(50)+"'");
 await rejects(`select configuration_private.choice_delta('${id(30)}','${id(200)}','${id(60)}')`,'D0A1_INVALID_CONFIGURATION');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  for(const table of ['product_option_choice_price_overrides','product_size_option_choice_compatibility']) await rejects('select * from '+table,'42501');
  await rejects(`select configuration_private.choice_delta('${id(30)}','${id(40)}','${id(60)}')`,'42501');
  ok((await db.query('select * from public.get_public_configuration_compatibility()')).rows.length===0,'unpublished compatibility hidden from '+role);
  await db.exec('reset role');
 }
 await db.exec("update products set is_published=true where id='"+id(30)+"'");
 await db.exec('set role anon');
 const projection=(await db.query('select * from public.get_public_configuration_compatibility()')).rows;
 ok(projection.length===1 && Object.keys(projection[0]).sort().join() === 'is_active,option_choice_id,product_id,product_size_id','narrow published compatibility only');
 await db.exec('reset role');
 for(const condition of ['is_available=false','is_sold_out=true','archived_at=now()','is_published=false']){
  await db.exec(`update products set ${condition} where id='${id(30)}';set role anon`);
  ok((await db.query('select * from public.get_public_configuration_compatibility()')).rows.length===0,condition+' compatibility hidden');
  await db.exec(`reset role;update products set is_available=true,is_sold_out=false,archived_at=null,is_published=true where id='${id(30)}'`);
 }
 ok((await db.query("select count(*) n from pg_policies where tablename in ('product_option_choice_price_overrides','product_size_option_choice_compatibility')")).rows[0].n===0,'no permissive policies');
 const before=JSON.stringify((await db.query('select * from product_option_choice_price_overrides order by id')).rows);
 await assert.rejects(()=>db.exec(fs.readFileSync(path.join(__dirname,'../admin/WEBSITE_CONFIGURATION_D0A1_SCHEMA.sql'),'utf8').replace(/^\uFEFF/,'')),e=>e.detail==='D0A1_COLLISION');n++;
 await db.exec('rollback');ok(JSON.stringify((await db.query('select * from product_option_choice_price_overrides order by id')).rows)===before,'collision leaves existing configuration unchanged');
 console.log(n+' local configuration schema/model assertions passed');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
