// Offline section ordering: every request is intercepted; no live database access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let count = 0;
  const check = (value, message) => { assert.ok(value, message); count++; };
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      let session = { user: { id: 'owner', email: 'owner@local.test' } };
      const listeners = [];
      window.fixture = {
        rows: ['Espresso', 'Non-Espresso', 'Signature'].map((name, index) => ({ id: 's' + index, name, category_id: 'coffee', sort_order: index, is_active: true })),
        writes: [], fail: false
      };
      window.signOutFixture = () => { session = null; listeners.forEach(fn => fn('SIGNED_OUT', null)); };
      const empty = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => Promise.resolve({ data: [], error: null }).then(resolve) : () => empty });
      window.supabase = { createClient: () => ({
        channel: () => empty, removeChannel: async () => {}, rpc: async () => ({ data: true, error: null }),
        auth: { getSession: async () => ({ data: { session } }), onAuthStateChange: fn => { listeners.push(fn); return {}; } },
        from: table => {
          let update = null; const filters = {};
          const q = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => {
            let data = [];
            if (table === 'categories') data = [{ id: 'coffee', name: 'Coffee', sort_order: 0, is_active: true }, { id: 'tea', name: 'Tea', sort_order: 1, is_active: true }];
            if (table === 'category_sections') {
              if (update) {
                fixture.writes.push({ table, update, filters });
                if (fixture.fail) return Promise.resolve({ data: null, error: { message: 'Fixture save rejected' } }).then(resolve);
                const row = fixture.rows.find(row => row.id === filters.id && row.category_id === filters.category_id);
                if (row) Object.assign(row, update);
                data = row ? { id: row.id } : null;
              } else data = fixture.rows.filter(row => row.category_id === filters.category_id).sort((a, b) => a.sort_order - b.sort_order).map(row => ({ ...row }));
            }
            return Promise.resolve({ data, error: null }).then(resolve);
          } : (...args) => { if (key === 'update') update = args[0]; if (key === 'eq') filters[args[0]] = args[1]; return q; } });
          return q;
        }
      }) };
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://curv.test' && ['/admin/menu-manager.html', '/admin/admin.js', '/admin/admin.css'].includes(url.pathname)) return route.fulfill({ path: path.join(root, url.pathname.slice(1)) });
      return route.abort();
    });
    await page.goto('https://curv.test/admin/menu-manager.html');
    await page.waitForFunction(() => document.querySelector('[data-display-order-category]').options.length === 3);
    await page.locator('[data-menu-manager-view-tab="display-order"]').first().click({ force: true });
    const toggle = page.locator('[data-collapsible-target="display-order-content"]');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await page.locator('[data-display-order-category]').selectOption('coffee');
    await page.waitForFunction(() => document.querySelectorAll('.section-order-row').length === 3);
    const names = () => page.locator('.section-order-row > span').allTextContents();
    check((await names()).join('|') === 'Espresso|Non-Espresso|Signature', 'saved section order loads');
    check(await page.getByRole('button', { name: 'Move Up: Espresso', exact: true }).isDisabled(), 'first cannot move up');
    check(await page.getByRole('button', { name: 'Move Down: Signature', exact: true }).isDisabled(), 'last cannot move down');
    await page.getByRole('button', { name: 'Move Up: Signature', exact: true }).click();
    await page.getByRole('button', { name: 'Move Up: Signature', exact: true }).click();
    check((await names())[0] === 'Signature', 'Signature moves to top');
    check(await page.evaluate(() => fixture.writes.length === 0), 'moves stay local until save');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('[data-display-order-category]').selectOption('tea');
    check(await page.locator('[data-display-order-category]').inputValue() === 'coffee', 'category switch protects unsaved sections');
    await page.locator('[data-reset-section-order]').click();
    check((await names())[2] === 'Signature', 'restore discards draft');
    await page.getByRole('button', { name: 'Move Up: Signature', exact: true }).click();
    await page.getByRole('button', { name: 'Move Up: Signature', exact: true }).click();
    await page.evaluate(() => { fixture.fail = true; });
    await page.locator('[data-save-section-order]').click();
    await page.waitForFunction(() => document.querySelector('[data-section-order-status]').textContent.includes('Unable to save'));
    check(!(await page.locator('[data-save-section-order]').isDisabled()), 'failed save is retryable');
    check((await names())[0] === 'Signature', 'failed save retains draft');
    await page.evaluate(() => { fixture.fail = false; fixture.writes = []; });
    await page.locator('[data-save-section-order]').click();
    await page.waitForFunction(() => document.querySelector('[data-section-order-status]').textContent.startsWith('Section order saved.'));
    check(await page.evaluate(() => fixture.writes.length === 3 && fixture.writes.every(w => w.table === 'category_sections' && Object.keys(w.update).join() === 'sort_order' && w.filters.category_id === 'coffee')), 'save only writes scoped section sort orders');
    check(await page.evaluate(() => fixture.rows.find(r => r.name === 'Signature').sort_order === 0), 'Signature persists at zero');
    check(await page.locator('[data-save-section-order]').isDisabled(), 'clean saved state');
    await page.locator('[data-display-order-category]').selectOption('tea');
    await page.waitForFunction(() => document.querySelectorAll('.section-order-row').length === 0);
    check(await page.locator('[data-save-section-order]').isDisabled(), 'empty category cannot save');
    await page.locator('[data-display-order-category]').selectOption('coffee');
    await page.waitForFunction(() => document.querySelectorAll('.section-order-row').length === 3);
    check((await names())[0] === 'Signature', 'reload uses saved section order');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.locator('.section-order-panel').evaluate(el => el.scrollWidth <= el.clientWidth), 'section controls fit ' + width);
    }
    await page.evaluate(() => signOutFixture());
    check(await page.locator('[data-save-section-order]').isDisabled(), 'signout locks save');
    check(await page.locator('.section-order-row').count() === 0, 'signout clears draft');
    check(errors.length === 0, errors.join('\n'));
    console.log('Menu Manager section ordering: ' + count + ' assertions passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
