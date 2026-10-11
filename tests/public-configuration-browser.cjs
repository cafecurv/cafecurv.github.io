// Offline shared-card, options, cart and order-payload tests. No live API calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'menu/index.html'), 'utf8');
  const browser = await chromium.launch({ channel: process.env.CURV_BROWSER_CHANNEL || 'msedge', headless: true });
  let checks = 0;
  const check = (value, message) => { checks++; assert(value, message); };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url() === 'https://curv.test/menu/'
      ? route.fulfill({ contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') }) : route.abort());
    await page.goto('https://curv.test/menu/');
    await page.evaluate(() => {
      window.fetch = () => { throw new Error('Live requests forbidden'); };
      window.WebSocket = class { constructor() { throw new Error('Live requests forbidden'); } };
    });
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) await page.addScriptTag({ content: m[1] });
    await page.evaluate(() => {
      closeForm();
      window.fixtureId = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
      const categories = ['Matcha & Hojicha', 'Salads', 'New Category', 'Espresso', 'Takoyaki & Savory Bites'].map((name,i) => ({ id: fixtureId(100+i), name, sort_order:i }));
      const products = [
        { id:1, name:'Kagoshima Matcha Cream', category:0, prices:[['Each',180]] },
        { id:2, name:'Banana Pudding Matcha Latte', category:0, prices:[['Each',190]] },
        { id:3, name:"Chef's Salad", category:1, prices:[['Each',150]] },
        { id:4, name:'Arbitrary Box', category:2, prices:[['Box',180],['Family',240]] },
        { id:5, name:'Unavailable', category:0, prices:[['Each',160]], is_available:false },
        { id:6, name:'Sold Out', category:0, prices:[['Each',160]], is_sold_out:true },
        { id:7, name:'Spanish Latte', category:3, prices:[['Regular',140],['Large',160]] },
        { id:8, name:'OG Takoyaki', category:4, prices:[['4pcs',180],['8pcs',320],['12pcs',450]] },
        { id:9, name:'Same Name', category:1, prices:[['Each',150]] },
        { id:10, name:'Same Name', category:2, prices:[['Each',150]] }
      ].map(p => ({ ...p, id:fixtureId(p.id), category_id:categories[p.category].id, is_published:true,
        is_available:p.is_available !== false, is_sold_out:p.is_sold_out || false, is_curv_pick:true,
        badge_labels:['New'], description:'A freshly prepared item from the menu.' }));
      const sizes = products.flatMap((p,i) => p.prices.map(([label,price],j) => ({ id:fixtureId(1000+i*10+j), product_id:p.id, label, price, sort_order:j })));
      const groups = [
        { product_id:fixtureId(2), option_group_id:fixtureId(200), group_key:'milk', name:'Milk', selection_type:'single', is_required:true, min_selections:1, max_selections:1, sort_order:0 },
        { product_id:fixtureId(2), option_group_id:fixtureId(201), group_key:'toppings', name:'Toppings', selection_type:'multi', is_required:true, min_selections:1, max_selections:2, sort_order:1 },
        { product_id:fixtureId(1), option_group_id:fixtureId(200), group_key:'milk', name:'Milk', selection_type:'single', is_required:true, min_selections:1, max_selections:1, sort_order:0 },
        ...[9,10].map(n => ({ product_id:fixtureId(n), option_group_id:fixtureId(202), group_key:'dressing', name:'Dressing', selection_type:'single', min_selections:0, max_selections:1 }))
      ];
      const choices = [
        ...[1,2].flatMap(n => [
          { product_id:fixtureId(n), option_group_id:fixtureId(200), option_choice_id:fixtureId(300), label:'Full Cream', value:'full', price_delta:0, sort_order:0 },
          { product_id:fixtureId(n), option_group_id:fixtureId(200), option_choice_id:fixtureId(301), label:'Oat Milk', value:'oat', price_delta:25.5, sort_order:1 }
        ]),
        ...['Crumbs','Pearls','Jelly'].map((label,i) => ({ product_id:fixtureId(2), option_group_id:fixtureId(201), option_choice_id:fixtureId(310+i), label, value:label.toLowerCase(), price_delta:10*(i+1), sort_order:i })),
        ...[9,10].map(n => ({ product_id:fixtureId(n), option_group_id:fixtureId(202), option_choice_id:fixtureId(320+n), label:'Dressing '+n, value:'dressing-'+n, price_delta:0, sort_order:0 }))
      ];
      const defaults = [
        { product_id:fixtureId(1), option_group_id:fixtureId(200), option_choice_id:fixtureId(301) },
        { product_id:fixtureId(2), option_group_id:fixtureId(201), option_choice_id:fixtureId(310) }
      ];
      window.fixture = { categories, products, sizes, groups, choices, defaults };
      window.renderFixture = () => {
        window.menuFixture = shapePublicMenuData(fixture.categories, fixture.products, fixture.sizes);
        menuFixture.options = buildSupabaseOptionsMap(fixture.groups, fixture.choices, fixture.defaults, fixture.products);
        renderPublicMenuFromSupabase(menuFixture);
      };
      window.getFixturePanel = n => {
        const target = publicProductPanelTargets.get(fixtureId(n));
        return document.getElementById('panel-' + target.panelId);
      };
      window.openFixture = n => {
        const target = publicProductPanelTargets.get(fixtureId(n));
        showSection(target.sectionId);
        document.querySelector('#panel-wrap-' + target.panelId + ' > .product-card').click();
      };
      renderFixture();
    });
    const results=await page.evaluate(async()=>{
      let count=0;const ok=(v,m)=>{if(!v)throw Error(m);count++;};
      const add=n=>{openFixture(n);getFixturePanel(n).querySelector('.panel-add-btn').click();};
      const pick=(n,key,value)=>getFixturePanel(n).querySelector('[data-option-key="'+key+'"] [data-value="'+value+'"]').click();
      cart.length=0;openFixture(2);pick(2,'milk','oat');pick(2,'toppings','pearls');add(2);
      ok(cart[0].option_choice_ids.join() === [301,310,311].map(fixtureId).join(),'single/multi/default IDs retained and sorted');
      ok(cart[0].options.milk==='oat' && cart[0].options.toppings==='crumbs,pearls','readable values retained');
      ok(cart[0].option_snapshots.some(x=>x.label==='Oat Milk'),'actual readable labels retained separately');
      ok(buildPublicOrderPayload().items[0].option_choice_ids.length===3,'payload retains all IDs');
      const saved=JSON.stringify(cart[0]);renderCart();updateQty(cart[0].key,1);
      ok(cart[0].option_choice_ids.length===3,'quantity edit/rebuild preserves IDs');
      cart[0]=JSON.parse(saved);renderCart();ok(cart[0].option_choice_ids.length===3,'serialized line rebuild preserves IDs');
      add(2);ok(cart.length===1 && cart[0].qty===2,'same configuration merges');
      openFixture(2);getFixturePanel(2).querySelector('.panel-note-input').value='Separate note';add(2);ok(cart.length===2,'different note separates');
      openFixture(2);pick(2,'milk','full');add(2);ok(cart.length===3,'different choice separates');
      cart.length=0;add(4);openFixture(4);getFixturePanel(4).querySelector('[data-value="Family"]').click();add(4);
      ok(cart.length===2 && cart[0].product_size_id!==cart[1].product_size_id,'different size separates');
      const identity={product_id:fixtureId(1),product_size_id:fixtureId(1000),option_choice_ids:[fixtureId(301),fixtureId(310)]};
      ok(configurationCartKey(identity,'')===configurationCartKey({...identity,option_choice_ids:identity.option_choice_ids.slice().reverse()},''),'selection order cannot alter identity');
      ok(configurationCartKey(identity,'x|y')!==configurationCartKey({...identity,product_size_id:fixtureId(1001)},'x|y'),'delimiter-safe identity');
      // Wrong, absent, and stale size IDs fail closed.
      openFixture(4);let chip=getFixturePanel(4).querySelector('.selected[data-size-id]');
      const good=chip.dataset.sizeId;chip.dataset.sizeId=fixtureId(1010);ok(!!publicPanelValidation(publicProductPanelTargets.get(fixtureId(4)).panelId),'wrong product size rejected');
      delete chip.dataset.sizeId;ok(!!publicPanelValidation(publicProductPanelTargets.get(fixtureId(4)).panelId),'missing size rejected');
      chip.dataset.sizeId=fixtureId(9999);ok(!!publicPanelValidation(publicProductPanelTargets.get(fixtureId(4)).panelId),'stale size rejected');chip.dataset.sizeId=good;
      // Explicit fixture mappings for every remaining Matcha modifier.
      for(const [i,key] of ['extrapower','sweetener'].entries()){
        fixture.groups.push({product_id:fixtureId(1),option_group_id:fixtureId(400+i),group_key:key,name:key,selection_type:'single',min_selections:0,max_selections:1});
        fixture.choices.push({product_id:fixtureId(1),option_group_id:fixtureId(400+i),option_choice_id:fixtureId(410+i),label:'No extra',value:'none',price_delta:0});
        fixture.defaults.push({product_id:fixtureId(1),option_group_id:fixtureId(400+i),option_choice_id:fixtureId(410+i)});
      }
      renderFixture();cart.length=0;add(1);
      ok(cart.length===1 && cart[0].product_size_id===fixtureId(1000),'mapped specialized single-size orders');
      ok(cart[0].option_choice_ids.length===3 && cart[0].price===205.5,'free defaults and premium option retained');
      fixture.defaults.find(d=>d.product_id===fixtureId(1)&&d.option_group_id===fixtureId(200)).option_choice_id=fixtureId(300);
      renderFixture();cart.length=0;add(1);ok(cart[0].option_choice_ids.includes(fixtureId(300)) && cart[0].options.milk==='full','changed default updates ID and snapshot');
      fixture.choices.find(c=>c.product_id===fixtureId(1)&&c.option_choice_id===fixtureId(300)).is_active=false;
      renderFixture();ok(getFixturePanel(1).querySelector('.panel-add-btn').disabled,'inactive default fails closed');
      fixture.choices.find(c=>c.product_id===fixtureId(1)&&c.option_choice_id===fixtureId(300)).is_active=true;
      fixture.defaults.find(d=>d.product_id===fixtureId(1)&&d.option_group_id===fixtureId(200)).option_choice_id=fixtureId(9999);
      renderFixture();ok(getFixturePanel(1).querySelector('.panel-add-btn').disabled,'missing default choice fails closed');
      fixture.defaults=fixture.defaults.filter(d=>d.product_id!==fixtureId(1));renderFixture();
      ok(getFixturePanel(1).querySelector('.panel-add-btn').disabled,'required group with no default requires selection');
      cart.length=0;add(9);ok(cart[0].option_choice_ids.length===0,'optional no-selection is explicit empty array');
      fixture.defaults.push({product_id:fixtureId(2),option_group_id:fixtureId(201),option_choice_id:fixtureId(311)});
      renderFixture();cart.length=0;openFixture(2);pick(2,'milk','full');add(2);
      ok(cart[0].option_choice_ids.includes(fixtureId(310))&&cart[0].option_choice_ids.includes(fixtureId(311)),'multi defaults explicit');
      // Every Takoyaki legacy modifier must be catalog-backed, even free/no.
      for(const [i,key] of ['spicy','addons','cheese'].entries()){
        fixture.groups.push({product_id:fixtureId(8),option_group_id:fixtureId(500+i),group_key:key,name:key,selection_type:'single',min_selections:0,max_selections:1});
        fixture.choices.push({product_id:fixtureId(8),option_group_id:fixtureId(500+i),option_choice_id:fixtureId(510+i),label:'No',value:'no',price_delta:0});
        fixture.defaults.push({product_id:fixtureId(8),option_group_id:fixtureId(500+i),option_choice_id:fixtureId(510+i)});
      }
      renderFixture();cart.length=0;openFixture(8);getFixturePanel(8).querySelector('[data-value="8pcs"]').click();add(8);
      ok(cart[0].product_size_id===fixtureId(1071)&&cart[0].price===320,'specialized multi-size directly binds actual row');
      for(const [i,key] of ['milk','extrashot','syrup','sauce'].entries()){
        fixture.groups.push({product_id:fixtureId(7),option_group_id:fixtureId(700+i),group_key:key,name:key,selection_type:'single',min_selections:0,max_selections:1});
        fixture.choices.push({product_id:fixtureId(7),option_group_id:fixtureId(700+i),option_choice_id:fixtureId(710+i),label:'Included / none',value:'none',price_delta:0});
      }
      fixture.choices.push({product_id:fixtureId(8),option_group_id:fixtureId(502),option_choice_id:fixtureId(520),label:'Yes',value:'yes',price_delta:30});
      renderFixture();
      for(const [size,price] of [['4pcs',210],['8pcs',380],['12pcs',540]]){
        cart.length=0;openFixture(8);getFixturePanel(8).querySelector('[data-value="'+size+'"]').click();if(!getFixturePanel(8).querySelector('[data-option-key="cheese"] [data-value="yes"]').classList.contains('selected'))pick(8,'cheese','yes');add(8);
        ok(cart[0].price===price && cart[0].option_choice_ids.includes(fixtureId(520)),'mapped cheese preview '+size);
      }
      fixture.products.find(p=>p.id===fixtureId(1)).name='CS Matcha Oat Latte';
      fixture.defaults.push({product_id:fixtureId(1),option_group_id:fixtureId(200),option_choice_id:fixtureId(300)});
      renderFixture();cart.length=0;openFixture(1);pick(1,'milk','oat');add(1);
      ok(cart[0].price===180 && cart[0].option_choice_ids.includes(fixtureId(301)),'recipe inclusion independent of selected default');
      fixture.choices.find(c=>c.product_id===fixtureId(1)&&c.option_choice_id===fixtureId(301)).value='Oat Milk';
      renderFixture();cart.length=0;openFixture(1);pick(1,'milk','Oat Milk');add(1);
      ok(cart[0].price===180 && cart[0].option_choice_ids.includes(fixtureId(301)),'legacy milk display value preserves preview without changing identity');
      // A distinct HOT serving row; temperature choices are explicit catalog IDs.
      fixture.sizes.push({id:fixtureId(1062),product_id:fixtureId(7),label:'Hot 12oz',price:160,sort_order:2});
      fixture.groups.push({product_id:fixtureId(7),option_group_id:fixtureId(600),group_key:'temperature',name:'Temperature',selection_type:'single',is_required:true,min_selections:1,max_selections:1});
      for(const [i,value] of ['iced','hot'].entries())fixture.choices.push({product_id:fixtureId(7),option_group_id:fixtureId(600),option_choice_id:fixtureId(610+i),label:value.toUpperCase(),value,price_delta:0});
      fixture.defaults.push({product_id:fixtureId(7),option_group_id:fixtureId(600),option_choice_id:fixtureId(610)});
      renderFixture();ok(getFixturePanel(7).querySelector('.panel-add-btn').disabled,'missing temperature compatibility fails closed');
      menuFixture.configurationCompatibility=[{product_id:fixtureId(7),product_size_id:fixtureId(1060),option_choice_id:fixtureId(610),is_active:true},{product_id:fixtureId(7),product_size_id:fixtureId(1061),option_choice_id:fixtureId(610),is_active:true},{product_id:fixtureId(7),product_size_id:fixtureId(1062),option_choice_id:fixtureId(611),is_active:true}];
      renderPublicMenuFromSupabase(menuFixture);cart.length=0;add(7);ok(cart[0].temp==='ICED'&&cart[0].option_choice_ids[0]===fixtureId(610),'ICED stable identity');
      openFixture(7);pick(7,'temperature','hot');ok(getFixturePanel(7).querySelector('.panel-add-btn').disabled,'HOT regular forbidden');
      getFixturePanel(7).querySelector('[data-size-id="'+fixtureId(1062)+'"]').click();add(7);
      ok(cart.length===2 && cart[1].temp==='HOT' && cart[1].product_size_id===fixtureId(1062)&&cart[1].option_choice_ids[0]===fixtureId(611),'HOT distinct size/choice identity');
      cart.length=0;addItem('Fake','',1,null);ok(cart.length===0,'legacy helper blocked');
      publicItemPanels.clear();document.getElementById('espresso').innerHTML='<div id="espresso-panels-mount"></div>';renderAllEspressoPanels();updatePanelPrice('spanish-latte');panelAddToCart('spanish-latte','Spanish Latte');ok(cart.length===0,'pre-hydration fallback cannot add');
      ok(document.querySelector('#panel-spanish-latte .panel-add-btn').disabled,'pre-hydration button disabled');
      publicMenuSupabaseClient={from(){return {select(){return this;},order(){return this;},then(resolve){return Promise.resolve({error:{message:'offline catalog failure'},data:null}).then(resolve);}};}};
      window.supabase={createClient:()=>publicMenuSupabaseClient};publicMenuFetchStarted=false;
      await fetchPublicMenuFromSupabase();panelAddToCart('spanish-latte','Spanish Latte');
      ok(cart.length===0,'failed catalog fetch cannot enable identity-less fallback');
      ok(document.querySelector('#panel-spanish-latte .panel-add-btn').disabled,'failed-fetch display remains disabled');
      return count;
    });
    assert.deepEqual(errors,[]);console.log(results+' configuration identity browser assertions passed; all requests intercepted');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
