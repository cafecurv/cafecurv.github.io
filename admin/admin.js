(() => {
  const yearTarget = document.getElementById('current-year');
  if (yearTarget) {
    yearTarget.textContent = new Date().getFullYear();
  }

  const dashboardDate = document.getElementById('dashboard-date');
  if (dashboardDate) {
    dashboardDate.textContent = new Date().toLocaleDateString('en-PH', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  const navToggle = document.querySelector('.nav-toggle');
  const sidebar = document.querySelector('.sidebar');
  const navLinks = document.querySelectorAll('.admin-nav-link');

  const closeMobileNav = () => {
    if (!sidebar || !navToggle) return;
    sidebar.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  };

  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      closeMobileNav();
    });
  });

  if (navToggle && sidebar) {
    navToggle.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });
  }
})();
