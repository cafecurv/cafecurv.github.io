(() => {
  const root = document.querySelector('[data-inventory-page]');
  if (!root) return;

  const inventoryItems = [];
  const drawerLayer = document.querySelector('[data-inventory-drawer-layer]');
  const backdrop = document.querySelector('[data-inventory-drawer-backdrop]');
  const drawers = Array.from(document.querySelectorAll('[data-inventory-drawer]'));
  const openButtons = Array.from(document.querySelectorAll('[data-inventory-drawer-open]'));
  const closeButtons = Array.from(document.querySelectorAll('[data-inventory-drawer-close]'));
  const searchInput = document.querySelector('[data-inventory-search]');
  const categoryFilter = document.querySelector('[data-inventory-category-filter]');
  const statusFilter = document.querySelector('[data-inventory-status-filter]');
  const clearFiltersButton = document.querySelector('[data-inventory-clear-filters]');
  const emptyState = document.querySelector('[data-inventory-empty-state]');
  const noSearchState = document.querySelector('[data-inventory-no-search]');
  const noCategoryState = document.querySelector('[data-inventory-no-category]');
  const noStatusState = document.querySelector('[data-inventory-no-status]');
  const errorState = document.querySelector('[data-inventory-error]');
  const statusRegion = document.querySelector('[data-inventory-status]');
  let activeDrawer = null;
  let lastFocusedElement = null;

  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const setInventoryNavActive = () => {
    document.querySelectorAll('[data-nav-item]').forEach((item) => {
      const isInventory = item.dataset.navItem === 'inventory';
      item.classList.toggle('is-active', isInventory);
      if (isInventory) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    });

    document.querySelectorAll('.mobile-more-item').forEach((item) => {
      const isInventory = item.getAttribute('href') === 'inventory.html';
      item.classList.toggle('is-active', isInventory);
      if (isInventory) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    });
  };

  const setStatus = (message = '') => {
    if (!statusRegion) return;
    statusRegion.textContent = message;
    statusRegion.hidden = !message;
  };

  const getFocusable = (drawer) => Array.from(drawer.querySelectorAll(focusableSelector))
    .filter((element) => element.offsetParent !== null || element === document.activeElement);

  const openDrawer = (drawerName, trigger) => {
    const drawer = drawers.find((item) => item.dataset.inventoryDrawer === drawerName);
    if (!drawer || !drawerLayer || !backdrop) return;
    lastFocusedElement = trigger || document.activeElement;
    activeDrawer = drawer;
    drawers.forEach((item) => {
      item.hidden = item !== drawer;
    });
    drawerLayer.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      drawerLayer.classList.add('is-open');
      backdrop.classList.add('is-open');
    });
    document.body.classList.add('inventory-drawer-open');
    const firstFocusable = getFocusable(drawer)[0];
    if (firstFocusable) firstFocusable.focus();
    setStatus('');
  };

  const closeDrawer = () => {
    if (!activeDrawer || !drawerLayer || !backdrop) return;
    drawerLayer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('inventory-drawer-open');
    drawers.forEach((item) => {
      item.hidden = true;
    });
    drawerLayer.hidden = true;
    backdrop.hidden = true;
    activeDrawer = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  };

  const trapFocus = (event) => {
    if (!activeDrawer || event.key !== 'Tab') return;
    const focusable = getFocusable(activeDrawer);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const updateEmptyState = () => {
    const searchActive = Boolean(searchInput && searchInput.value.trim());
    const categoryActive = Boolean(categoryFilter && categoryFilter.value !== 'all');
    const statusActive = Boolean(statusFilter && statusFilter.value !== 'all');
    const filtersActive = searchActive || categoryActive || statusActive;
    const visibleState = inventoryItems.length > 0
      ? 'items'
      : searchActive
        ? 'search'
        : categoryActive
          ? 'category'
          : statusActive
            ? 'status'
            : 'empty';
    if (clearFiltersButton) clearFiltersButton.hidden = !filtersActive;
    if (errorState) errorState.hidden = true;
    if (emptyState) emptyState.hidden = visibleState !== 'empty';
    if (noSearchState) noSearchState.hidden = visibleState !== 'search';
    if (noCategoryState) noCategoryState.hidden = visibleState !== 'category';
    if (noStatusState) noStatusState.hidden = visibleState !== 'status';
  };

  openButtons.forEach((button) => {
    button.addEventListener('click', () => {
      openDrawer(button.dataset.inventoryDrawerOpen, button);
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', closeDrawer);
  });

  backdrop?.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeDrawer) {
      closeDrawer();
      return;
    }
    trapFocus(event);
  });

  [searchInput, categoryFilter, statusFilter].forEach((control) => {
    control?.addEventListener('input', updateEmptyState);
    control?.addEventListener('change', updateEmptyState);
  });

  clearFiltersButton?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = 'all';
    if (statusFilter) statusFilter.value = 'all';
    updateEmptyState();
  });

  setInventoryNavActive();
  setStatus('');
  updateEmptyState();
})();
