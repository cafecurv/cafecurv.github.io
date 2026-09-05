// Offline crop integration tests. Every external request is blocked.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let count = 0;
  const check = (value, label) => { assert(value, label); count++; };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/admin/menu-manager.html') return route.fulfill({
        contentType: 'text/html',
        body: fs.readFileSync(path.join(root, 'admin/menu-manager.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      });
      if (url.pathname === '/admin/admin.css') return route.fulfill({ path: path.join(root, 'admin/admin.css') });
      return route.abort();
    });
    await page.goto('https://curv.test/admin/menu-manager.html');
    for (const name of ['product-image-crop.js', 'product-image-upload.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'admin', name), 'utf8') });
    await page.evaluate(() => {
      const root = document.querySelector('[data-product-image-editor]');
      document.body.replaceChildren(root);
      root.style.cssText = 'max-width:600px;padding:16px';
      window.authorized = true;
      window.uploads = [];
      window.uploader = CurvProductImageUpload.create({
        root, isAuthorized: () => authorized, isEnabled: () => true,
        getClient: () => ({ storage: { from: () => ({
          async upload(path, file) {
            const bitmap = await createImageBitmap(file);
            uploads.push({ path, name: file.name, type: file.type, size: file.size, width: bitmap.width, height: bitmap.height });
            bitmap.close();
            return {};
          },
          async remove() { return {}; },
          getPublicUrl: path => ({ data: { publicUrl: 'https://curv.test/storage/' + path } })
        }) } })
      });
      window.fixture = (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, width / 2, height / 2);
        ctx.fillStyle = '#00ff00'; ctx.fillRect(width / 2, 0, width / 2, height / 2);
        ctx.fillStyle = '#0000ff'; ctx.fillRect(0, height / 2, width / 2, height / 2);
        ctx.fillStyle = '#ffff00'; ctx.fillRect(width / 2, height / 2, width / 2, height / 2);
        return new Promise(done => canvas.toBlob(blob => done(new File([blob], 'original.png', { type: 'image/png' }))));
      };
    });
    const open = async (width = 1200, height = 600) => {
      await page.evaluate(async ([w, h]) => { window.selection = uploader.select(await fixture(w, h)); }, [width, height]);
      await page.waitForFunction(() => document.querySelector('dialog').open && !document.querySelector('[data-crop-apply]').disabled);
    };
    const apply = async () => {
      await page.locator('[data-crop-apply]').click();
      await page.evaluate(() => selection);
    };
    const pixels = () => page.evaluate(() => {
      const ctx = document.querySelector('dialog canvas').getContext('2d');
      return [[0,0], [767,0], [0,767], [767,767]].map(([x,y]) => [...ctx.getImageData(x,y,1,1).data]);
    });
    for (const [w,h] of [[1200,600], [600,1200], [800,800]]) {
      await page.evaluate(() => uploader.reset('/images/legacy.jpg'));
      await open(w,h);
      check(await page.evaluate(() => uploads.length) === 0, 'no upload before save');
      check((await pixels()).every(pixel => pixel[3] === 255 && pixel.slice(0,3).some(v => v < 250)), 'frame covered for ' + w + 'x' + h);
      check(await page.locator('[name=image_url]').inputValue() === '/images/legacy.jpg', 'saved reference untouched while cropping');
      await apply();
      check(await page.locator('[data-image-preview]').getAttribute('src').then(src => src.startsWith('blob:')), 'applied crop preview');
    }
    const previous = await page.locator('[data-image-preview]').getAttribute('src');
    await open();
    await page.locator('[data-crop-cancel]').click();
    await page.evaluate(() => selection);
    check(await page.locator('[data-image-preview]').getAttribute('src') === previous, 'cancel retains pending crop');
    await open();
    await page.keyboard.press('Escape');
    check(await page.locator('[data-image-preview]').getAttribute('src') === previous, 'Escape retains preview');
    await open();
    const canvas = page.locator('dialog canvas');
    const initial = await canvas.evaluate(c => c.toDataURL());
    const rect = await canvas.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.8, rect.y + rect.height / 2);
    await page.mouse.up();
    check(await canvas.evaluate(c => c.toDataURL()) !== initial, 'mouse drag changes crop');
    await page.locator('[data-crop-zoom]').fill('2');
    await page.locator('[data-crop-zoom]').dispatchEvent('input');
    const zoomed = await canvas.evaluate(c => c.toDataURL());
    check(zoomed !== initial, 'zoom changes framing');
    await page.locator('[data-crop-right]').click();
    check(await canvas.evaluate(c => c.toDataURL()) !== zoomed, 'rotate right changes pixels');
    await page.locator('[data-crop-left]').click();
    check((await pixels()).every(pixel => pixel[3] === 255), 'rotate left keeps opaque coverage');
    await canvas.focus();
    const keyboardBefore = await canvas.evaluate(c => c.toDataURL());
    await page.keyboard.press('ArrowLeft');
    check(await canvas.evaluate(c => c.toDataURL()) !== keyboardBefore, 'keyboard reposition');
    await apply();
    await page.evaluate(() => uploader.prepare('12345678-1234-4234-8234-123456789012'));
    const uploaded = await page.evaluate(() => uploads[0]);
    check(uploaded.width === 768 && uploaded.height === 768, 'uploaded crop dimensions');
    check(uploaded.name === 'product-crop.webp' && uploaded.type === 'image/webp', 'cropped output uploaded not original');
    check(uploaded.size <= 5 * 1024 * 1024, 'output size allowed');
    await page.evaluate(() => { uploader.markSaveAttempt(); uploader.markAttached(); });
    await page.locator('[data-image-remove]').click();
    check(await page.locator('[name=image_url]').inputValue() === '', 'remove clears saved reference');
    await open();
    await page.evaluate(() => uploader.reset('/images/another-product.jpg'));
    check(!await page.locator('dialog').evaluate(d => d.open), 'product switch closes crop');
    check(await page.locator('[name=image_url]').inputValue() === '/images/another-product.jpg', 'new editor not overwritten');
    await open();
    await page.evaluate(() => { authorized = false; uploader.reset(''); });
    check(!await page.locator('dialog').evaluate(d => d.open), 'signout closes crop');
    check(await page.evaluate(() => uploads.length) === 1, 'signout never uploads');
    await page.evaluate(() => { authorized = true; uploader.reset('images/legacy.jpg'); });
    check(await page.locator('[data-image-preview]').getAttribute('src') === '/images/legacy.jpg', 'legacy reference unchanged');
    await page.locator('[data-image-file]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
    check(!await page.locator('dialog').evaluate(d => d.open), 'unsupported rejected before crop');
    await page.locator('[data-image-file]').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(5242881) });
    check(!await page.locator('dialog').evaluate(d => d.open), 'oversized rejected before crop');
    await page.setViewportSize({ width: 390, height: 844 });
    await open();
    const mobile = await canvas.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const start = { x: mobile.x + mobile.width / 2, y: mobile.y + mobile.height / 2 };
    const beforeTouch = await canvas.evaluate(c => c.toDataURL());
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 50, y: start.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(await canvas.evaluate(c => c.toDataURL()) !== beforeTouch, 'real touch drag changes crop');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile no overflow');
    check(mobile.width === mobile.height, 'mobile square frame');
    if (process.env.CURV_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.CURV_TEST_SCREENSHOTS, 'product-image-crop-mobile.png') });
    await apply();
    check(await page.evaluate(() => uploads.length) === 1, 'Apply never uploads');
    check(errors.length === 0, 'no browser errors: ' + errors.join(', '));
    console.log(count + ' crop assertions passed; all requests intercepted.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
