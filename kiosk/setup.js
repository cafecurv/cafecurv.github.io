(() => {
  'use strict';
  document.getElementById('deviceForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('setupStatus'), button = event.target.querySelector('button');
    button.disabled = true; status.textContent = 'Verifying device…';
    try {
      const client = window.curvKioskAuth.getClient();
      const result = await client.auth.signInWithPassword({ email: document.getElementById('deviceEmail').value.trim(), password: document.getElementById('devicePassword').value });
      document.getElementById('devicePassword').value = '';
      if (result.error) throw Error('signin');
      await window.curvKioskAuth.rpc('kiosk_context');
      location.replace('/menu/?kiosk=1');
    } catch (_) {
      document.getElementById('devicePassword').value = '';
      // A rejected owner/staff/unapproved sign-in must not leave its session here.
      try { await window.curvKioskAuth.getClient().auth.signOut({ scope: 'local' }); } catch (_) {}
      try { sessionStorage.removeItem('curv-kiosk-v2:device-auth'); } catch (_) {}
      status.textContent = 'Device setup is unavailable or this account is not an authorized non-staff kiosk. Ask the owner for assistance.';
    } finally { button.disabled = false; }
  });
})();
