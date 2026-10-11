/* D0B6: checkout authority and session-only recovery. Catalog prices remain estimates. */
(() => {
  'use strict';
  const storageKey = 'curv-pending-order-v2';
  const trim = value => String(value ?? '').replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '') || null;
  const uuid = value => {
    const s = String(value || '').toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) throw Error('intent');
    return s;
  };
  const state = { status: 'idle', quote: null, intentKey: '', generation: 0, reviewing: false, busy: false };
  let pending = null, recovery = false, storageCorrupt = false;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || !saved.request?.payload || !getSafeSubmissionKey(saved.request.payload.submission_key)
        || !['ambiguous', 'price_changed', 'validation', 'conflict'].includes(saved.state)) throw Error('pending');
      pending = saved; recovery = true;
    }
  } catch (_) { storageCorrupt = true; }
  const messages = {
    ORDER_CART_INVALID: 'Please review your cart and try again.', QUANTITY_INVALID: 'Please review the item quantities.',
    PRODUCT_UNAVAILABLE: 'One of the selected items is no longer available.', SIZE_INVALID: 'One of the selected sizes is no longer available.',
    OPTION_INVALID: 'One of the selected options is no longer available.', OPTION_REQUIRED: 'Please complete the required options.',
    OPTION_SELECTION_INVALID: 'Please review the selected options.', CONFIGURATION_INVALID: 'This item is temporarily unavailable. Please refresh the menu.',
    CLIENT_UPDATE_REQUIRED: 'Please refresh before starting a new order.', CURV_ORDERING_CLOSED: WEBSITE_ORDERING_CLOSED_REJECTION_MESSAGE,
    DINE_TIMING_REQUIRED: 'Choose when we should prepare your order.', DINE_TIMING_INVALID: 'Choose a valid preparation time later today.',
    DINE_TIMING_NOT_LATER_TODAY: 'Choose a preparation time later today.'
  };
  const uncertain = () => pending && ['ambiguous', 'conflict'].includes(pending.state);
  async function rpc(client, name, args) {
    let timer;
    try {
      return await Promise.race([client.rpc(name, args), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('timeout')), 30000);
      })]);
    } finally { clearTimeout(timer); }
    // A timeout does not establish whether submission committed. Its frozen
    // request stays recoverable even if the original server call finishes later.
  }
  const write = () => {
    if (pending) sessionStorage.setItem(storageKey, JSON.stringify(pending));
    else sessionStorage.removeItem(storageKey);
  };
  function items() {
    if (!cart.length || cart.length > 30) throw Error('intent');
    return normalizeItems(cart.map(i => ({ product_id: i.product_id, product_size_id: i.product_size_id,
      option_choice_ids: i.option_choice_ids || [], quantity: i.qty, item_note: i.options?.note ?? i.item_note ?? null })));
  }
  function normalizeItems(lines) {
    const merged = new Map();
    for (const i of lines) {
      const choices = i.option_choice_ids.map(uuid).sort();
      if (choices.length > 64 || new Set(choices).size !== choices.length || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 2147483647) throw Error('intent');
      const note = trim(i.item_note); if (note && [...note].length > 500) throw Error('intent');
      const row = { product_id: uuid(i.product_id), product_size_id: uuid(i.product_size_id), option_choice_ids: choices, quantity: i.quantity, item_note: note };
      const key = JSON.stringify([row.product_id, row.product_size_id, choices, note]);
      if (merged.has(key)) merged.get(key).quantity += row.quantity; else merged.set(key, row);
      if (merged.get(key).quantity > 2147483647) throw Error('intent');
    }
    return [...merged.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, i]) => i);
  }
  function payload() {
    const old = buildPublicOrderPayload(); if (!old) throw Error('intent');
    const p = { pricing_contract_version: 2, items: items() };
    for (const key of ['customer_name','customer_phone','customer_email','fulfillment_type','delivery_option','delivery_address','pickup_time','payment_method','customer_notes','preparation_timing','requested_preparation_at']) p[key] = old[key] ?? null;
    return p;
  }
  function semantic(p) {
    const out = { ...p, items: normalizeItems(p.items) };
    delete out.submission_key; delete out.review_fingerprint;
    for (const k of ['customer_name','customer_phone','customer_email','delivery_address','pickup_time','customer_notes']) out[k] = trim(out[k]);
    const phone = out.customer_phone;
    if (/^09\d{9}$/.test(phone)) out.customer_phone = '+63' + phone.slice(1);
    else if (/^639\d{9}$/.test(phone)) out.customer_phone = '+' + phone;
    if (out.fulfillment_type !== 'delivery') { out.delivery_address = null; out.delivery_option = null; }
    if (out.fulfillment_type === 'dine_in') out.pickup_time = null;
    if (out.requested_preparation_at) out.requested_preparation_at = new Date(out.requested_preparation_at).toISOString();
    return JSON.stringify(out);
  }
  function validQuote(q, requestedItems) {
    if (!q || q.pricing_contract_version !== 2 || q.pricing_fingerprint_version !== 1 || q.currency !== 'PHP'
      || typeof q.pricing_policy_version !== 'string' || !/^[a-f0-9]{64}$/.test(q.review_fingerprint)
      || !/^\d+\.\d{2}$/.test(q.subtotal) || !Array.isArray(q.items) || !q.items.length) return false;
    try {
      if (JSON.stringify(normalizeItems(q.items)) !== JSON.stringify(normalizeItems(requestedItems))) return false;
      return q.items.every(i => ['unit_price','line_total','base_price','option_total'].every(k => /^\d+\.\d{2}$/.test(i[k]))
        && typeof i.product_name === 'string' && typeof i.size_label === 'string' && Array.isArray(i.options)
        && i.options.every(o => typeof o.label === 'string' && /^\d+\.\d{2}$/.test(o.effective_price_delta)));
    } catch (_) { return false; }
  }
  function reviewHtml(q, p) {
    const e = escapeHtml;
    const preparation = p.preparation_timing === 'scheduled' ? new Date(p.requested_preparation_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }) : 'ASAP';
    return `<div class="authoritative-review" aria-live="polite"><p>${e(p.customer_name)} · ${e(p.fulfillment_type === 'dine_in' ? 'Dine-In' : p.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery')}</p>`
      + (p.fulfillment_type === 'dine_in' ? `<p>Preparation: ${e(preparation)} · Pay at Counter</p>` : `<p>${e(p.pickup_time)}</p>`)
      + (p.fulfillment_type === 'delivery' ? `<p>${e(p.delivery_address)}</p>` : '') + q.items.map(i =>
      `<article><strong>${e(i.quantity)}× ${e(i.product_name)}</strong><p>${e(i.category_name)} · ${e(i.size_label)}</p>`
      + i.options.map(o => `<p>${e(o.group_name)}: ${e(o.label)} (+₱${e(o.effective_price_delta)} / item)</p>`).join('')
      + (i.item_note ? `<p>Note: ${e(i.item_note)}</p>` : '') + `<p>₱${e(i.unit_price)} × ${e(i.quantity)} — ₱${e(i.line_total)}</p></article>`).join('')
      + `<p><strong>Subtotal: ₱${e(q.subtotal)}</strong></p>`
      + (p.fulfillment_type === 'delivery' ? '<p>Delivery fee and final total will be confirmed separately.</p>' : '') + '</div>';
  }
  async function quote(p) {
    const generation = ++state.generation;
    state.intentKey = JSON.stringify(p.items); state.orderKey = semantic(p);
    state.status = 'quoting'; state.quote = null; syncButton();
    setSubmitOrderStatus('Checking current prices…');
    try {
      const client = getPublicSupabaseClient(); if (!client) throw Error('network');
      const { data, error } = await rpc(client, 'quote_public_cart', { p_request: { pricing_contract_version: 2, items: p.items } });
      if (generation !== state.generation) return null;
      if (error || !data?.ok || !validQuote(data.quote, p.items)) {
        state.status = 'error'; setSubmitOrderStatus(messages[data?.error?.code] || 'Unable to check current prices. Please retry.', 'error'); return null;
      }
      state.status = 'ready'; state.quote = data.quote; state.intentKey = JSON.stringify(p.items);
      return data.quote;
    } catch (_) { if (generation === state.generation) { state.status = 'error'; setSubmitOrderStatus('Unable to check current prices. Please retry.', 'error'); } return null; }
  }
  function changed() {
    if (isOrderSubmittedLocked) return;
    let current; try { current = payload(); } catch (_) { current = null; }
    if (pending && !uncertain() && current && semantic(current) !== semantic(pending.request.payload)) {
      pending = null; recovery = false; try { write(); } catch (_) { storageCorrupt = true; }
    }
    if (state.intentKey && (!current || JSON.stringify(current.items) !== state.intentKey)) {
      state.status = 'stale'; state.quote = null; ++state.generation;
      if (state.busy) { state.refreshRequested = true; closeOrderConfirmModal(); }
      else if (!document.getElementById('orderConfirmOverlay')?.hidden && !uncertain()) { closeOrderConfirmModal(); setTimeout(submitPublicOrder, 0); }
    }
    // Meaningful order-field edits must also re-open review with the new attempt.
    if ((state.reviewing || state.status === 'quoting') && current && state.orderKey !== semantic(current)) {
      ++state.generation; state.status = 'stale'; state.refreshRequested = true; closeOrderConfirmModal();
    }
    syncButton();
  }
  function syncButton() {
    const button = document.getElementById('submitOrderBtn'); if (!button || isOrderSubmittedLocked) return;
    if (state.busy) { button.disabled = true; button.textContent = state.status === 'quoting' ? 'Checking Prices…' : state.reviewing ? 'Review Your Order' : 'Submitting…'; }
    else if (pending) { button.disabled = false; button.textContent = uncertain() ? 'Recover Previous Order' : pending.state === 'price_changed' ? 'Review Updated Order' : 'Review Order'; }
    else if (state.status === 'error' || state.status === 'stale') { button.textContent = 'Retry Price Review'; }
    else if (!button.disabled) button.textContent = 'Review Order';
  }
  async function submit() {
    if (state.busy || isOrderSubmittedLocked) return;
    if (storageCorrupt || (!pending && getStoredPublicSubmissionKey() && getStoredPublicSubmissionFailureMode() !== 'validation')) {
      setSubmitOrderStatus('A previous order needs to be checked before starting another. Use your tracking link or contact CURV; do not resend it as a new order.', 'error'); return;
    }
    if (pending?.state === 'conflict') { setSubmitOrderStatus('This request belongs to a different order. Check your tracking link or contact CURV before starting another.', 'error'); return; }
    state.busy = true; isSubmittingPublicOrder = true; syncButton();
    try {
      if (!uncertain()) {
        const useRecovery = recovery && pending;
        if (!useRecovery && !cart.length) { setSubmitOrderStatus('Please add at least one item to your order.', 'error'); return; }
        const p = useRecovery ? { ...pending.request.payload } : payload();
        delete p.submission_key; delete p.review_fingerprint;
        if (!useRecovery) {
          const validation = validatePublicOrderPayload(p); if (validation) { setSubmitOrderStatus(validation, 'error'); return; }
        }
        if (!isPublicOrderSubmitEnabled()) { setSubmitOrderStatus(WEBSITE_ORDERING_PAUSED_MESSAGE, 'error'); return; }
        if (pending && semantic(p) !== semantic(pending.request.payload)) { pending = null; write(); }
        let q = pending?.state === 'price_changed' && state.status === 'ready' && state.intentKey === JSON.stringify(p.items) ? state.quote : await quote(p);
        if (!q) return;
        state.orderKey = semantic(p); state.intentKey = JSON.stringify(p.items); state.reviewing = true; syncButton();
        const confirmed = await confirmOrderBeforeSubmit(q, p, pending?.state === 'price_changed'); state.reviewing = false;
        if (!confirmed || state.status !== 'ready') return;
        if (!useRecovery && semantic(payload()) !== state.orderKey) { state.status = 'stale'; return; }
        const key = pending?.request.payload.submission_key || generatePublicSubmissionKey();
        pending = { version: 1, state: 'ambiguous', request: { payload: { ...p, submission_key: key, review_fingerprint: q.review_fingerprint }, client_context: {} },
          subtotal: q.subtotal, remember: useRecovery ? pending.remember : document.getElementById('remember-customer-details').checked,
          details: useRecovery ? pending.details : document.getElementById('remember-customer-details').checked ? captureCustomerDetails() : null };
        recovery = false;
      }
      // Persist BEFORE network activity; inability to freeze blocks a new send.
      write();
      const frozen = JSON.parse(JSON.stringify(pending));
      const client = getPublicSupabaseClient(); if (!client) throw Error('network');
      setSubmitOrderStatus('Submitting your order…');
      const { data, error } = await rpc(client, 'submit_public_order_v2', { p_request: frozen.request });
      if (error) throw Error('network');
      if (data?.order_number && getSafeTrackingToken(data.tracking_token)) {
        // Clear before rendering; if removal fails, the same accepted request is
        // still safe to replay on reload. Never rotate it into another attempt.
        pending = null; try { write(); } catch (_) { storageCorrupt = true; }
        clearPublicSubmissionState();
        lastSubmittedPublicOrderSignature = semantic(frozen.request.payload);
        // Respect both original opt-in and any later withdrawal of consent.
        if (frozen.remember) saveCustomerDetailsAfterSuccess(frozen.details);
        handleSuccessfulPublicOrder(String(data.order_number), frozen.request.payload.fulfillment_type, frozen.subtotal, data.tracking_token);
        return;
      }
      if (data?.error?.code === 'PRICE_CHANGED' && validQuote(data.quote, frozen.request.payload.items)) {
        pending.state = 'price_changed'; state.status = 'ready'; state.quote = data.quote; state.intentKey = JSON.stringify(frozen.request.payload.items); write();
        setSubmitOrderStatus('Some item details or prices changed. Please review your updated order before continuing.', 'error');
        // Display now, but no confirmation handler can send until the next
        // explicit Review Updated Order action opens the confirm dialog.
        setOrderConfirmModal('Your order has changed', reviewHtml(data.quote, frozen.request.payload), [{ label: 'Review & Continue', onClick: () => { closeOrderConfirmModal(); submitPublicOrder(); } }]);
      } else if (messages[data?.error?.code]) {
        pending.state = 'validation'; state.status = 'error'; write();
        if (data.error.code === 'CURV_ORDERING_CLOSED') setWebsiteOrderingStatus(false);
        setSubmitOrderStatus(messages[data.error.code], 'error');
      } else if (data?.error?.code === 'ORDER_SUBMISSION_KEY_CONFLICT') {
        pending.state = 'conflict'; write(); setSubmitOrderStatus('This request belongs to a different order. Check your tracking link or contact CURV before starting another.', 'error');
      } else throw Error('uncertain');
    } catch (_) {
      if (pending) { pending.state = 'ambiguous'; try { write(); } catch (_) {} }
      setSubmitOrderStatus(pending ? 'Your order could not be confirmed. Recover the previous order before starting another. Keep this tab open.' : 'Please review your cart and try again.', 'error');
    } finally {
      state.reviewing = false; state.busy = false; isSubmittingPublicOrder = false; syncAnytimeOrderState(); syncButton();
      if (state.refreshRequested) { state.refreshRequested = false; if (!uncertain() && !isOrderSubmittedLocked) setTimeout(submitPublicOrder, 0); }
    }
  }
  window.curvCheckout = { submit, changed, syncButton, reviewHtml, items, semantic, state, hasPending: () => !!pending, storageKey };
  document.getElementById('submitOrderStatus')?.setAttribute('aria-live', 'polite');
  document.getElementById('formBody')?.addEventListener('input', changed);
  document.getElementById('formBody')?.addEventListener('change', changed);
  syncOrderBarState();
  syncButton();
})();
