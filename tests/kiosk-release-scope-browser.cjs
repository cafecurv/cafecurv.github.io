// Gate 4 release scope and fail-closed kiosk checks; every browser request is intercepted.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.CURV_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const base = 'ea9b452a14a917adcc6663c452a90123759d0df0';
const git = (...args) => cp.execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const baseline = file => git('show', base + ':' + file);
let count = 0;
const check = (value, message) => { assert.ok(value, message); count++; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); count++; };

async function open(browser, html, controller, url, config) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const result = Promise.resolve({ data: [], error: null });
    let query;
    query = new Proxy({}, { get: (_, key) => key === 'then' ? result.then.bind(result) : () => query });
    window.supabase = {
      createClient: () => ({ from: () => query, rpc: async () => ({ data: { website_ordering_enabled: true }, error: null }) })
    };
  });
  await context.route('**/*', route => {
    const request = new URL(route.request().url());
    if (request.origin !== 'https://curv.test') return route.abort();
    if (request.pathname === '/menu/' || request.pathname === '/menu') {
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    if (request.pathname === '/menu/authoritative-checkout.js') {
      return route.fulfill({ contentType: 'application/javascript', body: controller });
    }
    if (request.pathname === '/kiosk/config.js' && config) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.CURV_KIOSK_CONFIG = ' + JSON.stringify(config) });
    }
    if (request.pathname.startsWith('/kiosk/')) {
      const file = path.join(root, request.pathname);
      if (fs.existsSync(file)) return route.fulfill({ path: file });
    }
    return route.abort();
  });
  await page.goto('https://curv.test' + url);
  return { context, page };
}

async function run() {
  equal(git('rev-parse', 'HEAD').trim(), base, 'exact approved Round 1 baseline');
  equal(git('diff', '--cached', '--name-only').trim(), '', 'index empty');
  for (const file of ['admin/admin.js', 'admin/incoming-orders.html', 'admin/admin.css', 'track/index.html',
    'menu/authoritative-checkout.js', 'kiosk/config.js', 'kiosk/auth.js', 'kiosk/setup.html', 'kiosk/setup.js']) {
    check(read(file) === baseline(file), 'unchanged from approved baseline: ' + file);
  }
  check(!fs.existsSync(root + '/menu/delivery-pin.js') && !fs.existsSync(root + '/admin/delivery-courier.js'), 'no new D1/P5 runtime modules');
  check(!fs.existsSync(root + '/admin/WEBSITE_DELIVERY_D1A_FOUNDATION.sql') && !fs.existsSync(root + '/supabase/functions/delivery-quote'), 'no new D1 migration or Edge runtime');
  const html = read('menu/index.html');
  const oldHtml = baseline('menu/index.html');
  const fulfillment = /<select[^>]+id="f-delivery"[\s\S]*?<\/select>/;
  equal(html.match(fulfillment)[0], oldHtml.match(fulfillment)[0], 'ordinary fulfillment markup identical');
  for (const file of ['menu/index.html', 'kiosk/setup.html']) {
    check(read(file).includes('@supabase/supabase-js@2.118.0/dist/umd/supabase.js'), 'exact SDK pin ' + file);
    check(read(file).includes('integrity="sha384-') && read(file).includes('crossorigin="anonymous"'), 'SDK integrity ' + file);
  }

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const publicController = read('menu/authoritative-checkout.js');
    const old = await open(browser, oldHtml, baseline('menu/authoritative-checkout.js'), '/menu/');
    const fresh = await open(browser, html, publicController, '/menu/');
    for (const fixture of [old, fresh]) {
      await fixture.page.waitForFunction(() => curvCheckoutBootstrap.status === 'ready');
    }
    const state = page => page.evaluate(() => ({
      fulfillment: document.getElementById('f-delivery').value,
      payment: document.getElementById('f-payment').value,
      choices: [...document.querySelectorAll('#f-delivery option')].map(option => ({
        value: option.value, disabled: option.disabled, hidden: option.hidden
      })),
      kiosk: document.body.classList.contains('curv-kiosk')
    }));
    equal(await state(fresh.page), await state(old.page), 'normal checkout defaults and all choices unchanged');
    equal((await state(fresh.page)).fulfillment, 'dine-in', 'production dine-in default retained');
    equal(await fresh.page.evaluate(() => curvCheckout.version), '2026-10-28.2', 'matched normal asset release');
    await old.context.close();
    await fresh.context.close();

    // The real config is now intentionally enabled. Test both original safeguards with offline fixtures.
    for (const [label, config] of [
      ['disabled', { enabled: false, supabaseUrl: 'https://device.test', publishableKey: 'fixture-only' }],
      ['unconfigured', { enabled: true, supabaseUrl: '', publishableKey: '' }]
    ]) {
      const { context, page } = await open(browser, html, publicController, '/menu/?kiosk=1', config);
      await page.getByRole('heading', { name: 'A little help from CURV' }).waitFor();
      equal(await page.getByRole('heading', { name: 'Welcome to Curv!' }).count(), 0, label + ' kiosk cannot show Welcome');
      equal(await page.getByLabel('Your nickname').count(), 0, label + ' kiosk cannot onboard');
      equal(await page.evaluate(() => {
        try { curvKioskAuth.getClient(); return false; }
        catch (error) { return error.message === 'KIOSK_SETUP_REQUIRED'; }
      }), true, label + ' kiosk denies device client');
      await context.close();
    }
    console.log(count + ' kiosk-only release scope assertions passed; all requests intercepted.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; });
