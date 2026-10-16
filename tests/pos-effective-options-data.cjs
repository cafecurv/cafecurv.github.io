// Offline synthetic catalog; no database or network access.
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const raw={products:[{id:id(1),name:'Effective Latte',is_available:true,effective_options_version:1,configuration_valid:true,
 sizes:[{id:id(10),label:'Regular',price:100},{id:id(11),label:'Hot 12oz',price:100}],
 temperature_compatibility:[{size_id:id(10),choice_id:id(20)},{size_id:id(11),choice_id:id(21)}],
 groups:[{id:id(30),key:'temperature',name:'Temperature',selection_type:'single',is_required:true,min_selections:1,max_selections:1,
 choices:[{id:id(20),label:'Iced',price_delta:0,price_by_size:{[id(10)]:0,[id(11)]:0},is_default:true},{id:id(21),label:'Hot',price_delta:0,price_by_size:{[id(10)]:0,[id(11)]:0}}]},
 {id:id(31),key:'milk',name:'Milk',selection_type:'single',is_required:false,min_selections:0,max_selections:1,
 choices:[{id:id(22),label:'Oat',price_delta:25,price_by_size:{[id(10)]:15,[id(11)]:35}}]}]}]};
raw.products.push({...structuredClone(raw.products[0]),id:id(2),name:'Other Latte',groups:[structuredClone(raw.products[0].groups[0])]});
module.exports={raw,id};
