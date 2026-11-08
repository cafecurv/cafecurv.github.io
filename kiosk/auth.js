/* Dedicated nonstaff device session. No normal website/admin auth storage. */
(() => {
  'use strict';
  if (window.curvKioskAuth) return;
  let client;
  const config = () => window.CURV_KIOSK_CONFIG;
  const rpcCategories = new Map([
    ['KIOSK_AUTH_REQUIRED', 'SESSION'],
    ['KIOSK_SESSION_REQUIRED', 'SESSION'],
    ['KIOSK_NONSTAFF_REQUIRED', 'DEVICE'],
    ['KIOSK_DEVICE_UNAVAILABLE', 'DEVICE'],
    ['KIOSK_GENERATION_CONFLICT', 'GENERATION'],
    ['KIOSK_GENERATION_CLOSED', 'GENERATION'],
    ['KIOSK_DISABLED', 'CLOSED'],
    ['KIOSK_DRAINING', 'CLOSED'],
    ['CURV_ORDERING_CLOSED', 'CLOSED'],
    ['KIOSK_ATTEMPT_REQUIRED', 'STATE'],
    ['KIOSK_KEY_CONFLICT', 'CONFLICT'],
    ['KIOSK_INPUT_INVALID', 'VALIDATION'],
    ['ORDER_CART_INVALID', 'CART'],
    ['QUANTITY_INVALID', 'CART'],
    ['PRODUCT_UNAVAILABLE', 'VALIDATION'],
    ['SIZE_INVALID', 'VALIDATION'],
    ['OPTION_INVALID', 'VALIDATION'],
    ['OPTION_REQUIRED', 'VALIDATION'],
    ['OPTION_SELECTION_INVALID', 'VALIDATION'],
    ['CONFIGURATION_INVALID', 'VALIDATION']
  ]);
  const rpcErrorCategories = new WeakMap();
  function rpcError(message, category) {
    const error = Error(message);
    rpcErrorCategories.set(error, category);
    return error;
  }
  function getClient() {
    const c = config();
    if (!c?.enabled || !c.supabaseUrl || !c.publishableKey || !window.supabase?.createClient) throw rpcError('KIOSK_SETUP_REQUIRED', 'SETUP');
    if (!client) client = window.supabase.createClient(c.supabaseUrl, c.publishableKey, { auth: {
      storage: sessionStorage, storageKey: 'curv-kiosk-v2:device-auth', persistSession: true,
      autoRefreshToken: true, detectSessionInUrl: false
    }});
    return client;
  }
  async function rpc(name, args = {}) {
    if (!/^kiosk_[a-z_]+$/.test(name) || name.startsWith('kiosk_owner_')) throw Error('KIOSK_OPERATION_DENIED');
    const c = getClient();
    const { data: session, error: authError } = await c.auth.getSession();
    if (authError || !session?.session) throw rpcError('KIOSK_AUTH_REQUIRED', 'SESSION');
    let timer;
    try {
      const result = await Promise.race([c.rpc(name, args), new Promise((_, reject) => {
        timer = setTimeout(() => reject(rpcError('KIOSK_NETWORK_UNCERTAIN', 'TIMEOUT')), 30000);
      })]);
      if (result.error) {
        const detail = result.error.details || '';
        const code = /^(KIOSK_[A-Z_]+|CURV_ORDERING_CLOSED)$/.test(detail) ? detail : 'KIOSK_REQUEST_UNCERTAIN';
        throw rpcError(code, rpcCategories.get(detail));
      }
      return result.data;
    } finally { clearTimeout(timer); }
  }
  window.curvKioskAuth = { rpc, getClient, diagnosticCategory: error => rpcErrorCategories.get(error) };
})();
