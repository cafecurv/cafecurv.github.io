/* Immutable ticket snapshot -> escaped 58mm HTML -> browser print transport. */
(function(root){
  'use strict';
  const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const type=value=>({dine_in:'DINE-IN',pickup:'TAKEOUT',delivery:'DELIVERY'}[value]||value||'');
  function item(s,quantity){
    if(!s)return '';
    return `<div class="item-name">${escape(quantity)}x ${escape(s.name)}</div>`+
      (s.variant?`<div class="sub">${escape(s.variant)}</div>`:'')+
      (s.options||[]).map(o=>`<div class="sub">${escape(o.group_name)}: ${escape(o.label)}</div>`).join('')+
      (s.note?`<div class="note">${escape(s.note)}</div>`:'');
  }
  function headerDetails(h){return `${escape(h.customer_name)} · ${escape(type(h.fulfillment_type))}<div class="note">${escape(h.note||'No order note')}</div>`;}
  function buildTicketHtml(ticket){
    const h=ticket.header;
    const when=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(ticket.submitted_at));
    const lines=ticket.instructions.map(i=>{
      if(i.scope==='ORDER')return `<section class="instruction"><h2>CHANGE ORDER DETAILS</h2><p>No extra preparation</p><b>BEFORE</b><div>${headerDetails(i.before)}</div><b>AFTER</b><div>${headerDetails(i.after)}</div></section>`;
      if(i.action==='CHANGE')return `<section class="instruction change"><h2>CHANGE / REPLACE</h2><b>PREVIOUS PREPARATION</b>${item(i.before,i.before.quantity)}<b>REPLACE WITH</b>${item(i.after,i.after.quantity)}</section>`;
      return `<section class="instruction ${escape(i.action.toLowerCase())}"><h2>${escape(i.action)}</h2>${item(i.action==='CANCEL'?i.before:i.after,i.quantity)}</section>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kitchen ${escape(h.order_number)} / ${escape(ticket.ticket_number)}</title><style>
@page { size:58mm auto; margin:3mm; }
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}body{width:52mm;font:12px/1.35 "Courier New",monospace;overflow-wrap:anywhere}h1,h2,p{margin:5px 0}h1{font-size:18px}h2{font-size:16px}.header{text-align:center;font-weight:bold}.instruction{border-top:1px dashed #000;padding:9px 0;break-inside:avoid}.item-name{font-size:15px;font-weight:bold}.sub{padding-left:8px}.note{font-weight:bold;white-space:pre-wrap}.cancel h2,.change h2{border:2px solid #000;padding:4px;text-align:center}.instruction b{display:block;margin-top:6px}.order-note,footer{border-top:1px dashed #000;padding-top:8px;margin-top:8px}.controls{font:14px system-ui;margin-bottom:15px}.controls button{font:inherit;padding:10px;width:100%}@media screen{body{margin:12px auto}}@media print{.controls{display:none}}
</style></head><body><div class="controls"><button id="print-ticket">Print this ticket</button><p>Printing may be canceled or unavailable. This ticket is already saved; reprint it without sending again.</p></div><main><header class="header"><h1>CURV</h1><h1>${ticket.ticket_number===1?'KITCHEN TICKET':'KITCHEN UPDATE'}</h1><p>ORDER #${escape(h.order_number)}</p><p>TICKET #${escape(ticket.ticket_number)}</p><p>${escape(h.customer_name)}</p><p>${escape(type(h.fulfillment_type))}</p><p>${escape(when)}</p></header>${lines}${h.note?`<section class="order-note"><b>ORDER NOTE</b><div class="note">${escape(h.note)}</div></section>`:''}<footer>Sent by: ${escape(ticket.submitted_by)}</footer></main><script>document.getElementById('print-ticket').onclick=function(){window.print();};window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},120);});<\/script></body></html>`;
  }
  function reserveWindow(){
    const w=root.open('','_blank','width=360,height=700');
    if(w){w.document.open();w.document.write('<!doctype html><title>Kitchen ticket</title><p>Checking the saved kitchen ticket…</p>');w.document.close();}
    return w;
  }
  function showTicket(w,ticket){if(!w||w.closed)return false;w.document.open();w.document.write(buildTicketHtml(ticket));w.document.close();return true;}
  const api={buildTicketHtml,reserveWindow,showTicket};root.CurvKitchen=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
