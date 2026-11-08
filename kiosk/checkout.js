/* CURV protected kiosk checkout. Public checkout/controller is intentionally separate. */
(() => {
  'use strict';
  if (window.curvCheckout) return;
  const version = '2026-10-29.1', storageKey = 'curv-kiosk-v2:pending', deadlineKey = 'curv-kiosk-v2:deadline';
  const state = { status: 'loading', busy: false, reviewing: false, accepted: null };
  let admittedReview;
  let generation, device, nickname = '', fulfillment = '', pending, corrupt = false, epoch = 0, idle = Date.now(), deadline = 0, releaseLock, ownsLock = false, authSubscribed = false;
  const root = document.getElementById('kioskRoot') || document.body.appendChild(Object.assign(document.createElement('section'), { id: 'kioskRoot', className: 'kiosk-screen' }));
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  function isolate(on) { for (const element of document.body.children) if (element !== root && element instanceof HTMLElement) element.inert = on; }
  const make = (tag, text, attrs = {}) => Object.assign(document.createElement(tag), text === undefined ? attrs : { textContent: text, ...attrs });
  function screen(title, copy, view = 'loading') {
    root.dataset.kioskView = view;
    root.hidden = false; root.replaceChildren(); isolate(true);
    const card = make('div', undefined, { className: 'kiosk-card' });
    card.append(make('img', undefined, { className: 'kiosk-logo', src: '/kiosk/curv-kiosk-logo.svg', alt: 'The CURV Café' }));
    card.append(make('h1', title)); if (copy) card.append(make('p', copy)); root.append(card);
    document.documentElement.classList.remove('curv-kiosk-pending'); return card;
  }
  function button(card, label, run) { const b = make('button', label, { type: 'button' }); b.addEventListener('click', run); card.append(b); return b; }
  const safeNumber = r => r && typeof r.order_number === 'string' && /^C-[0-9]+$/.test(r.order_number) && r.order_number.length <= 80;
  function persist() { if (pending) sessionStorage.setItem(storageKey, JSON.stringify(pending)); else sessionStorage.removeItem(storageKey); }
  function clearCustomer() {
    nickname = ''; fulfillment = ''; admittedReview = null; cart = []; state.accepted = null;
    for (const id of ['f-name','f-contact','f-address','f-notes','f-delivery-time']) { const e = document.getElementById(id); if (e) e.value = ''; }
    document.getElementById('kioskBanner')?.remove(); closeOrderConfirmModal(); renderCart();
  }
  function locked(message = 'Ask CURV staff to restore this kiosk. Any previous request is still protected.') {
    deadline = 0; state.accepted = null;
    state.status = 'locked'; root.hidden = false;
    const card = screen('A little help from CURV', undefined, 'locked');
    card.append(make('p', 'Please ask a CURV team member for help.'), make('p', message));
    button(card, 'Check kiosk again', () => initialize());
    syncButton();
  }
  function uncertain() {
    state.status = 'uncertain';
    const card = screen('Let’s check that order', undefined, 'uncertain');
    card.append(make('p', 'Please wait while we check your order.'), make('p', 'The result is not confirmed yet. Keep this tab open and ask staff if needed. We will reuse the same request.'));
    button(card, 'Recover previous order', recover); syncButton();
  }
  async function call(name, args = {}) { return window.curvKioskAuth.rpc(name, args); }
  async function loadAsset(path) {
    await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = path; s.onload = resolve; s.onerror = reject; document.head.append(s); });
  }
  function stored() {
    try {
      // Do not discard/reinterpret a legacy V1 request under a new contract.
      if (sessionStorage.getItem('curv-kiosk:curv-pending-order-v2') || sessionStorage.getItem('curv-kiosk:curv-accepted-order-v2')) throw Error('legacy');
      const raw = sessionStorage.getItem(storageKey); if (!raw) return;
      const p = JSON.parse(raw);
      if (p.version !== 1 || !getSafeSubmissionKey(p.key) || !getSafeSubmissionKey(p.generation) || !getSafeSubmissionKey(p.device)
        || (p.payload && p.payload.submission_key !== p.key)) throw Error('pending');
      pending = p;
    } catch (_) { corrupt = true; }
  }
  stored();
  async function initialize() {
    const current = ++epoch; state.busy = false; screen('One moment…', 'Checking this shared tablet.'); clearCustomer();
    try {
      if (!ownsLock) return locked('Another kiosk tab may be open. Use one customer tab on this tablet.');
      if (corrupt) return locked('An earlier or unreadable kiosk request needs staff verification. Its stored recovery data has not been removed.');
      if (!window.CURV_KIOSK_CONFIG) await loadAsset('/kiosk/config.js?v=' + version);
      if (!window.curvKioskAuth) await loadAsset('/kiosk/auth.js?v=' + version);
      if (!authSubscribed) {
        window.curvKioskAuth.getClient().auth.onAuthStateChange(event => {
          if (event === 'SIGNED_OUT') { ++epoch; clearCustomer(); locked(); }
        });
        authSubscribed = true;
      }
      const ctx = await call('kiosk_context'); if (current !== epoch) return;
      if (ctx?.contract_version !== 1 || !getSafeSubmissionKey(ctx.device_id)) throw Error('context');
      device = ctx.device_id;
      if (pending && pending.device !== device) return locked('This saved request belongs to another device identity. Ask the owner to recover it.');
      if (pending && pending.generation !== ctx.generation_id) {
        const old = await call('kiosk_recover', { p_generation: pending.generation, p_key: pending.key }); if (current !== epoch) return;
        if (old?.state !== 'closed') return uncertain();
        pending = null; persist(); sessionStorage.removeItem(deadlineKey);
      }
      if (ctx.generation_id && ctx.submission_key) {
        generation = ctx.generation_id;
        if (pending && pending.key !== ctx.submission_key) return locked('A different request is active. Ask staff to verify the saved order.');
        pending = pending || { version: 1, device, generation, key: ctx.submission_key, payload: null }; persist();
        if (ctx.state === 'accepted') return accepted(ctx);
        return uncertain();
      }
      if (pending) { generation = pending.generation; return uncertain(); }
      const begun = await call('kiosk_begin'); if (current !== epoch) return;
      generation = begun.generation_id; device = begun.device_id;
      if (!getSafeSubmissionKey(generation)) throw Error('generation');
      state.status = 'name'; idle = Date.now(); nameScreen(); syncButton();
    } catch (_) { if (current === epoch) locked(); }
  }
  function nameScreen(error = '') {
    const card = screen("hey, what's your name?", "We'll call you when your order is ready.", 'name');
    const form = make('form'); const label = make('label', 'Your nickname', { htmlFor: 'kioskNickname' });
    const input = make('input', undefined, { id: 'kioskNickname', type: 'text', autocomplete: 'off', value: nickname });
    input.setAttribute('aria-describedby', 'kioskNameError'); form.append(label, input);
    form.append(make('p', error, { id: 'kioskNameError', className: 'kiosk-error', role: 'alert' }));
    form.append(make('button', 'Continue', { type: 'submit' })); card.append(form);
    form.addEventListener('submit', e => {
      e.preventDefault(); const value = input.value.trim();
      if (!value || [...value].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return nameScreen('Please use a nickname of 1–80 characters.');
      nickname = value; state.status = 'mode'; modeScreen();
    });
    input.focus();
  }
  function modeScreen() {
    const card = screen('where are you enjoying it?', undefined, 'mode');
    card.append(make('p', nickname, { className: 'kiosk-nickname' }));
    const choices = make('div', undefined, { className: 'kiosk-choices' }); card.append(choices);
    for (const [label, copy, type] of [['FOR HERE','stay and sip in the café','dine_in'],['TO GO','we pack it up for you','pickup']]) {
      const b = button(choices, label, () => { fulfillment = type; state.status = 'menu'; root.hidden = true; isolate(false); idle = Date.now();
        document.getElementById('f-name').value = nickname; document.getElementById('f-delivery').value = type === 'dine_in' ? 'dine-in' : 'pickup';
        syncOrderMethodFields(); document.getElementById('f-payment').value = 'counter';
        const banner = make('div', undefined, { className: 'kiosk-banner', id: 'kioskBanner' }); banner.append(make('span', nickname + ' · ' + label + ' · Pay at counter'));
        document.body.prepend(banner); syncButton(); });
      b.setAttribute('aria-label', label);
      b.replaceChildren(make('span', label.toLowerCase(), { className: 'kiosk-choice-title' }), make('small', copy));
    }
    card.append(make('p', 'Pay at the counter after ordering.', { className: 'kiosk-payment-hint' }));
    button(card, 'Back', () => { state.status = 'name'; nameScreen(); }).className = 'kiosk-back';
  }
  function items() {
    if (!cart.length || cart.length > 30) throw Error('cart');
    const catalogId = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
    return cart.map(i => {
      const choices = [...(i.option_choice_ids || [])].sort();
      if (!catalogId(i.product_id) || !catalogId(i.product_size_id) || !Number.isInteger(i.qty) || i.qty < 1
        || choices.some(c => !catalogId(c)) || new Set(choices).size !== choices.length) throw Error('cart');
      return { product_id: i.product_id, product_size_id: i.product_size_id, option_choice_ids: choices, quantity: i.qty,
        item_note: String(i.options?.note ?? i.item_note ?? '').trim() || null };
    });
  }
  function payload() { return { kiosk_contract_version: 1, customer_name: nickname, fulfillment_type: fulfillment,
    items: items(), customer_notes: document.getElementById('f-notes').value.trim() || null }; }
  function validQuote(q) {
    return q?.pricing_contract_version === 2 && q.currency === 'PHP' && /^[a-f0-9]{64}$/.test(q.review_fingerprint || '')
      && /^\d+\.\d{2}$/.test(q.subtotal || '') && Array.isArray(q.items) && q.items.length > 0 && q.items.length <= 30
      && q.items.every(i => Number.isInteger(i.quantity) && i.quantity > 0 && typeof i.product_name === 'string'
        && typeof i.size_label === 'string' && /^\d+\.\d{2}$/.test(i.line_total || '') && /^\d+\.\d{2}$/.test(i.unit_price || '') && Array.isArray(i.options));
  }
  function recoveryType() {
    const p = pending?.payload;
    if (!pending || pending.device !== device || pending.generation !== generation
      || !getSafeSubmissionKey(pending.key) || p?.submission_key !== pending.key
      || p.kiosk_contract_version !== 1 || !['dine_in', 'pickup'].includes(p.fulfillment_type)) throw Error('KIOSK_RECOVERY_INTENT_REQUIRED');
    return p.fulfillment_type;
  }
  function bindAdmission(admission) {
    const type = recoveryType();
    if (admission?.state !== 'admitted' || admission.submission_key !== pending.key) throw Error('KIOSK_RECOVERY_INTENT_REQUIRED');
    // The existing RPC has verified this frozen request against the same server attempt.
    // Keep only a volatile display binding; no new browser storage or personal details.
    admittedReview = { device, generation, key: pending.key, type };
  }
  function reviewType() {
    if (!pending) {
      if (!['dine_in', 'pickup'].includes(fulfillment)) throw Error('KIOSK_RECOVERY_INTENT_REQUIRED');
      return fulfillment;
    }
    const type = recoveryType();
    if (!admittedReview || admittedReview.device !== device || admittedReview.generation !== generation
      || admittedReview.key !== pending.key || admittedReview.type !== type) throw Error('KIOSK_RECOVERY_INTENT_REQUIRED');
    return type;
  }
  function reviewHtml(q) {
    const e = escapeHtml;
    return '<div class="authoritative-review"><p>Pay at counter · ' + e(reviewType() === 'pickup' ? 'TO GO' : 'FOR HERE') + '</p>'
      + q.items.map(i => '<article><strong>' + e(i.quantity) + '× ' + e(i.product_name) + '</strong><p>' + e(i.size_label) + '</p>'
        + i.options.map(o => '<p>' + e(o.group_name) + ': ' + e(o.label) + '</p>').join('')
        + (i.item_note ? '<p>' + e(i.item_note) + '</p>' : '') + '<p>₱' + e(i.line_total) + '</p></article>').join('')
      + '<p><strong>Total: ₱' + e(q.subtotal) + '</strong></p></div>';
  }
  async function confirmation(q, changed = false) {
    if (!validQuote(q)) throw Error('quote');
    root.hidden = true; isolate(false);
    state.reviewing = true;
    try { return await confirmOrderBeforeSubmit(q, { fulfillment_type: reviewType() }, changed); }
    finally { state.reviewing = false; }
  }
  async function handleResult(result) {
    const current = epoch;
    if (result?.state === 'accepted') return accepted(result);
    if (result?.state === 'price_changed' && validQuote(result.quote)) {
      root.hidden = true;
      if (await confirmation(result.quote, true)) {
        if (current !== epoch) return;
        if (pending.payload) { pending.payload.review_fingerprint = result.quote.review_fingerprint; persist(); }
        const confirmed = await call('kiosk_confirm_price', { p_generation: generation, p_key: pending.key, p_review: result.quote.review_fingerprint });
        if (current !== epoch) return;
        if (confirmed?.state === 'accepted') return accepted(confirmed);
        if (confirmed?.state !== 'admitted') return uncertain();
        const response = await call('kiosk_submit', { p_generation: generation, p_key: pending.key });
        if (current === epoch) return handleResult(response);
        return;
      }
    }
    uncertain();
  }
  async function submit() {
    if (state.busy || state.accepted || corrupt) return;
    if (pending) return recover();
    if (state.status !== 'menu' || !nickname || !['dine_in','pickup'].includes(fulfillment)) return;
    const current = epoch; state.busy = true; isSubmittingPublicOrder = true; syncButton();
    try {
      const p = payload(), signature = JSON.stringify(p);
      const result = await call('kiosk_quote', { p_generation: generation, p_payload: p });
      if (current !== epoch) return;
      if (!result?.ok || !await confirmation(result.quote) || signature !== JSON.stringify(payload())) return;
      if (current !== epoch) return;
      const key = generatePublicSubmissionKey();
      pending = { version: 1, device, generation, key, payload: { ...p, submission_key: key, review_fingerprint: result.quote.review_fingerprint } };
      persist(); // Must succeed BEFORE admission or submission transport.
      const admission = await call('kiosk_admit', { p_generation: generation, p_payload: pending.payload });
      if (current !== epoch) return;
      bindAdmission(admission);
      const response = await call('kiosk_submit', { p_generation: generation, p_key: key });
      if (current === epoch) await handleResult(response);
    } catch (_) { if (current === epoch) pending ? uncertain() : setSubmitOrderStatus('Please check your cart and try again. Ask CURV staff if needed.', 'error'); }
    finally { state.busy = false; isSubmittingPublicOrder = false; syncButton(); }
  }
  async function recover() {
    if (state.busy || !pending || corrupt) return;
    const current = epoch; state.busy = true; isSubmittingPublicOrder = true; syncButton();
    try {
      const result = await call('kiosk_recover', { p_generation: pending.generation, p_key: pending.key });
      if (current !== epoch) return;
      generation = pending.generation;
      if (result?.state === 'closed') return finish();
      if (result?.state === 'accepted') return accepted(result);
      if (!['unknown', 'admitted', 'price_changed'].includes(result?.state)) throw Error('KIOSK_RECOVERY_INTENT_REQUIRED');
      recoveryType();
      // Re-attest the original frozen body before displaying any recovered review.
      // Canonical/request mismatch is rejected server-side; accepted replay is unchanged.
      const admission = await call('kiosk_admit', { p_generation: generation, p_payload: pending.payload });
      if (current !== epoch) return;
      bindAdmission(admission);
      const response = await call('kiosk_submit', { p_generation: generation, p_key: pending.key });
      if (current === epoch) await handleResult(response);
    } catch (_) { if (current === epoch) locked('Recovery could not be confirmed. Keep this tab open; staff may need to restore device access. The request is retained.'); }
    finally { state.busy = false; isSubmittingPublicOrder = false; syncButton(); }
  }
  function accepted(result) {
    if (!safeNumber(result.receipt) || !Number.isFinite(Date.parse(result.accepted_at))) return uncertain();
    state.accepted = result.receipt; state.status = 'accepted';
    pending.payload = null; persist(); // Verified acceptance: remove the personal frozen body, retain safe recovery pointer.
    let saved = Number(sessionStorage.getItem(deadlineKey));
    deadline = saved > 0 ? Math.min(saved, Date.now() + 60000) : Date.parse(result.accepted_at) + 60000;
    sessionStorage.setItem(deadlineKey, String(deadline));
    if (deadline <= Date.now()) { queueMicrotask(done); return; }
    setSubmittedFormLocked(true);
    const card = screen('order received!', undefined, 'accepted');
    const orderNumber = make('p', undefined, { className: 'kiosk-order-number' });
    orderNumber.style.setProperty('--kiosk-reference-length', result.receipt.order_number.length);
    orderNumber.append(make('span', result.receipt.order_number));
    card.append(orderNumber);
    const instructions = make('p', undefined, { className: 'kiosk-receipt-copy' });
    instructions.append('Go to the counter, tell us ', make('strong', result.receipt.order_number), ', and pay. ');
    if (nickname) instructions.append('We will call ', make('strong', nickname), '.');
    else instructions.append('We will call your order number.');
    card.append(instructions);
    const doneButton = button(card, 'Done · New customer', done);
    doneButton.className = 'kiosk-done';
    card.append(make('p', 'This screen resets after 60 seconds without activity.', { className: 'kiosk-reset-copy' }));
  }
  function finish() {
    try {
      sessionStorage.removeItem(storageKey); sessionStorage.removeItem(deadlineKey);
      if (sessionStorage.getItem(storageKey) !== null || sessionStorage.getItem(deadlineKey) !== null) throw Error('storage');
    } catch (error) { corrupt = true; throw error; }
    pending = null; clearCustomer();
    location.replace('/menu/?kiosk=1');
  }
  async function done() {
    if (state.busy || !state.accepted) return;
    state.busy = true;
    try { const r = await call('kiosk_close', { p_generation: generation }); if (r?.state !== 'closed') throw Error('close'); finish(); }
    catch (_) { locked('The next-customer reset could not be verified. Ask staff; the confirmed order is retained.'); }
    finally { state.busy = false; }
  }
  async function abandon() {
    if (pending || state.busy || !['name','mode','menu'].includes(state.status)) return;
    state.busy = true;
    try { const r = await call('kiosk_close', { p_generation: generation, p_draft: true }); if (r?.state === 'closed') finish(); }
    catch (_) { locked('This draft could not be cleared safely. Ask CURV staff.'); }
    finally { state.busy = false; }
  }
  function syncButton() {
    const b = document.getElementById('submitOrderBtn'); if (!b) return;
    b.disabled = state.busy || !['menu','uncertain'].includes(state.status) || (!pending && !cart.length);
    b.textContent = state.busy ? 'Checking order…' : pending ? 'Recover previous order' : 'Review Order';
  }
  function activity() {
    if (state.accepted && deadline && Date.now() >= deadline) { done(); return; }
    idle = Date.now(); if (state.accepted) { deadline = idle + 60000; try { sessionStorage.setItem(deadlineKey, String(deadline)); } catch (_) {} }
  }
  const controller = { version, contract: 'protected-kiosk-v1', state, submit, syncButton, reviewHtml, items,
    changed: syncButton, hasPending: () => !!pending, storageKey, dispose: () => false, resetKiosk: done };
  window.curvCheckout = controller; window.curvKiosk = { state, initialize };
  document.body.classList.add('curv-kiosk');
  document.querySelectorAll('#formBody input,#formBody select,#formBody textarea').forEach(e => e.autocomplete = 'off');
  for (const event of ['pointerdown','keydown','input']) document.addEventListener(event, activity, true);
  setInterval(() => {
    if (state.reviewing && Date.now() - idle >= 120000) {
      const edit = [...document.querySelectorAll('#orderConfirmActions button')].find(b => b.textContent === 'Edit Order');
      if (edit) edit.click();
      return;
    }
    if (state.accepted && deadline && Date.now() >= deadline) done(); else if (!pending && !state.busy && Date.now() - idle >= 120000) abandon();
  }, 1000);
  window.addEventListener('pagehide', () => { ++epoch; document.documentElement.classList.add('curv-kiosk-pending'); clearCustomer(); root.hidden = false; root.textContent = 'Checking this shared tablet…'; if (releaseLock) releaseLock(); ownsLock = false; });
  async function start() {
    if (!navigator.locks?.request) return locked('This browser does not support the protected single-tab kiosk. Ask staff to use the approved tablet browser.');
    navigator.locks.request('curv-kiosk-v2-customer-tab', { ifAvailable: true }, async lock => {
      if (!lock) return locked('A kiosk tab is already open. Please use that tab.');
      ownsLock = true; await initialize(); await new Promise(resolve => { releaseLock = resolve; });
    }).catch(() => locked());
  }
  window.addEventListener('pageshow', e => { if (e.persisted) start(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      ++epoch; document.documentElement.classList.add('curv-kiosk-pending'); clearCustomer();
      root.hidden = false; root.textContent = 'Checking this shared tablet…';
    } else if (ownsLock) initialize();
  });
  start();
})();
