/* Dedicated nonstaff device session. No normal website/admin auth storage. */
(() => {
  'use strict';
  if (window.curvKioskAuth) return;
  let client;
  const config = () => window.CURV_KIOSK_CONFIG;
  function getClient() {
    const c = config();
    if (!c?.enabled || !c.supabaseUrl || !c.publishableKey || !window.supabase?.createClient) throw Error('KIOSK_SETUP_REQUIRED');
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
    if (authError || !session?.session) throw Error('KIOSK_AUTH_REQUIRED');
    let timer;
    try {
      const result = await Promise.race([c.rpc(name, args), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('KIOSK_NETWORK_UNCERTAIN')), 30000);
      })]);
      if (result.error) {
        const code = /^(KIOSK_[A-Z_]+|CURV_ORDERING_CLOSED)$/.test(result.error.details || '') ? result.error.details : 'KIOSK_REQUEST_UNCERTAIN';
        throw Error(code);
      }
      return result.data;
    } finally { clearTimeout(timer); }
  }
  window.curvKioskAuth = { rpc, getClient };
})();
