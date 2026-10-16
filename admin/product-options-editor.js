/* Product-local draft only. All persistence belongs to the main product Save. */
(() => {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const node = (tag, text, cls) => { const e=document.createElement(tag); if(text!==undefined)e.textContent=text; if(cls)e.className=cls; return e; };
  const button = (text, fn) => { const b=node('button',text,'auth-button secondary');b.type='button';b.addEventListener('click',fn);return b; };
  const money = n => Number(n)===0?'Included':'+₱'+Number(n).toLocaleString('en-PH');
  window.CurvProductOptions = { create(host,onChange,getSizes,getProduct) {
    let data=null, groups=[], baseline='[]', editing=null;
    const changed=()=>onChange();
    const sizes=()=>getSizes().filter(s=>s.id);
    const field=(label,input)=>{input.setAttribute('aria-label',label);const wrap=node('label',undefined,'admin-field');wrap.append(node('span',label),input);return wrap;};
    const toggle=(label,value,fn)=>{const e=node('input');e.type='checkbox';e.checked=value;e.addEventListener('change',()=>fn(e.checked));return field(label,e);};
    const charge=(label,value,fn)=>{const e=node('input');e.type='number';e.min='0';e.max='999999.99';e.step='0.01';e.inputMode='decimal';e.value=value??'';e.placeholder='Use shared charge';e.addEventListener('input',()=>{fn(e.value===''?null:e.value);changed();});return field(label,e);};
    const groupInfo=g=>data.options_library.find(x=>x.id===g.option_group_id);
    const semantic=key=>({beverage_temperature:'temperature',extra_shot:'extrashot',sinkers:'inclusions',sauce_beverage:'sauce',garnish:'addons',add_cheese:'cheese'}[key]||key);
    const expectedKeys=()=>{
      const product=getProduct?.()||data?.product||{};
      const name=String(product.name||'').trim().toLowerCase().replace(/\s+/g,' ');
      const rows=data?.option_recipes||[];
      return (rows.find(r=>r.id&&r.id===(product.id||data?.product?.id))||rows.find(r=>r.name===name))?.keys;
    };
    const allowed=info=>!['size','pieces','note'].includes(semantic(info.group_key))
      && (!expectedKeys()||expectedKeys().includes(semantic(info.group_key)));
    const requirements=c=>(data.option_configuration?.structure?.requirements||[]).filter(r=>r.option_choice_id===c.option_choice_id);
    function draw(){
      host.replaceChildren();host.hidden=!data;if(!data)return;
      host.append(node('p','Changes apply to this product only. Use Save Changes below to save everything.','option-library-help'));
      for(const g of groups){
        const info=groupInfo(g);if(!info)continue;
        const card=node('article',undefined,'customer-option-card');card.append(node('h4',info.name));
        card.append(node('p',(g.is_required?'Required':'Optional')+' · '+(info.selection_type==='multi'?'Customers may choose several':'Customers choose one')));
        const defaults=g.choices.filter(c=>c.default).map(c=>info.choices.find(x=>x.id===c.option_choice_id)?.label).filter(Boolean);
        card.append(node('p','Default: '+(defaults.join(', ')||'None')));
        const list=node('ul');for(const c of g.choices){const shared=info.choices.find(x=>x.id===c.option_choice_id);if(!shared)continue;
          const prices=Object.entries(c.price_by_size);list.append(node('li',shared.label+' — '+(!c.enabled?'Unavailable':prices.length?prices.map(([id,p])=>(sizes().find(s=>s.id===id)?.label||'Size')+' '+money(p)).join(' / '):money(c.product_price_delta??shared.price_delta))));}
        card.append(list);
        const actions=node('div',undefined,'customer-option-actions');actions.append(button('Edit',()=>{editing=g.option_group_id;draw();host.querySelector('[data-option-focus]')?.focus();}),button('Remove',()=>{
          if(window.confirm('Remove '+info.name+' from this product?')){groups=groups.filter(x=>x!==g);editing=null;draw();changed();}
        }));card.append(actions);
        if(editing===g.option_group_id)edit(card,g,info);
        host.append(card);
      }
      const picker=node('select');picker.setAttribute('aria-label','Existing option set');picker.append(new Option('Choose an option set',''));
      for(const info of data.options_library.filter(i=>allowed(i)&&!groups.some(g=>semantic(groupInfo(g)?.group_key)===semantic(i.group_key))))picker.append(new Option(info.name,info.id));
      const add=node('div',undefined,'customer-option-actions');add.append(field('Existing option set',picker),button('+ Add option set',()=>{
        const info=data.options_library.find(g=>g.id===picker.value);if(!info||!allowed(info)||groups.some(g=>semantic(groupInfo(g)?.group_key)===semantic(info.group_key)))return;
        const g={option_group_id:info.id,is_required:false,min_selections:0,max_selections:info.selection_type==='single'?1:null,
          choices:info.choices.map(c=>({option_choice_id:c.id,enabled:true,default:false,product_price_delta:null,price_by_size:{}})),compatibility:{}};
        groups.push(g);editing=g.option_group_id;draw();changed();
      }));host.append(add);
      if(!sizes().length)host.append(node('p','Save a draft first to configure size availability or charges by size.','option-library-help'));
    }
    function edit(card,g,info){
      const section=node('div',undefined,'customer-option-edit');section.dataset.optionFocus='';section.tabIndex=-1;
      section.append(node('p','Used by '+Number(info.used_by||0)+' products. These edits affect this product only.'));
      section.append(toggle('Required',g.is_required,v=>{g.is_required=v;g.min_selections=v?Math.max(1,g.min_selections):0;changed();}));
      if(g.min_selections>1){const input=node('input');input.type='number';input.min='1';input.value=g.min_selections;input.addEventListener('input',()=>{g.min_selections=Number(input.value);changed();});section.append(field('Minimum choices',input));}
      if(info.selection_type==='multi'){
        const input=node('input');input.type='number';input.min='1';input.max='64';input.placeholder='No limit';input.value=g.max_selections??'';
        input.addEventListener('input',()=>{g.max_selections=input.value===''?null:Number(input.value);changed();});section.append(field('Maximum selections',input));
      } else {
        const select=node('select');select.append(new Option('None',''));for(const c of g.choices.filter(c=>c.enabled)){const shared=info.choices.find(x=>x.id===c.option_choice_id);if(shared)select.append(new Option(shared.label,c.option_choice_id));}
        select.value=g.choices.find(c=>c.default)?.option_choice_id||'';select.addEventListener('change',()=>{g.choices.forEach(c=>{c.default=c.option_choice_id===select.value;});changed();});section.append(field('Default choice',select));
      }
      for(const c of g.choices){
        const shared=info.choices.find(x=>x.id===c.option_choice_id);if(!shared)continue;
        const row=node('fieldset',undefined,'customer-choice-edit');row.append(node('legend',shared.label));
        row.append(toggle('Available',c.enabled,v=>{
          c.enabled=v;if(!v){c.default=false;c.product_price_delta=null;c.price_by_size={};for(const id of Object.keys(g.compatibility))g.compatibility[id]=g.compatibility[id].filter(x=>x!==c.option_choice_id);}
          draw();changed();
        }));
        const controls=node('fieldset');controls.disabled=!c.enabled;
        if(info.selection_type==='multi')controls.append(toggle('Selected by default',c.default,v=>{c.default=v;changed();}));
        controls.append(charge('Additional charge (shared: '+money(shared.price_delta)+')',c.product_price_delta,v=>{c.product_price_delta=v;}));
        const requiredSizes=requirements(c).some(r=>r.product_size_id);
        const bySize=Object.keys(c.price_by_size).length>0||requiredSizes;
        const sizeToggle=toggle('Additional charge by size',bySize,v=>{c.price_by_size=v?Object.fromEntries(sizes().map(s=>[s.id,null])):{};draw();changed();});
        sizeToggle.querySelector('input').disabled=requiredSizes||!sizes().length;controls.append(sizeToggle);
        if(bySize)for(const s of sizes())controls.append(charge(s.label,c.price_by_size[s.id],v=>{c.price_by_size[s.id]=v;}));
        if(semantic(info.group_key)==='temperature'){
          controls.append(node('p','Available sizes'));
          for(const s of sizes())controls.append(toggle(s.label,(g.compatibility[s.id]||[]).includes(c.option_choice_id),v=>{const list=(g.compatibility[s.id]||[]).filter(x=>x!==c.option_choice_id);if(v)list.push(c.option_choice_id);g.compatibility[s.id]=list;changed();}));
        }
        row.append(controls);section.append(row);
      }
      section.append(button('Done',()=>{editing=null;draw();}));card.append(section);
    }
    return {
      load(response){data=response?.options_version===1&&Array.isArray(response.option_recipes)?copy(response):null;groups=copy(data?.options||[]);baseline=JSON.stringify(groups);editing=null;draw();return !!data;},
      reset(){data=null;groups=[];baseline='[]';editing=null;draw();},
      refreshRecipe(){if(data)draw();},
      validate(requireRecipe=false){
        if(!data||(!requireRecipe&&JSON.stringify(groups)===baseline))return '';
        const expected=expectedKeys();
        for(const g of groups){
          const info=groupInfo(g);
          if(!info||!allowed(info))return 'This item cannot use '+(info?.name||'this option set')+'.';
          const enabled=g.choices.filter(c=>c.enabled),minimum=Math.max(Number(g.min_selections),g.is_required?1:0);
          if(!enabled.length||enabled.length<minimum)return 'At least '+Math.max(1,minimum)+' '+info.name+' choice'+(minimum>1?'s must':' must')+' stay available.';
          const defaults=g.choices.filter(c=>c.default);
          if(defaults.some(c=>!c.enabled)||defaults.length<minimum)return 'Choose '+(minimum>1?'enough default choices for ':'a default ')+info.name.toLowerCase()+'.';
          const maximum=g.max_selections??(info.selection_type==='single'?1:enabled.length);
          if(!Number.isInteger(minimum)||!Number.isInteger(Number(maximum))||maximum<minimum||defaults.length>maximum)return 'Review how many '+info.name+' choices customers can select.';
          for(const c of enabled){
            const label=info.choices.find(x=>x.id===c.option_choice_id)?.label||'This choice';
            const valid=v=>v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=999999.99&&Math.abs(Number(v)*100-Math.round(Number(v)*100))<0.000001;
            if(c.product_price_delta!==null&&!valid(c.product_price_delta))return 'Enter a valid additional charge for '+label+'.';
            if(Object.keys(c.price_by_size).length||requirements(c).some(r=>r.product_size_id))for(const size of sizes())if(!valid(c.price_by_size[size.id]))return 'Add a price for '+size.label+'.';
            if(semantic(info.group_key)==='temperature'&&!sizes().some(size=>(g.compatibility[size.id]||[]).includes(c.option_choice_id)))return label+' needs an available serving size.';
          }
          if(semantic(info.group_key)==='temperature')for(const size of sizes())if(!enabled.some(c=>(g.compatibility[size.id]||[]).includes(c.option_choice_id)))return 'Choose an available temperature for '+size.label+'.';
        }
        if(expected)for(const key of expected)if(!groups.some(g=>semantic(groupInfo(g)?.group_key)===key))return 'This product needs '+(data.options_library.find(i=>semantic(i.group_key)===key)?.name||'its required options')+' before it can be saved.';
        return '';
      },
      snapshot(){return JSON.stringify(groups);},
      payload(){return data&&JSON.stringify(groups)!==baseline?copy(groups):undefined;},
      get version(){return data?.version||null;}
    };
  }};
})();
