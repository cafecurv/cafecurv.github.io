// Offline geometry regression: real menu DOM/CSS, decoded large images, no live requests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'menu/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
  const browser = await chromium.launch({ channel: process.env.CURV_BROWSER_CHANNEL || 'msedge', headless: true });
  let assertions = 0;
  const check = (value, label) => { assertions++; assert(value, label); };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixtures = {};
    for (const [name, width, height] of [['large', 2400, 3200], ['square', 768, 768], ['wide', 2200, 800]]) {
      fixtures[name] = Buffer.from(await page.evaluate(([w,h]) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#6f974f'; ctx.fillRect(0,0,w,h);
        ctx.fillStyle = '#e7c85b'; ctx.fillRect(w/4,h/4,w/2,h/2);
        ctx.fillStyle = '#b25254'; ctx.fillRect(w/3,h/3,w/3,h/3);
        return c.toDataURL('image/png').split(',')[1];
      }, [width,height]), 'base64');
    }
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.href === 'https://curv.test/menu/') return route.fulfill({
        contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      });
      if (url.hostname === 'fixture.supabase.co' && url.pathname === '/storage/v1/object/public/menu-images/large.png') {
        return route.fulfill({ contentType: 'image/png', body: fixtures.large });
      }
      if (url.origin === 'https://curv.test' && ['/images/geometry-square.png', '/images/geometry-wide.png'].includes(url.pathname)) {
        return route.fulfill({ contentType: 'image/png', body: url.pathname.includes('square') ? fixtures.square : fixtures.wide });
      }
      return route.abort();
    });
    await page.goto('https://curv.test/menu/');
    await page.evaluate(() => {
      window.fetch = () => { throw new Error('Live fetch forbidden'); };
      window.WebSocket = class { constructor() { throw new Error('Live sockets forbidden'); } };
    });
    for (const content of scripts) await page.addScriptTag({ content });
    const sections = await page.evaluate(() => {
      closeForm();
      document.getElementById('htoOverlay')?.classList.remove('show');
      const configs = SPECIAL_PUBLIC_CATEGORY_SECTIONS.map(c => ({ sectionId: c.sectionId, name: c.tabLabel }));
      configs.push({ sectionId: 'public-category-geometry-new', name: 'Fixture New Category' });
      const categories = configs.map((c,i) => ({ id: c.sectionId === 'public-category-geometry-new' ? 'geometry-new' : 'geometry-' + c.sectionId, name: c.name, sort_order: i }));
      const categorySections = categories.map(c => ({ id: c.id + '-signature', category_id: c.id, name: 'Signature', sort_order: 0 }));
      const products = categories.flatMap((c,i) => [
        'https://fixture.supabase.co/storage/v1/object/public/menu-images/large.png',
        '/images/geometry-square.png', 'images/geometry-wide.png', null
      ].map((image_url, index) => ({
        id: c.id + '-product-' + index, category_id: c.id, category_section_id: c.id + '-signature',
        name: i === 0 && index === 0 ? 'Banana Pudding Matcha Latte' : 'Arbitrary Product ' + i + '-' + index,
        description: 'Creamy banana pudding, matcha and milk. Freshly prepared with a long description that wraps naturally.',
        image_url, badge_labels: ['New', 'Best Seller'], is_published: true, is_available: true,
        is_sold_out: false, is_curv_pick: true, sort_order: index
      })));
      // Real enhanced neighbor confirms generic insertion does not break panel flow.
      products.push({
        id: 'geometry-kagoshima', category_id: 'geometry-matcha', category_section_id: 'geometry-matcha-signature',
        name: 'Kagoshima Matcha Cream', image_url: '/images/geometry-square.png',
        is_published: true, is_available: true, is_curv_pick: true, sort_order: 4
      });
      const sizes = products.map(p => ({ id: p.id + '-size', product_id: p.id, label: 'Each', price: 185, sort_order: 0 }));
      window.geometryMenu = shapePublicMenuData(categories, products, sizes, categorySections);
      renderPublicMenuFromSupabase(geometryMenu);
      document.querySelectorAll('img').forEach(img => { img.loading = 'eager'; });
      return configs.map(c => c.sectionId);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.generic-public-product img, .curv-pick-card img')].every(img => img.complete && img.naturalWidth > 0));
    await page.evaluate(() => showSection('matcha'));
    console.log('Matcha image/text geometry:', await page.locator('#matcha .generic-public-product').first().evaluate(card => {
      const bounds = el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height });
      return { card: bounds(card), image: bounds(card.querySelector('img')), text: bounds(card.querySelector('.item-info')) };
    }));
    const widths = [320, 375, 390, 430, 768, 1280];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const sectionId of [...sections, 'seasonal']) {
        await page.evaluate(async id => {
          showSection(id);
          await Promise.allSettled(document.getElementById(id).getAnimations({ subtree: true })
            .filter(animation => animation.effect.getTiming().iterations !== Infinity)
            .map(animation => animation.finished));
        }, sectionId);
        const geometry = await page.locator('#' + sectionId).evaluate(section => {
          const rect = el => { const r=el.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
          const contained = (inner, outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
          const cards = [...section.querySelectorAll('.generic-public-product, .curv-pick-card')];
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            cards: cards.map(card => {
              const box = rect(card), info = card.querySelector('.item-info, .product-card-info'), image = card.querySelector('img');
              const next = card.nextElementSibling;
              const textBoxes = [...card.querySelectorAll('.item-name, .item-desc, .menu-item-badge, .price-single, .price-pieces, button')].map(el => ({
                contained: contained(rect(el), box), wraps: el.scrollWidth <= el.clientWidth + 1 || getComputedStyle(el).display === 'inline'
              }));
              return {
                withinParent: contained(box, rect(card.parentElement)),
                withinViewport: box.left >= -1 && box.right <= innerWidth + 1,
                textWidth: rect(info).width, textBoxes,
                imageCount: card.querySelectorAll('img').length,
                image: image ? { ...rect(image), within: contained(rect(image),box), fit: getComputedStyle(image).objectFit, decoded: image.naturalWidth > 0,
                  wrapped: image.parentElement.classList.contains('product-card-thumb') } : null,
                follows: !next || rect(next).top >= box.bottom - 1,
                reachable: [...card.querySelectorAll('button')].every(b => {
                  const r=rect(b); return r.width >= 24 && r.height >= 20 && contained(r,box);
                })
              };
            }),
            orphanImages: [...section.querySelectorAll('img')].filter(img => !img.closest('.generic-public-product, .curv-pick-card, .menu-item-wrap')).length
          };
        });
        const label = width + 'px ' + sectionId;
        check(!geometry.overflow, label + ': no document overflow');
        check(geometry.cards.length >= 4, label + ': generic cards rendered');
        check(geometry.orphanImages === 0, label + ': no standalone images');
        for (const [i, card] of geometry.cards.entries()) {
          check(card.withinParent && card.withinViewport, label + ': card contained ' + i);
          check(card.textWidth >= 140, label + ': usable text width ' + i + ' (' + card.textWidth + ')');
          check(card.textBoxes.every(t => t.contained && t.wraps), label + ': text/badge/price contained ' + i);
          check(card.follows, label + ': subsequent card positioned ' + i);
          check(card.reachable, label + ': add reachable ' + i);
          check(card.imageCount <= 1, label + ': no duplicate image ' + i);
          if (card.image) {
            const expected = width <= 480 ? 64 : 76;
            check(card.image.within && card.image.wrapped && card.image.decoded, label + ': image contained/decoded ' + i);
            // Borders consume up to 2px of the fixed thumbnail box.
            check(card.image.width >= expected - 2 && card.image.width <= expected && Math.abs(card.image.width - card.image.height) < 1,
              label + ': expected square thumbnail ' + i + ' (' + card.image.width + 'x' + card.image.height + ')');
            check(card.image.fit === 'cover', label + ': cover framing ' + i);
          }
        }
      }
      await page.evaluate(() => selectMenuSearchResult(publicMenuSearchIndex.find(p => p.productName === 'Banana Pudding Matcha Latte')));
      await page.waitForFunction(() => document.querySelector('#matcha .menu-search-target-highlight'));
      check(await page.locator('#matcha .menu-search-target-highlight').count() === 1, width + ': search routes actual Matcha card');
      if (process.env.CURV_TEST_SCREENSHOTS && [320,390,1280].includes(width)) {
        await page.waitForFunction(() => {
          const card = document.querySelector('#matcha .menu-search-target-highlight');
          const rect = card.getBoundingClientRect();
          return Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 3 && Number(getComputedStyle(card).opacity) === 1;
        });
        await page.screenshot({ path: path.join(process.env.CURV_TEST_SCREENSHOTS, 'menu-generic-geometry-' + width + '.png') });
      }
    }
    const behavior = await page.evaluate(async () => {
      const card = document.querySelector('#matcha [data-public-menu-product-id="geometry-matcha-product-0"]');
      cart.length = 0;
      card.querySelector('button').click();
      const added = cart.length === 1 && cart[0].name === 'Banana Pudding Matcha Latte' && cart[0].price === 185;
      const panel = renderedPublicPanels.get('geometry-kagoshima');
      const pick = [...document.querySelectorAll('#seasonal .curv-pick-card[onclick]')].find(p => p.textContent.includes('Kagoshima Matcha Cream'));
      pick.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const panelOpen = document.getElementById('panel-' + panel.panelId).closest('.menu-item-wrap').classList.contains('open');
      const genericPick = [...document.querySelectorAll('#seasonal .curv-pick-quick-card')].find(p => p.textContent.includes('Banana Pudding Matcha Latte'));
      cart.length = 0;
      genericPick.querySelector('button').click();
      const pickAdded = cart.length === 1 && cart[0].name === 'Banana Pudding Matcha Latte';
      geometryMenu.products.find(p => p.id === 'geometry-matcha-product-0').is_available = false;
      geometryMenu.products.find(p => p.id === 'geometry-matcha-product-1').is_sold_out = true;
      renderPublicMenuFromSupabase(geometryMenu);
      const disabled = ['geometry-matcha-product-0','geometry-matcha-product-1'].every(id =>
        document.querySelector('#matcha [data-public-menu-product-id="' + id + '"] button').disabled);
      return { added, pickAdded, panelOpen, disabled };
    });
    for (const [key,value] of Object.entries(behavior)) check(value, key);
    check(errors.length === 0, 'no uncaught errors: ' + errors.join(', '));
    console.log(assertions + ' geometry/behavior assertions passed across ' + widths.join(', ') + 'px. All requests intercepted.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
