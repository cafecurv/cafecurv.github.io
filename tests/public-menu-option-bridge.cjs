// Offline cutover test: both option-key generations, approved recipes, fail-closed panels.
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
      ? route.fulfill({ contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') })
      : route.abort());
    await page.goto('https://curv.test/menu/');
    await page.evaluate(() => {
      window.fetch = () => { throw Error('Live requests forbidden'); };
      window.WebSocket = class { constructor() { throw Error('Live requests forbidden'); } };
    });
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (script[1].trim()) await page.addScriptTag({ content: script[1] });
    }

    const result = await page.evaluate(() => {
      closeForm();
      const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
      const aliases = ['beverage_temperature', 'temperature', 'extra_shot', 'sinkers',
        'sauce_beverage', 'garnish', 'add_cheese', 'milk', 'syrup', 'sweetener'];
      const normalized = aliases.map(normalizePublicOptionKey);
      const recipe = name => getApprovedPublicRecipeKeys({ id: uuid(9999), name });
      const recipes = Object.fromEntries([
        'Brown Sugar Cinnamon Cream Latte', 'Curv Seasalt Latte', 'Seasalt Dark Latte',
        'Cloud Spanish Oat Latte', 'Cocoa Caramel Latte', 'White Ube Latte',
        'Iced Shaken Vanilla Jelly', 'Curv Latte', 'Americano',
        'Hojicha Banana Pudding Latte', 'Hojicha Brûlée', 'Double Chocolate Chip Cream',
        'Tropic Kiss', 'Chicken Karaage', 'Cream Dory Fillet', 'OG Takoyaki'
      ].map(name => [name, recipe(name)]));
      const duplicateProduct = { id: uuid(1), name: 'Curv Latte' };
      const aliasRow = key => ({ product_id: uuid(1), option_group_id: uuid(20),
        group_key: key, name: 'Temperature', selection_type: 'single',
        is_required: true, min_selections: 1, max_selections: 1 });
      const duplicate = buildSupabaseOptionsMap(
        [aliasRow('beverage_temperature'), aliasRow('temperature')], [], [], [duplicateProduct]);
      const conflict = buildSupabaseOptionsMap(
        [aliasRow('beverage_temperature'), { ...aliasRow('temperature'), option_group_id: uuid(21) }],
        [], [], [duplicateProduct]);

      const categories = [
        { id: uuid(100), name: 'Espresso', sort_order: 0 },
        { id: uuid(101), name: 'Takoyaki & Savory Bites', sort_order: 1 },
        { id: uuid(102), name: 'Sushi', sort_order: 2 }
      ];
      const products = [
        { id: uuid(1), name: 'Brown Sugar Cinnamon Cream Latte', category_id: categories[0].id },
        { id: uuid(2), name: 'Curv Latte', category_id: categories[0].id },
        { id: uuid(3), name: 'Chicken Karaage', category_id: categories[1].id },
        { id: uuid(4), name: 'Classic Cali Maki', category_id: categories[2].id },
        { id: uuid(5), name: 'OG Takoyaki', category_id: categories[1].id }
      ].map(product => ({ ...product, is_published: true, is_available: true,
        is_sold_out: false, description: 'Fixture recipe' }));
      const sizes = products.flatMap((product, i) =>
        (i === 4 ? ['4pcs', '8pcs', '12pcs'] : i < 2 ? ['Regular', 'Large'] : ['Regular']).map((label, j) =>
          ({ id: uuid(200 + i * 10 + j), product_id: product.id, label,
            price: 150 + j * 20, sort_order: j })));
      sizes.push({ id: uuid(299), product_id: products[1].id, label: '12oz Hot', price: 150, sort_order: 2 });
      const optionGroups = [], optionChoices = [], optionDefaults = [];
      const addGroup = (productIndex, key, groupIndex, required = false) => {
        const product_id = products[productIndex].id;
        const option_group_id = uuid(300 + productIndex * 10 + groupIndex);
        const option_choice_id = uuid(400 + productIndex * 10 + groupIndex);
        optionGroups.push({ product_id, option_group_id, group_key: key,
          name: key === 'beverage_temperature' ? 'Temperature' : key,
          selection_type: 'single', is_required: required,
          min_selections: required ? 1 : 0, max_selections: 1, sort_order: groupIndex });
        optionChoices.push({ product_id, option_group_id, option_choice_id,
          label: key === 'beverage_temperature' ? 'Iced' : 'Fixture ' + key,
          value: key === 'beverage_temperature' ? 'iced' : key,
          price_delta: 0, sort_order: 0 });
        if (required) optionDefaults.push({ product_id, option_group_id, option_choice_id });
        return option_choice_id;
      };
      ['milk', 'extra_shot', 'syrup', 'sauce_beverage'].forEach((key, i) => addGroup(0, key, i));
      const icedChoice = addGroup(1, 'beverage_temperature', 0, true);
      const hotChoice = uuid(499);
      optionChoices.push({ product_id: products[1].id, option_group_id: uuid(310),
        option_choice_id: hotChoice, label: 'Hot', value: 'hot', price_delta: 0, sort_order: 1 });
      ['milk', 'extra_shot', 'syrup', 'sauce_beverage'].forEach((key, i) => addGroup(1, key, i + 1));
      addGroup(0, 'beverage_temperature', 5); // retired on this iced-only signature
      addGroup(2, 'bites_sauce', 0); // fixed recipe, no selector
      addGroup(4, 'spicy', 0, true); // pre-migration Add-ons and Cheese still missing
      const compatibility = [{ product_id: products[1].id, product_size_id: sizes[2].id,
        option_choice_id: icedChoice, is_active: true },
        { product_id: products[1].id, product_size_id: uuid(299),
          option_choice_id: hotChoice, is_active: true }];
      const render = () => {
        const menu = shapePublicMenuData(categories, products, sizes);
        menu.options = buildSupabaseOptionsMap(optionGroups, optionChoices, optionDefaults, products);
        menu.configurationCompatibility = compatibility;
        renderPublicMenuFromSupabase(menu);
        const panel = index => {
          const target = publicProductPanelTargets.get(products[index].id);
          return document.getElementById('panel-' + target.panelId);
        };
        return products.map((_, index) => {
          const target = publicProductPanelTargets.get(products[index].id);
          const currentPanel = panel(index);
          const sizeHeading = [...currentPanel.querySelectorAll('.panel-options .option-group-label')]
            .find(label => label.textContent.trim() === 'Size');
          return { disabled: panel(index).querySelector('.panel-add-btn').disabled,
            headings: [...currentPanel.querySelectorAll('.panel-options .option-group-label')].map(label => label.textContent.trim()),
            visibleSizeHeading: !!sizeHeading && (sizeHeading.parentElement.classList.contains('panel-options')
              ? sizeHeading.style.display !== 'none' : sizeHeading.parentElement.style.display !== 'none'),
            temperatureLabels: [...currentPanel.querySelectorAll('.panel-options .option-group-label')]
              .filter(label => label.textContent.trim().toLowerCase().startsWith('temperature')).length,
            temperatureChoices: [...currentPanel.querySelectorAll('[data-option-key="temperature"] .option-chip')]
              .map(chip => chip.dataset.value),
            piecesCount: currentPanel.querySelectorAll('[data-group="pieces"]').length,
            customizeCount: currentPanel.querySelectorAll('.public-customize').length,
            required: publicItemPanels.get(target.panelId).requiredOptionKeys,
            groups: publicItemPanels.get(target.panelId).optionGroups.map(group => group.group_key),
            visibleTemperature: !!panel(index).querySelector('[data-option-key="temperature"], [data-group="temperature"]'),
            visibleSauce: !!panel(index).querySelector('[data-option-key="bites_sauce"], [data-group="sauce_pref"]') };
        });
      };
      const initial = render();
      compatibility.splice(0);
      const noSize = render();
      compatibility.push({ product_id: products[1].id, product_size_id: sizes[2].id,
        option_choice_id: icedChoice, is_active: true },
        { product_id: products[1].id, product_size_id: uuid(299),
          option_choice_id: hotChoice, is_active: true });
      optionGroups.splice(optionGroups.findIndex(group => group.product_id === products[1].id
        && group.group_key === 'beverage_temperature'), 1);
      const missingRequired = render();
      return { aliases, normalized, recipes, duplicateGroups: duplicate.byProductId[uuid(1)].groups.length,
        conflictError: !!conflict.errorsByProductId[uuid(1)], initial, noSize, missingRequired };
    });

    const expectedAliases = ['temperature', 'temperature', 'extrashot', 'inclusions',
      'sauce', 'addons', 'cheese', 'milk', 'syrup', 'sweetener'];
    result.aliases.forEach((key, i) =>
      check(result.normalized[i] === expectedAliases[i], key + ' normalizes to ' + expectedAliases[i]));
    check(result.duplicateGroups === 1, 'both names for one group ID render once');
    check(result.conflictError, 'different group IDs under one semantic key fail per product');
    for (const name of [
      'Brown Sugar Cinnamon Cream Latte', 'Curv Seasalt Latte', 'Seasalt Dark Latte',
      'Cloud Spanish Oat Latte', 'Cocoa Caramel Latte', 'White Ube Latte'
    ]) check(!result.recipes[name].includes('temperature'), name + ' has no Temperature requirement');
    check(!result.recipes['Iced Shaken Vanilla Jelly'].includes('temperature'), 'Vanilla Jelly has no Temperature');
    check(!result.recipes['Iced Shaken Vanilla Jelly'].includes('inclusions'), 'Vanilla Jelly has no Inclusions');
    check(result.recipes['Double Chocolate Chip Cream'].join() === 'syrup,sauce,inclusions',
      'Curvccino has no Milk');
    check(result.recipes['Tropic Kiss'].join() === 'syrup', 'Refresher has no Sauce');
    for (const name of ['Chicken Karaage', 'Cream Dory Fillet'])
      check(result.recipes[name].length === 0, name + ' has no sauce selector');
    check(result.recipes['Curv Latte'].includes('temperature'), 'Curv Latte still requires Temperature');
    check(result.recipes['Americano'].join() === 'temperature,extrashot',
      'Americano still requires Temperature and Extra Espresso Shot');
    check(result.recipes['Hojicha Banana Pudding Latte'].join() === 'extrapower,milk,sweetener'
      && result.recipes['Hojicha Brûlée'].join() === 'extrapower,milk,sweetener',
    'new Hojicha recipes match approved profile');
    check(result.recipes['OG Takoyaki'].join() === 'spicy,addons,cheese',
      'Takoyaki still expects three approved groups');
    check(!result.initial[0].disabled && !result.initial[0].visibleTemperature,
      'legacy Brown Sugar Temperature row is retired without blocking its four valid groups');
    check(!result.initial[1].disabled && result.initial[1].groups.includes('temperature'),
      'legacy Curv Latte Temperature key remains orderable with server compatibility');
    check(result.initial[1].temperatureLabels === 1
      && result.initial[1].temperatureChoices.join() === 'iced,hot',
    'classic drink renders one Temperature section with Hot and Iced');
    check(result.initial[0].temperatureLabels === 0,
      'iced-only signature has no Temperature heading');
    check(result.noSize[1].disabled && !result.noSize[1].visibleSizeHeading,
      'missing compatible sizes hide Size heading and remain fail-closed');
    check(!result.initial[2].disabled && !result.initial[2].visibleSauce,
      'savory fixed sauce is not a selectable requirement');
    check(!result.initial[3].disabled, 'unrelated group-free sushi stays addable');
    check(result.initial[4].disabled && result.initial[4].piecesCount === 1
      && result.initial[4].customizeCount === 1,
    'Takoyaki has one Pieces and Customize section but remains blocked for missing mappings');
    check(result.initial[4].groups.join() === 'spicy',
      'Takoyaki does not duplicate the legacy Spice group');
    check(result.missingRequired[1].disabled && !result.missingRequired[0].disabled,
      'truly missing Temperature blocks Curv Latte only');
    check(errors.length === 0, 'no browser script errors: ' + errors.join('; '));
    console.log('Public menu option bridge: ' + checks + ' assertions passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
