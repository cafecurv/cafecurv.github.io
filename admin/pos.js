/* CURV POS. Kitchen printing consumes only persisted immutable submission snapshots. */
(function (root) {
  'use strict';
  const money = value => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(Number(value || 0));
  const errors = {
    POS_AUTH_REQUIRED:'Sign in to use POS.', POS_ACCESS_DENIED:'You don’t have permission to perform this POS action.',
    POS_REVISION_CONFLICT:'This order changed on another device. We refreshed the latest version. Please check your change and try again.',
    POS_KEY_CONFLICT:'This saved request does not match. Ask the owner to check it before continuing.',
    POS_NOT_SELLABLE:'This item is unavailable or sold out. Choose another item.',
    POS_OPTIONS_INVALID:'Check the required options. The available choices may have changed.',
    POS_CATALOG_INVALID:'This product’s configuration needs owner review.', POS_NOT_FOUND:'This order or item is no longer available.',
    POS_STATE_INVALID:'Resume the order before editing or sending it.', POS_INVALID_INPUT:'Check the quantity, notes and order details.',
    POS_KITCHEN_NO_CHANGES:'All saved kitchen updates have already been sent.',
    POS_COPY_EMPTY:'Add and save an item before printing an Order Copy.',
    POS_COPY_UNAVAILABLE:'An unpaid Order Copy is not available for this order.'
  };
  function shapeCatalog(raw) {
    return (raw.products || []).filter(p => !p.archived_at && p.is_available !== false).map(p => {
      const sizes = (p.sizes || []).filter(s => Number.isFinite(Number(s.price)) && Number(s.price)>=0);
      const groups = (p.groups || []).map(g => ({...g, choices:(g.choices || []).map(c => ({...c,price_delta:Number(c.price_delta)}))}));
      const invalid = groups.some(g => !['single','multi'].includes(g.selection_type)
        || g.choices.some(c => !Number.isFinite(c.price_delta) || c.price_delta<0)
        || Math.max(g.min_selections || 0,g.is_required?1:0)>g.choices.length
        || (g.selection_type==='single' && Math.max(g.min_selections || 0,g.is_required?1:0)>1));
      // No invented legacy choices/prices. Temperature is an ordinary DB option.
      return {...p,sizes,groups,sellable:!p.is_sold_out && sizes.length>0 && !invalid};
    });
  }
  class PosStore {
    constructor(client,storage,userId) {
      this.client=client; this.storage=storage; this.key='curv-pos-p1a:'+userId; this.userId=userId;
      this.order=null; this.busy=false; this.pending=null; this.draft={}; this.lastId=null;
      const saved=JSON.parse(storage.getItem(this.key)||'{}');
      this.pending=saved.pending || null; this.lastId=saved.lastId || null; this.draft=saved.draft || {};
    }
    persist() { this.storage.setItem(this.key,JSON.stringify({pending:this.pending,lastId:this.lastId,draft:this.draft})); }
    async read(id) { const {data,error}=await this.client.rpc('pos_get_order',{p_order_id:id}); if(error) throw error; this.order=data; this.lastId=id; this.refreshRequired=false; this.persist(); return data; }
    async execute(method,args) {
      if(this.busy || this.pending) throw new Error('POS_PENDING');
      this.pending={method,args:{...args,p_key:root.crypto.randomUUID()}};
      try { this.persist(); } catch(e) { this.pending=null; throw new Error('POS_STORAGE'); }
      return this.retry();
    }
    async retry() {
      if(this.busy || !this.pending) return;
      this.busy=true; const command=this.pending;
      try {
        const {data,error}=await this.client.rpc(command.method,command.args);
        if(error) throw error;
        this.lastSubmission=data.kitchen_submission||null;
        this.order=data; this.lastId=data.id; this.pending=null; this.draft={}; this.persist();
        // A replay returns the original result; refetch before enabling edits in
        // case another device changed the order since that result was committed.
        try { await this.read(data.id); } catch(e) { this.refreshRequired=true; }
        return this.order;
      } catch(error) {
        const detail=error.details || error.detail || '';
        const definitive=Boolean(errors[detail]) || /^(22|23|42501)/.test(error.code || '');
        if(!definitive && !this.pending) this.pending=command; // A failed local acknowledgement must not unlock a repeat action.
        if(definitive && detail!=='POS_KEY_CONFLICT') {
          this.pending=null; this.persist();
          if(detail==='POS_REVISION_CONFLICT'||detail==='POS_KITCHEN_NO_CHANGES') {
            try { await this.read(command.args.p_order_id); } catch(e) { this.refreshRequired=true; }
          }
        }
        throw error;
      } finally { this.busy=false; }
    }
  }
  const api={shapeCatalog,PosStore,money,errors};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.CurvPOS=api;
  if(!root.document || !document.getElementById('workspace')) return;
  const $=id=>document.getElementById(id);
  const client=root.supabase?.createClient('https://tjqnmyjttqukowcehzmq.supabase.co','sb_publishable_tkWA-7LTA9R5wKw7_vi_ng_YDYnS1M0',
    {auth:{storageKey:'curv-pos-auth',detectSessionInUrl:false}});
  let store=null, catalog=[], selected=null, editId=null, generation=0, activeUser=null, headerDirty=false, loading=false;
  function say(text) { $('status').textContent=text; }
  function node(tag,text,cls) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n; }
  function button(text,fn,disabled=false) { const b=node('button',text); b.type='button'; b.disabled=disabled; b.addEventListener('click',fn); return b; }
  function safeImage(url) { try { const u=new URL(url,location.href); return ['https:','http:'].includes(u.protocol)?u.href:''; } catch(e) { return ''; } }
  function lock() {
    const blocked=loading || !store || store.busy || Boolean(store.pending) || store.refreshRequired;
    $('workspace').querySelectorAll('button,input,select,textarea').forEach(n=>{ if(n.id!=='retry') n.disabled=blocked || n.dataset.unavailable==='true'; });
    $('recovery').hidden=!store?.pending && !store?.refreshRequired;
    $('retry').disabled=Boolean(store?.busy);
    if(store?.order?.status==='held') {
      ['header-editor','item-editor'].forEach(id=>$(id).querySelectorAll('input,select,textarea,button').forEach(n=>n.disabled=true));
    }
    if($('item-editor').dataset.quantityOnly==='true') {
      $('size').disabled=true; $('options').querySelectorAll('input').forEach(n=>n.disabled=true);
    }
  }
  function header() { return {customer:$('customer').value,type:$('order-type').value,note:$('order-note').value}; }
  function editorDraft() { return selected?{product:selected.id,editId,quantityOnly:$('item-editor').dataset.quantityOnly==='true',size:$('size').value,choices:choices(),quantity:$('quantity').value,note:$('item-note').value}:null; }
  function saveDraft() {
    if(!store || store.busy || store.pending) return;
    store.draft={header:header(),headerDirty,editor:editorDraft()};
    try { store.persist(); } catch(e) { say('Browser storage is unavailable. Your changes cannot be safely submitted.'); }
  }
  function args() { return {p_order_id:store.order.id,p_revision:store.order.revision}; }
  function describe(method,p) { return `${method.replace('pos_','').replaceAll('_',' ')}${p.p_quantity?' · quantity '+p.p_quantity:''}${p.p_item_note?' · note: '+p.p_item_note:''}${p.p_customer?' · customer: '+p.p_customer:''}`; }
  function showSavedTicket(w,ticket) {
    const shown=ticket&&root.CurvKitchen?.showTicket(w,ticket);
    if(!shown){w?.close();say('Kitchen ticket saved. Allow pop-ups and use Reprint Last Ticket to open it.');}
    else say('Kitchen ticket saved and print view opened. Physical printing is not confirmed.');
  }
  async function command(method,p) {
    const current=store, token=generation;
    const printWindow=method==='pos_send_kitchen'?root.CurvKitchen?.reserveWindow():null;
    saveDraft();
    const promise=current.execute(method,p); lock();
    try {
      await promise; if(token!==generation){printWindow?.close();return;}
      headerDirty=false; selected=null; editId=null; $('item-editor').hidden=true; $('proposal').hidden=true;
      renderOrder(); say(current.refreshRequired?'Saved. Refresh the order before making another change.':'Order saved.');
      if(method==='pos_send_kitchen')showSavedTicket(printWindow,current.lastSubmission);
    } catch(e) {
      printWindow?.close();
      if(token!==generation)return;
      const detail=e.details||e.detail;
      say(errors[detail] || (e.message==='POS_STORAGE'?'Browser storage is unavailable. Nothing was submitted.':
        current.pending?'We’re checking whether that change was saved. Don’t submit it again yet.':'Check your entry and try again.'));
      $('proposal').textContent='Your attempted change: '+describe(method,p); $('proposal').hidden=false;
      renderOrder(true);
    } finally { if(token===generation)lock(); }
  }
  function renderOrder(preserveDraft=false) {
    const o=store?.order;
    $('order-number').textContent=o?o.order_number:'New Order';
    $('order-state').textContent=o?`${o.status.toUpperCase()} · Revision ${o.revision}`:'Add the first item to save this order.';
    if(!preserveDraft) { $('customer').value=o?.customer_name||''; $('order-type').value=o?.fulfillment_type||'dine_in'; $('order-note').value=o?.note||''; }
    $('save-header').hidden=!o; $('hold').hidden=!o || o.status!=='open'; $('resume').hidden=!o || o.status!=='held';
    $('print-order-copy').dataset.unavailable=String(!o?.items?.length||!['open','held'].includes(o?.status));
    $('total').textContent=money(o?.total); $('items').replaceChildren();
    for(const i of o?.items || []) {
      const line=node('article',undefined,'pos-line'); line.append(node('strong',`${i.quantity} × ${i.product_name}`),node('p',i.variant_label),node('p',money(i.line_total)));
      for(const c of i.options?.selections || []) line.append(node('p',`${c.group_name}: ${c.label} (${money(c.price_delta)})`));
      if(i.item_note) line.append(node('p',i.item_note));
      if(o.kitchen){const pending=o.kitchen.pending.find(p=>p.order_item_id===i.id);
        line.append(node('span',!pending?'✓ SENT':pending.action==='CANCEL'?'CANCEL PENDING':pending.action==='ADD'&&!pending.before?'NEW':'CHANGED','kitchen-marker'));}
      const editable=o.status==='open';
      const edit=button('Edit quantity / note',()=>openEditor(i,false),!editable);
      const configure=button('Change configuration',()=>openEditor(i,true),!editable);
      const remove=button('Remove',()=>{ if(confirm('Remove '+i.product_name+'?'))command('pos_remove_item',{...args(),p_item_id:i.id}); },!editable);
      [edit,configure,remove].forEach(b=>b.dataset.unavailable=String(!editable));
      line.append(edit,configure,remove); $('items').append(line);
      if(o.kitchen&&i.quantity>1){const split=button('Split quantity',()=>{
        const value=prompt('How many units should move to a separate line? Edit that new line before sending.');
        if(value===null)return;const quantity=Number(value);
        if(!Number.isInteger(quantity)||quantity<1||quantity>=i.quantity){say('Choose at least one unit and fewer than the whole line.');return;}
        if(headerDirty||selected){say('Save or cancel your edits before splitting.');return;}
        command('pos_split_item',{...args(),p_item_id:i.id,p_quantity:quantity});
      },!editable);split.dataset.unavailable=String(!editable);line.append(split);}
    }
    $('kitchen').hidden=!o?.kitchen;
    if(o?.kitchen){const k=o.kitchen;
      $('kitchen-status').textContent=k.pending_count?`${k.pending_count} kitchen updates pending`:'✓ ALL ITEMS SENT';
      $('kitchen-pending').replaceChildren();
      for(const p of k.pending)$('kitchen-pending').append(node('p',p.scope==='ORDER'?'CHANGED — order details':
        `${p.action==='CANCEL'?'CANCEL PENDING':p.action==='CHANGE'?'CHANGED':'NEW / ADD'} ${p.quantity} × ${(p.after||p.before).name}`,'kitchen-pending-line'));
      $('send-kitchen').dataset.unavailable=String(!k.pending_count||o.status!=='open');
      $('reprint-kitchen').dataset.unavailable=String(!k.last_submission_id);
    }
  }
  function renderProducts() {
    const search=$('search').value.trim().toLowerCase(), cat=$('category').value, section=$('section').value;
    $('products').replaceChildren();
    for(const p of catalog.filter(p=>(!cat||p.category_id===cat)&&(!section||p.section_id===section)&&p.name.toLowerCase().includes(search))) {
      const b=button('',()=>selectProduct(p)); b.dataset.unavailable=String(!p.sellable); b.disabled=!p.sellable;
      const image=safeImage(p.image_url); if(image) { const img=node('img'); img.src=image; img.alt=''; img.loading='lazy'; b.append(img); }
      b.append(node('strong',p.name),node('small',p.is_sold_out?'Sold out':!p.sellable?'Configuration needs review':money(Math.min(...p.sizes.map(s=>Number(s.price))))));
      $('products').append(b);
    }
    lock();
  }
  function choices() { return [...$('options').querySelectorAll('input:checked')].map(n=>n.value).sort(); }
  function selectProduct(p,existing=null,quantityOnly=false) {
    selected=p; editId=existing?.id||null; $('item-editor').hidden=false; $('item-editor').dataset.quantityOnly=String(quantityOnly);
    $('item-title').textContent=p.name; $('size').replaceChildren();
    for(const s of p.sizes) { const option=node('option',s.label+' · '+money(s.price)); option.value=s.id; $('size').append(option); }
    if(existing)$('size').value=existing.product_size_id;
    $('options').replaceChildren();
    for(const g of p.groups) {
      const f=node('fieldset'); f.append(node('legend',g.name+(g.is_required?' (required)':'')));
      for(const c of g.choices) {
        const label=node('label'); const input=node('input'); input.type=g.selection_type==='single'?'radio':'checkbox'; input.name='group-'+g.id; input.value=c.id;
        input.checked=existing?(existing.options?.selections||[]).some(s=>s.choice_id===c.id):Boolean(c.is_default);
        label.append(input,document.createTextNode(c.label+' · '+money(c.price_delta))); f.append(label);
      }
      if(g.selection_type==='single' && !g.is_required && !g.min_selections) {
        const label=node('label');const input=node('input');input.type='radio';input.name='group-'+g.id; input.value='';
        input.checked=![...f.querySelectorAll('input')].some(n=>n.checked);label.append(input,document.createTextNode('None'));f.append(label);
      }
      $('options').append(f);
    }
    $('quantity').value=existing?.quantity||1; $('item-note').value=existing?.item_note||'';
    $('save-item').textContent=editId?(quantityOnly?'Save quantity / note':'Apply current catalog configuration'):'Add item';
    $('configuration-notice').textContent=(quantityOnly?'Saved price and options will be retained.':editId?'Changing configuration uses current catalog prices.':'Only configured sizes and options are offered. Ask the owner if a choice is missing.')+
      (existing?.quantity>1&&store.order?.kitchen?' Notes/options apply to the whole line. To change only some units, cancel and use Split quantity first.':'');
    lock(); if(quantityOnly) { $('size').disabled=true; $('options').querySelectorAll('input').forEach(n=>n.disabled=true); }
    estimate(); saveDraft(); $('item-title').scrollIntoView({block:'nearest'});
  }
  function openEditor(i,configure) {
    const p=catalog.find(p=>p.id===i.product_id);
    if(configure && !p?.sellable) { say('This product cannot be reconfigured. Quantity and note edits remain available.');return; }
    selectProduct(p||{id:i.product_id,name:i.product_name,sizes:[{id:i.product_size_id,label:i.variant_label,price:i.base_price}],groups:[]},i,!configure);
  }
  function estimate() {
    const old=store?.order?.items.find(i=>i.id===editId);
    const price=$('item-editor').dataset.quantityOnly==='true'?Number(old?.unit_price):
      Number(selected?.sizes.find(s=>s.id===$('size').value)?.price||0)+(selected?.groups||[]).flatMap(g=>g.choices).filter(c=>choices().includes(c.id)).reduce((sum,c)=>sum+Number(c.price_delta),0);
    $('estimate').textContent='Item total '+money(price*Number($('quantity').value||0));
  }
  async function loadCatalog() {
    const token=generation;
    const {data,error}=await client.rpc('pos_get_catalog'); if(error)throw error;
    if(token!==generation)return;
    catalog=shapeCatalog(data); for(const [id,key,name] of [['category','category_id','category_name'],['section','section_id','section_name']]) {
      $(id).replaceChildren(new Option(id==='category'?'All categories':'All sections',''));
      const seen=new Set();for(const p of catalog)if(p[key]&&!seen.has(p[key])) {seen.add(p[key]);$(id).append(new Option(p[name]||'Unsectioned',p[key]));}
    } renderProducts();
  }
  async function sessionChanged(session) {
    if(session?.user?.id===activeUser && store)return;
    const token=++generation; activeUser=session?.user?.id||null; store=null;catalog=[];selected=null;editId=null;headerDirty=false;loading=false;
    $('workspace').hidden=true; $('owner-link').hidden=true; $('identity').textContent=''; $('sign-out').hidden=!session; $('login').hidden=Boolean(session);
    $('item-editor').hidden=true; $('open-list').hidden=true; $('proposal').hidden=true; $('open-list').replaceChildren();
    if(!session){say('Sign in to use POS.');return;}
    try {
      const {data,error}=await client.rpc('pos_get_access'); if(error)throw error;
      if(token!==generation)return;
      store=new PosStore(client,localStorage,data.user_id); $('identity').textContent=data.name; $('owner-link').hidden=!data.is_owner;
      const draft=store.draft;
      if(store.lastId) await store.read(store.lastId);
      if(token!==generation)return;
      $('workspace').hidden=false; renderOrder(); await loadCatalog();
      if(token!==generation)return;
      if(draft.header) { $('customer').value=draft.header.customer; $('order-type').value=draft.header.type; $('order-note').value=draft.header.note;headerDirty=Boolean(draft.headerDirty); }
      if(draft.editor) { const e=draft.editor,p=catalog.find(p=>p.id===e.product);if(p) {selectProduct(p,store.order?.items.find(i=>i.id===e.editId),e.quantityOnly);$('size').value=e.size;$('quantity').value=e.quantity;$('item-note').value=e.note;$('options').querySelectorAll('input').forEach(n=>n.checked=e.choices.includes(n.value));estimate();saveDraft();} }
      say(store.pending?'A saved request needs checking before you continue.':'Ready to take orders.');lock();
    }catch(e){ if(token===generation){say(errors[e.details||e.detail]||'POS could not load. Check your connection, then sign out and try again.');$('sign-out').hidden=false;} }
  }
  $('login').addEventListener('submit',async e=>{e.preventDefault();$('login').querySelector('button').disabled=true;try { const {data,error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;$('password').value='';await sessionChanged(data.session); }catch(e){say('Sign-in failed. Check your credentials and try again.');}finally{$('login').querySelector('button').disabled=false;}});
  $('sign-out').onclick=async()=>{await client.auth.signOut({scope:'local'});sessionChanged(null);};
  $('header-editor').addEventListener('input',()=>{headerDirty=true;saveDraft();});
  $('header-editor').onsubmit=e=>{e.preventDefault();if(store.order){const h=header();command('pos_update_header',{...args(),p_customer:h.customer,p_type:h.type,p_note:h.note});}};
  $('item-editor').addEventListener('input',()=>{estimate();saveDraft();});
  $('item-editor').onsubmit=e=>{e.preventDefault();if(!selected)return;const common={p_quantity:Number($('quantity').value),p_item_note:$('item-note').value};
    if(editId && $('item-editor').dataset.quantityOnly==='true')return command('pos_update_item',{...args(),p_item_id:editId,...common});
    const line={...common,p_size:$('size').value,p_choices:choices().filter(Boolean)};
    if(editId)return command('pos_configure_item',{...args(),p_item_id:editId,...line});
    if(store.order) {if(headerDirty){say('Save your order details before adding another item.');return;}return command('pos_add_item',{...args(),...line});}
    const h=header();command('pos_create_order',{...line,p_customer:h.customer,p_type:h.type,p_note:h.note});};
  $('cancel-item').onclick=()=>{selected=null;editId=null;$('item-editor').hidden=true;saveDraft();};
  $('hold').onclick=()=>{if(headerDirty){say('Save your order details before holding.');return;}command('pos_hold_order',args());};
  $('resume').onclick=()=>command('pos_resume_order',args());
  $('print-order-copy').onclick=async()=>{
    if(!store?.order||store.pending||store.busy||loading)return;
    if(headerDirty||selected){say('Save or cancel your edits before printing an Order Copy.');return;}
    const token=generation,id=store.order.id;let w;
    loading=true;lock();
    try{
      w=root.CurvCustomerPrint?.reserveWindow();
      if(!w){say('Allow pop-ups, then select Print Order Copy again. The order has not changed.');return;}
      const {data,error}=await client.rpc('pos_get_order_copy',{p_order_id:id});if(error)throw error;
      if(token!==generation){w.close();return;}
      if(!root.CurvCustomerPrint.showCopy(w,data)){say('Print view was closed. Select Print Order Copy again. The order has not changed.');return;}
      say('Unpaid Order Copy opened from the latest saved order. Physical printing is not confirmed.');
    }catch(e){w?.close();if(token===generation)say(errors[e.details||e.detail||e.message]||'Could not open the Order Copy. Try again. The order has not changed.');}
    finally{if(token===generation){loading=false;lock();}}
  };
  $('send-kitchen').onclick=()=>{if(headerDirty||selected){say('Save or cancel your edits before sending kitchen updates.');return;}command('pos_send_kitchen',args());};
  $('reprint-kitchen').onclick=async()=>{
    const token=generation,id=store.order?.kitchen?.last_submission_id;if(!id)return;
    const w=root.CurvKitchen?.reserveWindow();loading=true;lock();
    try{const {data,error}=await client.rpc('pos_get_kitchen_ticket',{p_submission_id:id});if(error)throw error;
      if(token!==generation){w?.close();return;}showSavedTicket(w,data);
    }catch(e){w?.close();if(token===generation)say(errors[e.details||e.detail]||'Could not load the saved ticket. Try Reprint again.');}
    finally{if(token===generation){loading=false;lock();}}
  };
  $('new-order').onclick=()=>{if((headerDirty||selected)&&!confirm('Leave these unsaved edits?'))return;store.order=null;store.lastId=null;store.draft={};store.persist();headerDirty=false;selected=null;editId=null;$('item-editor').hidden=true;renderOrder();lock();};
  $('open-orders').onclick=async()=>{const token=generation;loading=true;lock();try {const {data,error}=await client.rpc('pos_list_open_orders');if(error)throw error;if(token!==generation)return;$('open-list').replaceChildren(node('h2','Open orders'));
    for(const o of data)$('open-list').append(button(`${o.order_number} · ${o.customer_name} · ${{dine_in:'Dine-In',pickup:'Takeout',delivery:'Delivery'}[o.fulfillment_type]} · ${o.status.toUpperCase()} · ${money(o.total)} · ${new Date(o.updated_at).toLocaleString('en-PH')} — Open`,async()=>{
      if((headerDirty||selected)&&!confirm('Leave these unsaved edits?'))return;
      const readToken=generation,current=store;loading=true;lock();
      try{await current.read(o.id);if(readToken!==generation)return;current.draft={};current.persist();headerDirty=false;selected=null;editId=null;$('item-editor').hidden=true;$('open-list').hidden=true;renderOrder();}
      catch(e){if(readToken===generation)say('Could not open this order. Try again.');}
      finally{if(readToken===generation){loading=false;lock();}}}));
    if(!data.length)$('open-list').append(node('p','No open counter orders.'));$('open-list').hidden=false;}
    catch(e){if(token===generation)say('Could not load open orders. Try again.');}
    finally{if(token===generation){loading=false;lock();}}};
  $('retry').onclick=async()=>{const token=generation,current=store,kitchen=current.pending?.method==='pos_send_kitchen',w=kitchen?root.CurvKitchen?.reserveWindow():null;
    try {const p=current.pending?current.retry():current.read(current.lastId);lock();await p;if(token!==generation){w?.close();return;}headerDirty=false;selected=null;editId=null;$('item-editor').hidden=true;renderOrder();say(current.refreshRequired?'Saved. Refresh the order before continuing.':'Latest order loaded. Check it before continuing.');if(kitchen)showSavedTicket(w,current.lastSubmission);}
    catch(e){w?.close();if(token===generation)say(errors[e.details||e.detail]||'Still unable to confirm. Please check again before making changes.');}finally{if(token===generation)lock();}};
  $('refresh-catalog').onclick=()=>loadCatalog().then(()=>say('Products refreshed.')).catch(()=>say('Products could not refresh. Try again.'));
  ['search','category','section'].forEach(id=>$(id).addEventListener('input',renderProducts));
  if(client) {client.auth.onAuthStateChange((_event,session)=>setTimeout(()=>sessionChanged(session),0));client.auth.getSession().then(({data})=>sessionChanged(data.session)).catch(()=>say('Sign-in could not load. Refresh and try again.'));}
  else say('POS could not start. Check your connection and refresh.');
})(typeof globalThis!=='undefined'?globalThis:this);
