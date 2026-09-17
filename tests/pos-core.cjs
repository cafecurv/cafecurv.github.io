const assert=require('node:assert/strict');
const {shapeCatalog,PosStore}=require('../admin/pos.js');
const {fixture}=require('./pos-database.cjs');
(async()=>{
  const f=await fixture();let checks=0;const ok=(x,label)=>{assert.ok(x,label);checks++;};
  const memory=new Map();const storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  try {
    const raw=(await f.rpc('pos_get_catalog')).data;
    ok(shapeCatalog(raw)[0].groups[0].choices[0].is_default,'DB default preserved');
    ok(!shapeCatalog({products:[{...raw.products[0],is_sold_out:true}]})[0].sellable,'sold out not sellable');
    ok(shapeCatalog({products:[{...raw.products[0],archived_at:'today'}]}).length===0,'archived hidden');
    ok(shapeCatalog({products:[{...raw.products[0],is_available:false}]}).length===0,'unavailable hidden');
    const input={p_size:f.id(40),p_choices:[f.id(60)],p_quantity:1,p_item_note:'saved note',p_customer:'Local',p_type:'pickup',p_note:''};
    const blocked=new PosStore({rpc:()=>{throw Error('should not submit');}},{getItem:()=>null,setItem:()=>{throw Error('denied');}},f.id(2));
    await assert.rejects(blocked.execute('pos_create_order',input),/POS_STORAGE/);checks++;
    let lose=true;
    const client={rpc:async(...args)=>{const result=await f.rpc(...args);if(lose&&args[0]==='pos_create_order'){lose=false;throw Error('lost response');}return result;}};
    let s=new PosStore(client,storage,f.id(2));s.draft={editor:{note:'saved note'}};
    await assert.rejects(s.execute('pos_create_order',input));ok(Boolean(s.pending),'uncertain request retained');
    const key=s.pending.args.p_key;
    s=new PosStore(client,storage,f.id(2));ok(s.pending.args.p_key===key,'same key restored on reload');
    await s.retry();ok(s.order.items.length===1&&!s.pending,'replay completes without duplication');
    // A recorded result must be followed by current authoritative state.
    await f.rpc('pos_update_header',{p_key:f.id(900),p_order_id:s.order.id,p_revision:s.order.revision,p_customer:'Newer',p_type:'delivery',p_note:''});
    s.pending={method:'pos_create_order',args:{...input,p_key:key}};s.persist();await s.retry();
    ok(s.order.customer_name==='Newer'&&s.order.revision===2,'replay refetches newer state');
    const other=new PosStore(client,storage,f.id(3));ok(!other.pending&&!other.lastId,'local state partitioned by Auth user');
    await f.db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname,'../admin/POS_PHASE_P1A_SMOKE_TEST.sql'),'utf8'));
    checks++;console.log(checks+' POS shaping/recovery/smoke checks passed.');
  }finally{await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
