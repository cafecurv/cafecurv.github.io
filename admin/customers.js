/* Read-only owner customer records. No catalog reads or persistent customer cache. */
(() => {
  const root = document.querySelector('[data-customers-page]');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const listView = $('customers-list-view'), detailView = $('customers-detail-view');
  const list = $('customer-list'), pages = $('customer-list-pages'), detail = $('customer-detail');
  const search = $('customer-search'), sort = $('customer-sort');
  const status = $('customers-status'), locked = $('customers-locked');
  const retryAuth = $('customers-auth-retry');
  const account = document.querySelector('[data-owner-account]');
  let client, sessionKey = null, epoch = 0, listRequest = 0, detailRequest = 0;
  let authorized = false, selected = null, offset = 0, historyOffset = 0;
  let filter = 'all', timer, listData = null, listScroll = 0, returnId = null;
  const itemsCache = new Map();
  const text = value => value == null || String(value).trim() === '' ? 'Unavailable' : String(value);
  const name = value => value == null || String(value).trim() === '' ? 'Name unavailable' : String(value);
  const el = (tag, cls, value) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const button = (label, action) => {
    const node = el('button', 'auth-button auth-button-secondary', label);
    node.type = 'button'; node.addEventListener('click', action); return node;
  };
  const date = value => {
    const d = value && new Date(value);
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-PH', {
      timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }) : 'Unavailable';
  };
  const money = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
  const label = value => text(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const fields = rows => {
    const dl = el('dl', 'customer-fields');
    rows.forEach(([key, value]) => { const row = el('div'); row.append(el('dt', '', key), el('dd', '', text(value))); dl.append(row); });
    return dl;
  };
  const message = (target, title, copy, retry) => {
    target.replaceChildren();
    const box = el('div', 'customer-empty');
    box.append(el('h2', '', title));
    if (copy) box.append(el('p', '', copy));
    if (retry) box.append(button('Retry', retry));
    target.append(box);
  };
  function clearPrivate() {
    epoch++; listRequest++; detailRequest++; clearTimeout(timer);
    authorized = false; selected = null; listData = null; returnId = null;
    itemsCache.clear(); list.replaceChildren(); pages.replaceChildren(); detail.replaceChildren();
    listView.hidden = true; detailView.hidden = true; locked.hidden = false;
    offset = 0; historyOffset = 0; filter = 'all'; search.value = ''; sort.value = 'recent';
    list.removeAttribute('aria-busy');
    root.querySelectorAll('[data-customer-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.customerFilter === 'all')));
    status.textContent = '';
  }
  function lock(messageText, retry = false) {
    clearPrivate(); $('customers-lock-message').textContent = messageText; retryAuth.hidden = !retry;
  }
  const isForbidden = error => ['42501','PGRST301','PGRST302','PGRST303'].includes(error?.code)
    || error?.details === 'CUSTOMER_FORBIDDEN' || [401,403].includes(error?.status);
  async function read(rpc, args, token) {
    const { data, error } = await client.rpc(rpc, args);
    if (token !== epoch) return null;
    if (error) {
      if (isForbidden(error)) lock('Owner access is required. Sign in with an authorized owner account.');
      throw error;
    }
    return data;
  }
  function pagination(target, data, limit, action) {
    target.replaceChildren();
    const previous = button('Previous', () => action(Math.max(0, data.offset - limit)));
    const next = button('Next', () => action(data.offset + limit));
    previous.disabled = data.offset === 0;
    next.disabled = !data.has_more || data.offset + limit > 100000;
    target.append(previous, el('span', '', `${data.total_count ? data.offset + 1 : 0}–${Math.min(data.offset + limit, data.total_count)} of ${data.total_count}`), next);
  }
  function renderList() {
    list.replaceChildren();
    const data = listData;
    if (!data.customers.length) {
      const narrowed = search.value.trim() || filter !== 'all';
      message(list, narrowed ? 'No customers match your search.' : 'No customer records yet.',
        narrowed ? 'Try another search or filter.' : 'New website orders will appear here once they’re linked to a customer.');
    }
    data.customers.forEach(c => {
      const card = button('', () => openCustomer(c.customer_id));
      card.className = 'customer-card'; card.dataset.customerId = c.customer_id;
      const head = el('div', 'customer-card-head');
      head.append(el('h2', '', name(c.latest_name)));
      if (c.repeat_customer) head.append(el('span', 'customer-repeat', 'Repeat'));
      card.append(head, el('p', 'customer-phone', text(c.normalized_phone)),
        el('p', 'customer-help', 'Last order: ' + date(c.last_order_at)),
        el('p', '', `${c.submitted_order_count} submitted orders`));
      list.append(card);
    });
    pagination(pages, data, 25, next => { offset = next; loadList(); });
  }
  async function loadList() {
    if (!sessionKey) return;
    clearTimeout(timer);
    const token = epoch, request = ++listRequest;
    const args = { p_search: search.value, p_filter: filter, p_sort: sort.value, p_limit: 25, p_offset: offset };
    listData = null; list.replaceChildren(); pages.replaceChildren(); list.setAttribute('aria-busy','true');
    status.textContent = 'Loading customers…'; retryAuth.hidden = true;
    try {
      const data = await read('customer_admin_list', args, token);
      if (token !== epoch || request !== listRequest || !data) return;
      authorized = true; locked.hidden = true; listView.hidden = !!selected;
      listData = data; renderList(); status.textContent = '';
    } catch (_) {
      if (token !== epoch || request !== listRequest) return;
      if (!authorized) { lock('Could not check customer access. Please try again.', true); return; }
      message(list, 'Could not load customers', 'Check your connection and try again.', loadList);
      status.textContent = '';
    } finally { if (token === epoch && request === listRequest) list.setAttribute('aria-busy','false'); }
  }
  const optionsText = value => {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(optionsText).filter(Boolean).join(', ');
    if (typeof value === 'object') return Object.entries(value).map(([key,v]) => `${key}: ${optionsText(v)}`).join(', ');
    return String(value);
  };
  function itemRows(target, items) {
    target.replaceChildren();
    if (!items.length) target.append(el('p', '', 'No saved items available.'));
    items.forEach(i => {
      const row = el('article', 'customer-item');
      row.append(el('h4','', `${i.quantity} × ${text(i.product_name)}`),
        el('p','', [i.category_name,i.variant_label].filter(Boolean).join(' · ')),
        el('p','', `${money(i.unit_price)} each · ${money(i.line_total)}`));
      if (i.options) row.append(el('p','',optionsText(i.options)));
      if (i.item_note) row.append(el('p','',i.item_note));
      target.append(row);
    });
  }
  function expandable(order, customerId, token, request) {
    const wrapper = el('details', 'customer-items'), summary = el('summary', '', 'View items'), body = el('div');
    wrapper.append(summary, body);
    let busy = false;
    async function load() {
      if (busy || token !== epoch || request !== detailRequest) return;
      const key = customerId + ':' + order.order_id;
      if (itemsCache.has(key)) { itemRows(body, itemsCache.get(key)); return; }
      busy = true; body.textContent = 'Loading saved items…';
      try {
        const data = await read('customer_admin_order_items', { p_customer_id: customerId, p_order_id: order.order_id }, token);
        if (token !== epoch || request !== detailRequest || !data) return;
        itemsCache.set(key, data.items); itemRows(body, data.items);
      } catch (_) {
        if (token === epoch && request === detailRequest) message(body, 'Could not load saved items', 'The order may no longer be available. Try again.', load);
      } finally { busy = false; }
    }
    wrapper.addEventListener('toggle', () => { if (wrapper.open) load(); });
    return wrapper;
  }
  async function loadDetail() {
    const token = epoch, request = ++detailRequest, customerId = selected;
    if (!authorized || !customerId) return;
    detail.replaceChildren(el('p','','Loading customer history…'));
    try {
      const data = await read('customer_admin_detail', { p_customer_id: customerId, p_limit: 20, p_offset: historyOffset }, token);
      if (token !== epoch || request !== detailRequest || selected !== customerId || !data) return;
      const c = data.customer, summary = el('section','customer-summary');
      summary.append(el('h2','',name(c.latest_name)));
      if (c.repeat_customer) summary.append(el('span','customer-repeat','Repeat'));
      summary.append(fields([
        ['Phone',c.normalized_phone],['Latest delivery address',c.latest_delivery_address],
        ['First linked order',date(c.first_order_at)],['Last linked order',date(c.last_order_at)],
        ['Submitted website orders',c.submitted_order_count],['Completed website orders',c.completed_order_count]
      ]), el('p','customer-help','Unverified contact record grouped by submitted phone number.'),
      el('p','customer-help','Only linked website orders are shown. Earlier orders were not backfilled.'));
      detail.replaceChildren(summary,el('h2','','Order history'));
      data.orders.forEach(o => {
        const card = el('article','customer-order');
        card.append(el('h3','',o.order_number),el('p','',date(o.created_at)));
        const badge = el('span','order-status-badge',label(o.status));
        if (['submitted','accepted','preparing','ready','completed','cancelled'].includes(o.status)) badge.classList.add('is-'+o.status);
        card.append(badge,fields([
          ['Order method',label(o.fulfillment_type)],['Payment method',label(o.payment_method)],
          ['Payment status',label(o.payment_status)],['Total',money(o.total)]
        ]),el('h4','','Details submitted with this order'),fields([
          ['Name',o.customer_name],['Phone',o.customer_phone],['Delivery address',o.delivery_address]
        ]),expandable(o,customerId,token,request));
        detail.append(card);
      });
      if (!data.orders.length) detail.append(el('p','','No linked website orders available.'));
      const pager = el('div','customer-pagination');
      pagination(pager,data,20,next => { historyOffset = next; loadDetail(); }); detail.append(pager);
    } catch (_) {
      if (token === epoch && request === detailRequest) message(detail,'Could not load customer history','The record may no longer be available. Try again.',loadDetail);
    }
  }
  function openCustomer(id) {
    if (!authorized) return;
    listScroll = window.scrollY; returnId = id; selected = id; historyOffset = 0;
    listView.hidden = true; detailView.hidden = false; loadDetail(); $('customers-back').focus();
    window.scrollTo(0,0);
  }
  $('customers-back').addEventListener('click', () => {
    detailRequest++; selected = null; detail.replaceChildren(); detailView.hidden = true; listView.hidden = false;
    list.querySelector(`[data-customer-id="${CSS.escape(returnId || '')}"]`)?.focus({ preventScroll: true });
    window.scrollTo(0,listScroll);
  });
  search.addEventListener('input', () => {
    listRequest++; offset = 0; clearTimeout(timer); listData = null;
    list.replaceChildren(); pages.replaceChildren(); status.textContent = 'Searching customers…';
    timer = setTimeout(loadList,300);
  });
  sort.addEventListener('change', () => { offset = 0; loadList(); });
  root.querySelectorAll('[data-customer-filter]').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.customerFilter; offset = 0;
    root.querySelectorAll('[data-customer-filter]').forEach(chip => chip.setAttribute('aria-pressed',String(chip === b)));
    loadList();
  }));
  $('customers-refresh').addEventListener('click', () => { itemsCache.clear(); loadList(); });
  retryAuth.addEventListener('click', () => { if (sessionKey) loadList(); else bootstrap(); });
  const toggle = document.querySelector('[data-owner-account-toggle]');
  const menu = document.querySelector('[data-owner-account-menu]');
  function closeMenu() { menu.hidden = true; toggle.setAttribute('aria-expanded','false'); }
  toggle.addEventListener('click', () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded',String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!account.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('curv-close-owner-dropdowns',closeMenu);
  function accountUI(signedIn) {
    document.querySelector('[data-owner-signed-in]').hidden = !signedIn;
    document.querySelector('[data-owner-signed-out]').hidden = signedIn;
    document.querySelector('[data-owner-account-label]').textContent = signedIn ? 'Account' : 'Owner Login';
  }
  function applySession(session) {
    const key = session?.user?.id ? session.user.id + ':' + (session.access_token || '') : null;
    if (key === sessionKey) {
      if (!key) { lock('Sign in with an authorized owner account to view customer records.'); accountUI(false); }
      return;
    }
    sessionKey = key; clearPrivate(); accountUI(!!key); closeMenu();
    $('owner-password').value = '';
    if (key) { $('customers-lock-message').textContent = 'Checking owner access…'; loadList(); }
    else lock('Sign in with an authorized owner account to view customer records.');
  }
  document.querySelector('[data-auth-form]').addEventListener('submit',async e => {
    e.preventDefault(); if (!client) return;
    const b = document.querySelector('[data-sign-in]'); b.disabled = true;
    const generation = authEvents;
    try {
      const { data,error } = await client.auth.signInWithPassword({ email: $('owner-email').value.trim(),password: $('owner-password').value });
      if (error) throw error;
      if (generation === authEvents) applySession(data.session);
    } catch (_) { if (generation === authEvents) lock('Sign in failed. Check your credentials and try again.'); }
    finally { $('owner-password').value = ''; b.disabled = false; }
  });
  document.querySelector('[data-sign-out]').addEventListener('click',async () => {
    authEvents++;
    sessionKey = null; lock('Signed out. Sign in to view customer records.'); accountUI(false); closeMenu();
    try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; }
    catch (_) { $('customers-lock-message').textContent = 'Customer data cleared. Sign-out failed; retry signing out from this account.'; accountUI(true); }
  });
  let authEvents = 0;
  async function bootstrap() {
    if (!client) { lock('Sign-in is unavailable. Reload the page and try again.'); return; }
    const generation = authEvents;
    try {
      const { data,error } = await client.auth.getSession();
      if (generation !== authEvents) return;
      if (error) throw error;
      if (!data.session && !sessionKey) { lock('Sign in with an authorized owner account to view customer records.'); accountUI(false); }
      else applySession(data.session);
    } catch (_) { if (generation === authEvents) lock('Could not load your session. Please try again.',true); }
  }
  if (window.supabase) {
    client = window.supabase.createClient('https://tjqnmyjttqukowcehzmq.supabase.co','sb_publishable_tkWA-7LTA9R5wKw7_vi_ng_YDYnS1M0');
    client.auth.onAuthStateChange((_event, session) => {
      authEvents++;
      // Clear synchronously; defer Supabase work outside the auth callback.
      const key = session?.user?.id ? session.user.id + ':' + (session.access_token || '') : null;
      if (key !== sessionKey) { clearPrivate(); sessionKey = null; }
      const generation = authEvents;
      setTimeout(() => { if (generation === authEvents) applySession(session); },0);
    });
  }
  window.addEventListener('pagehide', () => { authEvents++; sessionKey = null; clearPrivate(); });
  window.addEventListener('pageshow', e => { if (e.persisted) bootstrap(); });
  bootstrap();
})();
