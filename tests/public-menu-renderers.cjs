// Offline DOM regression suite. Uses installed Playwright; no Supabase or SQL.
// CURV_PLAYWRIGHT_MODULE may point to a bundled Playwright installation.
// CURV_BROWSER_CHANNEL defaults to msedge; set to chromium for bundled Chromium.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '../menu/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(text => text.trim());
  scripts.forEach(script => new (require('node:vm').Script)(script));
  const browser = await chromium.launch({ channel: process.env.CURV_BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.href === 'https://curv.test/menu/') {
        return route.fulfill({ contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') });
      }
      const root = path.resolve(__dirname, '..');
      const asset = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (url.origin === 'https://curv.test' && url.pathname.startsWith('/images/')
        && asset.startsWith(root + path.sep) && fs.existsSync(asset)) return route.fulfill({ path: asset });
      return route.abort();
    });
    await page.goto('https://curv.test/menu/');
    // Install after DOMContentLoaded: startup fetch listeners never run.
    await page.evaluate(() => {
      window.fetch = () => { throw new Error('Network forbidden in menu fixture tests'); };
      window.WebSocket = class { constructor() { throw new Error('WebSocket forbidden'); } };
    });
    for (const content of scripts) await page.addScriptTag({ content });
    const summary = await page.evaluate(() => {
      let assertions = 0;
      const check = (value, message) => { assertions++; if (!value) throw new Error(message); };
      const variant = (label, price = 180) => ({ label, price });
      const raw = (name, variants = [variant('Each')], extras = {}) => ({
        name, variants, is_published: true, is_curv_pick: true, is_available: true, is_sold_out: false, ...extras
      });
      const lineups = {
        matcha: MATCHA_ITEMS.map(item => raw(item.name, [variant('Each', item.price)])),
        espresso: ESPRESSO_ITEMS.map(item => raw(item.name, [variant('Regular', item.reg), variant('Large', item.lrg)])),
        blended: FRAPPE_ITEMS.map(item => raw(item.name, [variant('Regular', item.reg), variant('Large', item.lrg)])),
        refreshers: REFRESHER_ITEMS.map(item => raw(item.name, [variant('Regular', item.reg), variant('Large', item.lrg)])),
        bites: [
          ...TAKOYAKI_ITEMS.map(item => raw(item.name, item.pieces.map(piece => variant(piece.value, piece.price)))),
          ...SAVORY_ITEMS.map(item => raw(item.name, [variant('Each', item.price)]))
        ],
        salads: Object.keys(SALAD_BAR_ITEM_META).map(name => raw(name)),
        pastries: [raw('Fixture Croissant'), raw('Fixture Cake')]
      };
      const render = (sectionId, rows, extraCategories = [], nameOverride) => {
        const config = SPECIAL_PUBLIC_CATEGORY_SECTIONS.find(item => item.sectionId === sectionId);
        const category = { id: 'category-' + sectionId, name: nameOverride || config.categoryNames[0], sort_order: 1 };
        const categories = [category, ...extraCategories];
        const products = rows.map((item, index) => ({
          ...item, id: item.id || 'product-' + index, category_id: item.category_id || category.id, sort_order: index
        })).filter(item => item.is_published !== false && !item.archived_at);
        const sizes = products.flatMap(product => (Array.isArray(product.variants) ? product.variants : []).map((size, index) => ({
          ...size, product_id: product.id, id: product.id + '-size-' + index, sort_order: index
        })));
        const sections = categories.map(item => ({ id: item.id + '-section', category_id: item.id, name: 'Current Section', sort_order: 0 }));
        const shaped = shapePublicMenuData(categories, products, sizes, sections);
        renderPublicMenuFromSupabase(shaped);
        return shaped;
      };
      const verify = (sectionId, rows, expected, label) => {
        render(sectionId, rows);
        const section = document.getElementById(sectionId);
        check(section.querySelectorAll('[data-public-menu-product-id]').length === expected, sectionId + ': count ' + label);
        check(getNavTabForSectionId(sectionId).hidden === (expected === 0), sectionId + ': tab ' + label);
        check(section.hidden === (expected === 0), sectionId + ': section ' + label);
        check(document.getElementById('seasonal').hidden === (expected === 0), sectionId + ': picks visibility ' + label);
        check(publicMenuSearchIndex.length === expected, sectionId + ': search ' + label);
        check(publicMenuSearchIndex.every(item => item.renderedCategoryKey === sectionId), sectionId + ': actual search route');
        check(document.querySelectorAll('#seasonal .curv-pick-card').length === expected || expected === 0,
          sectionId + ': picks ' + label);
      };
      const matrix = [];
      for (const [sectionId, legacy] of Object.entries(lineups)) {
        verify(sectionId, legacy, legacy.length, 'legacy');
        if (['matcha', 'espresso', 'blended', 'refreshers', 'bites'].includes(sectionId)) {
          check(renderedPublicPanels.size === legacy.length, sectionId + ': legacy customizations');
        }
        verify(sectionId, legacy.slice(1), legacy.length - 1, 'removed');
        verify(sectionId, [...legacy, raw('Arbitrary New Product')], legacy.length + 1, 'added');
        verify(sectionId, [raw('Renamed Arbitrary Product')], 1, 'renamed');
        verify(sectionId, [{ ...legacy[0], name: 'Renamed Legacy Product' }], 1, 'legacy renamed');
        verify(sectionId, [raw('Moved-In Product')], 1, 'moved in');
        verify(sectionId, [], 0, 'moved out');
        verify(sectionId, [{ ...legacy[0], variants: [variant('Small Cup'), variant('Family Box', 250)] }], 1, 'unfamiliar sizes');
        check(renderedPublicPanels.size === 0, sectionId + ': unfamiliar sizes must not be relabeled');
        verify(sectionId, [{ ...legacy[0], is_available: false, variants: [] }], 1, 'unavailable no price');
        check(!document.querySelector('#' + sectionId + ' [data-public-menu-product-id] button:not([disabled])'),
          sectionId + ': unavailable disabled');
        verify(sectionId, [{ ...legacy[0], is_sold_out: true }], 1, 'sold out');
        check(!document.querySelector('#' + sectionId + ' .product-card:not([disabled])'),
          sectionId + ': sold-out panel disabled');
        verify(sectionId, [legacy[0], raw('Malformed', [variant('', -10)]), raw('', [])], 1, 'malformed mixed');
        verify(sectionId, [raw('Malformed', [variant('', -10)])], 0, 'zero valid');
        verify(sectionId, [raw('Generic Product')], 1, 'generic');
        check(document.querySelector('#' + sectionId + ' .generic-public-product'), sectionId + ': generic card');
        verify(sectionId, [legacy[0], raw('Draft', undefined, { is_published: false }), raw('Archived', undefined, { archived_at: '2026-01-01' })], 1, 'public view visibility');
        verify(sectionId, [raw('Section Product', undefined, { category_section_id: 'category-' + sectionId + '-section' })], 1, 'section');
        check(document.querySelector('#' + sectionId + ' .category-label').textContent === 'Current Section',
          sectionId + ': database section retained');
        matrix.push(sectionId + ': 15 scenarios');
      }
      render('matcha', [raw('Kagoshima Matcha Cream')], [], 'Matcha & Houjicha');
      check(!getNavTabForSectionId('matcha').hidden, 'Houjicha alias');
      check(renderedPublicPanels.size === 1, 'Kagoshima customization');
      check(publicMenuSearchIndex[0].renderedCategoryKey === 'matcha', 'Houjicha search route');
      const kagoshima = [...renderedPublicPanels.values()][0];
      check(document.getElementById('panel-' + kagoshima.panelId).querySelector('[data-group="milk"]'),
        'Kagoshima milk options retained');
      check(document.querySelector('#seasonal .curv-pick-card').getAttribute('onclick').includes(kagoshima.panelId),
        'Pick links to actual Kagoshima panel');
      showSection('matcha');
      cart.length = 0;
      panelAddToCart(kagoshima.panelId, 'Kagoshima Matcha Cream');
      check(cart.length === 1 && cart[0].price === 180, 'customized cart uses public price');

      const moved = raw('Kagoshima Matcha Cream', [variant('Box', 222)], { category_id: 'new-category' });
      render('matcha', [moved], [{ id: 'new-category', name: 'New Category', sort_order: 3 }]);
      check(!renderedPublicPanels.size, 'moved pick must not link old panel');
      check(publicMenuSearchIndex[0].renderedCategoryKey === 'public-category-new-category', 'moved search route');
      check(!document.querySelector('#seasonal .curv-pick-card[onclick]'), 'moved pick uses generic ordering');

      for (const alias of PUBLIC_TAKOYAKI_SAVORY_CATEGORY_NAMES) {
        render('bites', [raw('OG Takoyaki', [variant('Box')]), raw('New Side')], [], alias);
        check(!getNavTabForSectionId('bites').hidden, alias + ': visible');
        check(publicMenuSearchIndex.every(item => item.renderedCategoryKey === 'bites'), alias + ': search route');
      }
      const rows = [raw('OG Takoyaki', [variant('4pcs'), variant('8pcs'), variant('12pcs')]),
        raw('Chicken Karaage', [variant('Each')], { category_id: 'savory-alias' })];
      render('bites', rows, [{ id: 'savory-alias', name: 'Savory Bites', sort_order: 2 }], 'Curv Bites');
      check(document.querySelectorAll('#bites [data-public-menu-product-id]').length === 2, 'aliases aggregate');
      check(document.querySelectorAll('.nav-tab:not([hidden])').length === 2, 'only picks plus canonical bites tab');
      check(new Set([...document.querySelectorAll('[id]')].map(node => node.id)).size === document.querySelectorAll('[id]').length,
        'no duplicate DOM IDs');

      render('salads', [raw("Chef's Pick", [variant("Chef's Size", 123), variant('Large', 234)])]);
      const button = document.querySelector('#salads .add-btn-pill');
      new Function(button.getAttribute('onclick'));
      cart.length = 0;
      button.click();
      check(cart.length === 1 && cart[0].name === "Chef's Pick" && cart[0].variant === "Chef's Size" && cart[0].price === 123,
        'apostrophes and actual generic variant preserved in cart');

      const originalRender = renderMatchaPanel;
      renderMatchaPanel = () => { throw new Error('fixture panel render failure'); };
      render('matcha', [raw('Kagoshima Matcha Cream'), raw('Other Matcha')]);
      check(document.querySelectorAll('#matcha .generic-public-product').length === 2, 'render exception falls back per product');
      check(!renderedPublicPanels.size, 'failed panel not registered for picks');
      renderMatchaPanel = originalRender;

      const malformedMenu = render('matcha', [raw('Kagoshima Matcha Cream'), raw('Other Matcha')]);
      malformedMenu.categories[0].products.push(null, { id: 'broken', name: 'Broken', variants: [null] });
      malformedMenu.products.push(null, { id: 'broken', name: 'Broken', is_curv_pick: true, variants: [null] });
      renderPublicMenuFromSupabase(malformedMenu);
      check(!document.getElementById('matcha').hidden, 'null rows do not hide siblings');
      check(mapPublicCurvPicks(malformedMenu).items.length === 2, 'null pick isolated');

      render('matcha', [raw('Kagoshima Matcha Cream'), raw('Kagoshima Matcha Cream')]);
      check(publicMenuSearchIndex.length === 2 && publicMenuSearchIndex[0].target !== publicMenuSearchIndex[1].target,
        'same-named products have distinct search targets');
      check(renderedPublicPanels.size === 1, 'duplicate legacy panel uses generic second card');
      render('matcha', [raw('Kagoshima Matcha Cream'),
        raw('Salad Pick', undefined, { category_id: 'salad-category' }),
        raw('Generic Pick', undefined, { category_id: 'generic-category' })],
        [{ id: 'salad-category', name: 'Salads', sort_order: 2 },
          { id: 'generic-category', name: '__proto__', sort_order: 3 }]);
      check(document.querySelectorAll('#seasonal .curv-pick-card').length === 3, 'cross-category picks and arbitrary category label');
      check(new Set(publicMenuSearchIndex.map(item => item.renderedCategoryKey)).size === 3, 'cross-category search routes');

      render('espresso', [raw('Spanish Latte', [variant('Regular', 140), variant('Large', 160)])]);
      const spanish = [...renderedPublicPanels.values()][0];
      showSection('espresso');
      check(document.getElementById('panel-' + spanish.panelId).querySelector('[data-group="temperature"]'), 'espresso hot/iced preserved');
      check(document.getElementById('panel-' + spanish.panelId).querySelector('[data-group="milk"]'), 'espresso milk preserved');
      cart.length = 0;
      panelAddToCart(spanish.panelId, 'Spanish Latte');
      check(cart.length === 1 && cart[0].price === 140 && cart[0].variant === 'Regular', 'espresso public size/price cart contract');

      render('salads', [raw('Disabled With Price', undefined, { is_available: false })]);
      check(document.querySelector('#salads .menu-item-badge').textContent === 'Unavailable', 'generic unavailable badge');
      cart.length = 0;
      document.querySelector('#salads .add-btn').click();
      check(cart.length === 0, 'unavailable generic cannot add to cart');
      render('matcha', [raw('Kagoshima Matcha Cream'), raw('Other Matcha')]);
      return { assertions, matrix };
    });
    // Responsive checks use real DOM/layout with offline fixtures.
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { closeForm(); showSection('matcha'); });
      assert(await page.locator('#matcha [data-public-menu-product-id]').count() > 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        'No page overflow at ' + width);
      await page.evaluate(() => selectMenuSearchResult(publicMenuSearchIndex[1]));
      await page.waitForTimeout(120);
      assert(await page.locator('.menu-search-target-highlight').count() === 1, 'Search selection highlights actual card');
      if (process.env.CURV_TEST_SCREENSHOTS) {
        await page.screenshot({ path: path.join(process.env.CURV_TEST_SCREENSHOTS, 'menu-audit-' + width + '.png') });
      }
    }
    assert.deepEqual(errors, [], 'No uncaught page errors');
    console.log(JSON.stringify(summary, null, 2));
    console.log('Offline DOM, cart, search and responsive checks passed; requests blocked.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
