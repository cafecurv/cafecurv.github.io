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
    const results = await page.evaluate(() => {
      let count = 0; const ok = (v,m) => { if (!v) throw Error(m); count++; };
      // Complete the synthetic specialty mappings without changing production data.
      for (const [n,keys] of [[1,['extrapower','sweetener']],[7,['temperature','milk','extrashot','syrup','sauce']],[8,['spicy','addons','cheese']]]) {
        keys.forEach((key,i) => {
          const gid=fixtureId(2000+n*10+i), cid=fixtureId(3000+n*10+i);
          fixture.groups.push({product_id:fixtureId(n),option_group_id:gid,group_key:key,name:key,selection_type:key==='addons'?'multi':'single',min_selections:0,max_selections:key==='addons'?2:1});
          fixture.choices.push({product_id:fixtureId(n),option_group_id:gid,option_choice_id:cid,label:key==='temperature'?'Iced':'Default '+key,value:key==='temperature'?'iced':'default',price_delta:0});
          fixture.defaults.push({product_id:fixtureId(n),option_group_id:gid,option_choice_id:cid});
        });
      }
      renderFixture(); openFixture(2);
      const panel=getFixturePanel(2), outer=panel.querySelector('.public-customize'), toggle=outer.querySelector('button');
      const core=panel.querySelector('[data-group="size"]');
      const visible=el=>Boolean(el.getClientRects().length)&&!el.closest('[hidden]');
      ok(visible(core),'size immediately visible');
      ok(toggle.getAttribute('aria-expanded')==='false','Customize initially collapsed');
      ok(!visible(panel.querySelector('[data-option-key="milk"]')),'milk choices initially hidden');
      ok(panel.querySelector('.customize-note')&&!outer.contains(panel.querySelector('textarea')),'note outside Customize');
      ok(panel.querySelector('[data-customize-group="toppings"] .customize-summary').textContent==='Crumbs','default summary uses actual choice label');
      toggle.click();
      ok(toggle.getAttribute('aria-expanded')==='true','Customize expands');
      ok(visible(panel.querySelector('[data-customize-group="milk"] > button')),'compact modifier row visible');
      ok(!visible(panel.querySelector('[data-option-key="milk"]')),'choices stay hidden until row opened');
      const row=panel.querySelector('[data-customize-group="milk"]');row.querySelector('button').click();
      ok(visible(row.querySelector('[data-option-key="milk"]')),'row reveals choices');
      row.querySelector('[data-value="oat"]').click();row.querySelector('[data-value="full"]').click();
      ok(row.querySelectorAll('.selected').length===1,'single replaces previous');
      row.querySelector('[data-value="oat"]').click();
      ok(row.querySelector('.customize-summary').textContent==='Oat Milk','summary uses label not internal value');
      const toppings=panel.querySelector('[data-customize-group="toppings"]');toppings.querySelector('button').click();
      toppings.querySelector('[data-value="pearls"]').click();
      ok(toppings.querySelectorAll('.selected').length===2,'multi adds second choice');
      ok(getPanelBasePrice(publicProductPanelTargets.get(fixtureId(2)).panelId)+getPanelAddOnsPrice(publicProductPanelTargets.get(fixtureId(2)).panelId)===245.5,'size plus milk plus two toppings');
      toppings.querySelector('[data-value="pearls"]').click();ok(toppings.querySelectorAll('.selected').length===1,'multi toggles off');toppings.querySelector('[data-value="pearls"]').click();
      const id=publicProductPanelTargets.get(fixtureId(2)).panelId;
      const before=JSON.stringify(readPublicConfiguration(id));
      toggle.click();ok(JSON.stringify(readPublicConfiguration(id))===before,'collapse preserves entire UUID configuration');
      ok(getPanelBasePrice(id)+getPanelAddOnsPrice(id)===245.5,'collapsed total unchanged');
      panel.querySelector('.panel-add-btn').click();
      ok(cart[0].option_choice_ids.join()===[301,310,311].map(fixtureId).join(),'Add to Order retains selected IDs');
      const cartKey=cart[0].key;
      toggle.click();ok(row.querySelector('[data-value="oat"]').classList.contains('selected'),'reopen retains selection');
      panel.querySelector('.panel-add-btn').click();ok(cart.length===1&&cart[0].qty===2&&cart[0].key===cartKey,'cart identity unchanged by disclosure');
      openFixture(9);const optional=getFixturePanel(9);optional.querySelector('.public-customize > button').click();optional.querySelector('.customize-modifier > button').click();
      const choice=optional.querySelector('[data-choice-id]');choice.click();choice.click();
      ok(!choice.classList.contains('selected'),'optional single returns to no selection');
      ok(optional.querySelector('.customize-modifier .customize-summary').textContent==='None','empty summary is None');
      openFixture(7); const espresso=getFixturePanel(7);
      ok(visible(espresso.querySelector('[data-option-key="temperature"]')),'temperature stays outside collapsed customization');
      for(const key of ['milk','extrashot','syrup','sauce'])ok(espresso.querySelectorAll('[data-customize-group="'+key+'"]').length===1,'one compact '+key);
      ok(!espresso.querySelector('[data-group="extrashot"]'),'legacy replaced without duplicates');
      ok(espresso.querySelector('.public-customize > button').getAttribute('aria-expanded')==='false','product switching does not leak expansion');
      openFixture(8);const bites=getFixturePanel(8);ok(visible(bites.querySelector('[data-group="pieces"]')),'pieces stay visible');
      for(const key of ['spicy','addons','cheese'])ok(bites.querySelector('[data-customize-group="'+key+'"]'),'food modifier '+key);
      openFixture(1);for(const key of ['sweetener','extrapower'])ok(getFixturePanel(1).querySelector('[data-customize-group="'+key+'"]'),'matcha modifier '+key);
      openFixture(2);ok(row.querySelector('[data-value="oat"]').classList.contains('selected'),'returning product keeps its own selection');
      return count;
    });
    checks += results;
    checks += await page.evaluate(() => {
      let count=0;const ok=(v,m)=>{if(!v)throw Error(m);count++;};
      const originalId=publicProductPanelTargets.get(fixtureId(2)).panelId;
      const selectedBefore=JSON.stringify(readPublicConfiguration(originalId));
      hydratePublicItemPanels(menuFixture);hydratePublicItemPanels(menuFixture);
      ok(JSON.stringify(readPublicConfiguration(originalId))===selectedBefore,'repeated hydration preserves selected identities');
      ok(getFixturePanel(2).querySelectorAll('.public-customize').length===1,'repeated hydration leaves one wrapper');
      const panel=getFixturePanel(7),id=publicProductPanelTargets.get(fixtureId(7)).panelId;
      const options=panel.querySelector('.panel-options');
      const keys=['size','extrashot','milk','syrup','sauce','temperature'];
      const groups=keys.map(key=>panel.querySelector('[data-option-key="'+key+'"], [data-group="'+key+'"]'));
      const note=panel.querySelector('textarea');
      // Reproduce the reported effective DOM order, retaining the real nodes.
      options.replaceChildren();
      groups.forEach((group,i)=>{const shell=document.createElement('div');shell.className='public-option-group';const label=document.createElement('div');label.className='option-group-label';label.textContent=keys[i];shell.append(label,group);options.append(shell);});
      options.append(note);
      const syrup=groups[3];syrup.dataset.type='multi';syrup.dataset.max='3';
      const contract=publicItemPanels.get(id),catalog=contract.optionGroups.find(g=>g.group_key==='syrup');
      catalog.selection_type='multi';catalog.max_selections=3;
      for(const [n,label] of [[9100,'Caramel'],[9101,'Vanilla']]) {
        const choice={product_id:fixtureId(7),option_choice_id:fixtureId(n),label,value:label,price_delta:25};catalog.choices.push(choice);
        const button=document.createElement('button');button.type='button';button.className='option-chip selected';button.dataset.choiceId=choice.option_choice_id;button.dataset.value=label;button.dataset.price='25';button.textContent=label;syrup.append(button);
      }
      const size=groups[0].querySelector('.selected').dataset.sizeId,temp=groups[5].querySelector('.selected').dataset.choiceId;
      contract.compatibility.push({product_id:fixtureId(7),product_size_id:size,option_choice_id:temp,is_active:true});
      const before=JSON.stringify(readPublicConfiguration(id)),price=getPanelBasePrice(id)+getPanelAddOnsPrice(id);
      ok(!JSON.parse(before).error,'fixture has a valid UUID configuration');
      organizePublicCustomization(panel);organizePublicCustomization(panel);
      const order=[...options.children].filter(el=>el.querySelector('[data-group]')||el.classList.contains('customize-note')).map(el=>el.classList.contains('public-customize')?'customize':el.classList.contains('customize-note')?'note':el.querySelector('[data-group]').dataset.optionKey||el.querySelector('[data-group]').dataset.group);
      ok(order.join()==='size,temperature,customize,note','exact bad shape becomes Size Temperature Customize Note');
      ok(panel.querySelectorAll('.public-customize').length===1,'one Customize after repeated organization');
      ok(panel.querySelectorAll('.customize-note').length===1,'one note after repeated organization');
      for(const key of ['extrashot','milk','syrup','sauce'])ok(panel.querySelectorAll('[data-customize-group="'+key+'"]').length===1,'one row '+key);
      ok(groups.every(group=>panel.contains(group)),'original nodes preserved');
      ok(syrup.querySelectorAll('.selected').length===3,'multi selection survives');
      ok(JSON.stringify(readPublicConfiguration(id))===before,'all selected UUIDs survive');
      ok(getPanelBasePrice(id)+getPanelAddOnsPrice(id)===price,'all deltas and total survive');
      panel.querySelector('.public-customize > button').click();panel.querySelector('.public-customize > button').click();
      ok(JSON.stringify(readPublicConfiguration(id))===before,'collapse preserves configuration');
      setPublicPanelOpen(id,true);setPublicPanelOpen(id,false);setPublicPanelOpen(id,true);
      ok(panel.querySelectorAll('.public-customize').length===1,'reopening reconciles without duplicates');
      cart.length=0;updatePanelPrice(id);panel.querySelector('.panel-add-btn').click();
      ok(cart.length===1&&cart[0].option_choice_ids.join()===JSON.parse(before).option_choice_ids.join(),'Add to Order unchanged');
      // Later insertion into an already-organized panel must not be skipped.
      const late=document.createElement('div');late.innerHTML='<div class="option-group-label">Late modifier</div><div data-panel="'+id+'" data-group="late"><button class="option-chip selected" data-price="0">Late choice</button></div>';
      options.append(late);organizePublicCustomization(panel);
      ok(panel.querySelector('[data-customize-group="late"]'),'later modifier reconciled');
      panel.querySelector('[data-customize-group="late"]').remove();
      // Standalone specialized legacy path: opening is a real lifecycle hook.
      const legacy=renderEspressoPanel(ESPRESSO_ITEMS[0]);const old=document.getElementById(legacy.id);if(old)old.remove();document.getElementById('espresso').append(legacy);
      initPanel(ESPRESSO_ITEMS[0].id,buildEspressoDefaults(ESPRESSO_ITEMS[0]));
      setPublicPanelOpen(ESPRESSO_ITEMS[0].id,true);
      ok(legacy.querySelector('.public-customize'),'legacy opener organizes');
      ok(legacy.querySelector('[data-customize-group="milk"]'),'legacy milk wrapped');
      const legacyPanel=legacy.querySelector('.expansion-panel');organizePublicCustomization(legacyPanel);
      ok(legacy.querySelectorAll('.public-customize').length===1,'legacy repeat safe');legacy.remove();
      if(activePanel)setPublicPanelOpen(activePanel,false);setPublicPanelOpen(publicProductPanelTargets.get(fixtureId(2)).panelId,false);openFixture(2);
      return count;
    });
    const customize=page.locator('.section.active .public-item-wrap.open .public-customize > button');
    await customize.focus();const before=await customize.getAttribute('aria-expanded');await page.keyboard.press('Enter');
    check(await customize.getAttribute('aria-expanded')!==before,'native keyboard activation');
    for(const width of [320,390,768,1280]) {
      await page.setViewportSize({width,height:900});
      check(await page.locator('.section.active .public-item-wrap.open .panel-options').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'no option overflow '+width);
      await page.evaluate(()=>getFixturePanel(2).querySelectorAll('.customize-toggle[aria-expanded="false"]').forEach(b=>b.click()));
      check(await page.locator('.section.active .public-item-wrap.open .panel-options').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'expanded option overflow '+width);
      await page.evaluate(()=>getFixturePanel(2).querySelectorAll('.customize-toggle[aria-expanded="true"]').forEach(b=>b.click()));
    }
    if(process.env.CURV_CUSTOMIZE_SCREENSHOT) {
      await page.setViewportSize({width:390,height:900});
      await page.evaluate(()=>{document.body.classList.add('night-mode');if(activePanel)setPublicPanelOpen(activePanel,false);openFixture(2);const p=getFixturePanel(2);p.querySelectorAll('.customize-toggle[aria-expanded="true"]').forEach(b=>b.click());});
      await page.locator('.section.active .public-item-wrap.open').screenshot({path:process.env.CURV_CUSTOMIZE_SCREENSHOT+'-collapsed.png'});
      await page.locator('.section.active .public-item-wrap.open .public-customize > button').click();
      await page.locator('.section.active .public-item-wrap.open').screenshot({path:process.env.CURV_CUSTOMIZE_SCREENSHOT+'-expanded.png'});
    }
    check(errors.length===0,errors.join('\n'));
    console.log(checks+' compact Customize assertions passed; all requests intercepted.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
