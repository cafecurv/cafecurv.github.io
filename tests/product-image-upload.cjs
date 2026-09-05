// Offline browser tests: mock Storage and product operations; no live requests/SQL.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'admin/menu-manager.html'), 'utf8');
  const uploadSource = fs.readFileSync(path.join(root, 'admin/product-image-upload.js'), 'utf8');
  const cropSource = fs.readFileSync(path.join(root, 'admin/product-image-crop.js'), 'utf8');
  const adminSource = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  const check = (condition, label) => { checks++; assert(condition, label); };
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.href === 'https://curv.test/admin/menu-manager.html') {
        return route.fulfill({ contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') });
      }
      if (url.origin === 'https://curv.test' && url.pathname === '/admin/admin.css') return route.fulfill({ path: path.join(root, 'admin/admin.css') });
      return route.abort();
    });
    await page.goto('https://curv.test/admin/menu-manager.html');
    await page.addScriptTag({ content: cropSource + '\n' + uploadSource });
    await page.evaluate(() => {
      const root = document.querySelector('[data-product-image-editor]');
      document.body.replaceChildren(root);
      root.style.cssText = 'max-width:600px;padding:20px;margin:auto';
      window.authorized = true;
      window.enabled = true;
      window.calls = { uploads: [], removals: [] };
      window.storage = {
        async upload(objectPath, file, options) {
          calls.uploads.push({ path: objectPath, type: file.type, options });
          if (window.hold) return new Promise(resolve => { window.release = resolve; });
          return window.fail ? { error: new Error('Fixture upload failure') } : {};
        },
        async remove(paths) { calls.removals.push(...paths); return {}; },
        getPublicUrl: objectPath => ({ data: { publicUrl: 'https://curv.test/storage/v1/object/public/menu-images/' + objectPath } })
      };
      window.mockClient = { storage: { from(bucket) { if (bucket !== 'menu-images') throw new Error('Wrong bucket'); return storage; } } };
      window.uploader = CurvProductImageUpload.create({
        root, getClient: () => mockClient, isAuthorized: () => authorized, isEnabled: () => enabled
      });
    });
    const bytes = {};
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      bytes[type] = Buffer.from(await page.evaluate(type => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 4;
        canvas.getContext('2d').fillRect(0, 0, 4, 4);
        return canvas.toDataURL(type).split(',')[1];
      }, type), 'base64');
    }
    const choose = async (type = 'image/png', name = 'new-image.png', buffer = bytes[type]) => {
      await page.locator('[data-image-file]').setInputFiles({ name, mimeType: type, buffer });
      if (bytes[type] && buffer.length <= 5 * 1024 * 1024) {
        await page.waitForFunction(() => !document.querySelector('[data-crop-apply]').disabled);
        await page.locator('[data-crop-apply]').click();
        await page.waitForFunction(() => !document.querySelector('dialog.product-image-crop').open);
      }
    };
    const uuid = '12345678-1234-4234-8234-123456789012';
    for (const type of Object.keys(bytes)) {
      await page.evaluate(() => uploader.reset('/images/old.jpg'));
      await choose(type);
      check(await page.locator('[data-image-preview]').getAttribute('src').then(src => src.startsWith('blob:')), type + ' local preview');
      check(await page.locator('[name=image_url]').inputValue() === '/images/old.jpg', 'preview is not persisted');
      const url = await page.evaluate(id => uploader.prepare(id), uuid);
      check(url.includes('/products/' + uuid + '/'), type + ' unique product path');
      await page.evaluate(() => { uploader.markSaveAttempt(); uploader.markAttached(); });
    }
    check(await page.evaluate(() => calls.uploads.every(call => call.options.upsert === false)), 'no overwrites');
    check(await page.evaluate(() => new Set(calls.uploads.map(call => call.path)).size === 3), 'unique paths');
    const before = await page.evaluate(() => calls.uploads.length);
    await choose('text/plain', 'bad.txt', Buffer.from('invalid'));
    check((await page.locator('[data-image-status]').textContent()).includes('JPG, PNG'), 'unsupported message');
    await choose('image/png', 'large.png', Buffer.alloc(5 * 1024 * 1024 + 1));
    check((await page.locator('[data-image-status]').textContent()).includes('5 MB'), 'size limit');
    check(await page.evaluate(() => calls.uploads.length) === before, 'invalid selections do not upload');
    await page.locator('[data-image-remove]').click();
    check(await page.locator('[name=image_url]').inputValue() === '', 'remove clears reference');
    check(await page.evaluate(() => calls.removals.length) === 0, 'saved images never deleted');
    for (const url of ['images/old.jpg', '/images/old.jpg', 'https://example.test/old.jpg', 'data:image/png;base64,AA==']) {
      await page.evaluate(url => uploader.reset(url), url);
      check(await page.locator('[data-image-preview]').getAttribute('src') === (url.startsWith('images/') ? '/' + url : url), 'legacy preview');
    }
    await choose();
    await page.evaluate(() => { window.fail = true; });
    check(await page.evaluate(() => uploader.prepare().then(() => false, () => true)), 'upload error returned');
    check((await page.locator('[data-image-preview]').getAttribute('src')).startsWith('blob:'), 'failure retains selection');
    await page.evaluate(() => { window.fail = false; });
    check((await page.evaluate(() => uploader.prepare())).includes('/drafts/'), 'new-product draft path');
    const removals = await page.evaluate(() => calls.removals.length);
    await page.evaluate(() => uploader.reset('/images/new-product.jpg'));
    check(await page.evaluate(() => calls.removals.length) === removals + 1, 'unattached cleanup');

    await choose();
    const uploadCount = await page.evaluate(() => calls.uploads.length);
    await page.evaluate(() => { window.hold = true; window.pending = uploader.prepare().catch(error => error.message); uploader.prepare().catch(() => {}); });
    check(await page.locator('[data-image-progress]').isVisible(), 'busy progress');
    check(await page.locator('[data-image-choose]').isDisabled(), 'busy disabled');
    check(await page.evaluate(() => calls.uploads.length) === uploadCount + 1, 'double prepare single upload');
    await page.evaluate(() => { window.authorized = false; uploader.reset(''); window.release({}); });
    await page.evaluate(() => pending);
    check(await page.locator('[name=image_url]').inputValue() === '', 'signout ignores stale upload');
    check(await page.locator('[data-image-choose]').isDisabled(), 'signout controls disabled');
    await page.evaluate(() => { window.authorized = true; window.hold = false; uploader.reset(''); });
    await choose();
    await page.evaluate(() => { window.hold = true; window.pending = uploader.prepare().catch(error => error.message); });
    await page.evaluate(() => { uploader.reset('/images/other-product.jpg'); window.release({}); });
    await page.evaluate(() => pending);
    check(await page.locator('[name=image_url]').inputValue() === '/images/other-product.jpg', 'editor switch ignores stale upload');
    await page.evaluate(() => { window.hold = false; uploader.reset(''); });
    await choose();
    await page.evaluate(async () => { await uploader.prepare(); uploader.markSaveAttempt(); });
    const retain = await page.evaluate(() => calls.removals.length);
    await page.evaluate(() => uploader.reset(''));
    check(await page.evaluate(() => calls.removals.length) === retain, 'uncertain save retains object');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'width ' + width);
    }

    // Run the real Menu Manager save function against a mock query builder.
    await page.goto('https://curv.test/admin/menu-manager.html');
    await page.addScriptTag({ content: cropSource + '\n' + uploadSource });
    await page.evaluate(() => {
      window.dbProduct = {
        id: '12345678-1234-4234-8234-123456789012', name: 'Fixture Product',
        category_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', category_section_id: null,
        description: 'Keep this description', image_url: '/images/legacy.jpg', notes: '',
        is_published: true, is_available: true, is_sold_out: false, is_curv_pick: true, is_seasonal: false,
        archived_at: null, variant_group_name: 'Each', sort_order: 0,
        product_sizes: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Each', price: 180, cost: null, sort_order: 0 }]
      };
      window.saveCalls = [];
      window.storageCalls = [];
      window.uploadFail = false;
      window.clientMock = {
        auth: { onAuthStateChange: callback => { window.authCallback = callback; }, signOut: async () => ({}) },
        storage: { from: () => ({
          upload: async (path, file, options) => {
            storageCalls.push({ path, options });
            if (window.uploadHold) return new Promise(resolve => { window.finishUpload = resolve; });
            return uploadFail ? { error: new Error('Fixture upload rejected') } : {};
          },
          getPublicUrl: path => ({ data: { publicUrl: 'https://curv.test/storage/v1/object/public/menu-images/' + path } }),
          remove: async () => ({})
        }) },
        from(table) {
          return {
            select() { return this; }, eq() { return this; }, is() { return this; }, order() { return this; }, in() { return this; },
            update(value) { saveCalls.push(value); Object.assign(dbProduct, value); return this; },
            insert(value) { saveCalls.push(value); Object.assign(dbProduct, value); return this; },
            async maybeSingle() { return { data: { id: dbProduct.id } }; },
            async single() { return { data: { id: dbProduct.id } }; },
            then(resolve) { return Promise.resolve({ data: table === 'products' ? [dbProduct] : [], error: null }).then(resolve); }
          };
        },
        rpc: async () => ({ data: {}, error: null })
      };
      window.supabase = { createClient: () => clientMock };
    });
    const start = adminSource.lastIndexOf('(() => {', adminSource.indexOf("const menuManagerRoot ="));
    const end = adminSource.indexOf('(() => {', adminSource.indexOf('  refreshSession();', start));
    let manager = adminSource.slice(start, end);
    manager = manager.replace('  refreshSession();', [
      'window.menuTest = { saveDraftProduct, loadProductIntoForm, resetDraftProductForm, openCreateProductEditor,',
      "seed: () => { latestCategories = [{ id: dbProduct.category_id, name: 'Fixture Category', sort_order: 0 }];",
      "latestProducts = [dbProduct]; setSignedInState(true, 'owner@example.test'); populateDraftCategorySelect(latestCategories); },",
      'signout: () => { setSignedInState(false); resetDraftProductForm(); } };'
    ].join('\n'));
    await page.addScriptTag({ content: manager });
    await page.evaluate(async () => { menuTest.seed(); await menuTest.loadProductIntoForm(dbProduct.id); });
    await choose();
    await page.evaluate(() => menuTest.saveDraftProduct());
    const payload = await page.evaluate(() => saveCalls[0]);
    check(payload && payload.image_url.includes('/storage/v1/object/public/menu-images/'), 'save persists uploaded URL');
    check(payload.description === 'Keep this description' && payload.is_published && payload.is_available && payload.is_curv_pick, 'preserves product state');
    check(await page.evaluate(() => dbProduct.product_sizes[0].id) === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'size UUID unchanged');
    await choose();
    await page.evaluate(() => { window.uploadFail = true; });
    const savesBefore = await page.evaluate(() => saveCalls.length);
    await page.evaluate(() => menuTest.saveDraftProduct());
    check(await page.evaluate(() => saveCalls.length) === savesBefore, 'upload failure blocks write');
    check(!(await page.locator('[data-image-choose]').isDisabled()), 'failure unlocks editor');
    const uploadsBefore = await page.evaluate(() => storageCalls.length);
    await page.evaluate(() => { window.uploadFail = false; window.uploadHold = true; window.saving = menuTest.saveDraftProduct(); menuTest.saveDraftProduct(); });
    check(await page.evaluate(() => storageCalls.length) === uploadsBefore + 1, 'double save one upload');
    await page.evaluate(() => { menuTest.signout(); window.finishUpload({}); });
    await page.evaluate(() => saving);
    check(await page.evaluate(() => saveCalls.length) === savesBefore, 'signout prevents save');
    check(await page.locator('[name=image_url]').inputValue() === '', 'late response cannot refill form');

    await page.evaluate(async () => { window.uploadHold = false; menuTest.seed(); await menuTest.openCreateProductEditor(); });
    await page.locator('#draft-product-name').fill('New Image Product');
    await page.locator('#draft-product-category').selectOption('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await page.locator('[data-variant-price]').first().fill('199');
    await choose();
    await page.evaluate(() => menuTest.saveDraftProduct());
    const newPayload = await page.evaluate(() => saveCalls[saveCalls.length - 1]);
    check(newPayload.name === 'New Image Product' && newPayload.image_url.includes('/drafts/'), 'new product attaches draft upload');
    check(newPayload.is_published === false, 'new draft visibility preserved');
    if (process.env.CURV_TEST_SCREENSHOTS) {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.locator('[data-product-image-editor]').screenshot({ path: path.join(process.env.CURV_TEST_SCREENSHOTS, 'product-image-editor.png') });
    }

    const publicHtml = fs.readFileSync(path.join(root, 'menu/index.html'), 'utf8');
    await page.route('https://curv.test/menu/', route => route.fulfill({
      contentType: 'text/html', body: publicHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    }));
    await page.route('https://curv.test/storage/**', route => route.fulfill({ contentType: 'image/png', body: bytes['image/png'] }));
    await page.route('https://curv.test/images/**', route => route.fulfill({ contentType: 'image/png', body: bytes['image/png'] }));
    await page.goto('https://curv.test/menu/');
    for (const match of publicHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) await page.addScriptTag({ content: match[1] });
    }
    for (const imageUrl of ['images/fixture.png', '/images/fixture.png', 'https://curv.test/images/fixture.png',
      'https://curv.test/storage/v1/object/public/menu-images/products/fixture/image.png']) {
      const result = await page.evaluate(imageUrl => {
        const menu = shapePublicMenuData([{ id: 'salads-test', name: 'Salads', sort_order: 1 }],
          [{ id: 'photo-product', category_id: 'salads-test', name: 'Photo Product', image_url: imageUrl, is_curv_pick: true, is_available: true }],
          [{ id: 'photo-size', product_id: 'photo-product', label: 'Each', price: 180 }], []);
        renderPublicMenuFromSupabase(menu);
        document.querySelectorAll('#salads img, #curv-picks-supabase-mount img').forEach(img => { img.loading = 'eager'; });
        return {
          normal: document.querySelector('#salads img').getAttribute('src'),
          pick: document.querySelector('#seasonal img').getAttribute('src'),
          search: publicMenuSearchIndex[0].target.querySelector('img').getAttribute('src')
        };
      }, imageUrl);
      const expected = imageUrl.startsWith('images/') ? '/' + imageUrl : imageUrl;
      check(result.normal === expected && result.pick === expected && result.search === expected, 'public images: ' + imageUrl);
      await page.waitForFunction(() => [...document.querySelectorAll('#salads img, #curv-picks-supabase-mount img')].every(img => img.complete && img.naturalWidth > 0));
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'public mobile images no overflow');
    check(errors.length === 0, 'no uncaught errors: ' + errors.join(', '));
    console.log(checks + ' upload/UI/save assertions passed. All requests intercepted.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
