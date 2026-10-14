const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('admin/MENU_MANAGER_PRODUCT_SAVE_PHASE1.sql'),js=read('admin/admin.js'),menu=read('menu/index.html');
let count=0;const check=(v,m)=>{assert.ok(v,m);count++;};
check((sql.match(/^begin;$/gm)||[]).length===1&&(sql.match(/^commit;$/gm)||[]).length===1,'single migration transaction');
check(sql.includes("set local lock_timeout = '5s'")&&sql.includes("set local statement_timeout = '30s'"),'bounded migration');
check(!/create or replace/i.test(sql),'first application does not replace existing functions');
check(!/(insert into|update|delete from) public\.(orders|order_items)\b/i.test(sql),'no historical order writes');
check(sql.includes('pg_constraint')&&sql.includes('confrelid=\'public.product_sizes\'::regclass'),'unknown size dependencies require review');
const save=js.slice(js.indexOf('  const saveDraftProduct ='),js.indexOf('  const updateEditingProductPublishedState ='));
check(save.includes("client.rpc('menu_manager_save_product'")&&!save.includes(".from('products')")&&!save.includes('menu_manager_reconcile_product_sizes'),'one browser write boundary');
check(save.includes('pendingProductSave.request')&&save.includes('pendingProductSave.serialized !== serialized'),'uncertain retry preserves request');
check(!save.includes('certify_product')&&!save.includes('expected_structure'),'no browser certification');
check(sql.includes("'request_id','product_id','expected_version','action','product','sizes'"),'closed request shape');
check(sql.includes("current_setting('transaction_isolation')<>'read committed'"),'no stale isolation snapshots');
// Frozen eligibility guard must track the current public name fallback without
// changing public-menu behavior or inventing option mappings for new products.
const rows=menu.split('const PUBLIC_APPROVED_RECIPE_ROWS = [')[1].split('\n  ];')[0];
for(const match of rows.matchAll(/\['[^']+', (".*?"|'[^']*'), '([^']*)'\]/g)){
 if(!match[2])continue;
 const name=match[1][0]==='"'?JSON.parse(match[1]):match[1].slice(1,-1);
 check(sql.includes("'"+name.toLowerCase().replaceAll("'","''")+"'"),'zero-option publish cannot masquerade as '+name);
}
check(sql.includes("'caffè mocha'"),'existing alternate recipe spelling guarded');
console.log('Menu Manager product save static: '+count+' assertions passed');
