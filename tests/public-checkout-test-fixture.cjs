// Quote transport for existing C1A/timing tests. End-to-end authority is covered
// separately by public-checkout-browser.cjs against real local SQL.
const fs=require('node:fs'),path=require('node:path');
async function installCheckout(page){
 await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../menu/authoritative-checkout.js'),'utf8')});
 await page.evaluate(()=>{window.checkoutFixtureRpc=handler=>({submitHandler:handler,async rpc(name,args){
  if(name==='quote_public_cart'){
   const items=args.p_request.items.map((i,line_index)=>({...i,line_index,product_name:'Fixture',category_name:'Fixture',size_label:'Each',base_price:'150.00',option_total:'0.00',unit_price:'150.00',line_total:(150*i.quantity).toFixed(2),options:[]}));
   return {data:{ok:true,quote:{pricing_contract_version:2,pricing_fingerprint_version:1,pricing_policy_version:'fixture',currency:'PHP',review_fingerprint:'a'.repeat(64),subtotal:items.reduce((s,i)=>s+Number(i.line_total),0).toFixed(2),items}}};
  }
  return this.submitHandler(name,name==='submit_public_order_v2'?{order_payload:args.p_request.payload}:args);
 }});});
}
module.exports={installCheckout};
