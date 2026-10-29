// Offline shared-card, options, cart and order-payload tests. No live API calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(process.env.CURV_CUSTOMER_TEXT_MENU || path.join(root, 'menu/index.html'), 'utf8');
  const browser = await chromium.launch({ channel: process.env.CURV_BROWSER_CHANNEL || 'msedge', headless: true });
  let checks = 0;
  const check = (value, message) => { checks++; assert(value, message); };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = [], probes = [];
    page.on('request', r => { if(r.url().includes('/customer-text-probe')) probes.push(r.url()); });
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

    const payloads = [
      '<img src="/customer-text-probe" onerror="window.textProbe=1">',
      '<svg onload="window.textProbe=2"></svg>',
      '\" autofocus onfocus=\"window.textProbe=3\" data-probe=\"',
      "');window.textProbe=4;//",
      '</textarea><input id="f-contact" value="altered"><script>window.textProbe=5</script>',
      'A & B <3 \"single\" café 日本語 ♡ 🧋\nless ice please'
    ];
    for(const text of payloads) {
      await page.evaluate(text=>{
        window.textProbe=0;cart=[];renderCart();openFixture(2);
        const panel=getFixturePanel(2),note=panel.querySelector('textarea');note.value=text;note.dispatchEvent(new Event('input',{bubbles:true}));
        panel.querySelector('[data-choice-id=\"'+fixtureId(300)+'\"]').click();
        window.fieldBaseline=['f-contact','f-payment','f-delivery'].map(id=>document.getElementById(id).value);
        panel.querySelector('.panel-add-btn').click();
      },text);
      await page.waitForTimeout(30);
      check(await page.evaluate(()=>window.textProbe===0),'note payload must not execute');
      check(await page.locator('#cartItems img,#cartItems svg,#cartItems script,#cartItems input').count()===0,'note must not inject elements');
      check((await page.locator('.cart-item-opts').textContent()).includes(text),'literal complete note retained');
      check(await page.evaluate(t=>cart[0].options.note===t,text),'stored note unchanged');
      check(await page.evaluate(()=>cart[0].price===200&&cart[0].qty===1),'price and quantity unchanged by payload');
      check(await page.evaluate(()=>JSON.stringify(fieldBaseline)===JSON.stringify(['f-contact','f-payment','f-delivery'].map(id=>document.getElementById(id).value))),'checkout fields unchanged');
      check(await page.locator('#cartItems [onclick],#cartItems [onfocus],#cartItems [onerror]').count()===0,'customer key absent from executable attributes');
      await page.locator('.cart-qty-btn').last().evaluate(el=>el.click());check(await page.evaluate(()=>cart[0].qty===2),'literal key increment works');
      await page.locator('.cart-qty-btn').first().evaluate(el=>el.click());check(await page.evaluate(()=>cart[0].qty===1),'literal key decrement works');
      await page.locator('.cart-remove').evaluate(el=>el.click());check(await page.evaluate(()=>cart.length===0),'literal key removal works');
    }
    await page.evaluate(()=>{cart=[{key:'literal\"key',name:'<svg onload="window.textProbe=9">',variant:'<b>variant</b>',temp:'<i>iced</i>',qty:1,price:200,options:{custom:'<img src="/customer-text-probe" onerror="window.textProbe=9">'}}];renderCart();});
    check(await page.locator('#cartItems svg,#cartItems img,#cartItems b,#cartItems i').count()===0,'product/variant/customization data rendered as literal text');
    check((await page.locator('.cart-item-name').textContent()).includes('<svg'),'product literal retained');
    await page.evaluate(()=>setSubmittedFormLocked(true));
    check(await page.locator('#cartItems button:not(:disabled)').count()===0,'submitted cart controls remain disabled');
    await page.locator('.cart-qty-btn').last().evaluate(el=>el.click());
    check(await page.evaluate(()=>cart[0].qty===1),'disabled submitted cart cannot mutate');
    await page.evaluate(()=>setSubmittedFormLocked(false));
    await page.evaluate(()=>{const host=document.createElement('section');host.id='panel-xssfixture';const group=document.createElement('div');group.dataset.collapsible='true';group.dataset.groupName='note';group.dataset.groupLabel='<svg onload="window.textProbe=8">';const ta=document.createElement('textarea');ta.id='note-xssfixture';ta.className='panel-note-input';ta.value='<svg/onload=textProbe=8>';group.append(ta);host.append(group);document.body.append(host);wrapAccordionGroups(host);});
    check(await page.locator('#panel-xssfixture svg').count()===0,'initial accordion label/prefilled summary cannot inject markup');
    check((await page.locator('#panel-xssfixture .accordion-summary').textContent()).includes('<svg'),'prefilled accordion summary stays text');
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'menu/authoritative-checkout.js'),'utf8')});
    for(const text of payloads){
      await page.evaluate(text=>{
        const q={subtotal:'200.00',items:[{product_name:text,category_name:text,size_label:text,quantity:1,unit_price:'200.00',line_total:'200.00',item_note:text,options:[{group_name:text,label:text,effective_price_delta:'0.00'}]}]};
        const p={customer_name:text,fulfillment_type:'pickup',pickup_time:text};
        setOrderConfirmModal('Review',curvCheckout.reviewHtml(q,p),[]);
      },text);
      check(await page.locator('#orderConfirmBody img,#orderConfirmBody svg,#orderConfirmBody script,#orderConfirmBody input').count()===0,'public authoritative review escapes customer/catalog text');
      check((await page.locator('#orderConfirmBody').textContent()).includes(text),'public review displays literal text');
    }
    const t=payloads[0];await page.evaluate(t=>{showOrderSuccessModal({orderNumber:t,trackingToken:'00000000-0000-4000-8000-000000000123'});},t);
    check(await page.locator('#orderConfirmBody img,#afterSubmitStatus img').count()===0,'public confirmation cannot inject number markup');
    check(probes.length===0,'no payload-generated network request');
    check(await page.evaluate(()=>window.textProbe===0),'no event handler activated throughout');
    check(errors.length===0,'no browser script errors');
    console.log(JSON.stringify({suite:'customer-text-shared-security',assertions:checks,payloads:payloads.length,network:'all intercepted',credentials:'none accessed'}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
