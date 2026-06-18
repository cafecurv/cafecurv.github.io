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

  const moreButton = document.querySelector('.mobile-more-button');
  const moreDrawer = document.getElementById('mobile-more-drawer');
  const moreOverlay = document.querySelector('.mobile-more-overlay');
  const moreCloseTargets = document.querySelectorAll('[data-more-close]');
  let lastFocusedElement = null;

  const openMoreDrawer = () => {
    if (!moreButton || !moreDrawer || !moreOverlay) return;
    lastFocusedElement = document.activeElement;
    moreDrawer.classList.add('is-open');
    moreOverlay.classList.add('is-open');
    moreOverlay.hidden = false;
    moreDrawer.setAttribute('aria-hidden', 'false');
    moreButton.setAttribute('aria-expanded', 'true');
    document.body.classList.add('more-drawer-open');
    const firstDrawerButton = moreDrawer.querySelector('button');
    if (firstDrawerButton) firstDrawerButton.focus();
  };

  const closeMoreDrawer = () => {
    if (!moreButton || !moreDrawer || !moreOverlay) return;
    moreDrawer.classList.remove('is-open');
    moreOverlay.classList.remove('is-open');
    moreOverlay.hidden = true;
    moreDrawer.setAttribute('aria-hidden', 'true');
    moreButton.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('more-drawer-open');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  };

  if (moreButton && moreDrawer && moreOverlay) {
    moreButton.addEventListener('click', () => {
      const isOpen = moreButton.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        closeMoreDrawer();
      } else {
        openMoreDrawer();
      }
    });

    moreCloseTargets.forEach((target) => {
      target.addEventListener('click', closeMoreDrawer);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && moreButton.getAttribute('aria-expanded') === 'true') {
        closeMoreDrawer();
      }
    });
  }

})();
