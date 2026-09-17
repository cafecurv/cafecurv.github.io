/* P1C: authoritative saved order -> escaped unpaid copy -> browser transport. */
(function(root){
  'use strict';
  const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value));
  const finite=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>=0;
  function buildOrderCopyHtml(order){
    if(!order?.id||order.source!=='pos'||!['open','held'].includes(order.status)||order.payment_status!=='unpaid'
      ||order.currency!=='PHP'||!order.items?.length||!finite(order.subtotal)||!finite(order.total)
      ||order.items.some(i=>!Number.isInteger(i.quantity)||i.quantity<1||!finite(i.unit_price)||!finite(i.line_total)
        ||!finite(i.base_price)||(i.options?.selections||[]).some(c=>!finite(c.price_delta))))throw new Error('POS_COPY_UNAVAILABLE');
    const when=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(order.printed_at));
    const type={dine_in:'DINE-IN',pickup:'TAKEOUT',delivery:'DELIVERY'}[order.fulfillment_type]||order.fulfillment_type;
    const items=order.items.map(i=>`<section class="copy-item"><h2>${escape(i.quantity)}x ${escape(i.product_name)}</h2>
      ${i.variant_label?`<div>${escape(i.variant_label)}</div>`:''}
      ${(i.options?.selections||[]).length?`<div>Base: ${escape(money(i.base_price))} / unit</div>`:''}
      ${(i.options?.selections||[]).map(c=>`<div class="option">${escape(c.group_name)}: ${escape(c.label)} (+${escape(money(c.price_delta))} / unit)</div>`).join('')}
      ${i.item_note?`<div class="note">${escape(i.item_note)}</div>`:''}
      <div class="amount-row"><span>${escape(money(i.unit_price))} × ${escape(i.quantity)}</span><strong>${escape(money(i.line_total))}</strong></div></section>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order Copy ${escape(order.order_number)}</title><style>
@page{size:58mm auto;margin:3mm}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#000;background:#fff}body{width:52mm;font:12px/1.4 "Courier New",monospace;overflow-wrap:anywhere}header,footer{text-align:center}h1{font-size:19px;margin:5px 0}h2{font-size:14px;margin:5px 0}p{margin:6px 0}.copy-item{border-top:1px dashed #000;padding:8px 0;break-inside:avoid}.option{padding-left:5px}.note{font-weight:bold;white-space:pre-wrap;margin:5px 0}.amount-row{display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin-top:6px}.amount-row>span{min-width:0}.amount-row>strong{flex-shrink:0;text-align:right}.totals{border-top:2px solid #000;padding:8px 0}.total{font-size:16px;font-weight:bold}.unpaid{font-size:21px;font-weight:bold;border:2px solid #000;padding:5px;margin:12px 0}footer{border-top:1px dashed #000;padding-top:8px}.controls{font:14px system-ui;margin-bottom:12px}@media screen{body{margin:12px auto}}@media print{.controls{display:none}}
</style></head><body><p class="controls">This copy reflects the saved order when opened. For a fresh copy, close this view and select Print Order Copy in POS again.</p><main><header><h1>CURV</h1><h1>ORDER COPY</h1><p>ORDER #${escape(order.order_number)}</p><p>${escape(String(order.customer_name||'').trim()||'Walk-in')}</p><p>${escape(type)}</p><p>${escape(when)}</p></header>${items}
      ${order.note?`<section class="note">ORDER NOTE<br>${escape(order.note)}</section>`:''}
      <section class="totals"><div class="amount-row"><span>SUBTOTAL</span><strong>${escape(money(order.subtotal))}</strong></div><div class="amount-row total"><span>TOTAL</span><strong>${escape(money(order.total))}</strong></div></section>
      <footer><div class="unpaid">UNPAID</div><p>Order reference only.<br>Not proof of payment.</p></footer></main>
      <script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},120);});<\/script></body></html>`;
  }
  function reserveWindow(){const w=root.open('','_blank','width=360,height=700');if(w){w.document.open();w.document.write('<!doctype html><title>Order Copy</title><p>Loading the saved order…</p>');w.document.close();}return w;}
  function showCopy(w,order){if(!w||w.closed)return false;const html=buildOrderCopyHtml(order);w.document.open();w.document.write(html);w.document.close();return true;}
  const api={buildOrderCopyHtml,reserveWindow,showCopy};root.CurvCustomerPrint=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
