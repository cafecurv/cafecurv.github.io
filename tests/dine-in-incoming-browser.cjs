
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CURV_PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let n=0;const check=(v,m)=>{assert.ok(v,m);n++;};
const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 window.fixtureOrders=[{id:'00000000-0000-4000-8000-000000000001',order_number:'C-DINE',source:'website',status:'submitted',customer_name:'Dine Guest',customer_phone:'',fulfillment_type:'dine_in',pickup_time:null,payment_method:'counter',payment_status:'unpaid',delivery_fee_status:'not_applicable',subtotal:100,total:100,currency:'PHP',created_at:new Date().toISOString()}];
 for(const [i,type]of ['pickup','delivery'].entries())fixtureOrders.push({...fixtureOrders[0],id:'00000000-0000-4000-8000-00000000000'+(i+2),order_number:'C-'+type.toUpperCase(),fulfillment_type:type,customer_phone:'09171234567',pickup_time:'ASAP',delivery_address:type==='delivery'?'Fixture street':null});
 window.queries=[];window.mutations=[];window.schemaErrors=[];
 window.open=()=>({document:{open(){},write(html){window.ticketHtml=html;},close(){}}});
 const chain=(table)=>{const filters=[];let change=null,single=false,columns='';let proxy;proxy=new Proxy({}, {get:(_,key)=>{
 if(key==='then')return resolve=>{if(table==='orders'&&/preparation_timing|requested_preparation_at/.test(columns)){schemaErrors.push(columns);return Promise.resolve({data:null,error:{code:'42703',message:'column orders.preparation_timing does not exist'}}).then(resolve);}let data=table==='orders'?fixtureOrders:table==='order_items'?[{id:'i',order_id:fixtureOrders[0].id,product_name:'Saved item',quantity:1,unit_price:100,line_total:100,options:{}}]:[];
 for(const [method,col,value]of filters){if(method==='eq')data=data.filter(r=>r[col]===value);if(method==='in')data=data.filter(r=>value.includes(r[col]));}
 if(change){for(const row of data)Object.assign(row,change);mutations.push(change);}
 if(columns&&columns!=='*')data=data.map(row=>Object.fromEntries(columns.split(',').filter(c=>c in row).map(c=>[c,row[c]])));
 return Promise.resolve({data:single?(data[0]||null):structuredClone(data),count:data.length,error:null}).then(resolve);};
 return (...args)=>{queries.push({table,method:key,args});if(['eq','in'].includes(key))filters.push([key,...args]);if(key==='update')change=args[0];if(key==='select')columns=args[0];if(['single','maybeSingle'].includes(key))single=true;return proxy;};
 }});return proxy;};
 const channel={on(event,filter,callback){if(filter?.table==='orders')window.realtimeCallback=callback;return this;},subscribe(){return this;},unsubscribe(){}};
 window.supabase={createClient:()=>({from:chain,rpc:async()=>({data:{website_ordering_enabled:true},error:null}),channel:()=>channel,removeChannel:async()=>{},auth:{getSession:async()=>({data:{session:{user:{id:'owner',email:'owner@example.test'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};
});
const root=path.resolve(__dirname,'..');await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin==='https://curv.test'&&['/admin/incoming-orders.html','/admin/admin.js','/admin/admin.css'].includes(u.pathname))return r.fulfill({path:path.join(root,u.pathname.slice(1))});return r.abort();});
try{
await page.goto('https://curv.test/admin/incoming-orders.html');await page.locator('[data-order-list]').getByText('C-DINE',{exact:true}).first().waitFor();
check(true,'Active filter includes submitted dine-in');
await page.locator('[data-order-filter="submitted"]').click();await page.waitForFunction(()=>document.querySelector('[data-order-list]').textContent.includes('C-DINE'));
check(true,'New filter includes dine-in');
// Select the rendered order using the real list control.
await page.locator('[data-order-list]').getByText('C-DINE',{exact:true}).first().click();
await page.waitForFunction(()=>document.querySelector('[data-order-list]').textContent.includes('Preparation'));
let detail=await page.locator('[data-order-list]').textContent();check(detail.includes('Preparation')&&detail.includes('Not specified'),'legacy timing absence renders safely');check(!detail.includes('Preferred pickup time')&&!detail.includes('Preferred delivery time')&&!detail.includes('Delivery Address'),'dine-in contains no pickup/delivery timing or address');
check(await page.evaluate(()=>!queries.some(q=>q.table==='orders'&&q.method==='select'&&/preparation_timing|requested_preparation_at/.test(q.args[0]))),'order reads use current schema');
check(await page.evaluate(()=>!queries.some(q=>q.table==='orders'&&q.method==='eq'&&q.args[0]==='fulfillment_type')),'no fulfillment exclusion');


check(await page.locator('[data-order-list]').textContent().then(t=>t.includes('C-PICKUP')&&t.includes('C-DELIVERY')),'Pickup and Delivery load alongside legacy dine-in');
await page.locator('[data-order-list]').getByRole('button',{name:'Print Ticket',exact:true}).click();
check(await page.evaluate(()=>ticketHtml.includes('DINE IN')&&!ticketHtml.includes('undefined')),'legacy kitchen ticket renders without timing columns');
await page.locator('[data-order-search-input]').fill('C-DINE');
await page.waitForFunction(()=>queries.some(q=>q.table==='orders'&&q.method==='select'&&q.args[0].startsWith('id,order_number,status,customer_name')));
check(await page.locator('[data-order-search-results]').textContent().then(t=>t.includes('C-DINE')),'current-schema search index works');
await page.locator('[data-order-search-input]').fill('');
await page.evaluate(()=>{window.beforeRealtimeReads=queries.filter(q=>q.table==='orders'&&q.method==='select').length;realtimeCallback({new:fixtureOrders[0]});});
await page.waitForFunction(()=>queries.filter(q=>q.table==='orders'&&q.method==='select').length>beforeRealtimeReads);
await page.waitForFunction(()=>document.querySelector('[data-order-list]').textContent.includes('C-DINE'));
check(true,'realtime refresh succeeds without new columns');
// Reopen after refresh if selection was reset.
if(await page.locator('[data-order-list]').getByRole('button',{name:'Accept',exact:true}).count()===0)await page.locator('[data-order-list]').getByText('C-DINE',{exact:true}).first().click();
for(const [label,status]of [['Accept','accepted'],['Mark Preparing','preparing'],['Mark Ready','ready'],['Complete','completed']]) {
 await page.locator('[data-order-list]').getByRole('button',{name:label,exact:true}).click();
 await page.waitForFunction(status=>fixtureOrders[0].status===status,status);
 await page.waitForFunction(()=>!document.querySelector('[data-order-list]').textContent.includes('Loading orders'));
 check(await page.evaluate(status=>mutations.some(m=>m.status===status),status),'real status action '+status);
 if(status!=='completed')await page.locator('.order-ticket-summary').first().click();
}
check(await page.evaluate(()=>schemaErrors.length===0),'no missing-column error across reads, counters, search and refresh');
check(errors.length===0,errors.join('\n'));
console.log(n+' Incoming Orders browser assertions passed; network intercepted.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
