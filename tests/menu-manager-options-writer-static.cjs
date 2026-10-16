// Static contract parity: no database or network access.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8').replace(/\r\n/g,'\n');
const sql=read('admin/MENU_MANAGER_CUSTOMER_OPTIONS_PHASE3B.sql'),html=read('menu/index.html');let n=0;
const check=(v,m)=>{assert.ok(v,m);n++;};
const recipes=JSON.parse(sql.split('$recipes$')[1]);
const rows=vm.runInNewContext(html.match(/const PUBLIC_APPROVED_RECIPE_ROWS\s*=\s*(\[[\s\S]*?\n  \]);/)[1]);
for(const [id,name,keys]of rows){const row=recipes.find(x=>x.id===id);check(row&&row.name===name.toLowerCase()&&JSON.stringify(row.keys)===JSON.stringify(keys.split(' ').filter(Boolean).sort()),'recipe parity '+name);}
const matcha=vm.runInNewContext(html.match(/const MATCHA_ITEMS\s*=\s*(\[[\s\S]*?\n  \]);/)[1]);
for(const item of matcha){const row=recipes.find(x=>x.name===item.name.toLowerCase());const keys=[...(item.has_milk?['milk']:[]),...(item.has_sweetener?['sweetener']:[]),...(item.has_extra_powder?['extrapower']:[])].sort();check(row&&JSON.stringify(row.keys)===JSON.stringify(keys),'matcha parity '+item.name);}
check((sql.match(/^begin;$/gm)||[]).length===1&&(sql.match(/^commit;$/gm)||[]).length===1,'single transaction');
check(sql.includes("lock_timeout='5s'")&&sql.includes("statement_timeout='60s'"),'installation timeouts');
check(!/create (?:or replace )?function public\.(quote_public_cart|submit_public_order)/i.test(sql),'checkout endpoints untouched');
check(!/\b(insert into|update|delete from)\s+(?:public\.)?(orders|order_items|option_groups|option_choices)\b/i.test(sql),'no order or shared library writes');
const body=(s,name)=>s.match(new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;','i'))?.[1];
const sources=['MENU_MANAGER_OPTION_POLICIES_PHASE3A.sql','MENU_MANAGER_PRODUCT_SAVE_PHASE1.sql'].map(f=>read('admin/'+f));
for(const [,signature,hash]of sql.matchAll(/\('([^']+\([^']*\))','([a-f0-9]{32})'\)/g)){
 const original=sources.map(s=>body(s,signature.split('(')[0])).find(Boolean);
 check(original&&crypto.createHash('md5').update(original.replace(/\s+/g,'')).digest('hex')===hash,'prerequisite guard '+signature);
}
check(sql.includes("p_request ? 'options' then perform menu_save_private.reconcile_options"),'omission preserves configuration');
check(sql.includes('replay.request is distinct from p_request'),'full request replay identity');
check(sql.includes("'options_library',menu_save_private.options_library_version()"),'library participates in stale protection');
check(sql.includes('from public,anon,authenticated;'),'private helpers restricted');
console.log('Phase 3B static: '+n+' assertions passed');
