// Real HTML/bootstrap/script requests; every network request is intercepted. No SQL.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const root = process.env.CURV_CHECKOUT_TEST_ROOT || path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'menu/index.html'), 'utf8').replace(/\r\n/g, '\n');
  const legacyController = require('node:child_process').execFileSync('git', ['show', '1087d97ff7e329b50d5ccbbcb89358f538e898b5:menu/authoritative-checkout.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const controller = fs.readFileSync(path.join(root, 'menu/authoritative-checkout.js'), 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let assertions = 0;
  const equal = (a, b, message) => { assert.deepEqual(a, b, message); assertions++; };
  const check = (v, message) => { assert.ok(v, message); assertions++; };
  const pending = JSON.stringify({ version: 1, state: 'ambiguous', request: { payload: {
    submission_key: '11111111-1111-4111-8111-111111111111'
  } } });
  async function open(mode, preserve = false, menuPath = '/menu/') {
    const pageUrl = 'https://curv.test' + menuPath;
    const page = await browser.newPage(), requests = [], logs = [];
    page.on('console', m => { if (m.text().startsWith('[CURV checkout]')) logs.push(m.text()); });
    await page.addInitScript(({ mode, pending, preserve }) => {
      if (mode === 'pre-registered') window.curvCheckout = { version:'stale', state:{busy:false,reviewing:false,generation:0}, changed(){}, submit(){}, dispose(){return true;} };
      if (preserve) sessionStorage.setItem('curv-pending-order-v2', pending);
      if (mode === 'optional-api-missing') { Object.defineProperty(crypto, 'randomUUID', {value:undefined}); window.requestIdleCallback = undefined; window.ResizeObserver = undefined; }
      if (mode === 'storage-denied') Storage.prototype.getItem = () => { throw Error('Denied'); };
      window.checkoutListenerAdds = 0; window.checkoutListenerRemoves = 0;
      const add = Element.prototype.addEventListener, remove = Element.prototype.removeEventListener;
      Element.prototype.addEventListener = function(type, listener, ...args) {
        if (this.id === 'formBody' && listener?.name === 'changed') window.checkoutListenerAdds++;
        return add.call(this, type, listener, ...args);
      };
      Element.prototype.removeEventListener = function(type, listener, ...args) {
        if (this.id === 'formBody' && listener?.name === 'changed') window.checkoutListenerRemoves++;
        return remove.call(this, type, listener, ...args);
      };
    }, { mode, pending, preserve });
    let body = html;
    if (mode === 'old-html-new-js') body = body.replace("const CURV_CHECKOUT_RELEASE = '2026-10-20.1'", "const CURV_CHECKOUT_RELEASE = 'older-page'");
    if (mode === 'optional-global-missing') body = body.replace('const WEBSITE_ORDERING_CLOSED_REJECTION_MESSAGE =', 'const UNUSED_CLOSED_MESSAGE =');
    if (preserve) body = body.replace('const bootstrap = {', "cart = [{ key: 'preserved-cart', name: 'Keep me', qty: 1, price: 180 }];\n  const bootstrap = {");
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.href === pageUrl) return route.fulfill({ contentType: 'text/html', body });
      if (url.pathname.endsWith('/authoritative-checkout.js')) requests.push(url.href);
      if (url.pathname === '/authoritative-checkout.js') return route.fulfill({ status: 404, body: 'Not found' });
      if (url.pathname === '/menu/authoritative-checkout.js') {
        if(mode === 'delayed') await new Promise(resolve => setTimeout(resolve, 600));
        if (mode === 'both-fail' || (mode === 'first-fails' && requests.length === 1)) return route.abort('failed');
        let script = controller;
        if (mode === 'legacy-controller' && requests.length === 1) script = legacyController;
        if (mode === 'no-register') script = '/* loaded but no registration */';
        if (mode === 'init-failure' && requests.length === 1) script = "throw Error('Fixture initialization failure');";
        if (mode === 'late-init-failure' && requests.length === 1) script = script.replace('syncOrderBarState();', "throw Error('Fixture late initialization failure');");
        if (mode === 'active-stale') script = script.replace("const version = '2026-10-20.1';", "const version = 'stale';") + '\nwindow.curvCheckout.state.busy = true;';
        if (mode === 'mismatch' && requests.length === 1) script = script.replace("const version = '2026-10-20.1';", "const version = 'stale';");
        if (mode === 'unmarked' && requests.length === 1) script = script.replace('const controller = { dispose, version, submit', 'const controller = { dispose, submit');
        return route.fulfill({ contentType: 'application/javascript', body: script });
      }
      return route.abort('blockedbyclient');
    });
    await page.goto(pageUrl, { waitUntil: mode === 'delayed' ? 'domcontentloaded' : 'load' });
    if(mode === 'delayed') {
      await page.evaluate(()=>submitPublicOrder());
      check((await page.locator('#submitOrderStatus').textContent()).includes('Loading secure checkout'), 'delayed asset gets waiting state');
      equal(await page.locator('#checkoutLoadHelp').count(), 0, 'no premature permanent failure');
    }
    await page.waitForFunction(() => ['ready', 'unavailable', 'blocked-active'].includes(window.curvCheckoutBootstrap?.status));
    return { page, requests, logs };
  }
  try {
    // Serve the same HTML without redirecting slashless URLs, as production does.
    // Browser URL resolution and the actual bootstrap/controller are exercised.
    for (const menuPath of ['/menu/', '/menu', '/menu?fbclid=test', '/menu/?fbclid=test']) {
      for (const mode of ['normal', 'first-fails']) {
        const f = await open(mode, true, menuPath);
        equal(await f.page.evaluate(() => location.pathname + location.search), menuPath, 'URL stays unnormalized: ' + menuPath);
        equal(await f.page.evaluate(() => curvCheckoutBootstrap.status), 'ready', mode + ': ready at ' + menuPath);
        equal(await f.page.evaluate(() => curvCheckout.version), '2026-10-20.1', 'registered expected controller');
        equal(f.requests.length, mode === 'normal' ? 1 : 2, 'bounded requests');
        for (const [index, request] of f.requests.entries()) {
          const url = new URL(request);
          equal(url.pathname, '/menu/authoritative-checkout.js', 'initial/recovery menu-root pathname');
          equal(url.searchParams.get('v'), '2026-10-20.1', 'release preserved on every attempt');
          equal(url.searchParams.has('recovery'), index === 1, 'recovery only on second attempt');
        }
        equal(f.requests.some(request => new URL(request).pathname === '/authoritative-checkout.js'), false, 'never request root-level checkout');
        equal(await f.page.locator('#checkoutLoadHelp').count(), 0, 'no exhausted-recovery fallback');
        equal(await f.page.evaluate(() => checkoutListenerAdds - checkoutListenerRemoves), 2, 'one listener set');
        equal(await f.page.evaluate(() => sessionStorage.getItem('curv-pending-order-v2')), pending, 'pending request unchanged');
        await f.page.close();
      }
    }
    let f = await open('normal');
    equal(await f.page.evaluate(() => curvCheckout.version), '2026-10-20.1', 'controller release');
    equal(await f.page.evaluate(() => getCompatibleCheckout() === curvCheckout), true, 'page/controller compatibility');
    equal(f.requests.length, 1, 'normal load once');
    check(f.requests[0].endsWith('?v=2026-10-20.1'), 'explicit stable version URL');
    equal(await f.page.evaluate(() => checkoutListenerAdds), 2, 'one listener set');
    await f.page.evaluate(() => {
      window.firstController = curvCheckout;
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'authoritative-checkout.js?v=2026-10-20.1&duplicate=1';
        script.onload = resolve; script.onerror = reject; document.body.appendChild(script);
      });
    });
    equal(await f.page.evaluate(() => firstController === curvCheckout && checkoutListenerAdds === 2), true, 'duplicate evaluation does not reinitialize');
    await f.page.close();
    for (const mode of ['first-fails', 'init-failure', 'late-init-failure', 'mismatch', 'unmarked', 'legacy-controller', 'pre-registered']) {
      f = await open(mode, true);
      equal(f.requests.length, 2, mode + ': one recovery');
      check(new URL(f.requests[1]).searchParams.get('recovery') === '1' && !!new URL(f.requests[1]).searchParams.get('attempt'), mode + ': deterministic recovery URL');
      equal(await f.page.evaluate(() => curvCheckoutBootstrap.status), 'ready', mode + ': recovers');
      equal(await f.page.evaluate(() => checkoutListenerAdds - checkoutListenerRemoves), 2, mode + ': exactly one listener set');
      equal(await f.page.evaluate(() => cart[0].key), 'preserved-cart', mode + ': cart survives');
      equal(await f.page.evaluate(() => sessionStorage.getItem('curv-pending-order-v2')), pending, mode + ': frozen recovery survives');
      check(f.logs.some(x => x.includes('recovery attempt 1')), mode + ': diagnostic');
      if (mode.includes('init')) check(f.logs.some(x => x.includes('initialization failure')), mode + ': initialization diagnostic');
      await f.page.close();
    }
    for (const mode of ['both-fail', 'no-register', 'old-html-new-js']) {
      f = await open(mode, true);
      equal(f.requests.length, 2, mode + ': bounded requests');
      equal(await f.page.evaluate(() => getCompatibleCheckout()), null, mode + ': unusable controller');
      await f.page.evaluate(() => submitPublicOrder());
      check((await f.page.locator('#submitOrderStatus').textContent()).includes('Checkout is unavailable.'), mode + ': fail closed');
      equal(f.requests.length, 2, mode + ': submit cannot reload/loop');
      equal(await f.page.locator('#checkoutLoadHelp a').getAttribute('href'), 'https://m.me/cafecurv', 'safe contact fallback');
      equal(await f.page.locator('#submitOrderBtn').isDisabled(), true, 'unverified checkout blocked');
      equal(await f.page.evaluate(() => cart[0].key), 'preserved-cart', mode + ': cart intact');
      equal(await f.page.evaluate(() => sessionStorage.getItem('curv-pending-order-v2')), pending, mode + ': pending intact');
      check(f.logs.some(x => x.includes('recovery exhausted')), mode + ': exhaustion diagnostic');
      if (mode === 'mismatch' || mode === 'unmarked') {
        check(f.logs.some(x => x.includes('version mismatch')), 'mismatch diagnostic');
        equal(await f.page.evaluate(() => checkoutListenerAdds), 2, 'stale registered controller is not replaced/duplicated');
      }
      await f.page.close();
    }
    for (const mode of ['storage-denied', 'optional-global-missing', 'optional-api-missing', 'delayed']) {
      f = await open(mode);
      equal(await f.page.evaluate(() => curvCheckoutBootstrap.status), 'ready', mode + ': registers');
      equal(f.requests.length, 1, mode + ': no false recovery');
      await f.page.close();
    }
    f = await open('active-stale', true);
    equal(await f.page.evaluate(() => curvCheckoutBootstrap.status), 'blocked-active', 'active stale controller retained');
    equal(f.requests.length, 1, 'active stale controller never reloaded');
    equal(await f.page.evaluate(() => curvCheckout.state.busy), true, 'active request untouched');
    equal(await f.page.evaluate(() => sessionStorage.getItem('curv-pending-order-v2')), pending, 'active frozen request preserved');
    await f.page.close();
    f = await open('optional-global-missing');
    await f.page.evaluate(() => {
      isWebsiteOrderingEnabled = true; isPublicOrderTechnicalAvailable = true;
      document.getElementById('f-name').value = 'Offline guest';
      document.getElementById('f-delivery').value = 'dine-in'; syncOrderMethodFields(); setDeliveryTime('asap');
      cart = [{ key: 'fixture', name: 'Fixture', price: 180, qty: 1,
        product_id: '8c0dc38c-de30-4490-95e0-c83b099183a8',
        product_size_id: '02c3b451-de5c-44d6-a908-f9170d2caf01', option_choice_ids: [] }];
      getPublicSupabaseClient = () => null;
      return submitPublicOrder();
    });
    check((await f.page.locator('#submitOrderStatus').textContent()).includes('Unable to check current prices.'), 'client missing is runtime pricing error');
    equal(await f.page.evaluate(() => curvCheckoutBootstrap.status), 'ready', 'client missing does not break initialization');
    // Mock transport only: duplicate clicks cannot send before customer confirmation.
    await f.page.evaluate(() => {
      window.testQuotes = 0; window.testSubmits = 0;
      getPublicSupabaseClient = () => ({ async rpc(name, args) {
        if (name === 'quote_public_cart') {
          testQuotes++;
          const item = args.p_request.items[0];
          return { data: { ok: true, quote: { pricing_contract_version: 2,
            pricing_fingerprint_version: 1, pricing_policy_version: 'fixture', currency: 'PHP',
            review_fingerprint: 'a'.repeat(64), subtotal: '180.00',
            items: [{ ...item, line_index: 0, product_name: 'Fixture', category_name: 'Fixture',
              size_label: '8', base_price: '180.00', option_total: '0.00',
              unit_price: '180.00', line_total: '180.00', options: [] }] } } };
        }
        testSubmits++;
        return { data: { error: { code: 'CURV_ORDERING_CLOSED' } } };
      } });
      window.testAttempt = submitPublicOrder();
      submitPublicOrder();
    });
    await f.page.getByRole('button', { name: 'Continue & Submit' }).waitFor();
    equal(await f.page.evaluate(() => testQuotes), 1, 'duplicate clicks: one quote');
    equal(await f.page.evaluate(() => testSubmits), 0, 'no automatic submission before confirmation');
    await f.page.getByRole('button', { name: 'Continue & Submit' }).click();
    await f.page.evaluate(() => testAttempt);
    equal(await f.page.evaluate(() => testSubmits), 1, 'one confirmed submission');
    check((await f.page.locator('#submitOrderStatus').textContent()).includes('Website ordering was paused'), 'ordering-closed stays rejected');
    await f.page.close();
    console.log(assertions + ' checkout asset/bootstrap assertions passed; all requests intercepted; no SQL.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
