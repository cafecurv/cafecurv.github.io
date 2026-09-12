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
    const contract = await page.evaluate(() => ({
      shells:[...document.querySelectorAll('.section:not(#seasonal) [data-public-menu-product-id] > .product-card')].every(c => c.classList.contains('unified-product-card')),
      targets:publicProductPanelTargets.size,
      picks:document.querySelectorAll('#seasonal .curv-pick-card').length,
      duplicates:document.querySelectorAll('[id]').length !== new Set([...document.querySelectorAll('[id]')].map(n=>n.id)).size,
      duplicateNames:menuFixture.options.byProductId[fixtureId(9)].groups[0].choices[0].value !== menuFixture.options.byProductId[fixtureId(10)].groups[0].choices[0].value
    }));
    check(contract.shells && contract.targets === 10 && contract.picks === 10, 'one shell/panel target for all products and picks');
    check(!contract.duplicates && contract.duplicateNames, 'no duplicate DOM IDs; options keyed by product ID');

    await page.evaluate(() => { cart.length=0; openFixture(3); });
    check(await page.evaluate(() => cart.length === 0), 'single-size action does not quick-add');
    check(await page.evaluate(() => document.activeElement === getFixturePanel(3).querySelector('.public-panel-title')), 'panel receives focus');
    check(await page.evaluate(() => !getFixturePanel(3).inert), 'open panel interactive');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => getFixturePanel(3).inert && document.activeElement.classList.contains('product-card')), 'Escape closes and returns focus');
    await page.evaluate(() => { openFixture(3); getFixturePanel(3).querySelector('.public-panel-close').click(); });
    check(await page.evaluate(() => getFixturePanel(3).inert), 'Close button closes');

    await page.evaluate(() => {
      openFixture(2);
      const panel=getFixturePanel(2);
      panel.querySelector('[data-option-key="milk"] [data-value="oat"]').click();
      panel.querySelector('[data-option-key="toppings"] [data-value="pearls"]').click();
      panel.querySelector('[data-option-key="toppings"] [data-value="jelly"]').click();
    });
    check(await page.evaluate(() => getFixturePanel(2).querySelectorAll('[data-option-key="toppings"] .selected').length === 2), 'multi max selection enforced');
    check(await page.evaluate(() => getFixturePanel(2).querySelector('[data-option-key="toppings"] [data-value="crumbs"]').classList.contains('selected')), 'database default selected');
    await page.evaluate(() => {
      const p=getFixturePanel(2);
      p.querySelector('[data-option-key="toppings"] [data-value="crumbs"]').click();
      p.querySelector('[data-option-key="toppings"] [data-value="pearls"]').click();
    });
    check(await page.evaluate(() => getFixturePanel(2).querySelector('.panel-add-btn').disabled), 'required min enforced');
    await page.evaluate(() => {
      const p=getFixturePanel(2);
      p.querySelector('[data-option-key="toppings"] [data-value="crumbs"]').click();
      p.querySelector('.panel-note-input').value='Less ice, please';
      p.querySelectorAll('.panel-qty-btn')[1].click();
    });
    check(await page.evaluate(() => getFixturePanel(2).querySelector('.panel-price').textContent.includes('451')), 'decimal option delta and quantity total');
    await page.evaluate(() => getFixturePanel(2).querySelector('.panel-add-btn').click());
    const line = await page.evaluate(() => cart[0]);
    check(line.qty === 2 && line.price === 225.5 && line.options.milk === 'oat' && line.options.toppings === 'crumbs', 'choices and decimal unit price preserved in cart');
    check(line.options.note === 'Less ice, please' && line.product_id.endsWith('002') && line.product_size_id.endsWith('1010'), 'item note and actual product/size IDs preserved');
    check(await page.evaluate(() => getFixturePanel(2).inert && panelState[publicProductPanelTargets.get(fixtureId(2)).panelId].qty === 1), 'add closes panel and resets quantity');
    const payloads = await page.evaluate(() => {
      document.getElementById('f-name').value='Fixture Customer';
      document.getElementById('f-contact').value='09171234567';
      document.getElementById('f-notes').value='Whole order note';
      document.getElementById('f-address').value='Fixture address';
      return ['dine-in','pickup','delivery-curv-rider'].map(value => {
        document.getElementById('f-delivery').value=value;
        syncOrderMethodFields();
        document.getElementById('f-address').value='Fixture address';
        return buildPublicOrderPayload();
      });
    });
    check(payloads[0].fulfillment_type === 'dine_in' && payloads[0].payment_method === 'counter', 'Dine In counter contract');
    check(payloads[1].fulfillment_type === 'pickup' && payloads[2].fulfillment_type === 'delivery', 'Pickup/Delivery contract');
    check(payloads.every(p => p.items[0].item_note === 'Less ice, please' && p.customer_notes === 'Whole order note' && !('note' in p.items[0].options)), 'line notes separated from order notes');
    check(payloads.every(p => p.total === 451 && p.items[0].unit_price === 225.5 && p.items[0].line_total === 451), 'payload totals unchanged');

    await page.evaluate(() => {
      cart.length=0; openFixture(4);
      const p=getFixturePanel(4); p.querySelector('[data-value="Family"]').click();
      p.querySelector('.panel-add-btn').click();
    });
    check(await page.evaluate(() => cart[0].variant === 'Family' && cart[0].price === 240 && cart[0].product_size_id === fixtureId(1031)), 'multiple size selection retains label price ID');
    await page.evaluate(() => { cart.length=0; openFixture(1); });
    check(await page.evaluate(() => getFixturePanel(1).querySelectorAll('[data-option-key="milk"]').length === 1 && !getFixturePanel(1).querySelector('[data-group="milk"]')), 'public group replaces same specialized group');
    check(await page.evaluate(() => getFixturePanel(1).querySelector('[data-option-key="milk"] [data-value="oat"]').classList.contains('selected')), 'specialized product uses database default');
    check(await page.evaluate(() => Boolean(getFixturePanel(1).querySelector('[data-group="extrapower"]'))), 'compatible specialized enhancement retained');
    await page.evaluate(() => getFixturePanel(1).querySelector('.panel-add-btn').click());
    check(await page.evaluate(() => cart[0].price === 205.5 && cart[0].options.milk === 'oat'), 'specialized base plus database delta');
    await page.evaluate(() => {
      cart.length=0; openFixture(7);
      const p=getFixturePanel(7);
      p.querySelector('[data-group="temperature"] [data-value="hot"]').click();
      p.querySelector('.panel-add-btn').click();
    });
    check(await page.evaluate(() => cart[0].temp === 'HOT' && cart[0].variant === '12oz' && cart[0].price === 160 && cart[0].product_size_id === fixtureId(1061)), 'HOT price and underlying real size ID preserved');
    await page.evaluate(() => {
      cart.length=0; openFixture(8); const p=getFixturePanel(8);
      p.querySelector('[data-group="pieces"] [data-value="8pcs"]').click();
      p.querySelector('.panel-add-btn').click();
    });
    check(await page.evaluate(() => cart[0].variant === '8pcs' && cart[0].price === 320 && cart[0].product_size_id === fixtureId(1071)), 'Takoyaki piece count and size ID');

    await page.evaluate(() => {
      cart.length=0;
      for(const n of [9,10]) { openFixture(n); const p=getFixturePanel(n); p.querySelector('[data-option-key] .option-chip').click(); p.querySelector('.panel-add-btn').click(); }
    });
    check(await page.evaluate(() => cart.length === 2 && cart[0].product_id !== cart[1].product_id), 'same-named product lines do not merge');
    check(await page.evaluate(() => [5,6].every(n => {
      const p=getFixturePanel(n); return p.parentElement.querySelector('.product-card').disabled && p.querySelector('.panel-add-btn').disabled;
    })), 'unavailable/sold out action and add disabled');
    await page.evaluate(() => {
      cart.length=0; showSection('seasonal');
      document.querySelector('#seasonal [aria-controls="panel-' + publicProductPanelTargets.get(fixtureId(3)).panelId + '"]').click();
    });
    check(await page.evaluate(() => cart.length===0 && !getFixturePanel(3).inert), 'CURV Pick opens same normal panel without adding');
    await page.evaluate(() => getFixturePanel(3).querySelector('.panel-add-btn').click());
    check(await page.evaluate(() => cart[0].product_id === fixtureId(3)), 'Pick adds using same product ID');
    await page.evaluate(() => selectMenuSearchResult(publicMenuSearchIndex.find(p=>p.productId===fixtureId(2))));
    await page.waitForFunction(() => document.querySelector('#matcha .menu-search-target-highlight'));
    check(await page.evaluate(() => document.querySelector('#matcha .menu-search-target-highlight').dataset.publicMenuProductId === fixtureId(2)), 'search targets actual bordered card wrapper');

    await page.evaluate(() => {
      renderFixture(); renderFixture(); cart.length=0; openFixture(4);
      const p=getFixturePanel(4); p.querySelectorAll('.panel-qty-btn')[1].click(); p.querySelector('.panel-add-btn').click();
    });
    check(await page.evaluate(() => cart.length===1 && cart[0].qty===2), 'rerender does not duplicate handlers');
    await page.evaluate(() => {
      fixture.groups.find(g=>g.product_id===fixtureId(2) && g.group_key==='toppings').min_selections=4;
      renderFixture(); openFixture(2);
    });
    check(await page.evaluate(() => getFixturePanel(2).querySelector('.panel-add-btn').disabled && !getFixturePanel(3).querySelector('.panel-add-btn').disabled), 'invalid option rules affect only that product');
    await page.evaluate(() => {
      fixture.groups.find(g=>g.product_id===fixtureId(2) && g.group_key==='toppings').min_selections=1;
      renderFixture();
    });
    for (const width of [320,375,390,430,768,1280]) {
      await page.setViewportSize({ width, height:900 });
      await page.evaluate(() => {
        if (activePanel) setPublicPanelOpen(activePanel,false);
        openFixture(2);
      });
      await page.locator('#matcha .public-panel-title').filter({ hasText:'Banana Pudding Matcha Latte' }).scrollIntoViewIfNeeded();
      check(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth), width+': open panel no horizontal overflow');
      check(await page.evaluate(() => {
        const p=getFixturePanel(2), box=p.getBoundingClientRect();
        return [...p.querySelectorAll('.option-chip, .panel-add-btn, textarea')].every(el=>{
          const r=el.getBoundingClientRect(); return r.left>=box.left-1 && r.right<=box.right+1 && r.top>=box.top-1 && r.bottom<=box.bottom+1;
        });
      }), width+': controls contained');
      if (process.env.CURV_TEST_SCREENSHOTS && [320,390,1280].includes(width)) {
        await getScreenshot(page,width);
      }
    }
    check(errors.length===0, 'no uncaught errors: '+errors.join(','));
    console.log(checks+' unified card/options/cart/order assertions passed; all requests intercepted.');
    async function getScreenshot(page,width) {
      await page.screenshot({ path:path.join(process.env.CURV_TEST_SCREENSHOTS,'unified-item-panel-'+width+'.png') });
    }
  } finally { await browser.close(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
