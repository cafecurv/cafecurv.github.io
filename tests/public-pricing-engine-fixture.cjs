const {submissionFixture,readSql,foundation}=require('./public-submission-foundation-fixture.cjs');
const engine='WEBSITE_PRICING_D0B3_ENGINE.sql';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const line=(p=1000,s=1100,choices=[],quantity=1,item_note=null)=>({product_id:id(p),product_size_id:id(s),option_choice_ids:choices.map(id),quantity,item_note});
async function seedPricingCatalog(db){
 const q=(s,p=[])=>db.query(s,p);
 await q(`insert into public.categories(id,name) values($1,'Pricing fixture')`,[id(999)]);
 const products=[[1000,'Simple sushi'],[1001,'Configurable drink'],[1002,'Included Oat'],[1003,'Included Breve'],[1004,'Included Coconut'],[1005,'Takoyaki'],[1006,'Savory plate'],[1007,'Required multi-select']];
 for(const [p,name] of products)await q(`insert into public.products(id,category_id,name,is_published) values($1,$2,$3,true)`,[id(p),id(999),name]);
 for(const [s,p,label,price] of [[1100,1000,'Each',10.10],[1101,1001,'Regular',100],[1102,1001,'Large',120],[1103,1001,'HOT 12oz',90],[1104,1002,'Regular',100],[1105,1003,'Regular',100],[1106,1004,'Regular',100],[1107,1005,'4 pcs',100],[1108,1005,'8 pcs',180],[1109,1005,'12 pcs',250],[1110,1006,'Each',200],[1111,1007,'Each',50]])await q('insert into public.product_sizes(id,product_id,label,price) values($1,$2,$3,$4)',[id(s),id(p),label,price]);
 const groups=[[2000,'Milk','pricing_fixture_milk','single'],[2001,'Temperature','temperature','single'],[2002,'Extras','extras','multi'],[2003,'Cheese','cheese','single'],[2004,'Savory sauce','savory_sauce','single'],[2005,'Required pair','required_pair','multi']];
 for(const [g,name,key,type] of groups)await q('insert into public.option_groups(id,name,group_key,selection_type) values($1,$2,$3,$4)',[id(g),name,key,type]);
 const choices=[[3000,2000,'Full cream','full',0],[3001,2000,'Oat','oat',25],[3002,2000,'Breve','breve',50],[3003,2000,'Coconut','coconut',30],
 [3010,2001,'ICED','iced',0],[3011,2001,'HOT','hot',0],
 [3020,2002,'Extra shot','shot',40],[3021,2002,'Syrup','syrup',10],[3022,2002,'Sauce','sauce',15],[3023,2002,'Sweetener','sweetener',5],
 [3024,2002,'Curvccino inclusion','inclusion',20],[3025,2002,'Extra matcha','matcha',35],[3026,2002,'Extra hojicha','hojicha',30],[3027,2002,'Free topping','free',0],
 [3030,2003,'No cheese','no',0],[3031,2003,'Cheese','yes',0],[3040,2004,'Tempura sauce','tempura',0],[3041,2004,'Aioli','aioli',0],
 [3050,2005,'First','one',1],[3051,2005,'Second','two',2],[3052,2005,'Third','three',3]];
 for(const [c,g,label,value,price] of choices)await q('insert into public.option_choices(id,option_group_id,label,value,price_delta) values($1,$2,$3,$4,$5)',[id(c),id(g),label,value,price]);
 const assignment=async(p,g,required,min,max,defaults=[])=>{
  await q('insert into public.product_option_groups(product_id,option_group_id,is_required,min_selections,max_selections) values($1,$2,$3,$4,$5)',[id(p),id(g),required,min,max]);
  for(const c of defaults)await q('insert into public.product_option_defaults(product_id,option_group_id,option_choice_id) values($1,$2,$3)',[id(p),id(g),id(c)]);
 };
 await assignment(1001,2000,true,1,1,[3000]);await assignment(1001,2001,true,1,1,[3010]);await assignment(1001,2002,false,0,8);
 for(const [p,c] of [[1002,3001],[1003,3002],[1004,3003]]){
  await assignment(p,2000,true,1,1,[c]);
  await q("insert into public.product_option_choice_override_requirements(product_id,option_choice_id,specificity) values($1,$2,'product')",[id(p),id(c)]);
  await q('insert into public.product_option_choice_price_overrides(product_id,option_choice_id,price_delta) values($1,$2,0)',[id(p),id(c)]);
 }
 await assignment(1005,2003,false,0,1,[3030]);await assignment(1006,2004,true,1,1,[3040]);await assignment(1007,2005,true,2,2,[3050,3051]);
 for(const [s,price] of [[1107,30],[1108,60],[1109,90]]){
  await q("insert into public.product_option_choice_override_requirements(product_id,product_size_id,option_choice_id,specificity) values($1,$2,$3,'size')",[id(1005),id(s),id(3031)]);
  await q('insert into public.product_option_choice_price_overrides(product_id,product_size_id,option_choice_id,price_delta) values($1,$2,$3,$4)',[id(1005),id(s),id(3031),price]);
 }
 for(const [s,c] of [[1101,3010],[1102,3010],[1103,3011]])await q('insert into public.product_size_option_choice_compatibility(product_id,product_size_id,option_choice_id) values($1,$2,$3)',[id(1001),id(s),id(c)]);
 for(const [p] of products)await certify(db,p);
}
async function certify(db,p){await db.query('select configuration_private.certify_product($1,configuration_private.catalog_structure($1),$2)',[id(p),'Reviewed synthetic D0B3 fixture']);}
async function pricingFixture(){const f=await submissionFixture();try{await f.db.exec(readSql(foundation));await f.db.exec(readSql(engine));await seedPricingCatalog(f.db);return f;}catch(e){await f.db.close();throw e;}}
module.exports={pricingFixture,seedPricingCatalog,certify,id,line,readSql,engine};
