const assert=require('node:assert/strict');const fs=require('node:fs');const crypto=require('node:crypto');
const {raw,id}=require('./pos-effective-options-data.cjs');const {shapeCatalog,choicePrice,choiceCompatible,selectionPrice}=require('../admin/pos.js');
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};const p=shapeCatalog(raw)[0];
eq(p.sellable,true,'effective catalog sellable');
eq(choicePrice(p,p.groups[1].choices[0],id(10)),15,'size price supersedes fixed field');
eq(choicePrice(p,p.groups[1].choices[0],id(11)),35,'different size price');
eq(selectionPrice(p,id(10),[id(20),id(22)]),115,'preview total');
eq(selectionPrice(p,id(11),[id(21),id(22)]),135,'hot preview total');
eq(selectionPrice(p,id(11),[id(20)]),null,'incompatible temperature rejected');
eq(selectionPrice(p,id(10),[]),null,'required missing rejected');
eq(selectionPrice(p,id(10),[id(20),id(99)]),null,'foreign rejected');
eq(choiceCompatible(p,p.groups[0],p.groups[0].choices[0],id(10)),true,'default valid');
for(const value of [null,undefined,'',NaN,Infinity,-1]){const c={price_delta:0,price_by_size:{[id(10)]:value}};eq(choicePrice(p,c,id(10)),null,'invalid contextual value cannot become free');}
const bad=structuredClone(raw);bad.products[0].configuration_valid=false;eq(shapeCatalog(bad)[0].sellable,false,'invalid default flag blocks product');
eq(selectionPrice(shapeCatalog(raw)[1],id(10),[id(20),id(22)]),null,'no cross-product choice leakage');
const sql=fs.readFileSync('admin/POS_EFFECTIVE_OPTIONS_PHASE_P3.sql','utf8');
eq((sql.match(/^begin;$/gmi)||[]).length,1,'one transaction');eq((sql.match(/^commit;$/gmi)||[]).length,1,'one commit');
eq([...sql.matchAll(/create or replace function ([\w.]+)/gi)].map(m=>m[1]),['public.pos_get_catalog','pos_private.resolve_line'],'only intended replacements');
eq(/\b(insert into|update public\.|delete from|grant |revoke )/i.test(sql),false,'no persistent data writes or grants');
const sources=['POS_PHASE_P1A_BACKEND.sql','MENU_MANAGER_OPTION_POLICIES_PHASE3A.sql','MENU_MANAGER_CUSTOMER_OPTIONS_PHASE3B.sql'].map(f=>fs.readFileSync('admin/'+f,'utf8')).join('\n');
for(const [,signature,hash]of sql.matchAll(/\('([^']+)','([a-f0-9]{32})'\)/g)){
 const name=signature.split('(')[0].replaceAll('.','\\.');const re=new RegExp('create (?:or replace )?function '+name+'\\([^]*?as \\$\\$([^]*?)\\$\\$;','gi');const matches=[...sources.matchAll(re)];assert.ok(matches.length,signature);checks++;
 eq(crypto.createHash('md5').update(matches.at(-1)[1].replace(/\s+/g,'')).digest('hex'),hash,'reviewed source hash '+signature);
}
eq(sql.includes('configuration_private.effective_choice_price(v_product.id,p_size,id)'),true,'shared authoritative helper');
eq(sql.includes('perform pos_private.actor()'),true,'catalog authorization retained');
console.log(checks+' POS effective-options core/static checks passed.');
