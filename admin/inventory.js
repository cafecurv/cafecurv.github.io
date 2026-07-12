(() => {
  const root = document.querySelector('[data-inventory-page]');
  if (!root) return;

  const SUPABASE_URL = 'https://tjqnmyjttqukowcehzmq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tkWA-7LTA9R5wKw7_vi_ng_YDYnS1M0';
  const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
  const STATES = {
    AUTH_LOADING: 'AUTH_LOADING',
    SIGNED_OUT: 'SIGNED_OUT',
    LOADING: 'LOADING',
    READY: 'READY',
    ERROR: 'ERROR',
  };

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
  const loadingState = document.querySelector('[data-inventory-loading]');
  const signedOutState = document.querySelector('[data-inventory-signed-out]');
  const errorState = document.querySelector('[data-inventory-error]');
  const retryButton = document.querySelector('[data-inventory-retry]');
  const statusRegion = document.querySelector('[data-inventory-status]');
  const metricValues = new Map(Array.from(document.querySelectorAll('[data-inventory-metric]'))
    .map((element) => [element.dataset.inventoryMetric, element]));
  const metricNotes = Array.from(document.querySelectorAll('[data-inventory-metric-note]'));
  const attentionState = document.querySelector('[data-attention-state]');
  const attentionTitle = attentionState ? attentionState.querySelector('h3') : null;
  const attentionSignIn = document.querySelector('[data-attention-signin]');
  const attentionLoading = document.querySelector('[data-attention-loading]');
  const attentionError = document.querySelector('[data-attention-error]');
  const attentionList = document.querySelector('[data-attention-list]');
  const tableShell = document.querySelector('[data-inventory-table-shell]');
  const listBody = document.querySelector('[data-inventory-list]');
  const resultCount = document.querySelector('[data-inventory-result-count]');
  const authForm = document.querySelector('[data-auth-form]');
  const emailInput = document.getElementById('owner-email');
  const passwordInput = document.getElementById('owner-password');
  const signInButton = document.querySelector('[data-sign-in]');
  const signOutButton = document.querySelector('[data-sign-out]');
  const ownerAccount = document.querySelector('[data-owner-account]');
  const ownerAccountToggle = document.querySelector('[data-owner-account-toggle]');
  const ownerAccountMenu = document.querySelector('[data-owner-account-menu]');
  const ownerSignedOutPanel = document.querySelector('[data-owner-signed-out]');
  const ownerSignedInPanel = document.querySelector('[data-owner-signed-in]');
  const ownerAccountLabel = document.querySelector('[data-owner-account-label]');
  const ownerAccountEmail = document.querySelector('[data-owner-account-email]');
  const ownerAccountInitials = document.querySelector('[data-owner-account-initials]');
  const addItemForm = document.querySelector('[data-add-item-form]');
  const addItemNameInput = document.querySelector('[data-add-item-name]');
  const addItemCategorySelect = document.querySelector('[data-add-item-category]');
  const addItemUnitSelect = document.querySelector('[data-add-item-unit]');
  const addItemThresholdInput = document.querySelector('[data-add-item-threshold]');
  const addItemStorageInput = document.querySelector('[data-add-item-storage]');
  const addItemTrackExpiryInput = document.querySelector('[data-add-item-track-expiry]');
  const addItemSubmitButton = document.querySelector('[data-add-item-submit]');
  const addItemStatus = document.querySelector('[data-add-item-status]');
  const addItemControls = [
    addItemNameInput,
    addItemCategorySelect,
    addItemUnitSelect,
    addItemThresholdInput,
    addItemStorageInput,
    addItemTrackExpiryInput,
    addItemSubmitButton,
  ].filter(Boolean);

  let activeDrawer = null;
  let lastFocusedElement = null;
  let client = null;
  let pageState = STATES.AUTH_LOADING;
  let isOwnerSignedIn = false;
  let signedInOwnerEmail = '';
  let loadSequence = 0;
  let activeLoadSessionKey = '';
  let searchTimer = 0;
  let inventoryItems = [];
  let categories = [];
  let units = [];
  let alerts = [];
  let filteredItems = [];
  let isCreatingItem = false;
  let summary = {
    items: 0,
    lowStock: 0,
    expiringSoon: 0,
    expiredStock: 0,
  };

  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const addItemErrorMessages = {
    INV_AUTH_REQUIRED: 'Sign in with the CURV owner account before adding items.',
    INV_ADMIN_REQUIRED: 'Only CURV owners can add inventory items.',
    INV_NAME_REQUIRED: 'Enter an item name.',
    INV_NAME_TOO_LONG: 'Item name must be 100 characters or fewer.',
    INV_DUPLICATE_ITEM_NAME: 'An inventory item with that name already exists.',
    INV_CATEGORY_REQUIRED: 'Choose a category for this item.',
    INV_CATEGORY_NOT_FOUND: 'That category is no longer available. Refresh inventory and try again.',
    INV_CATEGORY_INACTIVE: 'That category is no longer active. Choose another category.',
    INV_UNIT_REQUIRED: 'Choose a unit for this item.',
    INV_UNIT_NOT_FOUND: 'That unit is no longer available. Refresh inventory and try again.',
    INV_UNIT_INACTIVE: 'That unit is no longer active. Choose another unit.',
    INV_INVALID_THRESHOLD: 'Low-stock threshold must be zero or higher.',
    INV_THRESHOLD_SCALE: 'Low-stock threshold can use up to three decimal places.',
    INV_STORAGE_TOO_LONG: 'Storage location must be 100 characters or fewer.',
    INV_ITEM_NAME_DUPLICATES_EXIST: 'Inventory duplicate names need review before new items can be added.',
  };

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

  const DASH = '\u2014';

  const setFormDisabled = (isDisabled) => {
    if (emailInput) emailInput.disabled = isDisabled;
    if (passwordInput) passwordInput.disabled = isDisabled;
    if (signInButton) signInButton.disabled = isDisabled;
  };

  const getOwnerInitials = (email = '') => {
    const cleanedEmail = email.trim();
    if (!cleanedEmail) return 'CO';
    const namePart = cleanedEmail.split('@')[0] || cleanedEmail;
    const parts = namePart.split(/[._\-\s]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return namePart.slice(0, 2).toUpperCase();
  };

  const updateOwnerAccountUi = () => {
    if (ownerAccount) ownerAccount.classList.toggle('is-signed-in', isOwnerSignedIn);
    if (ownerSignedOutPanel) ownerSignedOutPanel.hidden = isOwnerSignedIn;
    if (ownerSignedInPanel) ownerSignedInPanel.hidden = !isOwnerSignedIn;
    if (ownerAccountLabel) ownerAccountLabel.textContent = isOwnerSignedIn ? 'Owner' : 'Owner Login';
    if (ownerAccountEmail) ownerAccountEmail.textContent = signedInOwnerEmail || 'Owner access active.';
    if (ownerAccountInitials) ownerAccountInitials.textContent = getOwnerInitials(signedInOwnerEmail);
    if (signInButton) signInButton.disabled = isOwnerSignedIn;
    if (signOutButton) signOutButton.disabled = !isOwnerSignedIn;
  };

  const setSignedInState = (isSignedIn, email = '') => {
    isOwnerSignedIn = isSignedIn;
    signedInOwnerEmail = isSignedIn ? (email || signedInOwnerEmail) : '';
    updateOwnerAccountUi();
  };

  const closeOwnerAccountMenu = () => {
    if (!ownerAccountMenu || !ownerAccountToggle) return;
    ownerAccountMenu.hidden = true;
    ownerAccountToggle.setAttribute('aria-expanded', 'false');
  };

  const openOwnerAccountMenu = () => {
    if (!ownerAccountMenu || !ownerAccountToggle) return;
    ownerAccountMenu.hidden = false;
    ownerAccountToggle.setAttribute('aria-expanded', 'true');
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

  const clearElement = (element) => {
    if (!element) return;
    while (element.firstChild) element.removeChild(element.firstChild);
  };

  const createTextElement = (tagName, className, text) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  };

  const parseNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, '').trim());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  const setAddItemStatus = (message = '') => {
    if (!addItemStatus) return;
    addItemStatus.textContent = message;
    addItemStatus.hidden = !message;
  };

  const setAddItemBusy = (isBusy) => {
    const shouldDisable = isBusy || pageState !== STATES.READY || !isOwnerSignedIn;
    addItemControls.forEach((control) => {
      control.disabled = shouldDisable;
    });
    if (addItemSubmitButton) {
      addItemSubmitButton.textContent = isBusy ? 'Adding...' : 'Add Item';
    }
  };

  const resetAddItemForm = () => {
    if (addItemForm) addItemForm.reset();
    if (addItemThresholdInput) addItemThresholdInput.value = '0';
    setAddItemStatus('');
  };

  const preserveSelectValue = (select, renderOptions) => {
    if (!select) return;
    const selectedValue = select.value || '';
    renderOptions();
    select.value = Array.from(select.options).some((option) => option.value === selectedValue)
      ? selectedValue
      : '';
  };

  const renderAddItemOptions = () => {
    preserveSelectValue(addItemCategorySelect, () => {
      while (addItemCategorySelect.options.length > 1) addItemCategorySelect.remove(1);
      categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category.id || category.name;
        option.textContent = category.name;
        addItemCategorySelect.appendChild(option);
      });
    });

    preserveSelectValue(addItemUnitSelect, () => {
      while (addItemUnitSelect.options.length > 1) addItemUnitSelect.remove(1);
      units.forEach((unit) => {
        const option = document.createElement('option');
        option.value = unit.id || unit.name;
        option.textContent = unit.abbreviation ? `${unit.name} (${unit.abbreviation})` : unit.name;
        addItemUnitSelect.appendChild(option);
      });
    });
  };

  const extractInventoryErrorCode = (error) => {
    const source = [
      error?.details,
      error?.message,
      error?.hint,
      error?.code,
    ].filter(Boolean).join(' ');
    const match = source.match(/INV_[A-Z0-9_]+/);
    return match ? match[0] : '';
  };

  const getAddItemErrorMessage = (error) => {
    const code = extractInventoryErrorCode(error);
    return addItemErrorMessages[code] || "Couldn't add this item. Check the details and try again.";
  };

  const parseRpcResponse = (data) => {
    if (!data) return {};
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (_error) {
        return {};
      }
    }
    return data;
  };

  const hasMoreThanThreeDecimals = (value) => {
    const cleaned = String(value || '').trim();
    if (!cleaned.includes('.')) return false;
    const decimalPart = cleaned.split('.')[1] || '';
    return decimalPart.replace(/0+$/, '').length > 3;
  };

  const formatQuantity = (value) => {
    const number = parseNumber(value);
    if (!Number.isFinite(number)) return '0';
    return new Intl.NumberFormat('en-PH', {
      maximumFractionDigits: 3,
    }).format(number);
  };

  const formatQuantityWithUnit = (value, unit) => {
    const unitText = unit ? ` ${unit}` : '';
    return `${formatQuantity(value)}${unitText}`;
  };

  const normalizeSearchText = (value = '') => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const parseCalendarDate = (value) => {
    if (typeof value !== 'string') return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year, month, day };
  };

  const datePartsToDayIndex = (parts) => Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);

  const getManilaTodayParts = () => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date()).reduce((result, part) => {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
        result[part.type] = Number(part.value);
      }
      return result;
    }, {});
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
    };
  };

  // Compare YYYY-MM-DD values as Philippine calendar days, avoiding UTC date parsing shifts.
  const getManilaDayOffset = (dateValue) => {
    const parts = parseCalendarDate(dateValue);
    if (!parts) return null;
    return datePartsToDayIndex(parts) - datePartsToDayIndex(getManilaTodayParts());
  };

  const isDateWithinSevenManilaDays = (dateValue) => {
    const offset = getManilaDayOffset(dateValue);
    return offset !== null && offset >= 0 && offset <= 7;
  };

  const formatFriendlyDate = (dateValue) => {
    const parts = parseCalendarDate(dateValue);
    if (!parts) return '-';
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Manila',
    }).format(date);
  };

  const buildExpiryMap = (expiryRows) => {
    const map = new Map();
    expiryRows.forEach((row) => {
      const itemId = row.item_id || '';
      if (!itemId) return;
      const current = map.get(itemId) || {
        urgentDate: '',
        expiredQuantity: 0,
      };
      if (row.expiry_status === 'urgent') {
        const expiryDate = row.expiry_date || '';
        if (expiryDate && (!current.urgentDate || expiryDate < current.urgentDate)) {
          current.urgentDate = expiryDate;
        }
      }
      if (row.expiry_status === 'expired') {
        current.expiredQuantity += parseNumber(row.quantity_remaining);
      }
      map.set(itemId, current);
    });
    return map;
  };

  const normalizeInventoryItem = (row, lowStockIds, expiryMap) => {
    const itemId = row.item_id || '';
    const usableStock = parseNumber(row.usable_stock);
    const expiredStock = parseNumber(row.expired_stock);
    const currentStock = parseNumber(row.current_stock);
    const lowStockThreshold = parseNumber(row.low_stock_threshold);
    const expiryInfo = expiryMap.get(itemId) || {};
    const nearestExpiry = row.nearest_non_expired_expiry_date || expiryInfo.urgentDate || '';
    const expiringSoon = Boolean(row.track_expiry) && isDateWithinSevenManilaDays(nearestExpiry);
    const lowStock = Boolean(row.is_low_stock || lowStockIds.has(itemId));
    const outOfStock = usableStock <= 0;
    const expiredStockRecorded = expiredStock > 0;
    const inStock = !expiredStockRecorded && !outOfStock && !lowStock && !expiringSoon;
    return {
      itemId,
      itemName: row.item_name || 'Unnamed item',
      searchName: normalizeSearchText(row.item_name || ''),
      categoryId: row.category_id || '',
      categoryName: row.category_name || 'Uncategorized',
      unitAbbreviation: row.unit_abbreviation || '',
      usableStock,
      expiredStock,
      currentStock,
      lowStockThreshold,
      isLowStock: lowStock,
      nearestExpiry,
      trackExpiry: Boolean(row.track_expiry),
      storageLocation: row.storage_location || '',
      isActive: row.is_active !== false,
      isExpiringSoon: expiringSoon,
      isOutOfStock: outOfStock,
      hasExpiredStock: expiredStockRecorded,
      statusFlags: {
        'in-stock': inStock,
        'low-stock': lowStock,
        'out-of-stock': outOfStock,
        'expiring-soon': expiringSoon,
        'expired-stock': expiredStockRecorded,
      },
    };
  };

  const getStatusChips = (item) => {
    if (item.isOutOfStock && item.hasExpiredStock) return ['Out of Stock', 'Expired Stock Recorded'];
    if (item.hasExpiredStock) {
      const chips = ['Expired Stock Recorded'];
      if (item.isLowStock) chips.push('Low Stock');
      else if (item.isExpiringSoon) chips.push('Expiring Soon');
      return chips.slice(0, 2);
    }
    if (item.isOutOfStock) return ['Out of Stock'];
    if (item.isLowStock) {
      const chips = ['Low Stock'];
      if (item.isExpiringSoon) chips.push('Expiring Soon');
      return chips;
    }
    if (item.isExpiringSoon) return ['Expiring Soon'];
    return ['In Stock'];
  };

  const getPrimaryAlert = (item) => {
    if (item.isOutOfStock && item.hasExpiredStock) {
      return {
        priority: 1,
        label: 'Out of Stock',
        action: 'receive-stock',
        actionLabel: 'Receive Stock',
        detail: `${formatQuantityWithUnit(item.expiredStock, item.unitAbbreviation)} expired - also out of stock`,
      };
    }
    if (item.hasExpiredStock) {
      const extra = item.isLowStock ? ' - also low stock' : '';
      return {
        priority: 2,
        label: 'Expired Stock Recorded',
        action: 'record-waste',
        actionLabel: 'Record Waste',
        detail: `${formatQuantityWithUnit(item.expiredStock, item.unitAbbreviation)} expired${extra}`,
      };
    }
    if (item.isOutOfStock) {
      return {
        priority: 3,
        label: 'Out of Stock',
        action: 'receive-stock',
        actionLabel: 'Receive Stock',
        detail: 'out of stock',
      };
    }
    if (item.isLowStock) {
      const extra = item.isExpiringSoon ? ` - expires ${formatFriendlyDate(item.nearestExpiry)}` : '';
      return {
        priority: 4,
        label: 'Low Stock',
        action: 'receive-stock',
        actionLabel: 'Receive Stock',
        detail: `${formatQuantityWithUnit(item.usableStock, item.unitAbbreviation)} remaining - low stock${extra}`,
      };
    }
    if (item.isExpiringSoon) {
      return {
        priority: 5,
        label: 'Expiring Soon',
        action: '',
        actionLabel: '',
        detail: `expires ${formatFriendlyDate(item.nearestExpiry)}`,
      };
    }
    return null;
  };

  const computeAlerts = (items) => items
    .map((item) => {
      const alert = getPrimaryAlert(item);
      return alert ? { ...alert, item } : null;
    })
    .filter(Boolean)
    .sort((first, second) => first.priority - second.priority || first.item.itemName.localeCompare(second.item.itemName));

  const computeSummary = (items) => ({
    items: items.length,
    lowStock: items.filter((item) => item.isLowStock).length,
    expiringSoon: items.filter((item) => item.isExpiringSoon).length,
    expiredStock: items.filter((item) => item.hasExpiredStock).length,
  });

  const setMetricValue = (key, value) => {
    const element = metricValues.get(key);
    if (element) element.textContent = value;
  };

  const renderMetrics = () => {
    if (pageState === STATES.READY) {
      setMetricValue('items', String(summary.items));
      setMetricValue('low-stock', String(summary.lowStock));
      setMetricValue('expiring-soon', String(summary.expiringSoon));
      setMetricValue('expired-stock', String(summary.expiredStock));
      metricNotes.forEach((note) => {
        note.textContent = 'Live read-only inventory';
      });
      return;
    }

    const loadingText = pageState === STATES.LOADING ? '...' : DASH;
    setMetricValue('items', loadingText);
    setMetricValue('low-stock', loadingText);
    setMetricValue('expiring-soon', loadingText);
    setMetricValue('expired-stock', loadingText);
    metricNotes.forEach((note) => {
      if (pageState === STATES.LOADING) note.textContent = 'Loading inventory';
      else if (pageState === STATES.ERROR) note.textContent = 'Unavailable';
      else note.textContent = 'Waiting for owner sign-in';
    });
  };

  const renderCategoryOptions = () => {
    if (categoryFilter) {
      const selectedValue = categoryFilter.value || 'all';
      while (categoryFilter.options.length > 1) categoryFilter.remove(1);
      categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category.id || category.name;
        option.textContent = category.name;
        categoryFilter.appendChild(option);
      });
      categoryFilter.value = Array.from(categoryFilter.options).some((option) => option.value === selectedValue)
        ? selectedValue
        : 'all';
    }
    renderAddItemOptions();
  };

  const renderStatusChips = (container, item) => {
    getStatusChips(item).slice(0, 2).forEach((label) => {
      const chip = createTextElement('span', 'inventory-status-chip', label);
      chip.dataset.status = label.toLowerCase().replace(/\s+/g, '-');
      container.appendChild(chip);
    });
  };

  const createActionButton = (label, drawerName) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inventory-row-action';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (drawerName) openDrawer(drawerName, button);
    });
    return button;
  };

  const renderInventoryRows = (items) => {
    clearElement(listBody);
    items.forEach((item) => {
      const row = document.createElement('tr');

      const itemCell = document.createElement('td');
      itemCell.dataset.label = 'Item';
      itemCell.appendChild(createTextElement('strong', 'inventory-item-name', item.itemName));
      itemCell.appendChild(createTextElement('span', 'inventory-item-meta', item.categoryName));
      row.appendChild(itemCell);

      const stockCell = document.createElement('td');
      stockCell.dataset.label = 'Usable Stock';
      stockCell.appendChild(createTextElement('span', 'inventory-quantity', formatQuantityWithUnit(item.usableStock, item.unitAbbreviation)));
      if (item.hasExpiredStock) {
        stockCell.appendChild(createTextElement('span', 'inventory-expired-note', `Expired: ${formatQuantityWithUnit(item.expiredStock, item.unitAbbreviation)} - record as waste`));
      }
      row.appendChild(stockCell);

      const statusCell = document.createElement('td');
      statusCell.dataset.label = 'Status';
      const chipWrap = document.createElement('div');
      chipWrap.className = 'inventory-status-chip-row';
      renderStatusChips(chipWrap, item);
      statusCell.appendChild(chipWrap);
      row.appendChild(statusCell);

      const expiryCell = document.createElement('td');
      expiryCell.dataset.label = 'Next Expiry';
      expiryCell.textContent = item.trackExpiry && item.nearestExpiry ? formatFriendlyDate(item.nearestExpiry) : '-';
      row.appendChild(expiryCell);

      const storageCell = document.createElement('td');
      storageCell.dataset.label = 'Storage';
      storageCell.textContent = item.storageLocation || '-';
      row.appendChild(storageCell);

      const actionCell = document.createElement('td');
      actionCell.dataset.label = 'Actions';
      const actionWrap = document.createElement('div');
      actionWrap.className = 'inventory-row-actions';
      actionWrap.appendChild(createActionButton('Receive', 'receive-stock'));
      actionCell.appendChild(actionWrap);
      row.appendChild(actionCell);

      listBody.appendChild(row);
    });
  };

  const renderAttention = () => {
    clearElement(attentionList);
    if (attentionSignIn) attentionSignIn.hidden = true;
    if (attentionLoading) attentionLoading.hidden = true;
    if (attentionError) attentionError.hidden = true;

    if (pageState === STATES.READY && alerts.length) {
      if (attentionState) attentionState.hidden = true;
      if (attentionList) attentionList.hidden = false;
      alerts.forEach((alert) => {
        const row = document.createElement('div');
        row.className = 'inventory-alert-row';
        const copy = document.createElement('div');
        copy.appendChild(createTextElement('strong', 'inventory-alert-title', `${alert.item.itemName} - ${alert.label}`));
        copy.appendChild(createTextElement('p', 'inventory-alert-detail', alert.detail));
        row.appendChild(copy);
        if (alert.action) {
          const button = createActionButton(`${alert.actionLabel} ->`, alert.action);
          button.classList.add('inventory-alert-action');
          row.appendChild(button);
        }
        attentionList.appendChild(row);
      });
      return;
    }

    if (attentionState) attentionState.hidden = false;
    if (attentionList) attentionList.hidden = true;
    if (attentionTitle) {
      if (pageState === STATES.SIGNED_OUT) attentionTitle.textContent = 'Sign in to view stock alerts.';
      else if (pageState === STATES.LOADING || pageState === STATES.AUTH_LOADING) attentionTitle.textContent = 'Checking for items that need attention...';
      else if (pageState === STATES.ERROR) attentionTitle.textContent = "Couldn't load alerts.";
      else attentionTitle.textContent = 'Nothing needs attention right now.';
    }
  };

  const getFilters = () => ({
    search: searchInput ? normalizeSearchText(searchInput.value) : '',
    category: categoryFilter ? categoryFilter.value : 'all',
    status: statusFilter ? statusFilter.value : 'all',
  });

  const applyFilters = () => {
    const filters = getFilters();
    filteredItems = inventoryItems.filter((item) => itemMatchesFilters(item, filters));
  };

  const itemMatchesFilters = (item, filters) => {
    const searchMatch = !filters.search || item.searchName.includes(filters.search);
    const categoryMatch = filters.category === 'all'
      || item.categoryId === filters.category
      || item.categoryName === filters.category;
    const statusMatch = filters.status === 'all' || Boolean(item.statusFlags[filters.status]);
    return searchMatch && categoryMatch && statusMatch;
  };

  const revealCreatedItem = (itemId) => {
    if (!itemId) return;
    const item = inventoryItems.find((entry) => entry.itemId === itemId);
    if (!item || itemMatchesFilters(item, getFilters())) return;
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = 'all';
    if (statusFilter) statusFilter.value = 'all';
    applyFilters();
    renderInventoryRows(filteredItems);
    updateListState();
  };

  const validateAddItemForm = () => {
    const name = addItemNameInput ? addItemNameInput.value.trim() : '';
    if (!name) {
      setAddItemStatus('Enter an item name.');
      addItemNameInput?.focus();
      return null;
    }
    if (name.length > 100) {
      setAddItemStatus('Item name must be 100 characters or fewer.');
      addItemNameInput?.focus();
      return null;
    }

    const categoryId = addItemCategorySelect ? addItemCategorySelect.value : '';
    if (!categoryId) {
      setAddItemStatus('Choose a category for this item.');
      addItemCategorySelect?.focus();
      return null;
    }

    const unitId = addItemUnitSelect ? addItemUnitSelect.value : '';
    if (!unitId) {
      setAddItemStatus('Choose a unit for this item.');
      addItemUnitSelect?.focus();
      return null;
    }

    const thresholdRaw = addItemThresholdInput ? addItemThresholdInput.value.trim() : '';
    const threshold = thresholdRaw ? Number(thresholdRaw) : 0;
    if (!Number.isFinite(threshold) || threshold < 0) {
      setAddItemStatus('Low-stock threshold must be zero or higher.');
      addItemThresholdInput?.focus();
      return null;
    }
    if (hasMoreThanThreeDecimals(thresholdRaw)) {
      setAddItemStatus('Low-stock threshold can use up to three decimal places.');
      addItemThresholdInput?.focus();
      return null;
    }

    const storageLocation = addItemStorageInput ? addItemStorageInput.value.trim() : '';
    if (storageLocation.length > 100) {
      setAddItemStatus('Storage location must be 100 characters or fewer.');
      addItemStorageInput?.focus();
      return null;
    }

    return {
      p_name: name,
      p_category_id: categoryId,
      p_unit_id: unitId,
      p_low_stock_threshold: threshold,
      p_track_expiry: Boolean(addItemTrackExpiryInput?.checked),
      p_storage_location: storageLocation || null,
    };
  };

  const updateListState = () => {
    const filters = getFilters();
    const searchActive = Boolean(filters.search);
    const categoryActive = filters.category !== 'all';
    const statusActive = filters.status !== 'all';
    const filtersActive = searchActive || categoryActive || statusActive;
    const shouldShowTable = pageState === STATES.READY && filteredItems.length > 0;
    const emptyFiltered = pageState === STATES.READY && inventoryItems.length > 0 && filteredItems.length === 0;
    const noItems = pageState === STATES.READY && inventoryItems.length === 0;
    const visibleState = pageState === STATES.AUTH_LOADING || pageState === STATES.LOADING
      ? 'loading'
      : pageState === STATES.SIGNED_OUT
        ? 'signed-out'
        : pageState === STATES.ERROR
          ? 'error'
          : shouldShowTable
            ? 'items'
            : emptyFiltered && searchActive
              ? 'search'
              : emptyFiltered && categoryActive
                ? 'category'
                : emptyFiltered && statusActive
                  ? 'status'
                  : noItems
                    ? 'empty'
                    : 'items';

    if (clearFiltersButton) clearFiltersButton.hidden = pageState !== STATES.READY || !filtersActive;
    if (tableShell) tableShell.hidden = !shouldShowTable;
    if (loadingState) loadingState.hidden = visibleState !== 'loading';
    if (signedOutState) signedOutState.hidden = visibleState !== 'signed-out';
    if (errorState) errorState.hidden = visibleState !== 'error';
    if (emptyState) emptyState.hidden = visibleState !== 'empty';
    if (noSearchState) noSearchState.hidden = visibleState !== 'search';
    if (noCategoryState) noCategoryState.hidden = visibleState !== 'category';
    if (noStatusState) noStatusState.hidden = visibleState !== 'status';

    if (resultCount) {
      if (shouldShowTable) {
        resultCount.hidden = false;
        resultCount.textContent = filtersActive
          ? `Showing ${filteredItems.length} of ${inventoryItems.length} items`
          : `${inventoryItems.length} items`;
      } else {
        resultCount.hidden = true;
        resultCount.textContent = '';
      }
    }
  };

  const renderInventory = () => {
    renderMetrics();
    renderAttention();
    if (pageState === STATES.READY) {
      renderCategoryOptions();
      applyFilters();
      renderInventoryRows(filteredItems);
    } else {
      renderCategoryOptions();
      clearElement(listBody);
      filteredItems = [];
    }
    setAddItemBusy(isCreatingItem);
    updateListState();
  };

  const setPageState = (nextState) => {
    pageState = nextState;
    if (nextState === STATES.AUTH_LOADING) setStatus('Loading...');
    else if (nextState === STATES.SIGNED_OUT) setStatus('Sign in to view inventory.');
    else if (nextState === STATES.LOADING) setStatus('Loading inventory...');
    else if (nextState === STATES.ERROR) setStatus("Couldn't load inventory.");
    else setStatus('');
    renderInventory();
  };

  const clearInventoryState = () => {
    inventoryItems = [];
    categories = [];
    units = [];
    alerts = [];
    filteredItems = [];
    summary = {
      items: 0,
      lowStock: 0,
      expiringSoon: 0,
      expiredStock: 0,
    };
    if (categoryFilter) categoryFilter.value = 'all';
    if (statusFilter) statusFilter.value = 'all';
    if (searchInput) searchInput.value = '';
  };

  const loadInventoryData = async () => {
    if (!client || !isOwnerSignedIn) return;
    const sessionKey = signedInOwnerEmail || 'owner';
    if (pageState === STATES.LOADING && activeLoadSessionKey === sessionKey) return;
    activeLoadSessionKey = sessionKey;
    const sequence = loadSequence + 1;
    loadSequence = sequence;
    setPageState(STATES.LOADING);
    try {
      const [
        stockResult,
        categoryResult,
        unitResult,
        lowStockResult,
        expiryResult,
      ] = await Promise.all([
        client
          .from('inventory_stock_summary')
          .select('item_id,item_name,category_id,category_name,unit_abbreviation,usable_stock,expired_stock,current_stock,low_stock_threshold,is_low_stock,nearest_non_expired_expiry_date,track_expiry,storage_location,is_active')
          .order('item_name', { ascending: true }),
        client
          .from('inventory_categories')
          .select('id,name,sort_order,is_active')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
        client
          .from('inventory_units')
          .select('id,name,abbreviation,sort_order,is_active')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
        client
          .from('inventory_low_stock')
          .select('item_id,item_name'),
        client
          .from('inventory_expiry_watch')
          .select('item_id,item_name,expiry_date,expiry_status,quantity_remaining,unit_abbreviation')
          .in('expiry_status', ['expired', 'urgent'])
          .order('expiry_date', { ascending: true }),
      ]);

      const failedResult = [stockResult, categoryResult, unitResult, lowStockResult, expiryResult].find((result) => result.error);
      if (failedResult) throw failedResult.error;
      if (sequence !== loadSequence || !isOwnerSignedIn) return;

      const lowStockIds = new Set((lowStockResult.data || []).map((row) => row.item_id).filter(Boolean));
      const expiryMap = buildExpiryMap(expiryResult.data || []);
      inventoryItems = (stockResult.data || [])
        .filter((row) => row.is_active !== false)
        .map((row) => normalizeInventoryItem(row, lowStockIds, expiryMap));
      categories = (categoryResult.data || [])
        .filter((category) => category.is_active !== false)
        .map((category) => ({
          id: category.id || '',
          name: category.name || 'Uncategorized',
        }));
      units = (unitResult.data || [])
        .filter((unit) => unit.is_active !== false)
        .map((unit) => ({
          id: unit.id || '',
          name: unit.name || 'Unit',
          abbreviation: unit.abbreviation || '',
        }));
      summary = computeSummary(inventoryItems);
      alerts = computeAlerts(inventoryItems);
      setPageState(STATES.READY);
    } catch (error) {
      console.error('Inventory read failed:', error);
      if (sequence !== loadSequence) return;
      try {
        const { data } = await client.auth.getSession();
        const user = data && data.session && data.session.user;
        if (!user) {
          clearInventoryState();
          setSignedInState(false);
          setPageState(STATES.SIGNED_OUT);
          return;
        }
      } catch (sessionError) {
        console.error('Inventory session check failed:', sessionError);
      }
      setPageState(STATES.ERROR);
    } finally {
      if (sequence === loadSequence) activeLoadSessionKey = '';
    }
  };

  const handleAuthState = (isSignedIn, email = '') => {
    setSignedInState(isSignedIn, email);
    if (!isSignedIn) {
      loadSequence += 1;
      activeLoadSessionKey = '';
      clearInventoryState();
      setPageState(STATES.SIGNED_OUT);
      return;
    }
    loadInventoryData();
  };

  const refreshSession = async () => {
    if (!client) {
      setPageState(STATES.ERROR);
      return;
    }
    setPageState(STATES.AUTH_LOADING);
    try {
      const { data } = await client.auth.getSession();
      const user = data && data.session && data.session.user;
      handleAuthState(Boolean(user), user ? user.email : '');
    } catch (error) {
      console.error('Inventory auth check failed:', error);
      setPageState(STATES.ERROR);
    }
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
    if (event.key === 'Escape' && ownerAccountMenu && !ownerAccountMenu.hidden) {
      closeOwnerAccountMenu();
      ownerAccountToggle?.focus();
      return;
    }
    trapFocus(event);
  });

  document.addEventListener('click', (event) => {
    if (!ownerAccount || !ownerAccountMenu || ownerAccountMenu.hidden) return;
    if (!ownerAccount.contains(event.target)) closeOwnerAccountMenu();
  });

  ownerAccountToggle?.addEventListener('click', () => {
    if (!ownerAccountMenu || !ownerAccountToggle) return;
    if (ownerAccountMenu.hidden) openOwnerAccountMenu();
    else closeOwnerAccountMenu();
  });

  authForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || !emailInput || !passwordInput) return;
    setFormDisabled(true);
    try {
      const { error } = await client.auth.signInWithPassword({
        email: emailInput.value.trim(),
        password: passwordInput.value,
      });
      if (error) throw error;
      passwordInput.value = '';
      closeOwnerAccountMenu();
    } catch (error) {
      console.error('Inventory sign in failed:', error);
      setStatus('Sign in failed. Check the owner email and password.');
    } finally {
      setFormDisabled(false);
      updateOwnerAccountUi();
    }
  });

  addItemForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isCreatingItem) return;
    if (!client || pageState !== STATES.READY || !isOwnerSignedIn) {
      setAddItemStatus('Sign in with the CURV owner account before adding items.');
      return;
    }

    const payload = validateAddItemForm();
    if (!payload) return;

    isCreatingItem = true;
    setAddItemStatus('Adding item...');
    setAddItemBusy(true);
    try {
      const { data, error } = await client.rpc('inventory_create_item', payload);
      if (error) throw error;
      const response = parseRpcResponse(data);
      resetAddItemForm();
      closeDrawer();
      await loadInventoryData();
      revealCreatedItem(response.item_id || '');
      setStatus('Inventory item added.');
    } catch (error) {
      console.error('Inventory item creation failed:', error);
      setAddItemStatus(getAddItemErrorMessage(error));
    } finally {
      isCreatingItem = false;
      setAddItemBusy(false);
    }
  });

  signOutButton?.addEventListener('click', async () => {
    if (!client) return;
    signOutButton.disabled = true;
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      closeOwnerAccountMenu();
    } catch (error) {
      console.error('Inventory sign out failed:', error);
      setStatus('Sign out failed. Try again.');
    } finally {
      updateOwnerAccountUi();
    }
  });

  searchInput?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      if (pageState !== STATES.READY) return;
      applyFilters();
      renderInventoryRows(filteredItems);
      updateListState();
    }, 250);
  });

  [categoryFilter, statusFilter].forEach((control) => {
    control?.addEventListener('change', () => {
      if (pageState !== STATES.READY) return;
      applyFilters();
      renderInventoryRows(filteredItems);
      updateListState();
    });
  });

  clearFiltersButton?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = 'all';
    if (statusFilter) statusFilter.value = 'all';
    applyFilters();
    renderInventoryRows(filteredItems);
    updateListState();
  });

  retryButton?.addEventListener('click', () => {
    loadInventoryData();
  });

  setInventoryNavActive();
  setPageState(STATES.AUTH_LOADING);

  if (!hasSupabaseConfig || !window.supabase || typeof window.supabase.createClient !== 'function') {
    setPageState(STATES.ERROR);
    setFormDisabled(true);
    if (signOutButton) signOutButton.disabled = true;
    return;
  }

  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  // This client-side session check is a UX gate only; database RLS remains the actual security control.
  client.auth.onAuthStateChange((_event, session) => {
    const user = session && session.user;
    handleAuthState(Boolean(user), user ? user.email : '');
  });
  refreshSession();
})();
