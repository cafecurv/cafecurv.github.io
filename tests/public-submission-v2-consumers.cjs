// Actual v2 database rows through existing admin/tracking DOM and ticket renderers.
// No frontend edits and no external requests. Fetch behavior remains separately
// covered by the existing Incoming Orders browser suite.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
const {v2Fixture,payload,line,id,query,reviewed,submit,readSql}=require('./public-submission-v2-fixture.cjs');
(async()=>{const {db}=await v2Fixture();let browser,n=0;const check=(v,m)=>{assert.ok(v,m);n++;};
const q=(s,p=[])=>query(db,s,p);
const root=path.resolve(__dirname,'..'),admin=fs.readFileSync(path.join(root,'admin/admin.js'),'utf8'),track=fs.readFileSync(path.join(root,'track/index.html'),'utf8');
const extract=(source,name)=>{const start=source.lastIndexOf('  const '+name+' =');assert(start>=0,name);const end=source.indexOf('\n  const ',start+8);assert(end>start,name);return source.slice(start,end);};
try{
 await db.exec(readSql('INCOMING_ORDERS_PHASE_O7E_TRACKING_DETAILS.sql'));await db.exec(readSql('CUSTOMER_PHASE_C2A_BACKEND.sql'));
 await q('update products set name=$1 where id=$2',['Drink <img src=x onerror=alert(1)>',id(1001)]);
 const r=await submit(db,await reviewed(db,payload(99000,[line(1001,1101,[3001,3010,3020],2,'No lid <b>please</b>')],{customer_phone:'09171234567'})));
 check(!!r.order_number,'real v2 order');const order=(await q('select * from orders where order_number=$1',[r.order_number]))[0];
 const items=await q('select * from order_items where order_id=$1 order by sort_order',[order.id]);
 const tracking=(await q('select * from get_public_order_tracking($1::uuid)',[r.tracking_token]))[0];check(tracking.items.length===1,'tracking readable item present');
 check(!JSON.stringify(tracking).includes('pricing_configuration_snapshot'),'structured snapshot stays internal');
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);await db.exec('set role authenticated');let history,detail;
 try{history=(await q('select customer_admin_order_items($1,$2) v',[order.customer_id,order.id]))[0].v;detail=(await q('select customer_admin_detail($1) v',[order.customer_id]))[0].v;}finally{await db.exec('reset role');}
 check(history.items[0].product_name===items[0].product_name,'C2 history preserves server name');check(detail.orders.some(o=>o.order_number===r.order_number),'C2 linked website order');
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.setContent('<main id="admin"></main><main id="tracking"></main>');
 const functions=['formatCurrency','getFulfillmentType','formatOptionLabel','stringifyOptionValue','formatOrderItemOptions','escapeTicketHtml','formatKitchenTicketTime','getPreparationLabel','getKitchenTicketFulfillmentLine','getKitchenTicketItemOptions','buildKitchenTicketHtml','makeElement','renderOrderItemsSection'];
 await page.addScriptTag({content:'(()=>{const orderItemsByOrderId=new Map();const orderItemsLoadError="";'+functions.map(name=>extract(admin,name)).join('\n')+'window.v2Consumer={orderItemsByOrderId,renderOrderItemsSection,buildKitchenTicketHtml,getPreparationLabel};})();'});
 await page.evaluate(({order,items})=>{v2Consumer.orderItemsByOrderId.set(order.id,items);document.querySelector('#admin').append(v2Consumer.renderOrderItemsSection(order));window.ticket=v2Consumer.buildKitchenTicketHtml(order);},{order,items});
 const text=await page.locator('#admin').textContent();check(text.includes('Oat')&&text.includes('Extra shot')&&text.includes('No lid'),'admin details options and note');check(text.includes('330.00'),'admin authoritative total');check(await page.locator('#admin img,#admin b').count()===0,'dynamic text escaped by DOM');
 check(await page.evaluate(()=>ticket.includes('Preparation: ASAP')&&ticket.includes('Milk: Oat')&&ticket.includes('&lt;img')),'kitchen real snapshot and escaping');
 check(await page.evaluate(()=>!ticket.includes('Pickup time')&&!ticket.includes('Delivery Address')),'dine-in ticket no unrelated fields');
 const label=await page.evaluate(o=>v2Consumer.getPreparationLabel({...o,preparation_timing:'scheduled',requested_preparation_at:'2026-10-06T11:42:00Z'}),order);check(label.includes('7:42'),'Manila scheduled renderer');
 await page.addScriptTag({content:'(()=>{const totalList=document.querySelector("#tracking");'+['formatCurrency','formatOptionLabel','stringifyOptionValue','formatOrderItemOptions','addOrderItems'].map(name=>extract(track,name)).join('\n')+'window.renderV2Tracking=addOrderItems;})();'});
 await page.evaluate(t=>renderV2Tracking(t.items,t.currency),tracking);const trackText=await page.locator('#tracking').textContent();check(trackText.includes('Oat')&&trackText.includes('Extra shot')&&trackText.includes('330.00'),'tracking renders persisted authoritative details');check(await page.locator('#tracking img').count()===0,'tracking escapes names');
 await q('update product_sizes set price=999 where id=$1',[id(1101)]);const persisted=await q('select * from order_items where order_id=$1 order by sort_order',[order.id]);assert.deepEqual(persisted,items);n++;
 console.log(n+' D0B5 real-row consumer assertions passed; network blocked.');
}finally{if(browser)await browser.close();await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
