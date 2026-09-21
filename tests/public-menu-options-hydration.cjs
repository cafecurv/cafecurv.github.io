// Offline integration tests for public option reads, mapping and panel hydration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../menu/index.html'), 'utf8');
  const browser = await chromium.launch({ channel: process.env.CURV_BROWSER_CHANNEL || 'msedge', headless: true });
  let checks = 0;
  const check = (value, message) => { assert(value, message); checks++; };
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url() === 'https://curv.test/menu/'
      ? route.fulfill({ contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') }) : route.abort());
    await page.goto('https://curv.test/menu/');
    await page.evaluate(() => {
      window.fetch = () => { throw Error('Live requests forbidden'); };
      window.WebSocket = class { constructor() { throw Error('Live requests forbidden'); } };
    });
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) await page.addScriptTag({ content: m[1] });
    await page.evaluate(() => {
      closeForm();
      window.fixtureId = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
      window.loadOptionsScenario = async scenario => {
        cart.length = 0;
        const categories = (scenario.specialized ? ['Matcha & Hojicha', 'Takoyaki & Savory Bites'] : ['Salads', 'Sushi', 'Pasta']).map((name, i) => ({ id: fixtureId(100+i), name, sort_order: i }));
        const products = categories.map((category, i) => ({ id: fixtureId(i+1), category_id: category.id,
          name: scenario.specialized ? ['Kagoshima Matcha Cream', 'OG Takoyaki'][i] : 'Sample ' + category.name, is_published: true, is_available: true, is_sold_out: false, is_curv_pick: true }));
        const sizes = products.flatMap((product, i) => (scenario.specialized ? (i === 0 ? ['Each'] : ['4pcs', '8pcs', '12pcs']) : ['Each'])
          .map((label, j) => ({ id: fixtureId(200+i*10+j), product_id: product.id, label, price: 150+j*50, sort_order: j })));
        const group = { product_id: fixtureId(1), option_group_id: fixtureId(300), group_key: 'dressing', name: 'Dressing',
          selection_type: 'single', is_required: true, min_selections: 1, max_selections: 1, sort_order: 0 };
        const choice = { product_id: fixtureId(1), option_group_id: fixtureId(300), option_choice_id: fixtureId(400),
          label: 'Sesame', value: 'sesame', price_delta: 10, sort_order: 0 };
        const groups = scenario.required ? [group] : [];
        const choices = scenario.required && !scenario.noChoices ? [choice] : [];
        const defaults = scenario.required && !scenario.noDefault ? [{ product_id: fixtureId(1), option_group_id: fixtureId(300),
          option_choice_id: fixtureId(scenario.brokenDefault ? 401 : 400) }] : [];
        if (scenario.missingChoiceId) delete choice.option_choice_id;
        if (scenario.missingGroupId) delete group.option_group_id;
        if (scenario.missingDefaultId) delete defaults[0].option_choice_id;
        if (scenario.unattributableGroup) groups.push({ option_group_id: fixtureId(888) });
        if (scenario.badRules) group.selection_type = 'invalid';
        if (scenario.orphan) {
          groups.unshift({ ...group, product_id: fixtureId(999) });
          choices.push({ ...choice, product_id: fixtureId(999) });
          defaults.push({ product_id: fixtureId(999), option_group_id: fixtureId(300), option_choice_id: fixtureId(400) });
        }
        const rows = { public_menu_categories: categories, public_menu_products: products, public_menu_product_sizes: sizes,
          public_menu_category_sections: [], public_menu_option_groups: groups, public_menu_option_choices: choices, public_menu_option_defaults: defaults };
        const reads = [], warnings = [];
        const warn = console.warn;
        console.warn = (...args) => warnings.push(args.map(a => a instanceof Error ? a.message : a));
        publicMenuSupabaseClient = { from(view) {
          if (!(view in rows)) throw Error('Unexpected read: ' + view);
          reads.push(view);
          return { select() { return this; }, order() { return this; }, then(resolve, reject) {
            return Promise.resolve({ data: scenario.failedView === view ? null : rows[view],
              error: scenario.failedView === view ? { message: 'Fixture request failed', code: 'FIXTURE_FAILURE' } : null }).then(resolve, reject);
          } };
        } };
        window.supabase = { createClient: () => publicMenuSupabaseClient };
        publicMenuFetchStarted = false;
        try { await fetchPublicMenuFromSupabase(); } finally { console.warn = warn; }
        const panels = products.map(product => {
          const target = publicProductPanelTargets.get(product.id);
          if (!target) throw Error('Missing panel ' + product.id);
          const panel = document.getElementById('panel-' + target.panelId);
          showSection(target.sectionId);
          document.querySelector('#panel-wrap-' + target.panelId + ' > .product-card').click();
          const disabled = panel.querySelector('.panel-add-btn').disabled;
          const selectedDefault = !!panel.querySelector('[data-option-key="dressing"] [data-value="sesame"].selected');
          if (!disabled) panel.querySelector('.panel-add-btn').click();
          return { disabled, selectedDefault };
        });
        return { panels, reads, warnings, nullMap: latestPublicMenuOptions === null,
          orphanSkipped: latestPublicMenuOptions !== null && !latestPublicMenuOptions.byProductId[fixtureId(999)] &&
            !Object.values(latestPublicMenuOptions.byProductName).some(entry => entry && entry.product_id === fixtureId(999)),
          cart: cart.map(line => ({ product_id: line.product_id, price: line.price, options: line.options })) };
      };
    });
    const run = scenario => page.evaluate(s => loadOptionsScenario(s), scenario);
    let result = await run({});
    check(result.panels.every(p => !p.disabled), 'empty successful options: salad and sushi enabled');
    check(result.cart.length === 3, 'salad and sushi can actually be added');
    check(!result.nullMap && result.warnings.length === 0, 'empty successful reads produce valid empty map: ' + JSON.stringify(result.warnings));
    result = await run({ orphan: true });
    check(result.cart.length === 3 && result.panels.every(p => !p.disabled), 'orphan does not disable unrelated products');
    check(result.orphanSkipped, 'orphan excluded from both map indexes');
    const warning = result.warnings.find(w => String(w[0]).includes('Skipping option-group mapping'));
    check(!!warning && warning[1].product_id.endsWith('999') && warning[1].option_group_id.endsWith('300') &&
      warning[1].group_key === 'dressing' && warning[1].publicProductCount === 3, 'warning identifies orphan UUID, group and fetched product count');
    for (const view of ['public_menu_option_groups', 'public_menu_option_choices', 'public_menu_option_defaults']) {
      result = await run({ required: true, failedView: view });
      check(result.reads.includes(view), view + ': actual fetch path exercised');
      check(result.nullMap, view + ': failed request preserves null map');
      check(result.panels[0].disabled, view + ': known required options fail closed');
      check(view === 'public_menu_option_groups'
        ? result.panels.every(p => p.disabled) && result.cart.length === 0
        : result.panels.slice(1).every(p => !p.disabled) && result.cart.length === 2,
        view + ': only confirmed group-free products can fall back');
      check(result.warnings.some(w => String(w[0]).includes('Option fetch failed') && w[1].some(e => e.view === view)), view + ': request failure diagnosed');
    }
    for (const scenario of [{ noChoices: true }, { badRules: true }, { brokenDefault: true }, { missingChoiceId: true }, { missingGroupId: true }, { missingDefaultId: true }]) {
      result = await run({ required: true, ...scenario });
      check(!result.nullMap && result.panels[0].disabled, JSON.stringify(scenario) + ': affected product rejected locally');
      check(!result.panels[1].disabled && result.cart.length === 2 && result.cart[0].product_id.endsWith('002'), 'unrelated sushi remains addable');
    }
    for (const failedView of ['public_menu_option_choices', 'public_menu_option_defaults']) {
      result = await run({ failedView });
      check(result.nullMap && result.cart.length === 3, failedView + ': successful empty group read permits all three generic products');
      result = await run({ failedView, unattributableGroup: true });
      check(result.panels.every(p => p.disabled), 'unattributable group metadata cannot establish safe fallback');
    }
    result = await run({ required: true, noDefault: true });
    check(result.panels[0].disabled && !result.panels[1].disabled, 'required choice still required without default');
    result = await run({ required: true, orphan: true });
    check(result.panels.every(p => !p.disabled) && result.cart.length === 3, 'valid required options survive orphan mapping');
    check(result.panels[0].selectedDefault && result.cart[0].options.dressing === 'sesame', 'valid default selected and retained in cart');
    check(result.cart[0].price === 160, 'valid option price effect retained');
    for (const failedView of [undefined, 'public_menu_option_groups', 'public_menu_option_choices', 'public_menu_option_defaults']) {
      result = await run({ specialized: true, failedView });
      check(result.cart.length === 2 && result.panels.every(p => !p.disabled), 'Drinks/Takoyaki preserve validated specialized behavior: ' + failedView + JSON.stringify(result));
    }
    result = await run({ specialized: true, required: true, failedView: 'public_menu_option_choices' });
    check(result.panels[0].disabled && !result.panels[1].disabled, 'known configured options cannot bypass failure through specialized panel');
    check(errors.length === 0, 'no browser script errors: ' + errors.join('; '));
    console.log('Public menu options hydration: ' + checks + ' assertions passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
