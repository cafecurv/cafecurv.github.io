const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const load = name => fs.readFileSync(path.join(__dirname, '..', 'kiosk', name), 'utf8');
const authSource = load('auth.js');
const checkoutSource = load('checkout.js');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const device = id(1), generation = id(2), key = id(3);
const pendingKey = 'curv-kiosk-v2:pending';
const secret = 'synthetic-token-and-customer-data';
const cartError = 'Please check your cart and try again. Ask CURV staff if needed.';
const recoveryHeading = 'Let’s check that order';
const quote = {
  pricing_contract_version: 2, currency: 'PHP', review_fingerprint: 'a'.repeat(64),
  subtotal: '120.00',
  items: [{ quantity: 1, product_name: 'Fixture coffee', size_label: 'Regular', unit_price: '120.00', line_total: '120.00', options: [] }]
};
const ok = data => ({ data, error: null });
const rpcError = details => ({ data: null, error: { details, message: secret } });
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.handlers = {};
    this.dataset = {};
    this.classList = { add() {}, remove() {} };
    this.style = { setProperty() {} };
    this.value = '';
    this.text = '';
  }

  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  fire(name) { return this.handlers[name]({ preventDefault() {} }); }
  focus() {}
  append(...children) {
    for (const child of children) {
      const node = typeof child === 'string' ? Object.assign(new Element('#text'), { text: child }) : child;
      node.parent = this;
      this.children.push(node);
    }
  }
  prepend(child) { this.children.unshift(child); child.parent = this; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child.find(predicate);
      if (match) return match;
    }
    return null;
  }

  querySelector(selector) {
    assert.equal(selector, '.kiosk-diagnostic');
    return this.find(el => el.className === 'kiosk-diagnostic');
  }
}

async function fixture({ storage = new Map(), storageDenied = false, storageError = Error(secret), observeSubmitError } = {}) {
  const body = new Element('body');
  const root = new Element('section');
  root.id = 'kioskRoot';
  const fields = ['submitOrderStatus', 'submitOrderBtn', 'f-name', 'f-contact', 'f-address', 'f-notes', 'f-delivery-time', 'f-delivery', 'f-payment']
    .map(name => Object.assign(new Element('div'), { id: name }));
  body.append(root, ...fields);
  const byId = name => body.find(el => el.id === name);
  const status = byId('submitOrderStatus');
  const calls = [], reviews = [], navigations = [];
  const fixtureState = { session: true, onReview: () => true };
  const routes = {};
  let now = Date.parse('2026-11-08T04:00:00Z');
  let interval, nextTimer = 0, keysMade = 0;
  const timers = new Map();

  const defaults = {
    kiosk_context: () => ok({ contract_version: 1, device_id: device, generation_id: generation, state: 'draft' }),
    kiosk_begin: () => ok({ device_id: device, generation_id: generation }),
    kiosk_quote: () => ok({ ok: true, quote }),
    kiosk_admit: () => ok({ state: 'admitted', submission_key: key }),
    kiosk_submit: () => ok({ state: 'accepted', receipt: { order_number: 'C-9001' }, accepted_at: new Date(now).toISOString() }),
    kiosk_confirm_price: () => ok({ state: 'admitted' }),
    kiosk_recover: () => ok({ state: 'unknown' }),
    kiosk_close: () => ok({ state: 'closed' })
  };
  const mockClient = {
    auth: {
      getSession: async () => ok({ session: fixtureState.session ? {} : null }),
      onAuthStateChange() {}
    },
    async rpc(name, args) {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      if (name === 'kiosk_admit') assert.deepEqual(JSON.parse(storage.get(pendingKey)).payload, calls.at(-1).args.p_payload);
      return (routes[name] || defaults[name])(args);
    }
  };
  const sandbox = {
    CURV_KIOSK_CONFIG: { enabled: true, supabaseUrl: 'https://kiosk.invalid', publishableKey: 'fixture-only' },
    supabase: { createClient: () => mockClient },
    document: { body, documentElement: new Element('html'), getElementById: byId,
      createElement: tagName => new Element(tagName), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    HTMLElement: Element, navigator: { locks: { request: (_name, _options, run) => run({}) } },
    location: { replace: url => navigations.push(url) },
    sessionStorage: {
      getItem: name => storage.get(name) ?? null,
      setItem(name, value) { if (storageDenied && name === pendingKey) throw storageError; storage.set(name, value); },
      removeItem: name => storage.delete(name)
    },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { const token = ++nextTimer; timers.set(token, { fn, at: now + delay }); return token; },
    clearTimeout: token => timers.delete(token),
    setInterval: fn => { interval = fn; },
    addEventListener() {},
    cart: [],
    isSubmittingPublicOrder: false,
    getSafeSubmissionKey: value => /^[0-9a-f-]{36}$/.test(value || ''),
    generatePublicSubmissionKey: () => { keysMade++; return key; },
    setSubmitOrderStatus: text => { status.textContent = text; },
    escapeHtml: String,
    closeOrderConfirmModal() {},
    setSubmittedFormLocked() {},
    syncOrderMethodFields() {},
    renderCart() {},
    confirmOrderBeforeSubmit(response, intent, changed) {
      const html = sandbox.curvCheckout.reviewHtml(response);
      reviews.push({ html, fulfillment: intent.fulfillment_type, changed });
      return fixtureState.onReview(changed);
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(authSource, sandbox, { filename: 'auth.js' });
  let source = checkoutSource;
  if (observeSubmitError) {
    // Test-only observer at the existing catch boundary. No production probe is exposed.
    source = source.replace(/\r\n/g, '\n');
    const catchStart = '    } catch (error) {\n      if (current === epoch) {';
    assert.equal(source.split(catchStart).length, 2);
    sandbox.observeSubmitError = observeSubmitError;
    source = source.replace(catchStart, catchStart + '\n        window.observeSubmitError(error);');
  }
  vm.runInContext(source, sandbox, { filename: 'checkout.js' });
  await nextTurn();
  calls.length = 0;

  function onboard() {
    assert.equal(sandbox.curvCheckout.state.status, 'welcome');
    root.find(el => el.className === 'kiosk-welcome-start').fire('click');
    assert.equal(sandbox.curvCheckout.state.status, 'name');
    byId('kioskNickname').value = 'Fixture customer';
    root.find(el => el.tagName === 'form').fire('submit');
    root.find(el => el.attributes['aria-label'] === 'TO GO').fire('click');
    sandbox.cart.push({ product_id: id(4), product_size_id: id(5), qty: 1, option_choice_ids: [] });
  }

  function advance(ms) {
    now += ms;
    for (const [token, timer] of timers) {
      if (timer.at <= now) { timers.delete(token); timer.fn(); }
    }
    interval();
  }

  return {
    fixtureState, routes, calls, reviews, navigations, storage, status, root, sandbox, onboard, advance,
    submit: () => sandbox.curvCheckout.submit(),
    keysMade: () => keysMade,
    rpcNames: () => calls.map(call => call.name),
    diagnostic: () => body.querySelector('.kiosk-diagnostic')?.textContent,
    view: () => sandbox.curvCheckout.state.status
  };
}

const pending = {
  version: 1, device, generation, key,
  payload: { kiosk_contract_version: 1, submission_key: key, fulfillment_type: 'pickup', review_fingerprint: quote.review_fingerprint }
};

test('pre-review diagnostics block mutation transport and never create pending state', async t => {
  const cases = [
    ['invalid cart', 'C-CART-0N', f => { f.sandbox.cart[0].product_size_id = null; }, []],
    ['missing session', 'Q-SESSION-0N', f => { f.fixtureState.session = false; }, []],
    ['quote rejection', 'Q-VALIDATION-0N', f => { f.routes.kiosk_quote = () => rpcError('OPTION_REQUIRED'); }],
    ['ambiguous quote transport error', 'Q-UNKNOWN-0N', f => { f.routes.kiosk_quote = () => ({ ...rpcError(''), status: 0 }); }],
    ['bad quote envelope', 'Q-RESPONSE-0N', f => { f.routes.kiosk_quote = () => ok(null); }],
    ['bad quote amount', 'V-RESPONSE-0N', f => { f.routes.kiosk_quote = () => ok({ ok: true, quote: { ...quote, subtotal: 120 } }); }],
    ['review renderer exception', 'V-UNKNOWN-0N', f => {
      f.routes.kiosk_quote = () => ok({ ok: true, quote: { ...quote, items: [{ ...quote.items[0], options: [null] }] } });
    }],
    ['unrecognized exception', 'Q-UNKNOWN-0N', f => { f.routes.kiosk_quote = () => { throw Object.assign(Error(secret), { kioskCategory: secret }); }; }],
    ['unrecognized server detail', 'Q-UNKNOWN-0N', f => { f.routes.kiosk_quote = () => rpcError('KIOSK_UNRECOGNIZED'); }]
  ];
  for (const [name, code, setup, calls = ['kiosk_quote']] of cases) await t.test(name, async () => {
    const f = await fixture();
    f.onboard();
    setup(f);
    await f.submit();
    assert.equal(f.diagnostic(), 'Staff diagnostic: ' + code);
    assert.equal(f.status.textContent, cartError + 'Staff diagnostic: ' + code);
    assert.equal(f.reviews.length, 0);
    assert.equal(f.keysMade(), 0);
    assert.deepEqual(f.rpcNames(), calls);
    assert.equal(f.storage.has(pendingKey), false);
  });
});

test('quote timeout reports a timeout without creating a protected request', async () => {
  const f = await fixture();
  f.onboard();
  f.routes.kiosk_quote = () => new Promise(() => {});
  const submitted = f.submit();
  await nextTurn();
  f.advance(30_000);
  await submitted;
  assert.equal(f.diagnostic(), 'Staff diagnostic: Q-TIMEOUT-0N');
  assert.deepEqual(f.rpcNames(), ['kiosk_quote']);
  assert.equal(f.storage.has(pendingKey), false);
});

test('protected failures preserve the existing screen and distinguish durability', async t => {
  const cases = [
    ['storage throws', 'P-STORAGE-1F', () => {}, ['kiosk_quote']],
    ['session lost before admission', 'A-SESSION-1S', f => { f.fixtureState.onReview = () => { f.fixtureState.session = false; return true; }; }, ['kiosk_quote']],
    ['closed generation', 'A-GENERATION-1S', f => { f.routes.kiosk_admit = () => rpcError('KIOSK_GENERATION_CLOSED'); }],
    ['device denied', 'A-DEVICE-1S', f => { f.routes.kiosk_admit = () => rpcError('KIOSK_DEVICE_UNAVAILABLE'); }],
    ['malformed admission', 'A-RESPONSE-1S', f => { f.routes.kiosk_admit = () => ok({ state: 'admitted', submission_key: id(9) }); }],
    ['submit rejected', 'S-CLOSED-1S', f => { f.routes.kiosk_submit = () => rpcError('CURV_ORDERING_CLOSED'); }, ['kiosk_quote', 'kiosk_admit', 'kiosk_submit']],
    ['submit response malformed', 'S-RESPONSE-1S', f => { f.routes.kiosk_submit = () => ok({ state: 'accepted' }); }, ['kiosk_quote', 'kiosk_admit', 'kiosk_submit']]
  ];
  for (const [name, code, setup, calls = ['kiosk_quote', 'kiosk_admit']] of cases) await t.test(name, async () => {
    const storageDenied = name === 'storage throws';
    const f = await fixture({ storageDenied });
    f.onboard();
    setup(f);
    await f.submit();
    assert.equal(f.view(), 'uncertain');
    assert.equal(f.root.find(el => el.tagName === 'h1').textContent, recoveryHeading);
    assert.match(f.root.textContent, /The result is not confirmed yet/);
    assert.ok(f.root.find(el => el.textContent === 'Recover previous order'));
    assert.equal(f.diagnostic(), 'Staff diagnostic: ' + code);
    assert.equal(f.sandbox.curvCheckout.hasPending(), true);
    assert.equal(f.storage.has(pendingKey), !storageDenied);
    assert.deepEqual(f.rpcNames(), calls);
    assert.equal(f.keysMade(), 1);
  });
});

test('admission timeout retains the request and a late reply cannot trigger submit', async () => {
  const f = await fixture();
  f.onboard();
  let commitLate;
  f.routes.kiosk_admit = () => new Promise(resolve => {
    commitLate = () => resolve(ok({ state: 'admitted', submission_key: key }));
  });
  const submitted = f.submit();
  await nextTurn();
  const saved = f.storage.get(pendingKey);
  assert.ok(saved);
  f.advance(30_000);
  await submitted;
  assert.equal(f.diagnostic(), 'Staff diagnostic: A-TIMEOUT-1S');
  commitLate();
  await nextTurn();
  assert.deepEqual(f.rpcNames(), ['kiosk_quote', 'kiosk_admit']);
  assert.equal(f.storage.get(pendingKey), saved);
  assert.equal(f.view(), 'uncertain');
});

test('reload reports unconfirmed state and a failed lookup leaves recovery protected', async () => {
  const saved = JSON.stringify(pending);
  const f = await fixture({ storage: new Map([[pendingKey, saved]]) });
  assert.equal(f.view(), 'uncertain');
  assert.equal(f.diagnostic(), 'Staff diagnostic: R-UNCONFIRMED-1S');
  f.routes.kiosk_recover = () => rpcError('KIOSK_SESSION_REQUIRED');
  await f.submit();
  assert.deepEqual(f.rpcNames(), ['kiosk_recover']);
  assert.equal(f.view(), 'locked');
  assert.equal(f.diagnostic(), 'Staff diagnostic: R-SESSION-1S');
  assert.equal(f.storage.get(pendingKey), saved);
  assert.equal(f.keysMade(), 0);
});

test('a new successful review clears the prior inline diagnostic', async () => {
  const f = await fixture();
  f.onboard();
  f.routes.kiosk_quote = () => rpcError('SIZE_INVALID');
  await f.submit();
  assert.equal(f.diagnostic(), 'Staff diagnostic: Q-VALIDATION-0N');
  delete f.routes.kiosk_quote;
  f.fixtureState.onReview = () => false;
  await f.submit();
  assert.equal(f.reviews.length, 1);
  assert.match(f.reviews[0].html, /Fixture coffee/);
  assert.equal(f.diagnostic(), undefined);
  assert.deepEqual(f.rpcNames(), ['kiosk_quote', 'kiosk_quote']);
});

test('normal confirmation rejects a duplicate click and resets at 60 seconds', async () => {
  const f = await fixture();
  f.onboard();
  let confirm;
  f.fixtureState.onReview = () => new Promise(resolve => { confirm = resolve; });
  const submitted = f.submit();
  await nextTurn();
  await f.submit();
  assert.deepEqual(f.rpcNames(), ['kiosk_quote']);
  confirm(true);
  await submitted;
  assert.deepEqual(f.rpcNames(), ['kiosk_quote', 'kiosk_admit', 'kiosk_submit']);
  assert.equal(f.keysMade(), 1);
  assert.equal(f.view(), 'accepted');
  assert.equal(f.diagnostic(), undefined);
  assert.equal(JSON.parse(f.storage.get(pendingKey)).payload, null);
  f.advance(59_999);
  assert.deepEqual(f.navigations, []);
  f.advance(1);
  await nextTurn();
  assert.deepEqual(f.rpcNames(), ['kiosk_quote', 'kiosk_admit', 'kiosk_submit', 'kiosk_close']);
  assert.deepEqual(f.navigations, ['/menu/?kiosk=1']);
  assert.equal(f.storage.has(pendingKey), false);
});

test('updated price requires confirmation and reuses the existing key', async t => {
  for (const confirmUpdate of [false, true]) await t.test(confirmUpdate ? 'confirmed' : 'declined', async () => {
    const f = await fixture();
    f.onboard();
    f.fixtureState.onReview = changed => !changed || confirmUpdate;
    const updatedQuote = { ...quote, review_fingerprint: 'b'.repeat(64) };
    f.routes.kiosk_submit = () => {
      if (f.rpcNames().filter(name => name === 'kiosk_submit').length === 1) return ok({ state: 'price_changed', quote: updatedQuote });
      return ok({ state: 'accepted', receipt: { order_number: 'C-9001' }, accepted_at: '2026-11-08T04:00:00Z' });
    };
    await f.submit();
    assert.deepEqual(f.reviews.map(review => review.changed), [false, true]);
    assert.deepEqual(f.rpcNames(), ['kiosk_quote', 'kiosk_admit', 'kiosk_submit', ...(confirmUpdate ? ['kiosk_confirm_price', 'kiosk_submit'] : [])]);
    assert.equal(f.view(), confirmUpdate ? 'accepted' : 'uncertain');
    assert.equal(f.diagnostic(), undefined);
    assert.equal(f.keysMade(), 1);
    assert.deepEqual([...new Set(f.calls.filter(call => call.name === 'kiosk_submit').map(call => call.args.p_key))], [key]);
  });
});

test('explicit recovery re-attests the same saved request without a fresh key', async () => {
  const f = await fixture({ storage: new Map([[pendingKey, JSON.stringify(pending)]]) });
  await f.submit();
  assert.deepEqual(f.rpcNames(), ['kiosk_recover', 'kiosk_admit', 'kiosk_submit']);
  assert.equal(f.calls.at(-1).args.p_key, key);
  assert.equal(f.keysMade(), 0);
  assert.equal(f.view(), 'accepted');
  assert.equal(f.diagnostic(), undefined);
});

test('untrusted thrown values cannot classify themselves or interrupt protected screens', async t => {
  const cases = [
    ['throwing getter', trap => Object.defineProperty(Error(secret), 'kioskCategory', { get: trap })],
    ['throwing proxy', trap => new Proxy({}, { get: trap })],
    ['revoked proxy', () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      return proxy;
    }],
    ['null', () => null],
    ['undefined', () => undefined],
    ['primitive string', () => secret],
    ['primitive number', () => 42],
    ['frozen error', () => Object.freeze(Error(secret))],
    ['spoofed session tag', () => Object.assign(Error(secret), { kioskCategory: 'SESSION' })],
    ['unknown error', () => Error(secret)]
  ];
  for (const [name, makeThrown] of cases) await t.test(name, async () => {
    let reads = 0;
    const thrown = makeThrown(() => { reads++; throw Error(secret); });
    const fail = () => { throw thrown; };

    const f = await fixture();
    f.onboard();
    f.routes.kiosk_admit = fail;
    await f.submit();
    assert.equal(f.view(), 'uncertain');
    assert.equal(f.root.find(el => el.tagName === 'h1').textContent, recoveryHeading);
    assert.ok(f.root.find(el => el.textContent === 'Recover previous order'));
    assert.equal(f.diagnostic(), 'Staff diagnostic: A-UNKNOWN-1S');
    assert.equal(f.sandbox.curvCheckout.hasPending(), true);
    assert.deepEqual(f.rpcNames(), ['kiosk_quote', 'kiosk_admit']);
    assert.equal(JSON.parse(f.storage.get(pendingKey)).key, key);

    const saved = f.storage.get(pendingKey);
    const recovery = await fixture({ storage: new Map([[pendingKey, saved]]) });
    recovery.routes.kiosk_recover = fail;
    await recovery.submit();
    assert.equal(recovery.view(), 'locked');
    assert.ok(recovery.root.find(el => el.textContent === 'Check kiosk again'));
    assert.match(recovery.root.textContent, /The request is retained/);
    assert.equal(recovery.diagnostic(), 'Staff diagnostic: R-UNKNOWN-1S');
    assert.equal(recovery.sandbox.curvCheckout.hasPending(), true);
    assert.equal(recovery.storage.get(pendingKey), saved);
    assert.deepEqual(recovery.rpcNames(), ['kiosk_recover']);
    assert.equal(recovery.keysMade(), 0);
    assert.equal(reads, 0);
  });
});

test('an ambiguous RPC error does not inspect diagnostic-only transport fields', async () => {
  const f = await fixture();
  f.onboard();
  let reads = 0;
  const trap = () => { reads++; throw Error(secret); };
  f.routes.kiosk_quote = () => {
    const response = rpcError('');
    Object.defineProperty(response, 'status', { get: trap });
    Object.defineProperty(response.error, 'code', { get: trap });
    return response;
  };
  await f.submit();
  assert.equal(reads, 0);
  assert.equal(f.diagnostic(), 'Staff diagnostic: Q-UNKNOWN-0N');
  assert.deepEqual(f.rpcNames(), ['kiosk_quote']);
});

test('classification and label-render failures leave the original fallback controls accessible', async () => {
  const f = await fixture();
  f.onboard();
  f.routes.kiosk_admit = () => rpcError('KIOSK_SESSION_REQUIRED');
  f.sandbox.curvKioskAuth.diagnosticCategory = () => { throw Error(secret); };
  await f.submit();
  assert.equal(f.view(), 'uncertain');
  assert.equal(f.diagnostic(), 'Staff diagnostic: A-UNKNOWN-1S');

  const saved = f.storage.get(pendingKey);
  const recovery = await fixture({ storage: new Map([[pendingKey, saved]]) });
  recovery.routes.kiosk_recover = () => rpcError('KIOSK_SESSION_REQUIRED');
  const create = recovery.sandbox.document.createElement;
  recovery.sandbox.document.createElement = tag => {
    if (tag === 'span') throw Error(secret);
    return create(tag);
  };
  await recovery.submit();
  assert.equal(recovery.view(), 'locked');
  assert.ok(recovery.root.find(el => el.textContent === 'Check kiosk again'));
  assert.equal(recovery.diagnostic(), undefined);
  assert.equal(recovery.storage.get(pendingKey), saved);
  assert.deepEqual(recovery.rpcNames(), ['kiosk_recover']);
});

test('failed pending save rethrows the original object or primitive into checkout', async t => {
  for (const [name, storageError] of [['frozen exception', Object.freeze(Error(secret))], ['null', null], ['NaN', NaN]]) {
    await t.test(name, async () => {
      const caught = [];
      const f = await fixture({ storageDenied: true, storageError, observeSubmitError: error => caught.push(error) });
      f.onboard();
      await f.submit();
      assert.equal(caught.length, 1);
      assert.ok(Object.is(caught[0], storageError));
      assert.equal(f.diagnostic(), 'Staff diagnostic: P-STORAGE-1F');
      assert.equal(f.view(), 'uncertain');
      assert.ok(f.root.find(el => el.textContent === 'Recover previous order'));
      assert.equal(f.sandbox.curvCheckout.hasPending(), true);
      assert.equal(f.storage.has(pendingKey), false);
      assert.deepEqual(f.rpcNames(), ['kiosk_quote']);
      assert.equal(f.keysMade(), 1);

      f.routes.kiosk_recover = () => { throw storageError; };
      await f.submit();
      assert.equal(f.diagnostic(), 'Staff diagnostic: R-UNKNOWN-1F');
      assert.equal(f.view(), 'locked');
      assert.deepEqual(f.rpcNames(), ['kiosk_quote', 'kiosk_recover']);
    });
  }
});

test('cart changes clear obsolete inline codes without mutating the cart', async t => {
  const edits = [
    ['quantity', cart => { cart[0].qty = 2; }],
    ['option', cart => { cart[0].option_choice_ids.push(id(9)); }],
    ['removal', cart => { cart.pop(); }],
    ['addition', cart => { cart.push({ ...cart[0], product_id: id(8) }); }]
  ];
  for (const [name, edit] of edits) await t.test(name, async () => {
    const f = await fixture();
    f.onboard();
    f.routes.kiosk_quote = () => rpcError('SIZE_INVALID');
    await f.submit();
    assert.equal(f.diagnostic(), 'Staff diagnostic: Q-VALIDATION-0N');
    edit(f.sandbox.cart);
    const cart = JSON.stringify(f.sandbox.cart);
    f.sandbox.curvCheckout.changed();
    assert.equal(f.diagnostic(), undefined);
    assert.equal(f.status.textContent, cartError);
    assert.equal(JSON.stringify(f.sandbox.cart), cart);
    assert.equal(f.storage.has(pendingKey), false);
    assert.deepEqual(f.rpcNames(), ['kiosk_quote']);
  });
});

test('a cart-change notification preserves a protected uncertainty screen and saved request', async () => {
  const f = await fixture();
  f.onboard();
  f.routes.kiosk_admit = () => rpcError('KIOSK_GENERATION_CLOSED');
  await f.submit();
  const saved = f.storage.get(pendingKey);
  const screen = f.root.textContent;
  f.sandbox.cart[0].qty = 2;
  f.sandbox.curvCheckout.changed();
  assert.equal(f.root.textContent, screen);
  assert.equal(f.view(), 'uncertain');
  assert.equal(f.diagnostic(), 'Staff diagnostic: A-GENERATION-1S');
  assert.equal(f.storage.get(pendingKey), saved);
  assert.equal(f.sandbox.curvCheckout.hasPending(), true);
  assert.deepEqual(f.rpcNames(), ['kiosk_quote', 'kiosk_admit']);
});
