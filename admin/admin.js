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

  const currentAdminPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const currentNavItem = currentAdminPage === 'incoming-orders.html'
    ? 'incoming-orders'
    : currentAdminPage === 'menu-manager.html'
      ? 'menu-manager'
      : 'dashboard';

  document.querySelectorAll('[data-nav-item]').forEach((item) => {
    const isCurrent = item.dataset.navItem === currentNavItem;
    item.classList.toggle('is-active', isCurrent);
    if (isCurrent) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });
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

(() => {
  const desktopBadges = Array.from(document.querySelectorAll('[data-nav-item="incoming-orders"] .nav-badge'));
  const mobileBadges = Array.from(document.querySelectorAll('.mobile-nav-badge'));
  const badges = [...desktopBadges, ...mobileBadges];
  if (!badges.length) return;

  const SUPABASE_URL = 'https://tjqnmyjttqukowcehzmq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tkWA-7LTA9R5wKw7_vi_ng_YDYnS1M0';
  let badgeClient = null;
  let badgeRealtimeChannel = null;
  let orderToast = null;
  let orderToastTimer = null;
  const unseenOrderStorageKey = 'curvIncomingOrdersUnseen';
  let alertAudioUnlocked = false;
  let alertAudioContext = null;

  const getAdminPageName = () => (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();

  const readUnseenOrderKeys = () => {
    try {
      const stored = window.sessionStorage.getItem(unseenOrderStorageKey);
      const keys = stored ? JSON.parse(stored) : [];
      return new Set(Array.isArray(keys) ? keys.filter(Boolean) : []);
    } catch (error) {
      return new Set();
    }
  };

  let unseenOrderKeys = readUnseenOrderKeys();

  const persistUnseenOrderKeys = () => {
    try {
      window.sessionStorage.setItem(unseenOrderStorageKey, JSON.stringify(Array.from(unseenOrderKeys)));
    } catch (error) {
      // Session-only badge state is best-effort.
    }
  };

  const getOrderAlertKey = (order) => {
    if (!order) return '';
    return String(order.id || order.order_number || order.created_at || '').trim();
  };

  const setIncomingOrderBadge = (count) => {
    const safeCount = Math.max(0, Number(count || 0));
    const label = safeCount > 99 ? '99+' : String(safeCount);
    badges.forEach((badge) => {
      badge.textContent = label;
      badge.hidden = safeCount === 0;
      badge.setAttribute('aria-hidden', safeCount === 0 ? 'true' : 'false');
    });
  };

  const hideIncomingOrderBadge = () => {
    unseenOrderKeys.clear();
    persistUnseenOrderKeys();
    setIncomingOrderBadge(0);
  };

  const noteUnseenIncomingOrder = (order) => {
    const status = String(order && order.status || '').toLowerCase();
    const key = getOrderAlertKey(order);
    if (status !== 'submitted' || !key || getAdminPageName() === 'incoming-orders.html') {
      hideIncomingOrderBadge();
      return;
    }
    unseenOrderKeys.add(key);
    persistUnseenOrderKeys();
    setIncomingOrderBadge(unseenOrderKeys.size);
  };

  const unlockOrderAlertAudio = () => {
    alertAudioUnlocked = true;
  };

  document.addEventListener('pointerdown', unlockOrderAlertAudio, { once: true, passive: true });
  document.addEventListener('keydown', unlockOrderAlertAudio, { once: true });

  const playNewOrderChime = () => {
    if (!alertAudioUnlocked) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      alertAudioContext = alertAudioContext || new AudioContext();
      const context = alertAudioContext;
      if (context.state === 'suspended') context.resume().catch(() => {});

      const startAt = context.currentTime + 0.02;
      [660, 880].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startAt + index * 0.11);
        gain.gain.setValueAtTime(0.0001, startAt + index * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.055, startAt + index * 0.11 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + index * 0.11 + 0.18);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt + index * 0.11);
        oscillator.stop(startAt + index * 0.11 + 0.2);
      });
    } catch (error) {
      // Browsers can block audio; visual alerts still carry the notification.
    }
  };

  const dismissOrderToast = () => {
    if (orderToastTimer) window.clearTimeout(orderToastTimer);
    orderToastTimer = null;
    if (!orderToast) return;
    orderToast.classList.remove('is-open');
    window.setTimeout(() => {
      if (orderToast && !orderToast.classList.contains('is-open')) orderToast.hidden = true;
    }, 180);
  };

  const ensureOrderToast = () => {
    if (orderToast) return orderToast;
    orderToast = document.createElement('div');
    orderToast.className = 'admin-order-toast';
    orderToast.hidden = true;
    orderToast.setAttribute('role', 'status');
    orderToast.setAttribute('aria-live', 'polite');

    const content = document.createElement('button');
    content.type = 'button';
    content.className = 'admin-order-toast-content';
    content.addEventListener('click', () => {
      dismissOrderToast();
      if (getAdminPageName() !== 'incoming-orders.html') {
        window.location.href = 'incoming-orders.html';
      }
    });

    const title = document.createElement('span');
    title.className = 'admin-order-toast-title';
    title.dataset.orderToastTitle = '';
    title.textContent = 'New order received';

    const detail = document.createElement('span');
    detail.className = 'admin-order-toast-detail';
    detail.dataset.orderToastDetail = '';

    content.append(title, detail);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'admin-order-toast-close';
    closeButton.setAttribute('aria-label', 'Dismiss new order alert');
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      dismissOrderToast();
    });

    orderToast.append(content, closeButton);
    document.body.appendChild(orderToast);
    return orderToast;
  };

  const showNewOrderToast = (order) => {
    const status = String(order && order.status || '').toLowerCase();
    if (status !== 'submitted') return;

    const toast = ensureOrderToast();
    const title = toast.querySelector('[data-order-toast-title]');
    const detail = toast.querySelector('[data-order-toast-detail]');
    const orderNumber = order && order.order_number ? String(order.order_number) : 'New order';
    const customerName = order && order.customer_name ? String(order.customer_name).trim() : '';

    if (title) title.textContent = 'New order received';
    if (detail) detail.textContent = customerName ? 'Order ' + orderNumber + ' from ' + customerName : 'Order ' + orderNumber;

    playNewOrderChime();
    toast.hidden = false;
    window.requestAnimationFrame(() => toast.classList.add('is-open'));
    if (orderToastTimer) window.clearTimeout(orderToastTimer);
    orderToastTimer = window.setTimeout(dismissOrderToast, 8000);
  };

  const refreshIncomingOrderBadge = async () => {
    if (!badgeClient) return false;
    try {
      const { data: sessionData } = await badgeClient.auth.getSession();
      const isSignedIn = Boolean(sessionData && sessionData.session && sessionData.session.user);
      if (!isSignedIn || getAdminPageName() === 'incoming-orders.html') {
        hideIncomingOrderBadge();
        return isSignedIn;
      }
    } catch (error) {
      hideIncomingOrderBadge();
      return false;
    }
    setIncomingOrderBadge(unseenOrderKeys.size);
    return true;
  };

  const unsubscribeFromBadgeRealtime = () => {
    if (!badgeRealtimeChannel || !badgeClient) return;
    const channel = badgeRealtimeChannel;
    badgeRealtimeChannel = null;
    badgeClient.removeChannel(channel);
  };

  const subscribeToBadgeRealtime = () => {
    if (!badgeClient || badgeRealtimeChannel) return;
    badgeRealtimeChannel = badgeClient
      .channel('incoming-orders-nav-badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          const eventType = String(payload && payload.eventType || '').toUpperCase();
          if (eventType === 'INSERT') {
            noteUnseenIncomingOrder(payload.new);
            showNewOrderToast(payload.new);
          } else {
            refreshIncomingOrderBadge();
          }
        },
      )
      .subscribe();
  };

  window.curvRefreshIncomingOrderBadge = refreshIncomingOrderBadge;
  window.curvHideIncomingOrderBadge = hideIncomingOrderBadge;
  window.curvTestNewOrderToast = () => {
    showNewOrderToast({
      status: 'submitted',
      order_number: 'C-TEST',
      customer_name: 'Test Customer',
    });
  };

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    hideIncomingOrderBadge();
    return;
  }

  badgeClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  badgeClient.auth.onAuthStateChange((_event, session) => {
    if (session && session.user) {
      refreshIncomingOrderBadge();
      subscribeToBadgeRealtime();
    } else {
      unsubscribeFromBadgeRealtime();
      hideIncomingOrderBadge();
      dismissOrderToast();
    }
  });
  refreshIncomingOrderBadge().then((isSignedIn) => {
    if (isSignedIn) subscribeToBadgeRealtime();
  });
  window.addEventListener('pagehide', () => {
    unsubscribeFromBadgeRealtime();
    dismissOrderToast();
  });
})();
(() => {
  const menuManagerRoot = document.querySelector('[data-supabase-menu-manager]');
  if (!menuManagerRoot) return;

  // Use the Supabase Project URL and publishable/anon key only. Never use the service role key in browser code.
  const SUPABASE_URL = 'https://tjqnmyjttqukowcehzmq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tkWA-7LTA9R5wKw7_vi_ng_YDYnS1M0';

  const authForm = menuManagerRoot.querySelector('[data-auth-form]');
  const emailInput = document.getElementById('owner-email');
  const passwordInput = document.getElementById('owner-password');
  const signInButton = menuManagerRoot.querySelector('[data-sign-in]');
  const signOutButton = menuManagerRoot.querySelector('[data-sign-out]');
  const authStatus = menuManagerRoot.querySelector('[data-auth-status]');
  const ownerAccount = document.querySelector('[data-owner-account]');
  const ownerAccountToggle = document.querySelector('[data-owner-account-toggle]');
  const ownerAccountMenu = document.querySelector('[data-owner-account-menu]');
  const ownerSignedOutPanel = document.querySelector('[data-owner-signed-out]');
  const ownerSignedInPanel = document.querySelector('[data-owner-signed-in]');
  const ownerAccountLabel = document.querySelector('[data-owner-account-label]');
  const ownerAccountEmail = document.querySelector('[data-owner-account-email]');
  const ownerAccountInitials = document.querySelector('[data-owner-account-initials]');
  const menuManagerSubnavToggle = document.querySelector('[data-menu-manager-subnav-toggle]');
  const menuManagerSubnav = document.querySelector('[data-menu-manager-subnav]');
  const mobileMenuManagerSubnavToggle = document.querySelector('[data-mobile-menu-manager-subnav-toggle]');
  const mobileMenuManagerSubnav = document.querySelector('[data-mobile-menu-manager-subnav]');
  const categoryList = document.querySelector('[data-category-list]');
  const categoryStatus = document.querySelector('[data-category-status]');
  const productList = document.querySelector('[data-product-list]');
  const productStatus = document.querySelector('[data-product-status]');
  const productCount = document.querySelector('[data-product-count]');
  const draftForm = document.querySelector('[data-draft-product-form]');
  const draftCategorySelect = document.getElementById('draft-product-category');
  const draftSectionSelect = document.getElementById('draft-product-section');
  const inlineCategoryCreate = document.querySelector('[data-inline-category-create]');
  const inlineCategoryNameInput = document.querySelector('[data-inline-category-name]');
  const saveInlineCategoryButton = document.querySelector('[data-save-inline-category]');
  const cancelInlineCategoryButton = document.querySelector('[data-cancel-inline-category]');
  const inlineDraftSectionCreate = document.querySelector('[data-inline-draft-section-create]');
  const inlineDraftSectionNameInput = document.querySelector('[data-inline-draft-section-name]');
  const saveInlineDraftSectionButton = document.querySelector('[data-save-inline-draft-section]');
  const cancelInlineDraftSectionButton = document.querySelector('[data-cancel-inline-draft-section]');
  const inlineCategoryRename = document.querySelector('[data-inline-category-rename]');
  const inlineCategoryRenameInput = document.querySelector('[data-inline-category-rename-name]');
  const saveInlineCategoryRenameButton = document.querySelector('[data-save-inline-category-rename]');
  const cancelInlineCategoryRenameButton = document.querySelector('[data-cancel-inline-category-rename]');
  const renameSelectedCategoryButton = document.querySelector('[data-rename-selected-category]');
  const deleteSelectedCategoryButton = document.querySelector('[data-delete-selected-category]');
  const productSectionFilter = document.querySelector('[data-product-section-filter]');
  const inlineSectionCreate = document.querySelector('[data-inline-section-create]');
  const inlineSectionNameInput = document.querySelector('[data-inline-section-name]');
  const saveInlineSectionButton = document.querySelector('[data-save-inline-section]');
  const cancelInlineSectionButton = document.querySelector('[data-cancel-inline-section]');
  const inlineSectionRename = document.querySelector('[data-inline-section-rename]');
  const inlineSectionRenameInput = document.querySelector('[data-inline-section-rename-name]');
  const saveInlineSectionRenameButton = document.querySelector('[data-save-inline-section-rename]');
  const cancelInlineSectionRenameButton = document.querySelector('[data-cancel-inline-section-rename]');
  const renameSelectedSectionButton = document.querySelector('[data-rename-selected-section]');
  const deleteSelectedSectionButton = document.querySelector('[data-delete-selected-section]');
  const variantGroupSelect = document.getElementById('draft-variant-group');
  const customVariantField = document.querySelector('[data-custom-variant-field]');
  const customVariantInput = document.getElementById('draft-custom-variant-group');
  const saveCustomSoldByButton = document.querySelector('[data-save-custom-sold-by]');
  const cancelCustomSoldByButton = document.querySelector('[data-cancel-custom-sold-by]');
  const variantList = document.querySelector('[data-variant-list]');
  const addVariantButton = document.querySelector('[data-add-variant]');
  const createDraftButton = document.querySelector('[data-create-draft]');
  const editorPublishActionButton = document.querySelector('[data-editor-publish-action]');
  const undoProductChangesButton = document.querySelector('[data-undo-product-changes]');
  const cancelEditButton = document.querySelector('[data-cancel-edit]');
  const draftProductTitle = document.getElementById('draft-product-title');
  const editorPublishNote = document.querySelector('[data-editor-publish-note]');
  const productEditorViewTitle = document.querySelector('[data-product-editor-view-title]');
  const productBadgeChipList = document.querySelector('[data-product-badge-chip-list]');
  const productBadgeInput = document.querySelector('[data-product-badge-input]');
  const openProductEditorButton = document.querySelector('[data-open-product-editor]');
  const backToProductsButton = document.querySelector('[data-back-to-products]');
  const productOptionAttachmentList = document.querySelector('[data-product-option-attachments]');
  const showAttachOptionGroupButton = document.querySelector('[data-show-attach-option-group]');
  const productOptionAttachForm = document.querySelector('[data-product-option-attach-form]');
  const productOptionGroupSelect = document.getElementById('product-option-group-select');
  const saveProductOptionAttachmentButton = document.querySelector('[data-save-product-option-attachment]');
  const cancelProductOptionAttachmentButton = document.querySelector('[data-cancel-product-option-attachment]');
  const productOptionStatus = document.querySelector('[data-product-option-status]');
  const productFilterBar = document.querySelector('[data-product-filter-bar]');
  const productFilterList = document.querySelector('[data-product-filter-list]');
  const productStatusFilter = document.querySelector('[data-product-status-filter]');
  const productListSortSelect = document.querySelector('[data-product-list-sort]');
  const productSearchBar = document.querySelector('[data-product-search-bar]');
  const productSearchInput = document.querySelector('[data-product-search]');
  const clearProductSearchButton = document.querySelector('[data-clear-product-search]');
  const productBulkActions = document.querySelector('[data-product-bulk-actions]');
  const bulkPublishCount = document.querySelector('[data-bulk-publish-count]');
  const bulkPublishFilteredButton = document.querySelector('[data-bulk-publish-filtered]');
  const bulkUnpublishFilteredButton = document.querySelector('[data-bulk-unpublish-filtered]');
  const menuManagerViewTabs = Array.from(document.querySelectorAll('[data-menu-manager-view-tab]'));
  const menuManagerViewSections = Array.from(document.querySelectorAll('[data-menu-view-section]'));
  const productSubviewSections = Array.from(document.querySelectorAll('[data-product-subview]'));
  const collapsibleToggles = Array.from(document.querySelectorAll('[data-collapsible-toggle]'));
  const displayOrderCategorySelect = document.querySelector('[data-display-order-category]');
  const displayOrderSectionSelect = document.querySelector('[data-display-order-section]');
  const displayOrderList = document.querySelector('[data-display-order-list]');
  const displayOrderUnsaved = document.querySelector('[data-display-order-unsaved]');
  const displayOrderStatus = document.querySelector('[data-display-order-status]');
  const resetDisplayOrderButton = document.querySelector('[data-reset-display-order]');
  const saveDisplayOrderButton = document.querySelector('[data-save-display-order]');
  const optionGroupStatus = document.querySelector('[data-option-group-status]');
  const optionGroupList = document.querySelector('[data-option-group-list]');
  const optionGroupDetail = document.querySelector('[data-option-group-detail]');
  const optionChoiceList = document.querySelector('[data-option-choice-list]');
  const optionManagerStatus = document.querySelector('[data-option-manager-status]');
  const optionGroupForm = document.querySelector('[data-option-group-form]');
  const optionGroupFormTitle = document.querySelector('[data-option-group-form-title]');
  const saveOptionGroupButton = document.querySelector('[data-save-option-group]');
  const resetOptionGroupButton = document.querySelector('[data-reset-option-group]');
  const optionChoiceForm = document.querySelector('[data-option-choice-form]');
  const optionChoiceFormTitle = document.querySelector('[data-option-choice-form-title]');
  const saveOptionChoiceButton = document.querySelector('[data-save-option-choice]');
  const resetOptionChoiceButton = document.querySelector('[data-reset-option-choice]');
  const staticCategoryMarkup = categoryList ? categoryList.innerHTML : '';
  let latestCategories = [];
  let latestProducts = [];
  let optionGroupsList = [];
  let optionChoicesList = [];
  let latestCategorySections = [];
  let latestDraftCategorySections = [];
  let latestVisibleProducts = [];
  let selectedCategoryFilter = 'all';
  let selectedSectionFilter = 'all';
  let selectedProductStatusFilter = 'all';
  let selectedProductListSort = 'menu';
  let productSearchQuery = '';
  let productBadgeLabels = [];
  let productBadgesDisabled = true;
  let editingProductId = null;
  let draftFormBaseline = '';
  let draftFormSavedLabelActive = false;
  let editorPublishSaving = false;
  let bulkPublishSaving = false;
  let productOptionAttachments = [];
  let availableProductOptionGroups = [];
  let activeProductOptionGroupCount = 0;
  let productOptionAttachmentSaving = false;
  let productOptionDefaultSaving = false;
  let productOptionSettingsSaving = false;
  let productOptionDetachSaving = false;
  let editingProductOptionSettingsGroupId = '';
  let activeMenuManagerView = 'products';
  let activeProductSubview = 'list';
  let previousDraftCategoryValue = '';
  let previousDraftSectionValue = '';
  let previousVariantGroupValue = 'Each';
  let inlineCategorySaving = false;
  let inlineDraftSectionSaving = false;
  let inlineCategoryRenameSaving = false;
  let inlineCategoryDeleteSaving = false;
  let inlineSectionSaving = false;
  let inlineSectionRenameSaving = false;
  let inlineSectionDeleteSaving = false;
  let selectedOptionGroupId = '';
  let editingOptionGroupId = null;
  let editingOptionChoiceId = null;
  let isOwnerSignedIn = false;
  let signedInOwnerEmail = '';
  let optionGroupsLoaded = false;
  let optionGroupsLoading = false;
  let optionGroupSaving = false;
  let optionChoiceSaving = false;
  let variantRowCount = 1;
  let selectedDisplayOrderCategory = '';
  let selectedDisplayOrderSection = 'all';
  let latestDisplayOrderSections = [];
  let displayOrderOriginalProducts = [];
  let sortableProducts = [];
  let displayOrderDirty = false;
  let displayOrderSaving = false;
  let displayOrderLoadedCategory = '';
  let displayOrderLoadedSection = 'all';
  let draggedSortProductId = null;
  const DEFAULT_VARIANT_GROUPS = ['Each', 'Size', 'Pieces', 'Weight', 'Pack / Box'];
  const PRODUCT_BADGE_MAX_COUNT = 3;
  const PRODUCT_BADGE_MAX_LENGTH = 24;

  const hasSupabaseConfig = SUPABASE_URL !== 'SUPABASE_URL'
    && SUPABASE_PUBLISHABLE_KEY !== 'SUPABASE_PUBLISHABLE_KEY'
    && SUPABASE_URL.startsWith('https://')
    && SUPABASE_PUBLISHABLE_KEY.length > 20;

  const setStatus = (message) => {
    if (authStatus) authStatus.textContent = message;
  };

  const setOptionManagerStatus = (message) => {
    if (optionManagerStatus) optionManagerStatus.textContent = message;
  };

  const setFormDisabled = (isDisabled) => {
    if (emailInput) emailInput.disabled = isDisabled;
    if (passwordInput) passwordInput.disabled = isDisabled;
    if (signInButton) signInButton.disabled = isDisabled;
  };

  const getOwnerInitials = (email) => {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) return 'CO';
    const localPart = cleanEmail.split('@')[0] || cleanEmail;
    return localPart
      .split(/[._\-\s]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('') || 'CO';
  };

  const closeOwnerAccountMenu = () => {
    if (!ownerAccountMenu || !ownerAccountToggle) return;
    ownerAccountMenu.hidden = true;
    ownerAccountToggle.setAttribute('aria-expanded', 'false');
  };

  const toggleOwnerAccountMenu = () => {
    if (!ownerAccountMenu || !ownerAccountToggle) return;
    const shouldOpen = ownerAccountMenu.hidden;
    ownerAccountMenu.hidden = !shouldOpen;
    ownerAccountToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
      const firstTarget = ownerAccountMenu.querySelector('input:not(:disabled), button:not(:disabled)');
      if (firstTarget && typeof firstTarget.focus === 'function') firstTarget.focus();
    }
  };

  const updateOwnerAccountUi = () => {
    if (ownerSignedOutPanel) ownerSignedOutPanel.hidden = isOwnerSignedIn;
    if (ownerSignedInPanel) ownerSignedInPanel.hidden = !isOwnerSignedIn;
    if (ownerAccountLabel) ownerAccountLabel.textContent = isOwnerSignedIn ? 'Owner' : 'Owner Login';
    if (ownerAccountEmail) ownerAccountEmail.textContent = signedInOwnerEmail ? 'Signed in as ' + signedInOwnerEmail : 'Owner access active.';
    if (ownerAccountInitials) ownerAccountInitials.textContent = getOwnerInitials(signedInOwnerEmail);
  };

  const setSubnavExpanded = (toggle, subnav, shouldExpand) => {
    if (!toggle || !subnav) return;
    toggle.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
    subnav.hidden = !shouldExpand;
  };

  const setSignedInState = (isSignedIn, email = '') => {
    isOwnerSignedIn = isSignedIn;
    signedInOwnerEmail = isSignedIn ? (email || signedInOwnerEmail) : '';
    if (signInButton) signInButton.disabled = isSignedIn;
    if (signOutButton) signOutButton.disabled = !isSignedIn;
    if (openProductEditorButton) openProductEditorButton.disabled = !isSignedIn;
    updateOwnerAccountUi();
    updateEditorPublishAction();
    updateUndoChangesAction();
    updateBulkPublishControls();
  };

  const setCollapsibleExpanded = (toggle, shouldExpand) => {
    if (!toggle) return;
    const targetId = toggle.dataset.collapsibleTarget;
    const content = targetId ? document.getElementById(targetId) : null;
    if (!content) return;

    toggle.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
    toggle.textContent = shouldExpand
      ? (toggle.dataset.labelExpanded || toggle.textContent)
      : (toggle.dataset.labelCollapsed || toggle.textContent);
    const ariaLabel = shouldExpand
      ? toggle.dataset.ariaLabelExpanded
      : toggle.dataset.ariaLabelCollapsed;
    if (ariaLabel) {
      toggle.setAttribute('aria-label', ariaLabel);
      toggle.title = ariaLabel;
    }
    content.hidden = !shouldExpand;
  };

  const openCollapsibleById = (targetId) => {
    const toggle = collapsibleToggles.find((item) => item.dataset.collapsibleTarget === targetId);
    if (toggle) setCollapsibleExpanded(toggle, true);
  };

  const setMenuManagerView = (viewName) => {
    const nextView = viewName || 'products';
    activeMenuManagerView = nextView;

    menuManagerViewTabs.forEach((tab) => {
      const isActive = tab.dataset.menuManagerViewTab === nextView;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      if (isActive) {
        tab.setAttribute('aria-current', 'page');
      } else {
        tab.removeAttribute('aria-current');
      }
    });

    menuManagerViewSections.forEach((section) => {
      const viewNames = String(section.dataset.menuViewSection || '').split(/\s+/).filter(Boolean);
      section.hidden = !viewNames.includes(nextView);
    });

    if (nextView === 'option-library') {
      openCollapsibleById('option-groups-content');
      loadOptionGroups();
    }

    if (nextView === 'display-order') {
      openCollapsibleById('display-order-content');
    }
  };

  const setProductSubview = (subviewName) => {
    const nextSubview = subviewName || 'list';
    activeProductSubview = nextSubview;
    productSubviewSections.forEach((section) => {
      section.hidden = section.dataset.productSubview !== nextSubview;
    });
  };

  const showProductListView = () => {
    setMenuManagerView('products');
    setProductSubview('list');
  };

  const showProductEditorView = (mode = 'create') => {
    setMenuManagerView('products');
    setProductSubview('editor');
    openCollapsibleById('draft-product-content');
    if (productEditorViewTitle) {
      productEditorViewTitle.textContent = mode === 'edit' ? 'Edit Item' : 'Create Item';
    }
  };

  const openCreateProductEditor = async () => {
    resetDraftProductForm();
    populateDraftCategorySelect(latestCategories);
    await preselectDraftCategoryFromFilter();
    setDraftFormDisabled(!isOwnerSignedIn);
    showProductEditorView('create');
    setStatus(isOwnerSignedIn ? 'Create a new draft item.' : 'Sign in before creating an item.');
  };

  const getEditingProduct = () => {
    if (!editingProductId) return null;
    return latestProducts.find((item) => item.id === editingProductId) || null;
  };

  const getDraftFormSnapshot = () => {
    if (!draftForm) return '';
    const formData = new FormData(draftForm);
    const variants = getVariantRows().map((row) => ({
      label: row.querySelector('[data-variant-label]') ? row.querySelector('[data-variant-label]').value.trim() : '',
      price: row.querySelector('[data-variant-price]') ? row.querySelector('[data-variant-price]').value.trim() : '',
      cost: row.querySelector('[data-variant-cost]') ? row.querySelector('[data-variant-cost]').value.trim() : '',
    }));
    return JSON.stringify({
      name: String(formData.get('name') || '').trim(),
      category_id: String(formData.get('category_id') || '').trim(),
      category_section_id: String(formData.get('category_section_id') || '').trim(),
      image_url: String(formData.get('image_url') || '').trim(),
      variant_group: String(formData.get('variant_group') || '').trim(),
      custom_variant_group: String(formData.get('custom_variant_group') || '').trim(),
      description: String(formData.get('description') || '').trim(),
      notes: String(formData.get('notes') || '').trim(),
      is_available: formData.get('is_available') === 'on',
      is_curv_pick: formData.get('is_curv_pick') === 'on',
      is_seasonal: formData.get('is_seasonal') === 'on',
      badge_labels: productBadgeLabels.slice(),
      variants,
    });
  };

  const isDraftFormDirty = () => {
    if (!editingProductId || !draftFormBaseline) return false;
    return getDraftFormSnapshot() !== draftFormBaseline;
  };

  const updateUndoChangesAction = () => {
    if (!undoProductChangesButton) return;
    undoProductChangesButton.hidden = !editingProductId;
    undoProductChangesButton.disabled = !editingProductId || !isOwnerSignedIn || !isDraftFormDirty() || editorPublishSaving;
  };

  const markDraftFormClean = () => {
    draftFormBaseline = getDraftFormSnapshot();
    updateUndoChangesAction();
  };

  const markDraftFormDirty = () => {
    if (draftFormSavedLabelActive) {
      draftFormSavedLabelActive = false;
    }
    syncEditorSaveLabels();
  };

  const hasUnsavedDraftFormChanges = () => isDraftFormDirty();

  const normalizeProductBadgeLabel = (label) => String(label || '').trim().replace(/\s+/g, ' ');

  const renderProductBadges = () => {
    if (!productBadgeChipList) return;
    productBadgeChipList.innerHTML = '';

    productBadgeLabels.forEach((label) => {
      const chip = document.createElement('span');
      chip.className = 'product-badge-chip';

      const text = document.createElement('span');
      text.textContent = label;

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = 'Ãƒâ€”';
      removeButton.title = 'Remove ' + label + ' badge';
      removeButton.setAttribute('aria-label', 'Remove ' + label + ' badge');
      removeButton.disabled = productBadgesDisabled;
      removeButton.addEventListener('click', () => {
        productBadgeLabels = productBadgeLabels.filter((item) => item !== label);
        renderProductBadges();
        markDraftFormDirty();
      });

      chip.append(text, removeButton);
      productBadgeChipList.appendChild(chip);
    });

    if (productBadgeInput) {
      productBadgeInput.disabled = productBadgesDisabled || productBadgeLabels.length >= PRODUCT_BADGE_MAX_COUNT;
      productBadgeInput.placeholder = productBadgeLabels.length >= PRODUCT_BADGE_MAX_COUNT
        ? 'badge limit reached'
        : 'type badge here...';
    }

  };

  const setProductBadges = (labels = []) => {
    const seen = new Set();
    productBadgeLabels = (Array.isArray(labels) ? labels : [])
      .map(normalizeProductBadgeLabel)
      .filter((label) => {
        const key = label.toLowerCase();
        if (!label || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, PRODUCT_BADGE_MAX_COUNT);
    if (productBadgeInput) productBadgeInput.value = '';
    renderProductBadges();
  };

  const setProductBadgesDisabled = (isDisabled) => {
    productBadgesDisabled = isDisabled;
    renderProductBadges();
  };

  const addProductBadgeFromInput = () => {
    if (!productBadgeInput || productBadgesDisabled) return;
    const label = normalizeProductBadgeLabel(productBadgeInput.value);
    if (!label) {
      productBadgeInput.value = '';
      return;
    }
    if (label.length > PRODUCT_BADGE_MAX_LENGTH) {
      return;
    }
    if (productBadgeLabels.length >= PRODUCT_BADGE_MAX_COUNT) {
      return;
    }
    if (productBadgeLabels.some((item) => item.toLowerCase() === label.toLowerCase())) {
      productBadgeInput.value = '';
      return;
    }

    productBadgeLabels = [...productBadgeLabels, label];
    productBadgeInput.value = '';
    renderProductBadges();
    markDraftFormDirty();
  };

  const updateEditorPublishAction = () => {
    if (!editorPublishActionButton) return;
    const product = getEditingProduct();
    const isPublished = Boolean(product && product.is_published);
    editorPublishActionButton.hidden = false;
    if (!editingProductId) {
      editorPublishActionButton.textContent = 'Publish Item';
      editorPublishActionButton.disabled = !isOwnerSignedIn || editorPublishSaving;
      if (editorPublishNote) editorPublishNote.hidden = true;
      return;
    }

    editorPublishActionButton.textContent = isPublished ? 'Unpublish Item' : 'Publish Item';
    editorPublishActionButton.disabled = !isOwnerSignedIn || editorPublishSaving;
    if (editorPublishNote) editorPublishNote.hidden = !isPublished;
  };

  const syncEditorSaveLabels = () => {
    const product = getEditingProduct();
    const isPublished = Boolean(product && product.is_published);
    if (createDraftButton) {
      createDraftButton.textContent = draftFormSavedLabelActive ? 'Saved' : (isPublished ? 'Save Changes' : 'Save Draft');
      createDraftButton.disabled = !isOwnerSignedIn || draftFormSavedLabelActive;
    }
    updateEditorPublishAction();
    updateUndoChangesAction();
  };

  const returnToProductList = (message = 'Returned to product list.') => {
    resetDraftProductForm();
    populateDraftCategorySelect(latestCategories);
    setDraftFormDisabled(!isOwnerSignedIn);
    showProductListView();
    setStatus(message);
  };

  const setCreateMode = () => {
    editingProductId = null;
    draftFormBaseline = '';
    draftFormSavedLabelActive = false;
    if (productEditorViewTitle) productEditorViewTitle.textContent = 'Create Item';
    if (draftProductTitle) draftProductTitle.textContent = 'Create Item';
    if (createDraftButton) createDraftButton.textContent = 'Save Draft';
    if (cancelEditButton) {
      cancelEditButton.hidden = false;
      cancelEditButton.disabled = false;
    }
    syncEditorSaveLabels();
  };

  const setEditMode = (productId) => {
    editingProductId = productId;
    draftFormSavedLabelActive = false;
    showProductEditorView('edit');
    openCollapsibleById('draft-product-content');
    if (productEditorViewTitle) productEditorViewTitle.textContent = 'Edit Item';
    if (draftProductTitle) draftProductTitle.textContent = 'Edit Item';
    if (cancelEditButton) {
      cancelEditButton.hidden = false;
      cancelEditButton.disabled = false;
    }
    syncEditorSaveLabels();
  };

  const getVariantRows = () => variantList ? Array.from(variantList.querySelectorAll('[data-variant-row]')) : [];

  const ensureVariantGroupOption = (label) => {
    const value = String(label || '').trim();
    if (!variantGroupSelect || !value || value === '__add_custom_sold_by__') return;
    const existing = Array.from(variantGroupSelect.options).some((option) => option.value === value);
    if (existing) return;

    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    const addCustomOption = Array.from(variantGroupSelect.options).find((item) => item.value === '__add_custom_sold_by__');
    variantGroupSelect.insertBefore(option, addCustomOption || null);
  };

  const resetVariantGroupOptions = (selectedValue = 'Each') => {
    if (!variantGroupSelect) return;
    variantGroupSelect.innerHTML = '';
    DEFAULT_VARIANT_GROUPS.forEach((label) => {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      variantGroupSelect.appendChild(option);
    });
    const addCustomOption = document.createElement('option');
    addCustomOption.value = '__add_custom_sold_by__';
    addCustomOption.textContent = '+ Add custom...';
    variantGroupSelect.appendChild(addCustomOption);
    ensureVariantGroupOption(selectedValue);
    variantGroupSelect.value = selectedValue || 'Each';
    if (variantGroupSelect.value === '__add_custom_sold_by__') variantGroupSelect.value = 'Each';
    previousVariantGroupValue = variantGroupSelect.value || 'Each';
  };

  const getSelectedVariantGroup = () => {
    if (!variantGroupSelect) return 'Each';
    if (variantGroupSelect.value === '__add_custom_sold_by__') return '';
    return variantGroupSelect.value.trim();
  };

  const updateRemoveButtons = () => {
    const rows = getVariantRows();
    rows.forEach((row) => {
      const removeButton = row.querySelector('[data-remove-variant]');
      if (removeButton) removeButton.disabled = rows.length <= 1 || removeButton.dataset.locked === 'true';
    });
  };

  const setVariantRowDisabled = (row, isDisabled) => {
    row.querySelectorAll('input, button').forEach((field) => {
      field.disabled = isDisabled;
    });
  };

  const createVariantRow = ({ label = '', price = '', cost = '', touched = false } = {}) => {
    variantRowCount += 1;
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.dataset.variantRow = '';
    row.dataset.touched = touched ? 'true' : 'false';
    row.innerHTML = `
      <label class="admin-field" for="draft-variant-label-${variantRowCount}">
        <span>Variant label</span>
        <input id="draft-variant-label-${variantRowCount}" type="text" value="" data-variant-label required>
      </label>
      <label class="admin-field" for="draft-variant-price-${variantRowCount}">
        <span>Price</span>
        <input id="draft-variant-price-${variantRowCount}" type="number" min="0" step="0.01" inputmode="decimal" data-variant-price required>
      </label>
      <label class="admin-field" for="draft-variant-cost-${variantRowCount}">
        <span>Cost</span>
        <input id="draft-variant-cost-${variantRowCount}" type="number" min="0" step="0.01" inputmode="decimal" data-variant-cost>
      </label>
      <button type="button" class="variant-remove-button" data-remove-variant>Remove</button>
    `;
    row.querySelector('[data-variant-label]').value = label;
    row.querySelector('[data-variant-price]').value = price;
    row.querySelector('[data-variant-cost]').value = cost;
    return row;
  };

  const syncVariantGroupFields = () => {
    const isAddingCustom = variantGroupSelect && variantGroupSelect.value === '__add_custom_sold_by__';
    const isDisabled = !isAddingCustom || (variantGroupSelect && variantGroupSelect.disabled);
    if (customVariantField) customVariantField.hidden = !isAddingCustom;
    if (customVariantInput) customVariantInput.disabled = isDisabled;
    if (saveCustomSoldByButton) saveCustomSoldByButton.disabled = isDisabled;
    if (cancelCustomSoldByButton) cancelCustomSoldByButton.disabled = isDisabled;
  };

  const hideCustomSoldByCreate = (restorePrevious = false) => {
    if (restorePrevious && variantGroupSelect) {
      variantGroupSelect.value = previousVariantGroupValue || 'Each';
    }
    if (customVariantInput) customVariantInput.value = '';
    syncVariantGroupFields();
    if (restorePrevious) {
      if (editingProductId && !isDraftFormDirty()) {
        draftFormSavedLabelActive = true;
      }
      syncEditorSaveLabels();
    }
  };

  const addCustomSoldByLabel = () => {
    if (!variantGroupSelect || !customVariantInput) return;
    const label = customVariantInput.value.trim().replace(/\s+/g, ' ');
    if (!label) {
      setStatus('Enter a custom sold-by label.');
      return;
    }
    ensureVariantGroupOption(label);
    variantGroupSelect.value = label;
    previousVariantGroupValue = label;
    hideCustomSoldByCreate(false);
    maybeSyncDefaultVariantLabel();
    markDraftFormDirty();
    setStatus('Custom sold-by label added.');
  };

  const maybeSyncDefaultVariantLabel = () => {
    const rows = getVariantRows();
    if (rows.length !== 1) return;
    const row = rows[0];
    const labelInput = row.querySelector('[data-variant-label]');
    if (!labelInput || row.dataset.touched === 'true') return;
    const groupLabel = getSelectedVariantGroup();
    if (groupLabel) labelInput.value = groupLabel;
  };

  const bindVariantRow = (row) => {
    const labelInput = row.querySelector('[data-variant-label]');
    const removeButton = row.querySelector('[data-remove-variant]');

    if (labelInput) {
      labelInput.addEventListener('input', () => {
        row.dataset.touched = 'true';
        markDraftFormDirty();
      });
    }

    if (removeButton) {
      removeButton.addEventListener('click', () => {
        if (getVariantRows().length <= 1) return;
        row.remove();
        updateRemoveButtons();
        markDraftFormDirty();
      });
    }
  };

  const resetVariantRows = () => {
    if (!variantList) return;
    variantList.innerHTML = '';
    variantRowCount = 1;
    const row = createVariantRow({ label: 'Each', touched: false });
    const labelInput = row.querySelector('[data-variant-label]');
    labelInput.id = 'draft-variant-label-1';
    row.querySelector('label[for^="draft-variant-label-"]').setAttribute('for', 'draft-variant-label-1');
    row.querySelector('[data-variant-price]').id = 'draft-variant-price-1';
    row.querySelector('label[for^="draft-variant-price-"]').setAttribute('for', 'draft-variant-price-1');
    row.querySelector('[data-variant-cost]').id = 'draft-variant-cost-1';
    row.querySelector('label[for^="draft-variant-cost-"]').setAttribute('for', 'draft-variant-cost-1');
    variantList.appendChild(row);
    bindVariantRow(row);
    updateRemoveButtons();
  };

  const getDraftCategoryId = () => {
    const categoryId = draftCategorySelect ? draftCategorySelect.value : '';
    if (!categoryId || categoryId === '__create_category__') return '';
    return latestCategories.some((category) => category.id === categoryId) ? categoryId : '';
  };

  const syncDraftSectionSelectDisabled = () => {
    if (!draftSectionSelect) return;
    draftSectionSelect.disabled = !isOwnerSignedIn || !getDraftCategoryId() || Boolean(draftCategorySelect && draftCategorySelect.disabled);
  };

  const setDraftFormDisabled = (isDisabled) => {
    if (!draftForm) return;
    draftForm.querySelectorAll('input, select, textarea, button').forEach((field) => {
      field.disabled = isDisabled;
    });
    syncVariantGroupFields();
    syncDraftSectionSelectDisabled();
    updateRemoveButtons();
    updateCategoryActionButtons();
    setProductBadgesDisabled(isDisabled);
  };

  const renderProductOptionEmpty = (title, message) => {
    if (!productOptionAttachmentList) return;
    productOptionAttachmentList.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'product-option-empty';

    const heading = document.createElement('h4');
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = message;

    empty.append(heading, copy);
    productOptionAttachmentList.appendChild(empty);
  };

  const setProductOptionStatus = (message) => {
    if (productOptionStatus) productOptionStatus.textContent = message;
  };

  const setProductOptionAttachFormDisabled = (isDisabled) => {
    if (!productOptionAttachForm) return;
    const shouldDisable = isDisabled || productOptionAttachmentSaving;
    Array.from(productOptionAttachForm.querySelectorAll('input, select, button')).forEach((field) => {
      field.disabled = shouldDisable;
    });
    if (saveProductOptionAttachmentButton) saveProductOptionAttachmentButton.disabled = shouldDisable;
    if (cancelProductOptionAttachmentButton) cancelProductOptionAttachmentButton.disabled = shouldDisable;
  };

  const getNextProductOptionSortOrder = () => {
    if (!productOptionAttachments.length) return 0;
    return Math.max(...productOptionAttachments.map((item) => Number(item.sort_order || 0))) + 1;
  };

  const resetProductOptionAttachForm = () => {
    if (productOptionAttachForm) {
      productOptionAttachForm.hidden = true;
      if (productOptionGroupSelect) productOptionGroupSelect.value = '';
      const minInput = productOptionAttachForm.querySelector('[name="min_selections"]');
      const maxInput = productOptionAttachForm.querySelector('[name="max_selections"]');
      const sortInput = productOptionAttachForm.querySelector('[name="sort_order"]');
      const activeInput = productOptionAttachForm.querySelector('[name="is_active"]');
      const requiredInput = productOptionAttachForm.querySelector('[name="is_required"]');
      if (minInput) minInput.value = '0';
      if (maxInput) maxInput.value = '';
      if (sortInput) sortInput.value = String(getNextProductOptionSortOrder());
      if (activeInput) activeInput.checked = true;
      if (requiredInput) requiredInput.checked = false;
    }
    setProductOptionAttachFormDisabled(true);
  };

  const updateProductOptionAttachAvailability = () => {
    const isEditing = Boolean(editingProductId);
    if (showAttachOptionGroupButton) {
      showAttachOptionGroupButton.hidden = !isEditing;
      showAttachOptionGroupButton.disabled = !isEditing || productOptionAttachmentSaving;
    }
    if (!isEditing) {
      resetProductOptionAttachForm();
      setProductOptionStatus('Save the product before attaching option groups.');
    }
  };

  const renderProductOptionAttachments = (attachments = productOptionAttachments) => {
    productOptionAttachments = attachments || [];
    if (!productOptionAttachmentList) return;
    productOptionAttachmentList.innerHTML = '';
    updateProductOptionAttachAvailability();
    const canEditAttachments = Boolean(editingProductId);

    const attachedGroupIds = new Set(productOptionAttachments.map((item) => item.option_group_id).filter(Boolean));
    if (editingProductOptionSettingsGroupId && !attachedGroupIds.has(editingProductOptionSettingsGroupId)) {
      editingProductOptionSettingsGroupId = '';
    }

    if (!editingProductId) {
      renderProductOptionEmpty('Save the product before attaching option groups.', 'Existing product attachments will appear here when editing a product.');
      return;
    }

    if (!productOptionAttachments.length) {
      renderProductOptionEmpty('No option groups attached yet.', 'Use + Attach Group to add reusable options to this product.');
      return;
    }

    productOptionAttachments.forEach((attachment) => {
      const group = attachment.group || {};
      const card = document.createElement('article');
      card.className = 'product-option-card';
      card.dataset.optionGroupId = attachment.option_group_id || '';

      const top = document.createElement('div');
      top.className = 'product-option-top';
      const titleBlock = document.createElement('div');
      const name = document.createElement('h4');
      name.textContent = group.name || 'Missing option group';
      const key = document.createElement('p');
      key.className = 'product-option-key';
      key.textContent = group.group_key || 'missing_group_key';
      titleBlock.append(name, key);

      const badgeRow = document.createElement('div');
      badgeRow.className = 'product-option-badges';
      const typeBadge = document.createElement('span');
      typeBadge.className = 'option-status-pill is-type';
      typeBadge.textContent = String(group.selection_type || 'unknown').toUpperCase();
      const requiredBadge = document.createElement('span');
      requiredBadge.className = attachment.is_required ? 'option-status-pill is-active' : 'option-status-pill is-type';
      requiredBadge.textContent = attachment.is_required ? 'REQUIRED' : 'OPTIONAL';
      const activeBadge = document.createElement('span');
      activeBadge.className = attachment.is_active ? 'option-status-pill is-active' : 'option-status-pill is-inactive';
      activeBadge.textContent = attachment.is_active ? 'ASSIGNMENT ACTIVE' : 'ASSIGNMENT INACTIVE';
      badgeRow.append(typeBadge, requiredBadge, activeBadge);
      top.append(titleBlock, badgeRow);

      const meta = document.createElement('dl');
      meta.className = 'product-option-meta';
      const addMeta = (label, value) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        meta.append(term, description);
      };
      addMeta('Min selections', String(attachment.min_selections ?? 0));
      addMeta('Max selections', attachment.max_selections === null || attachment.max_selections === undefined ? 'Unlimited' : String(attachment.max_selections));
      addMeta('Sort order', String(attachment.sort_order ?? 0));

      const defaultText = attachment.defaults.length
        ? attachment.defaults.map((item) => item.choice && item.choice.is_active ? item.choice.label : 'Default choice inactive or missing').join(', ')
        : '-';
      addMeta('Default', defaultText);

      if (group.is_active === false || attachment.defaults.some((item) => !item.choice || !item.choice.is_active)) {
        const warning = document.createElement('p');
        warning.className = 'product-option-warning';
        warning.textContent = group.is_active === false ? 'Option group inactive' : 'Default choice inactive or missing';
        card.append(top, meta, warning);
      } else {
        card.append(top, meta);
      }

      const cardActions = document.createElement('div');
      cardActions.className = 'product-option-card-actions';
      const editSettingsButton = document.createElement('button');
      editSettingsButton.type = 'button';
      editSettingsButton.className = 'auth-button auth-button-secondary product-option-settings-toggle';
      editSettingsButton.textContent = editingProductOptionSettingsGroupId === attachment.option_group_id ? 'Editing Settings' : 'Edit Settings';
      editSettingsButton.disabled = !canEditAttachments || productOptionSettingsSaving || productOptionDetachSaving;
      editSettingsButton.addEventListener('click', () => {
        editingProductOptionSettingsGroupId = attachment.option_group_id;
        renderProductOptionAttachments(productOptionAttachments);
        setProductOptionStatus('Editing option group settings.');
      });

      const detachButton = document.createElement('button');
      detachButton.type = 'button';
      detachButton.className = 'auth-button auth-button-secondary product-option-detach-button';
      detachButton.textContent = 'Detach';
      detachButton.disabled = !canEditAttachments || productOptionDetachSaving || productOptionSettingsSaving;
      detachButton.addEventListener('click', () => detachProductOptionGroup(attachment.option_group_id));
      cardActions.append(editSettingsButton, detachButton);
      card.appendChild(cardActions);

      const settingsForm = document.createElement('div');
      settingsForm.className = 'product-option-settings-form';
      settingsForm.dataset.productOptionSettingsForm = '';
      settingsForm.hidden = editingProductOptionSettingsGroupId !== attachment.option_group_id;

      const requiredLabel = document.createElement('label');
      requiredLabel.className = 'draft-checkbox product-option-required-toggle';
      const requiredInput = document.createElement('input');
      requiredInput.type = 'checkbox';
      requiredInput.name = 'is_required';
      requiredInput.checked = Boolean(attachment.is_required);
      requiredInput.disabled = !canEditAttachments || productOptionSettingsSaving;
      const requiredText = document.createElement('span');
      requiredText.textContent = 'Required';
      requiredLabel.append(requiredInput, requiredText);

      const buildSettingsField = (labelText, name, value, placeholder = '') => {
        const label = document.createElement('label');
        label.className = 'admin-field';
        const span = document.createElement('span');
        span.textContent = labelText;
        const input = document.createElement('input');
        input.name = name;
        input.type = 'number';
        input.step = '1';
        input.inputMode = 'numeric';
        input.value = value;
        input.placeholder = placeholder;
        input.disabled = !canEditAttachments || productOptionSettingsSaving;
        if (name !== 'sort_order') input.min = '0';
        label.append(span, input);
        return label;
      };

      const minField = buildSettingsField('Min Selections', 'min_selections', String(attachment.min_selections ?? 0));
      const maxField = buildSettingsField('Max Selections', 'max_selections', attachment.max_selections === null || attachment.max_selections === undefined ? '' : String(attachment.max_selections), 'Unlimited');
      const sortField = buildSettingsField('Sort Order', 'sort_order', String(attachment.sort_order ?? 0));

      const activeLabel = document.createElement('label');
      activeLabel.className = 'draft-checkbox product-option-active-toggle';
      const activeInput = document.createElement('input');
      activeInput.type = 'checkbox';
      activeInput.name = 'is_active';
      activeInput.checked = Boolean(attachment.is_active);
      activeInput.disabled = !canEditAttachments || productOptionSettingsSaving;
      const activeText = document.createElement('span');
      activeText.textContent = 'Active';
      activeLabel.append(activeInput, activeText);

      const settingsActions = document.createElement('div');
      settingsActions.className = 'product-option-settings-actions';
      const saveSettingsButton = document.createElement('button');
      saveSettingsButton.type = 'button';
      saveSettingsButton.className = 'auth-button product-option-settings-save';
      saveSettingsButton.textContent = 'Save Settings';
      saveSettingsButton.disabled = !canEditAttachments || productOptionSettingsSaving;
      saveSettingsButton.addEventListener('click', () => saveProductOptionSettings(attachment.option_group_id));
      const cancelSettingsButton = document.createElement('button');
      cancelSettingsButton.type = 'button';
      cancelSettingsButton.className = 'auth-button auth-button-secondary';
      cancelSettingsButton.textContent = 'Cancel';
      cancelSettingsButton.disabled = !canEditAttachments || productOptionSettingsSaving;
      cancelSettingsButton.addEventListener('click', () => {
        editingProductOptionSettingsGroupId = '';
        renderProductOptionAttachments(productOptionAttachments);
        setProductOptionStatus('Settings edit cancelled.');
      });
      settingsActions.append(saveSettingsButton, cancelSettingsButton);
      settingsForm.append(requiredLabel, minField, maxField, sortField, activeLabel, settingsActions);
      card.appendChild(settingsForm);

      const choices = attachment.choices || [];
      const selectedChoiceIds = new Set(attachment.defaults
        .filter((item) => item.choice && item.choice.is_active)
        .map((item) => item.option_choice_id));
      const defaultEditor = document.createElement('div');
      defaultEditor.className = 'product-option-default-editor';

      const editorTitle = document.createElement('h5');
      editorTitle.textContent = group.selection_type === 'multi' ? 'Default choices' : 'Default choice';
      defaultEditor.appendChild(editorTitle);

      if (!choices.length) {
        const empty = document.createElement('p');
        empty.className = 'product-option-default-copy';
        empty.textContent = 'No active choices available for this group.';
        defaultEditor.appendChild(empty);
      } else if (group.selection_type === 'multi') {
        const list = document.createElement('div');
        list.className = 'product-option-default-checkboxes';
        choices.forEach((choice) => {
          const label = document.createElement('label');
          label.className = 'product-option-default-check';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = choice.id;
          input.dataset.defaultChoice = '';
          input.checked = selectedChoiceIds.has(choice.id);
          input.disabled = !canEditAttachments;
          const text = document.createElement('span');
          text.textContent = choice.label || 'Untitled choice';
          label.append(input, text);
          list.appendChild(label);
        });
        defaultEditor.appendChild(list);
      } else {
        const label = document.createElement('label');
        label.className = 'admin-field product-option-default-select';
        const labelText = document.createElement('span');
        labelText.textContent = 'Default';
        const select = document.createElement('select');
        select.dataset.defaultChoice = '';
        select.disabled = !canEditAttachments;
        const none = document.createElement('option');
        none.value = '';
        none.textContent = 'No default';
        select.appendChild(none);
        choices.forEach((choice) => {
          const option = document.createElement('option');
          option.value = choice.id;
          option.textContent = choice.label || 'Untitled choice';
          select.appendChild(option);
        });
        select.value = selectedChoiceIds.size ? Array.from(selectedChoiceIds)[0] : '';
        label.append(labelText, select);
        defaultEditor.appendChild(label);
      }

      const saveDefaultsButton = document.createElement('button');
      saveDefaultsButton.type = 'button';
      saveDefaultsButton.className = 'auth-button auth-button-secondary product-option-default-save';
      saveDefaultsButton.textContent = group.selection_type === 'multi' ? 'Save Defaults' : 'Save Default';
      saveDefaultsButton.disabled = !canEditAttachments || !choices.length;
      saveDefaultsButton.addEventListener('click', () => saveProductOptionDefaults(attachment.option_group_id));
      defaultEditor.appendChild(saveDefaultsButton);
      card.appendChild(defaultEditor);

      productOptionAttachmentList.appendChild(card);
    });
  };

  const resetProductOptionAttachments = () => {
    productOptionAttachments = [];
    availableProductOptionGroups = [];
    activeProductOptionGroupCount = 0;
    editingProductOptionSettingsGroupId = '';
    productOptionAttachmentSaving = false;
    productOptionDefaultSaving = false;
    productOptionSettingsSaving = false;
    productOptionDetachSaving = false;
    resetProductOptionAttachForm();
    renderProductOptionAttachments([]);
  };

  const populateProductOptionGroupSelect = (groups) => {
    if (!productOptionGroupSelect) return;
    productOptionGroupSelect.innerHTML = '<option value="">Select an active option group</option>';
    groups.forEach((group) => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name + ' (' + group.group_key + ')';
      option.dataset.selectionType = group.selection_type || '';
      productOptionGroupSelect.appendChild(option);
    });
  };

  const loadAvailableProductOptionGroups = async () => {
    if (!editingProductId) {
      availableProductOptionGroups = [];
      populateProductOptionGroupSelect([]);
      return [];
    }

    const attachedGroupIds = new Set(productOptionAttachments.map((item) => item.option_group_id));
    const { data, error } = await client
      .from('option_groups')
      .select('id,name,group_key,selection_type,sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      availableProductOptionGroups = [];
      activeProductOptionGroupCount = 0;
      populateProductOptionGroupSelect([]);
      setProductOptionStatus('Unable to load available option groups. ' + error.message);
      return [];
    }

    activeProductOptionGroupCount = (data || []).length;
    availableProductOptionGroups = (data || []).filter((group) => !attachedGroupIds.has(group.id));
    populateProductOptionGroupSelect(availableProductOptionGroups);
    return availableProductOptionGroups;
  };

  const openProductOptionAttachForm = async () => {
    if (!editingProductId || !productOptionAttachForm) {
      setProductOptionStatus('Save the product before attaching option groups.');
      return;
    }

    setProductOptionStatus('Loading available option groups...');
    const groups = await loadAvailableProductOptionGroups();
    if (!groups.length) {
      setProductOptionStatus(activeProductOptionGroupCount ? 'All active option groups are already attached.' : 'No available option groups to attach.');
      productOptionAttachForm.hidden = true;
      setProductOptionAttachFormDisabled(true);
      return;
    }

    productOptionAttachForm.hidden = false;
    if (productOptionGroupSelect) productOptionGroupSelect.value = '';
    const minInput = productOptionAttachForm.querySelector('[name="min_selections"]');
    const maxInput = productOptionAttachForm.querySelector('[name="max_selections"]');
    const sortInput = productOptionAttachForm.querySelector('[name="sort_order"]');
    const activeInput = productOptionAttachForm.querySelector('[name="is_active"]');
    const requiredInput = productOptionAttachForm.querySelector('[name="is_required"]');
    if (minInput) minInput.value = '0';
    if (maxInput) maxInput.value = '';
    if (sortInput) sortInput.value = String(getNextProductOptionSortOrder());
    if (activeInput) activeInput.checked = true;
    if (requiredInput) requiredInput.checked = false;
    setProductOptionAttachFormDisabled(false);
    setProductOptionStatus('Choose an active option group to attach.');
  };

  const syncProductOptionAttachmentLimits = () => {
    if (!productOptionAttachForm || !productOptionGroupSelect) return;
    const group = availableProductOptionGroups.find((item) => item.id === productOptionGroupSelect.value);
    if (!group || group.selection_type !== 'single') return;

    const requiredInput = productOptionAttachForm.querySelector('[name="is_required"]');
    const minInput = productOptionAttachForm.querySelector('[name="min_selections"]');
    const maxInput = productOptionAttachForm.querySelector('[name="max_selections"]');
    if (requiredInput && minInput) minInput.value = requiredInput.checked ? '1' : '0';
    if (maxInput) maxInput.value = '1';
  };

  const validateProductOptionAttachmentForm = () => {
    if (!editingProductId) return { error: 'Save the product before attaching option groups.' };
    if (!productOptionAttachForm) return null;

    const optionGroupField = productOptionAttachForm.querySelector('[name="option_group_id"]');
    const requiredField = productOptionAttachForm.querySelector('[name="is_required"]');
    const minField = productOptionAttachForm.querySelector('[name="min_selections"]');
    const maxField = productOptionAttachForm.querySelector('[name="max_selections"]');
    const sortField = productOptionAttachForm.querySelector('[name="sort_order"]');
    const activeField = productOptionAttachForm.querySelector('[name="is_active"]');
    const optionGroupId = optionGroupField ? String(optionGroupField.value || '').trim() : '';
    const group = availableProductOptionGroups.find((item) => item.id === optionGroupId);
    const isRequired = Boolean(requiredField && requiredField.checked);
    let minSelections = Number(String(minField ? minField.value || '0' : '0').trim());
    const maxText = String(maxField ? maxField.value || '' : '').trim();
    let maxSelections = maxText ? Number(maxText) : null;
    const sortText = String(sortField ? sortField.value || '' : '').trim();
    const sortOrder = sortText ? Number(sortText) : getNextProductOptionSortOrder();

    if (!optionGroupId || !group) return { error: 'Select an option group to attach.' };
    if (!Number.isInteger(minSelections) || minSelections < 0) return { error: 'Min selections must be a whole number 0 or greater.' };
    if (maxSelections !== null && (!Number.isInteger(maxSelections) || maxSelections < minSelections)) {
      return { error: 'Max selections must be blank or greater than or equal to min selections.' };
    }
    if (!Number.isInteger(sortOrder)) return { error: 'Sort order must be a whole number.' };

    if (group.selection_type === 'single') {
      minSelections = isRequired ? 1 : 0;
      maxSelections = 1;
    } else if (isRequired && minSelections === 0) {
      minSelections = 1;
    }

    return {
      value: {
        product_id: editingProductId,
        option_group_id: optionGroupId,
        is_required: isRequired,
        min_selections: minSelections,
        max_selections: maxSelections,
        sort_order: sortOrder,
        is_active: Boolean(activeField && activeField.checked),
      },
    };
  };

  const saveProductOptionAttachment = async (event) => {
    if (event) event.preventDefault();
    if (!isOwnerSignedIn || productOptionAttachmentSaving) return;

    const validation = validateProductOptionAttachmentForm();
    if (!validation) return;
    if (validation.error) {
      setProductOptionStatus(validation.error);
      return;
    }

    productOptionAttachmentSaving = true;
    setProductOptionAttachFormDisabled(false);
    setProductOptionStatus('Attaching option group...');

    const { error } = await client
      .from('product_option_groups')
      .insert(validation.value);

    productOptionAttachmentSaving = false;

    if (error) {
      setProductOptionAttachFormDisabled(false);
      const duplicateAttachment = error.message && /duplicate|unique/i.test(error.message);
      setProductOptionStatus(duplicateAttachment
        ? 'That option group is already attached to this product.'
        : 'Unable to attach option group. ' + error.message);
      return;
    }

    resetProductOptionAttachForm();
    await loadProductOptionAttachments(editingProductId);
    setProductOptionStatus('Option group attached.');
  };

  const validateProductOptionSettings = (optionGroupId) => {
    if (!editingProductId) return { error: 'Save the product before editing option group settings.' };
    const attachment = productOptionAttachments.find((item) => item.option_group_id === optionGroupId);
    if (!attachment) return { error: 'This option group is not attached to the current product.' };

    const card = productOptionAttachmentList
      ? productOptionAttachmentList.querySelector(`[data-option-group-id="${optionGroupId}"]`)
      : null;
    const settingsForm = card ? card.querySelector('[data-product-option-settings-form]') : null;
    if (!settingsForm) return { error: 'Settings controls could not be found.' };

    const group = attachment.group || {};
    const requiredField = settingsForm.querySelector('[name="is_required"]');
    const minField = settingsForm.querySelector('[name="min_selections"]');
    const maxField = settingsForm.querySelector('[name="max_selections"]');
    const sortField = settingsForm.querySelector('[name="sort_order"]');
    const activeField = settingsForm.querySelector('[name="is_active"]');
    const isRequired = Boolean(requiredField && requiredField.checked);
    let minSelections = Number(String(minField ? minField.value || '0' : '0').trim());
    const maxText = String(maxField ? maxField.value || '' : '').trim();
    let maxSelections = maxText ? Number(maxText) : null;
    const sortText = String(sortField ? sortField.value || '0' : '0').trim();
    const sortOrder = sortText ? Number(sortText) : 0;

    if (!Number.isInteger(minSelections) || minSelections < 0) {
      return { error: 'Min selections must be a whole number 0 or greater.' };
    }
    if (maxSelections !== null && (!Number.isInteger(maxSelections) || maxSelections < minSelections)) {
      return { error: 'Max selections must be blank or greater than or equal to min selections.' };
    }
    if (!Number.isInteger(sortOrder)) return { error: 'Sort order must be a whole number.' };

    if (group.selection_type === 'single') {
      minSelections = isRequired ? 1 : 0;
      maxSelections = 1;
    } else if (isRequired && minSelections === 0) {
      minSelections = 1;
    }

    const activeDefaultCount = (attachment.defaults || []).filter((item) => item.choice && item.choice.is_active).length;
    if (maxSelections !== null && activeDefaultCount > maxSelections) {
      return { error: 'Max selections cannot be lower than the saved default choices. Adjust defaults first.' };
    }

    return {
      value: {
        is_required: isRequired,
        min_selections: minSelections,
        max_selections: maxSelections,
        sort_order: sortOrder,
        is_active: Boolean(activeField && activeField.checked),
      },
    };
  };

  const saveProductOptionSettings = async (optionGroupId) => {
    if (!isOwnerSignedIn || productOptionSettingsSaving) return;

    const validation = validateProductOptionSettings(optionGroupId);
    if (!validation) return;
    if (validation.error) {
      setProductOptionStatus(validation.error);
      return;
    }

    productOptionSettingsSaving = true;
    renderProductOptionAttachments(productOptionAttachments);
    setProductOptionStatus('Saving option group settings...');

    const { error } = await client
      .from('product_option_groups')
      .update(validation.value)
      .eq('product_id', editingProductId)
      .eq('option_group_id', optionGroupId);

    productOptionSettingsSaving = false;

    if (error) {
      renderProductOptionAttachments(productOptionAttachments);
      setProductOptionStatus('Unable to save option group settings. ' + error.message);
      return;
    }

    editingProductOptionSettingsGroupId = '';
    await loadProductOptionAttachments(editingProductId);
    setProductOptionStatus('Option group settings updated.');
  };

  const detachProductOptionGroup = async (optionGroupId) => {
    if (!isOwnerSignedIn || productOptionDetachSaving) return;
    if (!editingProductId) {
      setProductOptionStatus('Save the product before detaching option groups.');
      return;
    }

    const attachment = productOptionAttachments.find((item) => item.option_group_id === optionGroupId);
    if (!attachment) {
      setProductOptionStatus('This option group is not attached to the current product.');
      return;
    }

    const confirmed = window.confirm('Remove this option group from this product? Saved defaults for this product/group will also be removed.');
    if (!confirmed) return;

    productOptionDetachSaving = true;
    if (editingProductOptionSettingsGroupId === optionGroupId) editingProductOptionSettingsGroupId = '';
    renderProductOptionAttachments(productOptionAttachments);
    setProductOptionStatus('Detaching option group...');

    const { error } = await client
      .from('product_option_groups')
      .delete()
      .eq('product_id', editingProductId)
      .eq('option_group_id', optionGroupId);

    productOptionDetachSaving = false;

    if (error) {
      renderProductOptionAttachments(productOptionAttachments);
      setProductOptionStatus('Unable to detach option group. ' + error.message);
      return;
    }

    resetProductOptionAttachForm();
    await loadProductOptionAttachments(editingProductId);
    setProductOptionStatus('Option group detached from product.');
  };

  const validateProductOptionDefaults = (optionGroupId) => {
    if (!editingProductId) return { error: 'Save the product before setting defaults.' };
    const attachment = productOptionAttachments.find((item) => item.option_group_id === optionGroupId);
    if (!attachment) return { error: 'This option group is not attached to the current product.' };

    const group = attachment.group || {};
    const activeChoiceIds = new Set((attachment.choices || []).map((choice) => choice.id));
    const card = productOptionAttachmentList
      ? productOptionAttachmentList.querySelector(`[data-option-group-id="${optionGroupId}"]`)
      : null;
    if (!card) return { error: 'Default controls could not be found.' };

    let selectedChoiceIds = [];
    if (group.selection_type === 'multi') {
      selectedChoiceIds = Array.from(card.querySelectorAll('[data-default-choice]:checked')).map((item) => item.value);
    } else {
      const select = card.querySelector('[data-default-choice]');
      selectedChoiceIds = select && select.value ? [select.value] : [];
    }

    const uniqueChoiceIds = Array.from(new Set(selectedChoiceIds));
    if (uniqueChoiceIds.some((choiceId) => !activeChoiceIds.has(choiceId))) {
      return { error: 'Defaults can only use active choices from this option group.' };
    }
    if (group.selection_type === 'single' && uniqueChoiceIds.length > 1) {
      return { error: 'Single-choice groups can only have one default.' };
    }
    if (group.selection_type === 'multi' && attachment.max_selections !== null && attachment.max_selections !== undefined && uniqueChoiceIds.length > Number(attachment.max_selections)) {
      return { error: 'Default choices cannot exceed max selections.' };
    }

    return {
      value: uniqueChoiceIds.map((choiceId) => ({
        product_id: editingProductId,
        option_group_id: optionGroupId,
        option_choice_id: choiceId,
      })),
    };
  };

  const saveProductOptionDefaults = async (optionGroupId) => {
    if (!isOwnerSignedIn || productOptionDefaultSaving) return;

    const validation = validateProductOptionDefaults(optionGroupId);
    if (!validation) return;
    if (validation.error) {
      setProductOptionStatus(validation.error);
      return;
    }

    productOptionDefaultSaving = true;
    setProductOptionStatus('Saving default choices...');

    const { error: deleteError } = await client
      .from('product_option_defaults')
      .delete()
      .eq('product_id', editingProductId)
      .eq('option_group_id', optionGroupId);

    if (deleteError) {
      productOptionDefaultSaving = false;
      setProductOptionStatus('Unable to clear existing defaults. ' + deleteError.message);
      return;
    }

    if (validation.value.length) {
      const { error: insertError } = await client
        .from('product_option_defaults')
        .insert(validation.value);

      if (insertError) {
        productOptionDefaultSaving = false;
        setProductOptionStatus('Existing defaults were cleared, but new defaults could not be saved. ' + insertError.message);
        await loadProductOptionAttachments(editingProductId);
        return;
      }
    }

    productOptionDefaultSaving = false;
    await loadProductOptionAttachments(editingProductId);
    setProductOptionStatus(validation.value.length ? 'Default choices saved.' : 'Defaults cleared.');
  };

  const resetDraftProductForm = () => {
    if (draftForm) draftForm.reset();
    resetVariantGroupOptions('Each');
    if (customVariantInput) customVariantInput.value = '';
    const availableInput = draftForm ? draftForm.querySelector('[name="is_available"]') : null;
    if (availableInput) availableInput.checked = true;
    resetVariantRows();
    setCreateMode();
    syncVariantGroupFields();
    maybeSyncDefaultVariantLabel();
    setProductBadges([]);
    if (draftCategorySelect) {
      draftCategorySelect.innerHTML = '<option value="">Sign in to load categories</option>';
    }
    latestDraftCategorySections = [];
    previousDraftSectionValue = '';
    renderDraftProductSections([], '');
    hideInlineDraftSectionCreate(false);
    hideInlineCategoryCreate(false);
    hideInlineCategoryRename();
    setDraftFormDisabled(true);
    resetProductOptionAttachments();
  };

  const populateDraftCategorySelect = (categories) => {
    if (!draftCategorySelect) return;
    const currentValue = draftCategorySelect.value;
    draftCategorySelect.innerHTML = '<option value="">Select a category</option>';
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      draftCategorySelect.appendChild(option);
    });
    const createOption = document.createElement('option');
    createOption.value = '__create_category__';
    createOption.textContent = '+ Add new category...';
    draftCategorySelect.appendChild(createOption);
    if (currentValue && categories.some((category) => category.id === currentValue)) {
      draftCategorySelect.value = currentValue;
    }
    updateCategoryActionButtons();
  };

  const getSelectedProductListCategoryId = () => {
    if (!selectedCategoryFilter || selectedCategoryFilter === 'all') return '';
    return latestCategories.some((category) => category.id === selectedCategoryFilter && category.is_active !== false)
      ? selectedCategoryFilter
      : '';
  };

  const getSelectedProductListCategory = () => {
    const categoryId = getSelectedProductListCategoryId();
    return categoryId ? latestCategories.find((category) => category.id === categoryId) || null : null;
  };

  const updateCategoryActionButtons = () => {
    const hasCategory = Boolean(getSelectedProductListCategoryId());
    const isBusy = inlineCategorySaving || inlineCategoryRenameSaving || inlineCategoryDeleteSaving;
    const isDisabled = !isOwnerSignedIn || isBusy || !hasCategory;
    if (renameSelectedCategoryButton) renameSelectedCategoryButton.disabled = isDisabled;
    if (deleteSelectedCategoryButton) deleteSelectedCategoryButton.disabled = isDisabled;
    updateSectionActionButtons();
  };

  const getSelectedSectionId = () => {
    if (!selectedSectionFilter || selectedSectionFilter === 'all') return '';
    return latestCategorySections.some((section) => section.id === selectedSectionFilter)
      ? selectedSectionFilter
      : '';
  };

  const getSelectedSection = () => {
    const sectionId = getSelectedSectionId();
    return sectionId ? latestCategorySections.find((section) => section.id === sectionId) || null : null;
  };

  const updateSectionActionButtons = () => {
    const hasCategory = Boolean(getSelectedProductListCategoryId());
    const hasSection = Boolean(getSelectedSectionId());
    const isBusy = inlineSectionSaving || inlineSectionRenameSaving || inlineSectionDeleteSaving;
    const actionsDisabled = !isOwnerSignedIn || isBusy || !hasCategory || !hasSection;
    if (renameSelectedSectionButton) renameSelectedSectionButton.disabled = actionsDisabled;
    if (deleteSelectedSectionButton) deleteSelectedSectionButton.disabled = actionsDisabled;
  };

  const preselectDraftCategoryFromFilter = async () => {
    const filteredCategoryId = getSelectedProductListCategoryId();
    if (filteredCategoryId && draftCategorySelect) {
      draftCategorySelect.value = filteredCategoryId;
      previousDraftCategoryValue = filteredCategoryId;
      await loadDraftCategorySections(filteredCategoryId, getSelectedSectionId());
      updateCategoryActionButtons();
    } else {
      renderDraftProductSections([], '');
    }
  };

  const setInlineCategoryDisabled = (isDisabled) => {
    if (inlineCategoryNameInput) inlineCategoryNameInput.disabled = isDisabled;
    if (saveInlineCategoryButton) saveInlineCategoryButton.disabled = isDisabled;
    if (cancelInlineCategoryButton) cancelInlineCategoryButton.disabled = isDisabled;
  };

  const showInlineCategoryCreate = () => {
    previousDraftCategoryValue = previousDraftCategoryValue || '';
    if (inlineCategoryCreate) inlineCategoryCreate.hidden = false;
    setInlineCategoryDisabled(!isOwnerSignedIn || inlineCategorySaving);
    if (inlineCategoryNameInput) {
      inlineCategoryNameInput.value = '';
      inlineCategoryNameInput.focus();
    }
  };

  const hideInlineCategoryCreate = (restorePrevious = true) => {
    if (inlineCategoryCreate) inlineCategoryCreate.hidden = true;
    if (inlineCategoryNameInput) inlineCategoryNameInput.value = '';
    setInlineCategoryDisabled(true);
    if (restorePrevious && draftCategorySelect) {
      draftCategorySelect.value = previousDraftCategoryValue || '';
    }
    previousDraftCategoryValue = draftCategorySelect && draftCategorySelect.value !== '__create_category__'
      ? draftCategorySelect.value
      : '';
    updateCategoryActionButtons();
  };

  const setInlineCategoryRenameDisabled = (isDisabled) => {
    if (inlineCategoryRenameInput) inlineCategoryRenameInput.disabled = isDisabled;
    if (saveInlineCategoryRenameButton) saveInlineCategoryRenameButton.disabled = isDisabled;
    if (cancelInlineCategoryRenameButton) cancelInlineCategoryRenameButton.disabled = isDisabled;
  };

  const showInlineCategoryRename = () => {
    const category = getSelectedProductListCategory();
    if (!category) {
      setStatus('Choose a category filter before renaming.');
      return;
    }
    hideInlineCategoryCreate(false);
    if (inlineCategoryRename) inlineCategoryRename.hidden = false;
    setInlineCategoryRenameDisabled(!isOwnerSignedIn || inlineCategoryRenameSaving);
    if (inlineCategoryRenameInput) {
      inlineCategoryRenameInput.value = category.name || '';
      inlineCategoryRenameInput.focus();
      inlineCategoryRenameInput.select();
    }
    updateCategoryActionButtons();
  };

  const hideInlineCategoryRename = () => {
    if (inlineCategoryRename) inlineCategoryRename.hidden = true;
    if (inlineCategoryRenameInput) inlineCategoryRenameInput.value = '';
    setInlineCategoryRenameDisabled(true);
    updateCategoryActionButtons();
  };

  const setInlineDraftSectionDisabled = (isDisabled) => {
    if (inlineDraftSectionNameInput) inlineDraftSectionNameInput.disabled = isDisabled;
    if (saveInlineDraftSectionButton) saveInlineDraftSectionButton.disabled = isDisabled;
    if (cancelInlineDraftSectionButton) cancelInlineDraftSectionButton.disabled = isDisabled;
  };

  const hideInlineDraftSectionCreate = (restorePrevious = true) => {
    if (inlineDraftSectionCreate) inlineDraftSectionCreate.hidden = true;
    if (inlineDraftSectionNameInput) inlineDraftSectionNameInput.value = '';
    setInlineDraftSectionDisabled(true);
    if (restorePrevious && draftSectionSelect && draftSectionSelect.value === '__create_section__') {
      draftSectionSelect.value = previousDraftSectionValue || '';
    }
    previousDraftSectionValue = draftSectionSelect && draftSectionSelect.value !== '__create_section__'
      ? draftSectionSelect.value
      : '';
  };

  const showInlineDraftSectionCreate = () => {
    if (!getDraftCategoryId()) {
      setStatus('Choose a product category before adding a section.');
      return;
    }
    if (inlineDraftSectionCreate) inlineDraftSectionCreate.hidden = false;
    setInlineDraftSectionDisabled(!isOwnerSignedIn || inlineDraftSectionSaving);
    if (inlineDraftSectionNameInput) {
      inlineDraftSectionNameInput.value = '';
      inlineDraftSectionNameInput.focus();
    }
  };

  const getNextDraftSectionSortOrder = () => {
    const maxSort = latestDraftCategorySections.reduce((max, section) => {
      const sortOrder = Number(section && section.sort_order);
      return Number.isFinite(sortOrder) ? Math.max(max, sortOrder) : max;
    }, -1);
    return maxSort + 1;
  };

  const renderDraftProductSections = (sections = [], selectedValue = '') => {
    latestDraftCategorySections = sections;
    if (!draftSectionSelect) return;

    const categoryId = getDraftCategoryId();
    draftSectionSelect.innerHTML = '';

    const makeOption = (label, value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    };

    if (!categoryId) {
      draftSectionSelect.appendChild(makeOption('Select category first', ''));
      draftSectionSelect.value = '';
      syncDraftSectionSelectDisabled();
      hideInlineDraftSectionCreate(false);
      return;
    }

    draftSectionSelect.appendChild(makeOption('No section', ''));
    sections.forEach((section) => {
      const label = section.is_active === false ? section.name + ' (inactive)' : section.name;
      draftSectionSelect.appendChild(makeOption(label, section.id));
    });
    draftSectionSelect.appendChild(makeOption('+ Add section...', '__create_section__'));

    draftSectionSelect.value = sections.some((section) => section.id === selectedValue) ? selectedValue : '';
    previousDraftSectionValue = draftSectionSelect.value;
    syncDraftSectionSelectDisabled();
  };

  const loadDraftCategorySections = async (categoryId, selectedValue = '') => {
    if (!categoryId) {
      renderDraftProductSections([], '');
      return;
    }

    if (draftSectionSelect) {
      draftSectionSelect.disabled = true;
      draftSectionSelect.innerHTML = '<option value="">Loading sections...</option>';
    }

    const { data, error } = await client
      .from('category_sections')
      .select('id,category_id,name,sort_order,is_active')
      .eq('category_id', categoryId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      latestDraftCategorySections = [];
      renderDraftProductSections([], '');
      setStatus('Unable to load product sections. ' + error.message);
      return;
    }

    renderDraftProductSections(data || [], selectedValue);
  };

  const createInlineDraftSection = async () => {
    if (!isOwnerSignedIn || inlineDraftSectionSaving) return;

    const categoryId = getDraftCategoryId();
    const name = inlineDraftSectionNameInput ? inlineDraftSectionNameInput.value.trim() : '';
    if (!categoryId) {
      setStatus('Choose a product category before adding a section.');
      return;
    }
    if (!name) {
      setStatus('Section name is required.');
      if (inlineDraftSectionNameInput) inlineDraftSectionNameInput.focus();
      return;
    }

    inlineDraftSectionSaving = true;
    setInlineDraftSectionDisabled(true);
    setStatus('Creating section...');

    const { data, error } = await client
      .from('category_sections')
      .insert({
        category_id: categoryId,
        name,
        sort_order: getNextDraftSectionSortOrder(),
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      inlineDraftSectionSaving = false;
      setInlineDraftSectionDisabled(false);
      const duplicateHint = error.code === '23505' ? ' A section with this name may already exist in this category.' : '';
      setStatus('Unable to create section.' + duplicateHint + ' ' + error.message);
      return;
    }

    await loadDraftCategorySections(categoryId, data && data.id ? data.id : '');
    if (getSelectedProductListCategoryId() === categoryId) {
      await loadCategorySections(categoryId);
    }
    inlineDraftSectionSaving = false;
    hideInlineDraftSectionCreate(false);
    setStatus('Section created and selected.');
  };

  const setInlineSectionCreateDisabled = (isDisabled) => {
    if (inlineSectionNameInput) inlineSectionNameInput.disabled = isDisabled;
    if (saveInlineSectionButton) saveInlineSectionButton.disabled = isDisabled;
    if (cancelInlineSectionButton) cancelInlineSectionButton.disabled = isDisabled;
  };

  const setInlineSectionRenameDisabled = (isDisabled) => {
    if (inlineSectionRenameInput) inlineSectionRenameInput.disabled = isDisabled;
    if (saveInlineSectionRenameButton) saveInlineSectionRenameButton.disabled = isDisabled;
    if (cancelInlineSectionRenameButton) cancelInlineSectionRenameButton.disabled = isDisabled;
  };

  const hideInlineSectionCreate = () => {
    if (inlineSectionCreate) inlineSectionCreate.hidden = true;
    if (inlineSectionNameInput) inlineSectionNameInput.value = '';
    setInlineSectionCreateDisabled(true);
    if (productSectionFilter && productSectionFilter.value === '__create_section__') {
      productSectionFilter.value = selectedSectionFilter || 'all';
    }
    updateSectionActionButtons();
  };

  const showInlineSectionCreate = () => {
    const categoryId = getSelectedProductListCategoryId();
    if (!categoryId) {
      setStatus('Choose a category before adding a section.');
      return;
    }
    hideInlineSectionRename();
    if (inlineSectionCreate) inlineSectionCreate.hidden = false;
    setInlineSectionCreateDisabled(!isOwnerSignedIn || inlineSectionSaving);
    if (inlineSectionNameInput) {
      inlineSectionNameInput.value = '';
      inlineSectionNameInput.focus();
    }
    updateSectionActionButtons();
  };

  const hideInlineSectionRename = () => {
    if (inlineSectionRename) inlineSectionRename.hidden = true;
    if (inlineSectionRenameInput) inlineSectionRenameInput.value = '';
    setInlineSectionRenameDisabled(true);
    updateSectionActionButtons();
  };

  const showInlineSectionRename = () => {
    const section = getSelectedSection();
    if (!section) {
      setStatus('Choose a section before renaming.');
      return;
    }
    hideInlineSectionCreate();
    if (inlineSectionRename) inlineSectionRename.hidden = false;
    setInlineSectionRenameDisabled(!isOwnerSignedIn || inlineSectionRenameSaving);
    if (inlineSectionRenameInput) {
      inlineSectionRenameInput.value = section.name || '';
      inlineSectionRenameInput.focus();
      inlineSectionRenameInput.select();
    }
    updateSectionActionButtons();
  };

  const getNextSectionSortOrder = () => {
    const maxSort = latestCategorySections.reduce((max, section) => {
      const sortOrder = Number(section && section.sort_order);
      return Number.isFinite(sortOrder) ? Math.max(max, sortOrder) : max;
    }, -1);
    return maxSort + 1;
  };

  const renderProductSections = (sections = []) => {
    latestCategorySections = sections;
    if (!productSectionFilter) return;

    const categoryId = getSelectedProductListCategoryId();
    productSectionFilter.innerHTML = '';

    const makeOption = (label, value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    };

    if (!categoryId) {
      selectedSectionFilter = 'all';
      productSectionFilter.appendChild(makeOption('Select category first', ''));
      productSectionFilter.value = '';
      productSectionFilter.disabled = true;
      hideInlineSectionCreate();
      hideInlineSectionRename();
      updateSectionActionButtons();
      return;
    }

    productSectionFilter.disabled = !isOwnerSignedIn;
    productSectionFilter.appendChild(makeOption('All sections', 'all'));
    sections.forEach((section) => {
      const label = section.is_active === false ? section.name + ' (inactive)' : section.name;
      productSectionFilter.appendChild(makeOption(label, section.id));
    });
    productSectionFilter.appendChild(makeOption('+ Add section...', '__create_section__'));

    if (!sections.some((section) => section.id === selectedSectionFilter)) {
      selectedSectionFilter = 'all';
    }
    productSectionFilter.value = selectedSectionFilter;
    updateSectionActionButtons();
  };

  const loadCategorySections = async (categoryId) => {
    if (!categoryId) {
      renderProductSections([]);
      return;
    }

    if (productSectionFilter) {
      productSectionFilter.disabled = true;
      productSectionFilter.innerHTML = '<option value="">Loading sections...</option>';
    }

    const { data, error } = await client
      .from('category_sections')
      .select('id,category_id,name,sort_order,is_active')
      .eq('category_id', categoryId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      latestCategorySections = [];
      renderProductSections([]);
      setStatus('Unable to load sections. ' + error.message);
      return;
    }

    renderProductSections(data || []);
  };

  const getNextCategorySortOrder = () => {
    const maxSort = latestCategories.reduce((max, category) => {
      const sortOrder = Number(category && category.sort_order);
      return Number.isFinite(sortOrder) ? Math.max(max, sortOrder) : max;
    }, -1);
    return maxSort + 1;
  };

  const setDisplayOrderStatus = (message) => {
    if (displayOrderStatus) displayOrderStatus.textContent = message;
  };

  const isDisplayOrderSectionSortable = () => Boolean(selectedDisplayOrderCategory)
    && selectedDisplayOrderSection
    && selectedDisplayOrderSection !== 'all';

  const getDisplayOrderSectionLabel = () => {
    if (selectedDisplayOrderSection === '__none__') return 'No section';
    const section = latestDisplayOrderSections.find((item) => item.id === selectedDisplayOrderSection);
    return section ? section.name : 'Selected section';
  };

  const updateDisplayOrderButtons = () => {
    const hasCategory = Boolean(selectedDisplayOrderCategory);
    const hasSortableSection = isDisplayOrderSectionSortable();
    const hasProducts = sortableProducts.length > 0;
    if (resetDisplayOrderButton) resetDisplayOrderButton.disabled = displayOrderSaving || !displayOrderDirty;
    if (saveDisplayOrderButton) saveDisplayOrderButton.disabled = displayOrderSaving || !displayOrderDirty || !hasCategory || !hasSortableSection || !hasProducts;
  };

  const populateDisplayOrderCategorySelect = (categories) => {
    if (!displayOrderCategorySelect) return;
    displayOrderCategorySelect.innerHTML = '<option value="">Select a category</option>';
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      displayOrderCategorySelect.appendChild(option);
    });
    displayOrderCategorySelect.disabled = !categories.length;
    if (selectedDisplayOrderCategory && categories.some((category) => category.id === selectedDisplayOrderCategory)) {
      displayOrderCategorySelect.value = selectedDisplayOrderCategory;
    } else {
      selectedDisplayOrderCategory = '';
    }
  };

  const renderDisplayOrderSections = (sections = []) => {
    latestDisplayOrderSections = sections;
    if (!displayOrderSectionSelect) return;

    displayOrderSectionSelect.innerHTML = '';

    const makeOption = (label, value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    };

    if (!selectedDisplayOrderCategory) {
      selectedDisplayOrderSection = 'all';
      displayOrderSectionSelect.appendChild(makeOption('Select category first', ''));
      displayOrderSectionSelect.value = '';
      displayOrderSectionSelect.disabled = true;
      return;
    }

    displayOrderSectionSelect.disabled = displayOrderSaving || !isOwnerSignedIn;
    displayOrderSectionSelect.appendChild(makeOption('All sections', 'all'));
    displayOrderSectionSelect.appendChild(makeOption('No section', '__none__'));
    sections.forEach((section) => {
      const label = section.is_active === false ? section.name + ' (inactive)' : section.name;
      displayOrderSectionSelect.appendChild(makeOption(label, section.id));
    });

    if (selectedDisplayOrderSection !== '__none__' && selectedDisplayOrderSection !== 'all' && !sections.some((section) => section.id === selectedDisplayOrderSection)) {
      selectedDisplayOrderSection = 'all';
    }
    displayOrderSectionSelect.value = selectedDisplayOrderSection;
  };

  const loadDisplayOrderSections = async (categoryId) => {
    if (!categoryId) {
      renderDisplayOrderSections([]);
      return;
    }

    if (displayOrderSectionSelect) {
      displayOrderSectionSelect.disabled = true;
      displayOrderSectionSelect.innerHTML = '<option value="">Loading sections...</option>';
    }

    const { data, error } = await client
      .from('category_sections')
      .select('id,category_id,name,sort_order,is_active')
      .eq('category_id', categoryId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      latestDisplayOrderSections = [];
      renderDisplayOrderSections([]);
      setDisplayOrderStatus('Unable to load sections. ' + error.message);
      return;
    }

    renderDisplayOrderSections(data || []);
  };

  const getProductSortOrder = (product) => {
    const sortOrder = Number(product && product.sort_order);
    return Number.isFinite(sortOrder) ? sortOrder : 0;
  };

  const sortProductsForDisplayOrder = (products) => products.slice().sort((a, b) =>
    getProductSortOrder(a) - getProductSortOrder(b) || String(a.name || '').localeCompare(String(b.name || ''))
  );

  const getCategorySortOrder = (product) => {
    const sortOrder = Number(product && product.category && product.category.sort_order);
    return Number.isFinite(sortOrder) ? sortOrder : 9999;
  };

  const sortProductsForPreview = (products) => products.slice().sort((a, b) =>
    getCategorySortOrder(a) - getCategorySortOrder(b)
    || getProductSortOrder(a) - getProductSortOrder(b)
    || String(a.name || '').localeCompare(String(b.name || ''))
  );

  const getProductCreatedTime = (product) => {
    const time = Date.parse(product && product.created_at ? product.created_at : '');
    return Number.isFinite(time) ? time : 0;
  };

  const sortProductsForBrowsing = (products = []) => {
    const sourceProducts = products || [];
    if (selectedProductListSort === 'name_asc') {
      return sourceProducts.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }
    if (selectedProductListSort === 'name_desc') {
      return sourceProducts.slice().sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')));
    }
    if (selectedProductListSort === 'newest') {
      return sourceProducts.slice().sort((a, b) =>
        getProductCreatedTime(b) - getProductCreatedTime(a)
        || String(a.name || '').localeCompare(String(b.name || ''))
      );
    }
    if (selectedProductListSort === 'oldest') {
      return sourceProducts.slice().sort((a, b) =>
        getProductCreatedTime(a) - getProductCreatedTime(b)
        || String(a.name || '').localeCompare(String(b.name || ''))
      );
    }
    if (selectedProductListSort === 'published_first') {
      return sourceProducts.slice().sort((a, b) =>
        Number(Boolean(b.is_published)) - Number(Boolean(a.is_published))
        || getCategorySortOrder(a) - getCategorySortOrder(b)
        || getProductSortOrder(a) - getProductSortOrder(b)
        || String(a.name || '').localeCompare(String(b.name || ''))
      );
    }
    if (selectedProductListSort === 'draft_first') {
      return sourceProducts.slice().sort((a, b) =>
        Number(Boolean(a.is_published)) - Number(Boolean(b.is_published))
        || getCategorySortOrder(a) - getCategorySortOrder(b)
        || getProductSortOrder(a) - getProductSortOrder(b)
        || String(a.name || '').localeCompare(String(b.name || ''))
      );
    }
    return sortProductsForPreview(sourceProducts);
  };

  const setDisplayOrderDirty = (isDirty) => {
    displayOrderDirty = isDirty;
    if (displayOrderUnsaved) displayOrderUnsaved.hidden = !isDirty;
    updateDisplayOrderButtons();
    setDisplayOrderStatus(isDirty
      ? 'Unsaved local changes. Save Display Order to update ' + getDisplayOrderSectionLabel() + '.'
      : 'Choose a category and section, reorder products, then save.');
  };

  const renderDisplayOrderEmpty = (title, message) => {
    if (!displayOrderList) return;
    displayOrderList.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'display-order-empty';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = message;
    empty.append(heading, copy);
    displayOrderList.appendChild(empty);
  };

  const moveSortableProduct = (index, direction) => {
    const nextIndex = index + direction;
    if (displayOrderSaving || nextIndex < 0 || nextIndex >= sortableProducts.length) return;

    const [moved] = sortableProducts.splice(index, 1);
    sortableProducts.splice(nextIndex, 0, moved);
    setDisplayOrderDirty(true);
    renderDisplayOrderList();
  };

  const renderDisplayOrderList = () => {
    if (!displayOrderList) return;
    displayOrderList.innerHTML = '';

    if (!selectedDisplayOrderCategory) {
      renderDisplayOrderEmpty('Select a category', 'Choose a category and section to reorder products.');
      return;
    }

    if (selectedDisplayOrderSection === 'all') {
      renderDisplayOrderEmpty('Choose a section to reorder safely.', 'All sections is view-only for now so products do not get mixed across sections.');
      return;
    }

    if (!sortableProducts.length) {
      renderDisplayOrderEmpty('No products in this section yet.', 'Create products or assign products to this section before sorting.');
      return;
    }

    sortableProducts.forEach((product, index) => {
      const row = document.createElement('div');
      row.className = 'display-order-row';
      row.draggable = sortableProducts.length > 1;
      row.dataset.productId = product.id;

      const handle = document.createElement('span');
      handle.className = 'display-order-handle';
      handle.textContent = '::';
      handle.setAttribute('aria-hidden', 'true');

      const copy = document.createElement('div');
      const name = document.createElement('p');
      name.className = 'display-order-name';
      name.textContent = product.name || 'Untitled product';
      const meta = document.createElement('p');
      meta.className = 'display-order-meta';
      meta.textContent = getDisplayOrderSectionLabel() + ' - Current sort_order ' + getProductSortOrder(product) + ' - Local position ' + (index + 1);
      copy.append(name, meta);

      const badges = document.createElement('div');
      badges.className = 'display-order-badges';
      badges.appendChild(makeBadge(product.is_published ? 'Published' : 'Draft', product.is_published ? 'is-live' : 'is-muted'));
      badges.appendChild(makeBadge(product.is_available ? 'Available' : 'Unavailable', product.is_available ? 'is-available' : 'is-muted'));

      const moveControls = document.createElement('div');
      moveControls.className = 'display-order-move-controls';
      const moveUpButton = document.createElement('button');
      moveUpButton.type = 'button';
      moveUpButton.className = 'display-order-move-button';
      moveUpButton.innerHTML = '&uarr;';
      moveUpButton.disabled = index === 0;
      moveUpButton.setAttribute('aria-label', 'Move ' + (product.name || 'product') + ' up');
      moveUpButton.title = 'Move product up';
      moveUpButton.addEventListener('click', () => moveSortableProduct(index, -1));

      const moveDownButton = document.createElement('button');
      moveDownButton.type = 'button';
      moveDownButton.className = 'display-order-move-button';
      moveDownButton.innerHTML = '&darr;';
      moveDownButton.disabled = index === sortableProducts.length - 1;
      moveDownButton.setAttribute('aria-label', 'Move ' + (product.name || 'product') + ' down');
      moveDownButton.title = 'Move product down';
      moveDownButton.addEventListener('click', () => moveSortableProduct(index, 1));

      moveControls.append(moveUpButton, moveDownButton);

      row.append(handle, copy, badges, moveControls);

      row.addEventListener('dragstart', (event) => {
        draggedSortProductId = product.id;
        row.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', product.id);
      });

      row.addEventListener('dragend', () => {
        draggedSortProductId = null;
        row.classList.remove('is-dragging');
      });

      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });

      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const sourceId = draggedSortProductId || event.dataTransfer.getData('text/plain');
        const targetId = product.id;
        if (!sourceId || sourceId === targetId) return;

        const sourceIndex = sortableProducts.findIndex((item) => item.id === sourceId);
        const targetIndex = sortableProducts.findIndex((item) => item.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;

        const [moved] = sortableProducts.splice(sourceIndex, 1);
        sortableProducts.splice(targetIndex, 0, moved);
        setDisplayOrderDirty(true);
        renderDisplayOrderList();
      });

      displayOrderList.appendChild(row);
    });
  };

  const getDisplayOrderProductsForSelection = () => {
    if (!selectedDisplayOrderCategory || selectedDisplayOrderSection === 'all') return [];
    return sortProductsForDisplayOrder(latestProducts.filter((product) => {
      if (product.category_id !== selectedDisplayOrderCategory) return false;
      if (selectedDisplayOrderSection === '__none__') return !product.category_section_id;
      return product.category_section_id === selectedDisplayOrderSection;
    }));
  };

  const initializeDisplayOrderCategory = async (categoryId) => {
    selectedDisplayOrderCategory = categoryId || '';
    if (displayOrderCategorySelect) displayOrderCategorySelect.value = selectedDisplayOrderCategory;

    if (!selectedDisplayOrderCategory) {
      selectedDisplayOrderSection = 'all';
      latestDisplayOrderSections = [];
      displayOrderOriginalProducts = [];
      sortableProducts = [];
      displayOrderLoadedCategory = '';
      displayOrderLoadedSection = 'all';
      renderDisplayOrderSections([]);
      setDisplayOrderDirty(false);
      renderDisplayOrderList();
      return;
    }

    selectedDisplayOrderSection = 'all';
    await loadDisplayOrderSections(selectedDisplayOrderCategory);
    displayOrderLoadedCategory = selectedDisplayOrderCategory;
    displayOrderLoadedSection = selectedDisplayOrderSection;
    displayOrderOriginalProducts = getDisplayOrderProductsForSelection();
    sortableProducts = displayOrderOriginalProducts.slice();
    setDisplayOrderDirty(false);
    renderDisplayOrderList();
  };

  const initializeDisplayOrderSection = (sectionValue) => {
    selectedDisplayOrderSection = sectionValue || 'all';
    if (displayOrderSectionSelect) displayOrderSectionSelect.value = selectedDisplayOrderSection;
    displayOrderLoadedCategory = selectedDisplayOrderCategory;
    displayOrderLoadedSection = selectedDisplayOrderSection;
    displayOrderOriginalProducts = getDisplayOrderProductsForSelection();
    sortableProducts = displayOrderOriginalProducts.slice();
    setDisplayOrderDirty(false);
    renderDisplayOrderList();
  };

  const handleDisplayOrderCategoryChange = async () => {
    if (!displayOrderCategorySelect) return;
    const nextCategory = displayOrderCategorySelect.value;

    if (displayOrderSaving) {
      displayOrderCategorySelect.value = selectedDisplayOrderCategory;
      return;
    }

    if (displayOrderDirty && nextCategory !== selectedDisplayOrderCategory) {
      const shouldDiscard = window.confirm('You have unsaved display order changes. Switch categories and discard them?');
      if (!shouldDiscard) {
        displayOrderCategorySelect.value = selectedDisplayOrderCategory;
        setDisplayOrderStatus('Category switch cancelled. Unsaved display order changes are still visible.');
        updateDisplayOrderButtons();
        return;
      }
    }

    await initializeDisplayOrderCategory(nextCategory);
  };

  const handleDisplayOrderSectionChange = () => {
    if (!displayOrderSectionSelect) return;
    const nextSection = displayOrderSectionSelect.value || 'all';

    if (displayOrderSaving) {
      displayOrderSectionSelect.value = selectedDisplayOrderSection;
      return;
    }

    if (displayOrderDirty && nextSection !== selectedDisplayOrderSection) {
      const shouldDiscard = window.confirm('You have unsaved display order changes. Switch sections and discard them?');
      if (!shouldDiscard) {
        displayOrderSectionSelect.value = selectedDisplayOrderSection;
        setDisplayOrderStatus('Section switch cancelled. Unsaved display order changes are still visible.');
        updateDisplayOrderButtons();
        return;
      }
    }

    initializeDisplayOrderSection(nextSection);
  };

  const resetDisplayOrder = () => {
    selectedDisplayOrderCategory = '';
    selectedDisplayOrderSection = 'all';
    latestDisplayOrderSections = [];
    displayOrderOriginalProducts = [];
    sortableProducts = [];
    displayOrderLoadedCategory = '';
    displayOrderLoadedSection = 'all';
    displayOrderSaving = false;
    if (displayOrderCategorySelect) {
      displayOrderCategorySelect.value = '';
      displayOrderCategorySelect.disabled = !latestCategories.length;
    }
    renderDisplayOrderSections([]);
    setDisplayOrderDirty(false);
    renderDisplayOrderEmpty('Select a category', 'Sortable products will appear here after owner sign-in.');
  };

  const saveDisplayOrder = async () => {
    if (displayOrderSaving) return;

    if (!displayOrderDirty) {
      setDisplayOrderStatus('No display order changes to save.');
      updateDisplayOrderButtons();
      return;
    }

    if (!selectedDisplayOrderCategory || !sortableProducts.length) {
      setDisplayOrderStatus('Choose a category with products before saving display order.');
      updateDisplayOrderButtons();
      return;
    }

    if (!isDisplayOrderSectionSortable()) {
      setDisplayOrderStatus('Choose a real section or No section before saving display order.');
      updateDisplayOrderButtons();
      return;
    }

    if (selectedDisplayOrderCategory !== displayOrderLoadedCategory || selectedDisplayOrderSection !== displayOrderLoadedSection) {
      setDisplayOrderStatus('Category or section changed before save. Reload the section order and try again.');
      updateDisplayOrderButtons();
      return;
    }

    const mismatchedProduct = sortableProducts.find((product) => {
      if (product.category_id !== selectedDisplayOrderCategory) return true;
      if (selectedDisplayOrderSection === '__none__') return Boolean(product.category_section_id);
      return product.category_section_id !== selectedDisplayOrderSection;
    });
    if (mismatchedProduct) {
      setDisplayOrderStatus('Display order stopped because a product does not belong to the selected category and section.');
      updateDisplayOrderButtons();
      return;
    }

    const savedOrder = sortableProducts.map((product, index) => ({
      id: product.id,
      name: product.name || 'Untitled product',
      sort_order: index,
    }));

    displayOrderSaving = true;
    if (displayOrderCategorySelect) displayOrderCategorySelect.disabled = true;
    if (displayOrderSectionSelect) displayOrderSectionSelect.disabled = true;
    updateDisplayOrderButtons();
    setDisplayOrderStatus('Saving display order...');

    for (const product of savedOrder) {
      let updateQuery = client
        .from('products')
        .update({ sort_order: product.sort_order })
        .eq('id', product.id)
        .eq('category_id', selectedDisplayOrderCategory);

      updateQuery = selectedDisplayOrderSection === '__none__'
        ? updateQuery.is('category_section_id', null)
        : updateQuery.eq('category_section_id', selectedDisplayOrderSection);

      const { data, error } = await updateQuery.select('id').single();

      if (error || !data) {
        displayOrderSaving = false;
        if (displayOrderCategorySelect) displayOrderCategorySelect.disabled = !latestCategories.length;
        renderDisplayOrderSections(latestDisplayOrderSections);
        updateDisplayOrderButtons();
        setDisplayOrderStatus('Unable to save display order for ' + product.name + '. Earlier rows may have saved; local order is still visible so you can retry. ' + (error ? error.message : 'No matching product row was updated.'));
        return;
      }
    }

    const savedSortById = new Map(savedOrder.map((product) => [product.id, product.sort_order]));
    latestProducts = sortProductsForPreview(latestProducts.map((product) => {
      if (!savedSortById.has(product.id)) return product;
      return { ...product, sort_order: savedSortById.get(product.id) };
    }));

    displayOrderOriginalProducts = getDisplayOrderProductsForSelection();
    sortableProducts = displayOrderOriginalProducts.slice();
    displayOrderSaving = false;
    if (displayOrderCategorySelect) displayOrderCategorySelect.disabled = !latestCategories.length;
    renderDisplayOrderSections(latestDisplayOrderSections);
    setDisplayOrderDirty(false);
    renderDisplayOrderList();
    renderProducts(latestProducts);
    setDisplayOrderStatus('Display order saved for ' + getDisplayOrderSectionLabel() + '.');
  };

  const renderProductFilters = (categories) => {
    if (!productFilterBar || !productFilterList) return;
    productFilterList.innerHTML = '';
    productFilterBar.hidden = !categories.length;
    if (!categories.length) {
      renderProductSections([]);
      return;
    }

    const makeFilterOption = (label, value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    };

    productFilterList.appendChild(makeFilterOption('All categories', 'all'));
    categories.forEach((category) => {
      productFilterList.appendChild(makeFilterOption(category.name, category.id));
    });
    productFilterList.value = selectedCategoryFilter;
    productFilterList.onchange = async () => {
      selectedCategoryFilter = productFilterList.value || 'all';
      selectedSectionFilter = 'all';
      hideInlineCategoryRename();
      hideInlineSectionCreate();
      hideInlineSectionRename();
      updateCategoryActionButtons();
      await loadCategorySections(getSelectedProductListCategoryId());
      renderProducts(latestProducts);
    };
    loadCategorySections(getSelectedProductListCategoryId());
    updateCategoryActionButtons();
  };

  const restoreStaticCategories = () => {
    if (categoryList && staticCategoryMarkup) categoryList.innerHTML = staticCategoryMarkup;
    if (categoryStatus) categoryStatus.textContent = 'Static shell';
  };

  const renderProductEmptyState = (title, message) => {
    if (!productList) return;
    productList.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'product-empty-state';

    const heading = document.createElement('h3');
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = message;

    empty.append(heading, copy);
    productList.appendChild(empty);
  };

  const resetProductPreview = () => {
    latestProducts = [];
    latestCategorySections = [];
    selectedCategoryFilter = 'all';
    selectedSectionFilter = 'all';
    selectedProductStatusFilter = 'all';
    if (productStatus) productStatus.textContent = 'Locked';
    if (productCount) productCount.textContent = 'Sign in to load products.';
    productSearchQuery = '';
    if (productFilterBar) productFilterBar.hidden = true;
    if (productFilterList) productFilterList.innerHTML = '';
    renderProductSections([]);
    if (productStatusFilter) productStatusFilter.value = 'all';
    if (productSearchBar) productSearchBar.hidden = true;
    if (productSearchInput) productSearchInput.value = '';
    if (clearProductSearchButton) clearProductSearchButton.disabled = true;
    latestVisibleProducts = [];
    updateBulkPublishControls();
    resetDisplayOrder();
    resetOptionGroups();
    renderProductEmptyState('Owner sign-in required', 'Products from Supabase will appear here after the owner account is connected.');
  };

  const formatPrice = (price) => new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(Number(price || 0));

  const makeBadge = (label, className) => {
    const badge = document.createElement('span');
    badge.className = className ? 'product-badge ' + className : 'product-badge';
    badge.textContent = label;
    return badge;
  };

  const getProductSearchText = (product) => {
    const variants = Array.isArray(product.product_sizes) ? product.product_sizes : [];
    const section = product.category_section_id
      ? latestCategorySections.find((item) => item.id === product.category_section_id)
      : null;
    return [
      product.name,
      product.category ? product.category.name : '',
      section ? section.name : '',
      product.variant_group_name,
      ...variants.map((variant) => variant.label),
    ].filter(Boolean).join(' ').toLowerCase();
  };

  const getFilteredProductsForPreview = (products = latestProducts) => {
    const sourceProducts = products || [];
    const categoryFilteredProducts = selectedCategoryFilter === 'all'
      ? sourceProducts
      : sourceProducts.filter((product) => product.category_id === selectedCategoryFilter);

    const sectionFilteredProducts = selectedSectionFilter === 'all'
      ? categoryFilteredProducts
      : categoryFilteredProducts.filter((product) => product.category_section_id === selectedSectionFilter);

    const statusFilteredProducts = sectionFilteredProducts.filter((product) => {
      if (selectedProductStatusFilter === 'draft') return !product.is_published;
      if (selectedProductStatusFilter === 'published') return product.is_published;
      if (selectedProductStatusFilter === 'available') return product.is_available;
      if (selectedProductStatusFilter === 'unavailable') return !product.is_available;
      return true;
    });

    const query = productSearchQuery.trim().toLowerCase();
    const searchedProducts = query
      ? statusFilteredProducts.filter((product) => getProductSearchText(product).includes(query))
      : statusFilteredProducts;
    return sortProductsForBrowsing(searchedProducts);
  };

  const updateBulkPublishControls = () => {
    const count = latestVisibleProducts.length;
    if (productBulkActions) productBulkActions.hidden = !latestProducts.length;
    if (bulkPublishCount) {
      bulkPublishCount.textContent = count === 1 ? '1 filtered product' : count + ' filtered products';
    }
    const shouldDisable = !isOwnerSignedIn || bulkPublishSaving || count === 0;
    if (bulkPublishFilteredButton) bulkPublishFilteredButton.disabled = shouldDisable;
    if (bulkUnpublishFilteredButton) bulkUnpublishFilteredButton.disabled = shouldDisable;
  };

  const appendImagePreview = (card, product) => {
    if (!product.image_url) return;

    const preview = document.createElement('div');
    preview.className = 'product-image-preview';

    const image = document.createElement('img');
    image.src = product.image_url;
    image.alt = '';
    image.loading = 'lazy';

    const copy = document.createElement('div');
    const placeholder = document.createElement('p');
    placeholder.className = 'product-image-placeholder';
    placeholder.textContent = 'Image unavailable';
    placeholder.hidden = true;
    const path = document.createElement('p');
    path.className = 'product-image-path';
    path.textContent = product.image_url;
    copy.append(placeholder, path);

    image.addEventListener('error', () => {
      image.hidden = true;
      placeholder.hidden = false;
      preview.classList.add('is-missing');
    }, { once: true });

    preview.append(image, copy);
    card.appendChild(preview);
  };

  const renderCategories = (categories) => {
    latestCategories = categories;
    populateDraftCategorySelect(categories);
    populateDisplayOrderCategorySelect(categories);
    renderProductFilters(categories);
    setDraftFormDisabled(!categories.length);
    if (!categoryList) return;
    categoryList.innerHTML = '';

    if (!categories.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-message';
      empty.textContent = 'No categories found.';
      categoryList.appendChild(empty);
      return;
    }

    categories.forEach((category, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = index === 0 ? 'category-item is-selected' : 'category-item';
      button.textContent = category.name;
      button.dataset.categoryId = category.id;
      categoryList.appendChild(button);
    });
  };

  const renderOptionEmptyState = (container, title, message, titleLevel = 'h3') => {
    if (!container) return;
    container.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'option-empty-state';

    const heading = document.createElement(titleLevel);
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = message;

    empty.append(heading, copy);
    container.appendChild(empty);
  };

  const setOptionGroupFormDisabled = (isDisabled) => {
    if (!optionGroupForm) return;
    Array.from(optionGroupForm.elements).forEach((field) => {
      field.disabled = isDisabled || optionGroupSaving;
    });
    if (saveOptionGroupButton) saveOptionGroupButton.disabled = isDisabled || optionGroupSaving;
    if (resetOptionGroupButton) resetOptionGroupButton.disabled = isDisabled || optionGroupSaving;
  };

  const resetOptionGroupForm = () => {
    editingOptionGroupId = null;
    if (optionGroupForm) {
      optionGroupForm.reset();
      if (optionGroupForm.elements.selection_type) optionGroupForm.elements.selection_type.value = 'single';
      if (optionGroupForm.elements.sort_order) optionGroupForm.elements.sort_order.value = '0';
      if (optionGroupForm.elements.is_active) optionGroupForm.elements.is_active.checked = true;
    }
    if (optionGroupFormTitle) optionGroupFormTitle.textContent = 'Create Option Group';
    setOptionGroupFormDisabled(!isOwnerSignedIn);
  };

  const loadOptionGroupIntoForm = (groupId) => {
    const group = optionGroupsList.find((item) => item.id === groupId);
    if (!group || !optionGroupForm) {
      setOptionManagerStatus('Option group could not be found.');
      return;
    }

    editingOptionGroupId = group.id;
    optionGroupForm.elements.name.value = group.name || '';
    optionGroupForm.elements.group_key.value = group.group_key || '';
    optionGroupForm.elements.selection_type.value = group.selection_type || 'single';
    optionGroupForm.elements.sort_order.value = String(group.sort_order ?? 0);
    optionGroupForm.elements.is_active.checked = Boolean(group.is_active);
    if (optionGroupFormTitle) optionGroupFormTitle.textContent = 'Edit Option Group';
    setOptionGroupFormDisabled(false);
    setOptionManagerStatus('Editing option group. Save changes or reset the form.');
  };

  const validateOptionGroupForm = () => {
    if (!optionGroupForm) return null;
    const formData = new FormData(optionGroupForm);
    const name = String(formData.get('name') || '').trim();
    const groupKey = String(formData.get('group_key') || '').trim();
    const selectionType = String(formData.get('selection_type') || '').trim();
    const sortOrderText = String(formData.get('sort_order') || '').trim();
    const sortOrder = sortOrderText ? Number(sortOrderText) : 0;

    if (!name) return { error: 'Option group name is required.' };
    if (!groupKey) return { error: 'Group key is required.' };
    if (!/^[a-z][a-z0-9_]*$/.test(groupKey)) {
      return { error: 'Group key must use lowercase snake_case, such as milk, extra_shot, or savory_sauce.' };
    }
    if (!['single', 'multi'].includes(selectionType)) {
      return { error: 'Selection type must be single or multi.' };
    }
    if (!Number.isInteger(sortOrder)) {
      return { error: 'Sort order must be a whole number.' };
    }

    return {
      value: {
        name,
        group_key: groupKey,
        selection_type: selectionType,
        sort_order: sortOrder,
        is_active: formData.get('is_active') === 'on',
      },
    };
  };

  const createOptionValueFromLabel = (label) => {
    return String(label || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'choice';
  };

  const setOptionChoiceFormDisabled = (isDisabled) => {
    if (!optionChoiceForm) return;
    const shouldDisable = isDisabled || optionChoiceSaving;
    Array.from(optionChoiceForm.elements).forEach((field) => {
      field.disabled = shouldDisable;
    });
    if (saveOptionChoiceButton) saveOptionChoiceButton.disabled = shouldDisable;
    if (resetOptionChoiceButton) resetOptionChoiceButton.disabled = shouldDisable;
  };

  const resetOptionChoiceForm = () => {
    editingOptionChoiceId = null;
    if (optionChoiceForm) {
      optionChoiceForm.reset();
      if (optionChoiceForm.elements.price_delta) optionChoiceForm.elements.price_delta.value = '0';
      if (optionChoiceForm.elements.sort_order) optionChoiceForm.elements.sort_order.value = '0';
      if (optionChoiceForm.elements.is_active) optionChoiceForm.elements.is_active.checked = true;
    }
    if (optionChoiceFormTitle) optionChoiceFormTitle.textContent = 'Create Option Choice';
    setOptionChoiceFormDisabled(!isOwnerSignedIn || !selectedOptionGroupId);
  };

  const loadOptionChoiceIntoForm = (choiceId) => {
    const choice = optionChoicesList.find((item) => item.id === choiceId);
    if (!choice || !optionChoiceForm) {
      setOptionManagerStatus('Option choice could not be found.');
      return;
    }

    editingOptionChoiceId = choice.id;
    optionChoiceForm.elements.label.value = choice.label || '';
    optionChoiceForm.elements.value.value = choice.value || '';
    optionChoiceForm.elements.price_delta.value = String(choice.price_delta ?? 0);
    optionChoiceForm.elements.sort_order.value = String(choice.sort_order ?? 0);
    optionChoiceForm.elements.is_active.checked = Boolean(choice.is_active);
    if (optionChoiceFormTitle) optionChoiceFormTitle.textContent = 'Edit Option Choice';
    setOptionChoiceFormDisabled(false);
    setOptionManagerStatus('Editing option choice. Save changes or reset the choice form.');
  };

  const validateOptionChoiceForm = () => {
    if (!optionChoiceForm) return null;
    if (!selectedOptionGroupId) return { error: 'Select an option group before creating a choice.' };

    const formData = new FormData(optionChoiceForm);
    const label = String(formData.get('label') || '').trim();
    const rawValue = String(formData.get('value') || '').trim();
    const value = rawValue || createOptionValueFromLabel(label);
    const priceDeltaText = String(formData.get('price_delta') || '').trim();
    const sortOrderText = String(formData.get('sort_order') || '').trim();
    const priceDelta = priceDeltaText ? Number(priceDeltaText) : 0;
    const sortOrder = sortOrderText ? Number(sortOrderText) : 0;

    if (!label) return { error: 'Choice label is required.' };
    if (!Number.isFinite(priceDelta) || priceDelta < 0) {
      return { error: 'Price delta must be 0 or greater.' };
    }
    if (!Number.isInteger(sortOrder)) {
      return { error: 'Sort order must be a whole number.' };
    }

    return {
      value: {
        option_group_id: selectedOptionGroupId,
        label,
        value,
        price_delta: priceDelta,
        sort_order: sortOrder,
        is_active: formData.get('is_active') === 'on',
      },
    };
  };

  const resetOptionGroups = () => {
    optionGroupsList = [];
    optionChoicesList = [];
    selectedOptionGroupId = '';
    editingOptionGroupId = null;
    editingOptionChoiceId = null;
    optionGroupsLoaded = false;
    optionGroupsLoading = false;
    if (optionGroupStatus) optionGroupStatus.textContent = 'Locked';
    resetOptionGroupForm();
    setOptionGroupFormDisabled(true);
    resetOptionChoiceForm();
    setOptionChoiceFormDisabled(true);
    renderOptionEmptyState(optionGroupList, 'Owner sign-in required', 'Reusable option groups will appear here after owner sign-in.', 'h4');
    renderOptionEmptyState(optionGroupDetail, 'Select a group', 'Select a group to see its choices.');
    if (optionChoiceList) optionChoiceList.innerHTML = '';
    setOptionManagerStatus('Sign in to load reusable option groups.');
  };

  const renderOptionGroups = (groups) => {
    optionGroupsList = groups || [];
    if (!optionGroupList) return;
    optionGroupList.innerHTML = '';

    if (optionGroupStatus) optionGroupStatus.textContent = 'Owner access';

    if (!optionGroupsList.length) {
      renderOptionEmptyState(optionGroupList, 'No option groups yet.', 'Use the form above to create the first reusable group.', 'h4');
      return;
    }

    optionGroupsList.forEach((group) => {
      const item = document.createElement('article');
      item.className = group.id === selectedOptionGroupId ? 'option-group-item is-selected' : 'option-group-item';
      item.dataset.optionGroupId = group.id;

      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'option-group-select';

      const name = document.createElement('span');
      name.className = 'option-group-name';
      name.textContent = group.name || 'Untitled group';

      const meta = document.createElement('span');
      meta.className = 'option-group-meta';
      meta.textContent = group.group_key || 'no key';

      const type = document.createElement('span');
      type.className = 'option-status-pill is-type';
      type.textContent = String(group.selection_type || 'unknown').toUpperCase();

      const status = document.createElement('span');
      status.className = group.is_active ? 'option-status-pill is-active' : 'option-status-pill is-inactive';
      status.textContent = group.is_active ? 'ACTIVE' : 'INACTIVE';

      selectButton.append(name, meta, type, status);
      selectButton.addEventListener('click', () => selectOptionGroup(group.id));

      const actions = document.createElement('div');
      actions.className = 'option-group-actions';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'option-mini-button';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => {
        selectOptionGroup(group.id);
        loadOptionGroupIntoForm(group.id);
      });

      const activeButton = document.createElement('button');
      activeButton.type = 'button';
      activeButton.className = group.is_active ? 'option-mini-button is-muted' : 'option-mini-button';
      activeButton.textContent = group.is_active ? 'Deactivate' : 'Reactivate';
      activeButton.addEventListener('click', () => toggleOptionGroupActive(group.id, !group.is_active));

      actions.append(editButton, activeButton);
      item.append(selectButton, actions);
      optionGroupList.appendChild(item);
    });
  };

  const renderOptionGroupDetail = (group) => {
    if (!optionGroupDetail) return;

    if (!group) {
      renderOptionEmptyState(optionGroupDetail, 'Select a group', 'Select a group to see its choices.');
      return;
    }

    optionGroupDetail.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'option-detail-header';

    const title = document.createElement('h3');
    title.textContent = group.name || 'Untitled group';
    const status = document.createElement('span');
    status.className = group.is_active ? 'option-status-pill is-active' : 'option-status-pill is-inactive';
    status.textContent = group.is_active ? 'ACTIVE' : 'INACTIVE';
    header.append(title, status);

    const details = document.createElement('dl');
    details.className = 'option-detail-list';

    const addDetail = (label, value) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value || '-';
      details.append(term, description);
    };

    addDetail('Group key', group.group_key);
    addDetail('Selection type', group.selection_type);
    addDetail('Sort order', String(group.sort_order ?? 0));

    optionGroupDetail.append(header, details);
  };

  const renderOptionChoices = (choices) => {
    optionChoicesList = choices || [];
    if (!optionChoiceList) return;
    optionChoiceList.innerHTML = '';

    if (!selectedOptionGroupId) {
      renderOptionEmptyState(optionChoiceList, 'Select a group to see its choices.', 'Choices will appear after you select an option group.', 'h4');
      return;
    }

    const heading = document.createElement('h4');
    heading.className = 'option-choice-heading';
    heading.textContent = 'Choices';
    optionChoiceList.appendChild(heading);

    if (!optionChoicesList.length) {
      renderOptionEmptyState(optionChoiceList, 'This group has no choices yet.', 'Choices will appear here after they are added in the next step.', 'h4');
      return;
    }

    optionChoicesList.forEach((choice) => {
      const row = document.createElement('article');
      row.className = 'option-choice-card';

      const top = document.createElement('div');
      top.className = 'option-choice-top';
      const name = document.createElement('h5');
      name.textContent = choice.label || 'Untitled choice';
      const status = document.createElement('span');
      status.className = choice.is_active ? 'option-status-pill is-active' : 'option-status-pill is-inactive';
      status.textContent = choice.is_active ? 'ACTIVE' : 'INACTIVE';
      top.append(name, status);

      const meta = document.createElement('p');
      meta.className = 'option-choice-meta';
      const priceDelta = Number(choice.price_delta || 0);
      meta.textContent = [
        choice.value ? 'Value: ' + choice.value : 'No value set',
        priceDelta > 0 ? '+' + formatPrice(priceDelta) : 'Free',
        'Sort: ' + String(choice.sort_order ?? 0),
      ].join(' - ');

      row.append(top, meta);
      const actions = document.createElement('div');
      actions.className = 'option-choice-actions';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'option-mini-button';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => loadOptionChoiceIntoForm(choice.id));

      const activeButton = document.createElement('button');
      activeButton.type = 'button';
      activeButton.className = choice.is_active ? 'option-mini-button is-muted' : 'option-mini-button';
      activeButton.textContent = choice.is_active ? 'Deactivate' : 'Reactivate';
      activeButton.addEventListener('click', () => toggleOptionChoiceActive(choice.id, !choice.is_active));

      actions.append(editButton, activeButton);
      row.appendChild(actions);
      optionChoiceList.appendChild(row);
    });
  };

  const selectOptionGroup = async (groupId) => {
    selectedOptionGroupId = groupId || '';
    resetOptionChoiceForm();
    renderOptionGroups(optionGroupsList);

    const group = optionGroupsList.find((item) => item.id === selectedOptionGroupId);
    renderOptionGroupDetail(group);

    if (!group) {
      optionChoicesList = [];
      if (optionChoiceList) optionChoiceList.innerHTML = '';
      setOptionChoiceFormDisabled(true);
      setOptionManagerStatus('Select an option group to view choices.');
      return;
    }

    await loadOptionChoices(group.id);
  };

  const renderProducts = (products) => {
    latestProducts = products || [];
    if (!productList) return;
    productList.innerHTML = '';

    if (productSearchBar) productSearchBar.hidden = !latestProducts.length;
    if (productStatusFilter) productStatusFilter.value = selectedProductStatusFilter;
    if (productListSortSelect) productListSortSelect.value = selectedProductListSort;
    if (clearProductSearchButton) clearProductSearchButton.disabled = !productSearchQuery;

    const query = productSearchQuery.trim().toLowerCase();
    const visibleProducts = getFilteredProductsForPreview(latestProducts);
    latestVisibleProducts = visibleProducts;
    updateBulkPublishControls();

    if (!latestProducts.length) {
      if (productStatus) productStatus.textContent = 'Supabase draft list';
      if (productCount) productCount.textContent = '0 products';
      renderProductEmptyState('No products in Supabase yet.', 'Create a draft product when you are ready. Drafts stay admin-only until a future approved menu connection.');
      return;
    }

    if (!visibleProducts.length) {
      if (productStatus) productStatus.textContent = 'Supabase draft list';
      if (productCount) productCount.textContent = latestProducts.length === 1 ? '1 product total' : latestProducts.length + ' products total';
      renderProductEmptyState('No products match this filter.', 'Try All categories, All statuses, clear search, or use a different product name, category, sold-by value, or variant label.');
      return;
    }

    if (productStatus) productStatus.textContent = 'Supabase draft list';
    if (productCount) {
      const totalText = latestProducts.length === 1 ? '1 product total' : latestProducts.length + ' products total';
      productCount.textContent = selectedCategoryFilter === 'all' && selectedSectionFilter === 'all' && selectedProductStatusFilter === 'all' && !query
        ? totalText
        : visibleProducts.length + ' shown - ' + totalText;
    }

    visibleProducts.forEach((product) => {
      const card = document.createElement('article');
      card.className = product.is_published ? 'product-preview-card is-published' : 'product-preview-card is-draft';

      const top = document.createElement('div');
      top.className = 'product-card-top';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'product-card-title';
      title.textContent = product.name;
      const category = document.createElement('p');
      category.className = 'product-card-category';
      category.textContent = product.category ? product.category.name : 'Uncategorized';
      const section = product.category_section_id
        ? latestCategorySections.find((item) => item.id === product.category_section_id)
        : null;
      if (section) {
        category.textContent += ' / ' + section.name;
      }
      const soldBy = document.createElement('p');
      soldBy.className = 'product-sold-by';
      soldBy.textContent = 'Sold by: ' + (product.variant_group_name || 'Each');
      titleWrap.append(title, category, soldBy);

      const badges = document.createElement('div');
      badges.className = 'product-badge-row';
      badges.appendChild(makeBadge(product.is_published ? 'Published' : 'Draft', product.is_published ? 'is-live' : 'is-muted'));
      badges.appendChild(makeBadge(product.is_available ? 'Available' : 'Unavailable', product.is_available ? 'is-available' : 'is-muted'));
      if (product.is_curv_pick) badges.appendChild(makeBadge('CURV Pick', 'is-special'));
      if (product.is_seasonal) badges.appendChild(makeBadge('Seasonal', 'is-special'));
      top.append(titleWrap, badges);
      card.appendChild(top);

      appendImagePreview(card, product);

      if (product.description) {
        const description = document.createElement('p');
        description.className = 'product-card-description';
        description.textContent = product.description;
        card.appendChild(description);
      }

      const variants = Array.isArray(product.product_sizes) ? product.product_sizes.slice() : [];
      variants.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.label).localeCompare(String(b.label)));
      const variantRow = document.createElement('div');
      variantRow.className = 'product-variant-row';
      if (variants.length) {
        variants.forEach((variant) => {
          const pill = document.createElement('span');
          pill.className = 'product-variant-pill';
          pill.append(document.createTextNode(variant.label + ' ' + formatPrice(variant.price)));
          if (variant.cost !== null && variant.cost !== undefined) {
            const cost = document.createElement('span');
            cost.className = 'product-variant-cost';
            cost.textContent = ' - Internal cost ' + formatPrice(variant.cost);
            pill.appendChild(cost);
          }
          variantRow.appendChild(pill);
        });
      } else {
        const pill = document.createElement('span');
        pill.className = 'product-variant-pill';
        pill.textContent = 'No variants yet';
        variantRow.appendChild(pill);
      }
      card.appendChild(variantRow);

      const actions = document.createElement('div');
      actions.className = 'product-card-actions';
      if (true) {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'product-action-button';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => loadProductIntoForm(product.id));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'product-action-button is-danger';
        deleteButton.textContent = 'Ã°Å¸â€”â€˜Ã¯Â¸Â';
        deleteButton.title = 'Delete draft product';
        deleteButton.setAttribute('aria-label', 'Delete draft product');
        deleteButton.addEventListener('click', () => deleteDraftProduct(product.id));

        const publishButton = document.createElement('button');
        publishButton.type = 'button';
        publishButton.className = 'product-action-button is-publish';
        publishButton.textContent = 'Publish';
        publishButton.addEventListener('click', () => updateProductPublishedState(product.id, true));

        actions.append(editButton);
      } else if (false) {
        const lockedButton = document.createElement('button');
        lockedButton.type = 'button';
        lockedButton.className = 'product-action-button';
        lockedButton.textContent = 'Edit';
        lockedButton.addEventListener('click', () => loadProductIntoForm(product.id));

        const unpublishButton = document.createElement('button');
        unpublishButton.type = 'button';
        unpublishButton.className = 'product-action-button is-publish';
        unpublishButton.textContent = 'Unpublish';
        unpublishButton.addEventListener('click', () => updateProductPublishedState(product.id, false));

        actions.append(lockedButton, unpublishButton);
      }
      card.appendChild(actions);
      productList.appendChild(card);
    });
  };

  const setVariantRows = (variants) => {
    if (!variantList) return;
    variantList.innerHTML = '';
    variantRowCount = 0;
    const rows = variants.length ? variants : [{ label: 'Each', price: '', cost: '', touched: false }];
    rows.forEach((variant) => {
      const row = createVariantRow({
        label: variant.label || '',
        price: variant.price ?? '',
        cost: variant.cost ?? '',
        touched: true,
      });
      variantList.appendChild(row);
      bindVariantRow(row);
    });
    updateRemoveButtons();
  };

  const loadProductIntoForm = async (productId) => {
    const product = latestProducts.find((item) => item.id === productId);
    if (!product) {
      setStatus('Product could not be found in the current preview.');
      return;
    }

    resetDraftProductForm();
    populateDraftCategorySelect(latestCategories);
    setDraftFormDisabled(false);

    draftForm.elements.name.value = product.name || '';
    draftForm.elements.category_id.value = product.category_id || '';
    previousDraftCategoryValue = product.category_id || '';
    await loadDraftCategorySections(product.category_id || '', product.category_section_id || '');
    updateCategoryActionButtons();
    draftForm.elements.image_url.value = product.image_url || '';
    draftForm.elements.description.value = product.description || '';
    draftForm.elements.notes.value = product.notes || '';
    setProductBadges(product.badge_labels);
    draftForm.elements.is_available.checked = Boolean(product.is_available);
    draftForm.elements.is_curv_pick.checked = Boolean(product.is_curv_pick);
    draftForm.elements.is_seasonal.checked = Boolean(product.is_seasonal);

    const groupName = product.variant_group_name || 'Each';
    resetVariantGroupOptions(groupName);
    if (customVariantInput) customVariantInput.value = '';
    syncVariantGroupFields();

    const variants = Array.isArray(product.product_sizes) ? product.product_sizes.slice() : [];
    variants.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.label).localeCompare(String(b.label)));
    setVariantRows(variants.map((variant) => ({
      label: variant.label,
      price: variant.price,
      cost: variant.cost,
      touched: true,
    })));

    setEditMode(product.id);
    markDraftFormClean();
    loadProductOptionAttachments(product.id);
    draftForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus(product.is_published ? 'This item is published. Saving changes updates the live menu.' : 'Editing draft product. Save changes or cancel.');
  };


  resetProductPreview();
  resetDraftProductForm();

  if (!hasSupabaseConfig) {
    setStatus('Supabase config missing. Add project URL and publishable key before connecting.');
    setFormDisabled(true);
    if (signOutButton) signOutButton.disabled = true;
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    setStatus('Supabase client could not load. Check the admin page script connection.');
    setFormDisabled(true);
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  const loadOptionGroups = async (forceReload = false) => {
    if (!isOwnerSignedIn) {
      resetOptionGroups();
      return;
    }

    if (!forceReload && (optionGroupsLoaded || optionGroupsLoading)) {
      setOptionGroupFormDisabled(false);
      renderOptionGroups(optionGroupsList);
      renderOptionGroupDetail(optionGroupsList.find((item) => item.id === selectedOptionGroupId));
      renderOptionChoices(optionChoicesList);
      return;
    }

    optionGroupsLoading = true;
    if (optionGroupStatus) optionGroupStatus.textContent = 'Loading';
    setOptionManagerStatus('Loading option groups...');

    const { data, error } = await client
      .from('option_groups')
      .select('id,name,group_key,selection_type,is_active,sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      optionGroupsList = [];
      optionChoicesList = [];
      selectedOptionGroupId = '';
      optionGroupsLoading = false;
      optionGroupsLoaded = false;
      if (optionGroupStatus) optionGroupStatus.textContent = 'Error';
      renderOptionEmptyState(optionGroupList, 'Unable to load option groups.', error.message, 'h4');
      renderOptionEmptyState(optionGroupDetail, 'Select a group', 'Select a group to see its choices.');
      if (optionChoiceList) optionChoiceList.innerHTML = '';
      setOptionManagerStatus('Unable to load option groups. ' + error.message);
      return;
    }

    const groups = data || [];
    optionGroupsList = groups;
    optionGroupsLoading = false;
    optionGroupsLoaded = true;
    if (selectedOptionGroupId && !groups.some((group) => group.id === selectedOptionGroupId)) {
      selectedOptionGroupId = '';
    }
    optionChoicesList = [];
    setOptionGroupFormDisabled(false);
    renderOptionGroups(groups);
    renderOptionGroupDetail(optionGroupsList.find((item) => item.id === selectedOptionGroupId));
    if (selectedOptionGroupId) {
      await loadOptionChoices(selectedOptionGroupId);
    } else {
      renderOptionChoices([]);
    }

    if (!groups.length) {
      setOptionManagerStatus('No option groups yet.');
      return;
    }

    setOptionManagerStatus('Option groups loaded. Select a group to see its choices.');
  };

  const loadOptionChoices = async (groupId) => {
    if (!groupId) {
      optionChoicesList = [];
      renderOptionChoices([]);
      return;
    }

    setOptionManagerStatus('Loading option choices...');
    const { data, error } = await client
      .from('option_choices')
      .select('id,option_group_id,label,value,price_delta,sort_order,is_active')
      .eq('option_group_id', groupId)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true });

    if (error) {
      optionChoicesList = [];
      renderOptionEmptyState(optionChoiceList, 'Unable to load choices.', error.message, 'h4');
      setOptionManagerStatus('Unable to load option choices. ' + error.message);
      return;
    }

    renderOptionChoices(data || []);
    setOptionChoiceFormDisabled(false);
    setOptionManagerStatus((data || []).length ? 'Option choices loaded.' : 'No choices in this group yet.');
  };

  const saveOptionChoice = async (event) => {
    event.preventDefault();
    if (!isOwnerSignedIn || optionChoiceSaving) return;

    const validation = validateOptionChoiceForm();
    if (!validation) return;
    if (validation.error) {
      setOptionManagerStatus(validation.error);
      return;
    }

    const wasEditing = Boolean(editingOptionChoiceId);
    optionChoiceSaving = true;
    setOptionChoiceFormDisabled(false);
    setOptionManagerStatus(wasEditing ? 'Saving option choice...' : 'Creating option choice...');

    const payload = validation.value;
    let error = null;

    if (editingOptionChoiceId) {
      const response = await client
        .from('option_choices')
        .update({
          label: payload.label,
          value: payload.value,
          price_delta: payload.price_delta,
          sort_order: payload.sort_order,
          is_active: payload.is_active,
        })
        .eq('id', editingOptionChoiceId)
        .eq('option_group_id', selectedOptionGroupId)
        .select('id')
        .single();
      error = response.error;
    } else {
      const response = await client
        .from('option_choices')
        .insert(payload)
        .select('id')
        .single();
      error = response.error;
    }

    optionChoiceSaving = false;

    if (error) {
      setOptionChoiceFormDisabled(false);
      setOptionManagerStatus('Unable to save option choice. ' + error.message);
      return;
    }

    resetOptionChoiceForm();
    await loadOptionChoices(selectedOptionGroupId);
    setOptionManagerStatus(wasEditing ? 'Option choice updated.' : 'Option choice created.');
  };

  const toggleOptionChoiceActive = async (choiceId, shouldBeActive) => {
    if (!isOwnerSignedIn || optionChoiceSaving || !selectedOptionGroupId) return;
    const choice = optionChoicesList.find((item) => item.id === choiceId);
    if (!choice) {
      setOptionManagerStatus('Option choice could not be found.');
      return;
    }

    const actionLabel = shouldBeActive ? 'reactivate' : 'deactivate';
    const confirmed = window.confirm((shouldBeActive ? 'Reactivate' : 'Deactivate') + ' this option choice?');
    if (!confirmed) return;

    optionChoiceSaving = true;
    setOptionChoiceFormDisabled(false);
    setOptionManagerStatus((shouldBeActive ? 'Reactivating' : 'Deactivating') + ' option choice...');

    const { error } = await client
      .from('option_choices')
      .update({ is_active: shouldBeActive })
      .eq('id', choiceId)
      .eq('option_group_id', selectedOptionGroupId);

    optionChoiceSaving = false;

    if (error) {
      setOptionChoiceFormDisabled(false);
      setOptionManagerStatus('Unable to ' + actionLabel + ' option choice. ' + error.message);
      return;
    }

    if (editingOptionChoiceId === choiceId && optionChoiceForm && optionChoiceForm.elements.is_active) {
      optionChoiceForm.elements.is_active.checked = shouldBeActive;
    }
    await loadOptionChoices(selectedOptionGroupId);
    setOptionManagerStatus('Option choice ' + (shouldBeActive ? 'reactivated.' : 'deactivated.'));
  };

  const saveOptionGroup = async (event) => {
    event.preventDefault();
    if (!isOwnerSignedIn || optionGroupSaving) return;

    const validation = validateOptionGroupForm();
    if (!validation) return;
    if (validation.error) {
      setOptionManagerStatus(validation.error);
      return;
    }

    const wasEditing = Boolean(editingOptionGroupId);
    optionGroupSaving = true;
    setOptionGroupFormDisabled(false);
    setOptionManagerStatus(wasEditing ? 'Saving option group...' : 'Creating option group...');

    const payload = validation.value;
    let savedGroupId = editingOptionGroupId;
    let error = null;

    if (editingOptionGroupId) {
      const response = await client
        .from('option_groups')
        .update(payload)
        .eq('id', editingOptionGroupId)
        .select('id')
        .single();
      error = response.error;
    } else {
      const response = await client
        .from('option_groups')
        .insert(payload)
        .select('id')
        .single();
      error = response.error;
      if (response.data && response.data.id) savedGroupId = response.data.id;
    }

    optionGroupSaving = false;

    if (error) {
      const duplicateKey = error.message && /duplicate|unique/i.test(error.message);
      setOptionGroupFormDisabled(false);
      setOptionManagerStatus(duplicateKey
        ? 'That group key already exists. Use a different lowercase snake_case key.'
        : 'Unable to save option group. ' + error.message);
      return;
    }

    selectedOptionGroupId = savedGroupId || '';
    resetOptionGroupForm();
    selectedOptionGroupId = savedGroupId || selectedOptionGroupId;
    optionGroupsLoaded = false;
    await loadOptionGroups(true);
    setOptionManagerStatus(wasEditing ? 'Option group updated.' : 'Option group created.');
  };

  const toggleOptionGroupActive = async (groupId, shouldBeActive) => {
    if (!isOwnerSignedIn || optionGroupSaving) return;
    const group = optionGroupsList.find((item) => item.id === groupId);
    if (!group) {
      setOptionManagerStatus('Option group could not be found.');
      return;
    }

    const actionLabel = shouldBeActive ? 'reactivate' : 'deactivate';
    const confirmed = window.confirm((shouldBeActive ? 'Reactivate' : 'Deactivate') + ' this option group?');
    if (!confirmed) return;

    optionGroupSaving = true;
    setOptionGroupFormDisabled(false);
    setOptionManagerStatus((shouldBeActive ? 'Reactivating' : 'Deactivating') + ' option group...');

    const { error } = await client
      .from('option_groups')
      .update({ is_active: shouldBeActive })
      .eq('id', groupId);

    optionGroupSaving = false;

    if (error) {
      setOptionGroupFormDisabled(false);
      setOptionManagerStatus('Unable to ' + actionLabel + ' option group. ' + error.message);
      return;
    }

    selectedOptionGroupId = groupId;
    if (editingOptionGroupId === groupId && optionGroupForm && optionGroupForm.elements.is_active) {
      optionGroupForm.elements.is_active.checked = shouldBeActive;
    }
    optionGroupsLoaded = false;
    await loadOptionGroups(true);
    setOptionManagerStatus('Option group ' + (shouldBeActive ? 'reactivated.' : 'deactivated.'));
  };

  const loadProductOptionAttachments = async (productId) => {
    if (!productId) {
      resetProductOptionAttachments();
      return;
    }

    renderProductOptionEmpty('Loading option attachments...', 'Checking product option groups in Supabase.');
    updateProductOptionAttachAvailability();

    const { data: assignments, error: assignmentError } = await client
      .from('product_option_groups')
      .select('product_id,option_group_id,is_required,min_selections,max_selections,sort_order,is_active')
      .eq('product_id', productId)
      .order('sort_order', { ascending: true });

    if (editingProductId !== productId) return;

    if (assignmentError) {
      productOptionAttachments = [];
      renderProductOptionEmpty('Unable to load option attachments.', assignmentError.message);
      return;
    }

    if (!assignments || !assignments.length) {
      productOptionAttachments = [];
      renderProductOptionAttachments([]);
      return;
    }

    const groupIds = Array.from(new Set(assignments.map((item) => item.option_group_id).filter(Boolean)));

    const [
      { data: groups, error: groupError },
      { data: defaults, error: defaultError },
    ] = await Promise.all([
      client
        .from('option_groups')
        .select('id,name,group_key,selection_type,is_active')
        .in('id', groupIds),
      client
        .from('product_option_defaults')
        .select('product_id,option_group_id,option_choice_id')
        .eq('product_id', productId),
    ]);

    if (editingProductId !== productId) return;

    if (groupError || defaultError) {
      productOptionAttachments = [];
      renderProductOptionEmpty('Unable to load option attachments.', (groupError || defaultError).message);
      return;
    }

    const choiceIds = Array.from(new Set((defaults || []).map((item) => item.option_choice_id).filter(Boolean)));
    let choices = [];
    if (choiceIds.length) {
      const { data: choiceRows, error: choiceError } = await client
        .from('option_choices')
        .select('id,option_group_id,label,is_active')
        .in('id', choiceIds);

      if (choiceError) {
        productOptionAttachments = [];
        renderProductOptionEmpty('Unable to load option attachments.', choiceError.message);
        return;
      }
      choices = choiceRows || [];
    }

    const { data: activeChoices, error: activeChoiceError } = await client
      .from('option_choices')
      .select('id,option_group_id,label,sort_order,is_active')
      .in('option_group_id', groupIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true });

    if (activeChoiceError) {
      productOptionAttachments = [];
      renderProductOptionEmpty('Unable to load option attachments.', activeChoiceError.message);
      return;
    }

    if (editingProductId !== productId) return;

    const groupMap = new Map((groups || []).map((group) => [group.id, group]));
    const choiceMap = new Map(choices.map((choice) => [choice.id, choice]));
    const choicesByGroup = new Map();
    (activeChoices || []).forEach((choice) => {
      const list = choicesByGroup.get(choice.option_group_id) || [];
      list.push(choice);
      choicesByGroup.set(choice.option_group_id, list);
    });
    const defaultsByGroup = new Map();
    (defaults || []).forEach((item) => {
      const list = defaultsByGroup.get(item.option_group_id) || [];
      list.push({
        ...item,
        choice: choiceMap.get(item.option_choice_id) || null,
      });
      defaultsByGroup.set(item.option_group_id, list);
    });

    const attachments = assignments.map((assignment) => ({
      ...assignment,
      group: groupMap.get(assignment.option_group_id) || null,
      choices: choicesByGroup.get(assignment.option_group_id) || [],
      defaults: defaultsByGroup.get(assignment.option_group_id) || [],
    }));

    renderProductOptionAttachments(attachments);
  };

  const loadCategories = async () => {
    setStatus('Loading categories...');
    const { data, error } = await client
      .from('categories')
      .select('id,name,sort_order,is_active')
      .order('sort_order', { ascending: true });

    if (error) {
      latestCategories = [];
      restoreStaticCategories();
      resetProductPreview();
      resetDraftProductForm();
      setStatus('Unable to load categories. ' + error.message);
      return;
    }

    renderCategories(data || []);
    if (categoryStatus) categoryStatus.textContent = 'Supabase read-only';
    setStatus('Connected as owner. Categories loaded.');
  };

  const createInlineCategory = async () => {
    if (!isOwnerSignedIn || inlineCategorySaving) return;

    const name = inlineCategoryNameInput ? inlineCategoryNameInput.value.trim() : '';
    if (!name) {
      setStatus('Category name is required.');
      if (inlineCategoryNameInput) inlineCategoryNameInput.focus();
      return;
    }

    inlineCategorySaving = true;
    setInlineCategoryDisabled(true);
    setStatus('Creating category...');

    const { data, error } = await client
      .from('categories')
      .insert({
        name,
        sort_order: getNextCategorySortOrder(),
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      inlineCategorySaving = false;
      setInlineCategoryDisabled(false);
      const duplicateHint = error.code === '23505' ? ' A category with this name may already exist.' : '';
      setStatus('Unable to create category.' + duplicateHint + ' ' + error.message);
      return;
    }

    await loadCategories();
    if (draftCategorySelect && data && data.id) {
      draftCategorySelect.value = data.id;
      previousDraftCategoryValue = data.id;
      await loadDraftCategorySections(data.id, '');
    }
    inlineCategorySaving = false;
    hideInlineCategoryCreate(false);
    setInlineCategoryDisabled(true);
    setStatus('Category created and selected.');
  };

  const renameSelectedCategory = async () => {
    if (!isOwnerSignedIn || inlineCategoryRenameSaving) return;

    const categoryId = getSelectedProductListCategoryId();
    const name = inlineCategoryRenameInput ? inlineCategoryRenameInput.value.trim() : '';
    if (!categoryId) {
      setStatus('Choose a category filter before renaming.');
      return;
    }
    if (!name) {
      setStatus('Category name is required.');
      if (inlineCategoryRenameInput) inlineCategoryRenameInput.focus();
      return;
    }

    inlineCategoryRenameSaving = true;
    setInlineCategoryRenameDisabled(true);
    updateCategoryActionButtons();
    setStatus('Renaming category...');

    const { error } = await client
      .from('categories')
      .update({ name })
      .eq('id', categoryId);

    if (error) {
      inlineCategoryRenameSaving = false;
      setInlineCategoryRenameDisabled(false);
      updateCategoryActionButtons();
      const duplicateHint = error.code === '23505' ? ' A category with this name may already exist.' : '';
      setStatus('Unable to rename category.' + duplicateHint + ' ' + error.message);
      return;
    }

    await loadCategories();
    selectedCategoryFilter = categoryId;
    if (productFilterList) productFilterList.value = categoryId;
    inlineCategoryRenameSaving = false;
    hideInlineCategoryRename();
    renderProducts(latestProducts);
    setStatus('Category renamed.');
  };

  const deleteSelectedCategoryIfUnused = async () => {
    if (!isOwnerSignedIn || inlineCategoryDeleteSaving) return;

    const categoryId = getSelectedProductListCategoryId();
    const category = getSelectedProductListCategory();
    if (!categoryId || !category) {
      setStatus('Choose a category filter before deleting.');
      return;
    }

    inlineCategoryDeleteSaving = true;
    updateCategoryActionButtons();
    setStatus('Checking category products...');

    const { count, error: countError } = await client
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', categoryId);

    if (countError) {
      inlineCategoryDeleteSaving = false;
      updateCategoryActionButtons();
      setStatus('Unable to check category products. ' + countError.message);
      return;
    }

    if ((count || 0) > 0) {
      inlineCategoryDeleteSaving = false;
      updateCategoryActionButtons();
      setStatus('This category has products. Move or delete those products before deleting the category.');
      return;
    }

    const confirmed = window.confirm('Delete this category permanently? This cannot be undone.');
    if (!confirmed) {
      inlineCategoryDeleteSaving = false;
      updateCategoryActionButtons();
      setStatus('Category deletion cancelled.');
      return;
    }

    setStatus('Deleting category...');
    const { error } = await client
      .from('categories')
      .delete()
      .eq('id', categoryId);

    if (error) {
      inlineCategoryDeleteSaving = false;
      updateCategoryActionButtons();
      setStatus('Unable to delete category. ' + error.message);
      return;
    }

    if (draftCategorySelect) draftCategorySelect.value = '';
    if (selectedCategoryFilter === categoryId) selectedCategoryFilter = 'all';
    selectedSectionFilter = 'all';
    if (selectedDisplayOrderCategory === categoryId) selectedDisplayOrderCategory = '';
    hideInlineCategoryCreate(false);
    hideInlineCategoryRename();
    renderProductSections([]);
    await loadCategories();
    await loadProducts();
    inlineCategoryDeleteSaving = false;
    updateCategoryActionButtons();
    setStatus('Category deleted.');
  };

  const createInlineSection = async () => {
    if (!isOwnerSignedIn || inlineSectionSaving) return;

    const categoryId = getSelectedProductListCategoryId();
    const name = inlineSectionNameInput ? inlineSectionNameInput.value.trim() : '';
    if (!categoryId) {
      setStatus('Choose a category before adding a section.');
      return;
    }
    if (!name) {
      setStatus('Section name is required.');
      if (inlineSectionNameInput) inlineSectionNameInput.focus();
      return;
    }

    inlineSectionSaving = true;
    setInlineSectionCreateDisabled(true);
    updateSectionActionButtons();
    setStatus('Creating section...');

    const { data, error } = await client
      .from('category_sections')
      .insert({
        category_id: categoryId,
        name,
        sort_order: getNextSectionSortOrder(),
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      inlineSectionSaving = false;
      setInlineSectionCreateDisabled(false);
      updateSectionActionButtons();
      const duplicateHint = error.code === '23505' ? ' A section with this name may already exist in this category.' : '';
      setStatus('Unable to create section.' + duplicateHint + ' ' + error.message);
      return;
    }

    selectedSectionFilter = data && data.id ? data.id : 'all';
    await loadCategorySections(categoryId);
    hideInlineSectionCreate();
    renderProducts(latestProducts);
    inlineSectionSaving = false;
    updateSectionActionButtons();
    setStatus('Section created and selected.');
  };

  const renameSelectedSection = async () => {
    if (!isOwnerSignedIn || inlineSectionRenameSaving) return;

    const sectionId = getSelectedSectionId();
    const categoryId = getSelectedProductListCategoryId();
    const name = inlineSectionRenameInput ? inlineSectionRenameInput.value.trim() : '';
    if (!categoryId || !sectionId) {
      setStatus('Choose a section before renaming.');
      return;
    }
    if (!name) {
      setStatus('Section name is required.');
      if (inlineSectionRenameInput) inlineSectionRenameInput.focus();
      return;
    }

    inlineSectionRenameSaving = true;
    setInlineSectionRenameDisabled(true);
    updateSectionActionButtons();
    setStatus('Renaming section...');

    const { error } = await client
      .from('category_sections')
      .update({ name })
      .eq('id', sectionId)
      .eq('category_id', categoryId);

    if (error) {
      inlineSectionRenameSaving = false;
      setInlineSectionRenameDisabled(false);
      updateSectionActionButtons();
      const duplicateHint = error.code === '23505' ? ' A section with this name may already exist in this category.' : '';
      setStatus('Unable to rename section.' + duplicateHint + ' ' + error.message);
      return;
    }

    await loadCategorySections(categoryId);
    selectedSectionFilter = sectionId;
    if (productSectionFilter) productSectionFilter.value = sectionId;
    hideInlineSectionRename();
    renderProducts(latestProducts);
    inlineSectionRenameSaving = false;
    updateSectionActionButtons();
    setStatus('Section renamed.');
  };

  const deleteSelectedSectionIfUnused = async () => {
    if (!isOwnerSignedIn || inlineSectionDeleteSaving) return;

    const sectionId = getSelectedSectionId();
    const categoryId = getSelectedProductListCategoryId();
    const section = getSelectedSection();
    if (!categoryId || !sectionId || !section) {
      setStatus('Choose a section before deleting.');
      return;
    }

    inlineSectionDeleteSaving = true;
    updateSectionActionButtons();
    setStatus('Checking section products...');

    const { count, error: countError } = await client
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('category_section_id', sectionId);

    if (countError) {
      inlineSectionDeleteSaving = false;
      updateSectionActionButtons();
      setStatus('Unable to check section products. ' + countError.message);
      return;
    }

    if ((count || 0) > 0) {
      inlineSectionDeleteSaving = false;
      updateSectionActionButtons();
      setStatus('This section has ' + count + ' products. Reassign or remove those products before deleting this section.');
      return;
    }

    const confirmed = window.confirm('Delete this section permanently? This cannot be undone.');
    if (!confirmed) {
      inlineSectionDeleteSaving = false;
      updateSectionActionButtons();
      setStatus('Section deletion cancelled.');
      return;
    }

    setStatus('Deleting section...');
    const { error } = await client
      .from('category_sections')
      .delete()
      .eq('id', sectionId)
      .eq('category_id', categoryId);

    if (error) {
      inlineSectionDeleteSaving = false;
      updateSectionActionButtons();
      setStatus('Unable to delete section. ' + error.message);
      return;
    }

    selectedSectionFilter = 'all';
    hideInlineSectionCreate();
    hideInlineSectionRename();
    await loadCategorySections(categoryId);
    renderProducts(latestProducts);
    inlineSectionDeleteSaving = false;
    updateSectionActionButtons();
    setStatus('Section deleted.');
  };

  const loadProducts = async () => {
    if (productStatus) productStatus.textContent = 'Loading';
    if (productCount) productCount.textContent = 'Loading products...';

    const { data, error } = await client
      .from('products')
      .select('id,category_id,category_section_id,name,description,image_url,notes,badge_labels,is_available,is_published,is_curv_pick,is_seasonal,sort_order,created_at,variant_group_name,category:categories(id,name,sort_order),product_sizes(id,label,price,cost,sort_order)')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .order('sort_order', { referencedTable: 'product_sizes', ascending: true });

    if (error) {
      resetProductPreview();
      setStatus('Unable to load products. ' + error.message);
      return;
    }

    const products = sortProductsForPreview(data || []);

    renderProducts(products);
    if (selectedDisplayOrderCategory) {
      const currentDisplayOrderCategory = selectedDisplayOrderCategory;
      const currentDisplayOrderSection = selectedDisplayOrderSection;
      await initializeDisplayOrderCategory(currentDisplayOrderCategory);
      if (currentDisplayOrderSection && currentDisplayOrderSection !== 'all') {
        initializeDisplayOrderSection(currentDisplayOrderSection);
      }
    } else {
      renderDisplayOrderList();
    }
    setStatus('Connected as owner. Categories and products loaded.');
  };

  const refreshSession = async () => {
    const { data } = await client.auth.getSession();
    const isSignedIn = Boolean(data && data.session && data.session.user);
    setSignedInState(isSignedIn, data && data.session && data.session.user ? data.session.user.email : '');
    if (isSignedIn) {
      await loadCategories();
      await loadProducts();
    } else {
      latestCategories = [];
      restoreStaticCategories();
      resetProductPreview();
      resetDraftProductForm();
      showProductListView();
      setStatus('Ready for owner sign in.');
    }
  };

  const validateDraftProductForm = () => {
    if (!draftForm) return null;
    const formData = new FormData(draftForm);
    const name = String(formData.get('name') || '').trim();
    const categoryId = String(formData.get('category_id') || '').trim();
    const variantGroupName = getSelectedVariantGroup();
    const variantRows = getVariantRows();
    const sizeRows = [];

    if (!name) {
      return { error: 'Product name is required.' };
    }

    if (!categoryId) {
      return { error: 'Category is required.' };
    }

    if (!variantGroupName) {
      return { error: 'Variant group is required.' };
    }

    if (!variantRows.length) {
      return { error: 'Add at least one variant.' };
    }

    for (const [index, row] of variantRows.entries()) {
      const label = row.querySelector('[data-variant-label]').value.trim();
      const priceText = row.querySelector('[data-variant-price]').value.trim();
      const costText = row.querySelector('[data-variant-cost]').value.trim();
      const price = Number(priceText);
      const cost = costText ? Number(costText) : null;

      if (!label) {
        return { error: 'Variant label is required for row ' + (index + 1) + '.' };
      }

      if (!priceText || !Number.isFinite(price) || price < 0) {
        return { error: 'Variant price must be 0 or greater for row ' + (index + 1) + '.' };
      }

      if (costText && (!Number.isFinite(cost) || cost < 0)) {
        return { error: 'Variant cost must be 0 or greater for row ' + (index + 1) + '.' };
      }

      sizeRows.push({ label, price, cost, sort_order: index });
    }

    if (productBadgeLabels.length > PRODUCT_BADGE_MAX_COUNT) {
      return { error: 'Use up to 3 badges per product.' };
    }

    if (productBadgeLabels.some((label) => label.length > PRODUCT_BADGE_MAX_LENGTH)) {
      return { error: 'Keep badges to 24 characters or fewer.' };
    }

    return {
      value: {
        category_id: categoryId,
        category_section_id: draftSectionSelect && draftSectionSelect.value && draftSectionSelect.value !== '__create_section__'
          ? draftSectionSelect.value
          : null,
        name,
        description: String(formData.get('description') || '').trim() || null,
        image_url: String(formData.get('image_url') || '').trim() || null,
        notes: String(formData.get('notes') || '').trim() || null,
        badge_labels: productBadgeLabels.slice(),
        is_available: formData.get('is_available') === 'on',
        is_curv_pick: formData.get('is_curv_pick') === 'on',
        is_seasonal: formData.get('is_seasonal') === 'on',
        is_published: false,
        variant_group_name: variantGroupName,
        sort_order: 0,
        sizeRows,
      },
    };
  };

  const saveDraftProduct = async (eventOrOptions = {}) => {
    const options = eventOrOptions && typeof eventOrOptions.preventDefault === 'function'
      ? {}
      : eventOrOptions;
    if (eventOrOptions && typeof eventOrOptions.preventDefault === 'function') {
      eventOrOptions.preventDefault();
    }

    if (!latestCategories.length) {
      setStatus('Load categories before saving this item.');
      return;
    }

    const validation = validateDraftProductForm();
    if (!validation || validation.error) {
      setStatus(validation ? validation.error : 'Draft product form is unavailable.');
      return;
    }

    const draft = validation.value;
    const isEditing = Boolean(editingProductId);
    const existingProduct = getEditingProduct();
    const finalPublishedState = typeof options.publishState === 'boolean'
      ? options.publishState
      : Boolean(existingProduct && existingProduct.is_published);
    if (createDraftButton) createDraftButton.disabled = true;
    if (editorPublishActionButton) editorPublishActionButton.disabled = true;
    if (undoProductChangesButton) undoProductChangesButton.disabled = true;
    if (cancelEditButton) cancelEditButton.disabled = true;
    setStatus(finalPublishedState
      ? (isEditing ? 'Saving live item...' : 'Creating and publishing item...')
      : (isEditing ? 'Saving draft item...' : 'Saving draft item...'));

    const productPayload = {
      category_id: draft.category_id,
      category_section_id: draft.category_section_id,
      name: draft.name,
      description: draft.description,
      image_url: draft.image_url,
      notes: draft.notes,
      badge_labels: draft.badge_labels,
      is_available: draft.is_available,
      is_curv_pick: draft.is_curv_pick,
      is_seasonal: draft.is_seasonal,
      is_published: finalPublishedState,
      variant_group_name: draft.variant_group_name,
      sort_order: isEditing && existingProduct ? Number(existingProduct.sort_order || 0) : 0,
    };

    let productId = editingProductId;

    if (isEditing) {
      const { error: productError } = await client
        .from('products')
        .update(productPayload)
        .eq('id', editingProductId);

      if (productError) {
        setStatus('Unable to update item. ' + productError.message);
        if (createDraftButton) createDraftButton.disabled = false;
        if (editorPublishActionButton) editorPublishActionButton.disabled = false;
        updateUndoChangesAction();
        if (cancelEditButton) cancelEditButton.disabled = false;
        return;
      }

      const { error: deleteSizesError } = await client
        .from('product_sizes')
        .delete()
        .eq('product_id', editingProductId);

      if (deleteSizesError) {
        await loadProducts();
        setStatus('Item was updated, but existing variants could not be replaced. ' + deleteSizesError.message);
        if (createDraftButton) createDraftButton.disabled = false;
        if (editorPublishActionButton) editorPublishActionButton.disabled = false;
        updateUndoChangesAction();
        if (cancelEditButton) cancelEditButton.disabled = false;
        return;
      }
    } else {
      const { data: product, error: productError } = await client
        .from('products')
        .insert(productPayload)
        .select('id')
        .single();

      if (productError) {
        setStatus('Unable to save item. ' + productError.message);
        if (createDraftButton) createDraftButton.disabled = false;
        if (editorPublishActionButton) editorPublishActionButton.disabled = false;
        updateUndoChangesAction();
        return;
      }

      productId = product.id;
    }

    const sizePayload = draft.sizeRows.map((variant) => ({
      product_id: productId,
      label: variant.label,
      price: variant.price,
      cost: variant.cost,
      sort_order: variant.sort_order,
    }));

    const { error: sizeError } = await client
      .from('product_sizes')
      .insert(sizePayload);

    if (sizeError) {
      await loadProducts();
      setStatus((isEditing ? 'Item was updated, but variants could not be saved. ' : 'Item row was created, but variants could not be saved. ') + sizeError.message);
      if (createDraftButton) createDraftButton.disabled = false;
      if (editorPublishActionButton) editorPublishActionButton.disabled = false;
      updateUndoChangesAction();
      if (cancelEditButton) cancelEditButton.disabled = !isEditing;
      return;
    }

    await loadProducts();
    if (productId) {
      await loadProductIntoForm(productId);
      draftFormSavedLabelActive = true;
      markDraftFormClean();
      syncEditorSaveLabels();
    }
    setStatus(finalPublishedState
      ? (isEditing ? 'Live item updated.' : 'Item saved and published.')
      : (isEditing ? 'Draft item saved.' : 'Draft item saved.'));
  };

  const updateProductPublishedState = async (productId, shouldPublish, options = {}) => {
    const product = latestProducts.find((item) => item.id === productId);
    if (!product) {
      setStatus('Product could not be found in the current preview.');
      return;
    }

    const actionLabel = shouldPublish ? 'publish' : 'unpublish';
    const confirmed = window.confirm((shouldPublish ? 'Publish' : 'Unpublish') + ' this product? This only changes the admin Supabase publish state.');
    if (!confirmed) return;

    setStatus((shouldPublish ? 'Publishing' : 'Unpublishing') + ' product...');
    const { error } = await client
      .from('products')
      .update({ is_published: shouldPublish })
      .eq('id', productId);

    if (error) {
      setStatus('Unable to ' + actionLabel + ' product. ' + error.message);
      return;
    }

    await loadProducts();
    if (options.keepEditor && editingProductId === productId) {
      await loadProductIntoForm(productId);
      draftFormSavedLabelActive = true;
      markDraftFormClean();
      syncEditorSaveLabels();
    } else if (shouldPublish && editingProductId === productId) {
      resetDraftProductForm();
      populateDraftCategorySelect(latestCategories);
      setDraftFormDisabled(false);
    }
    setStatus(shouldPublish ? 'Product published in admin.' : 'Product unpublished and returned to draft.');
  };

  const updateEditingProductPublishedState = async () => {
    const product = getEditingProduct();
    if (!editingProductId) {
      editorPublishSaving = true;
      updateEditorPublishAction();
      await saveDraftProduct({ publishState: true });
      editorPublishSaving = false;
      updateEditorPublishAction();
      return;
    }

    if (!product) {
      setStatus('Product could not be found in the current preview.');
      return;
    }

    if (!product.is_published) {
      editorPublishSaving = true;
      updateEditorPublishAction();
      await saveDraftProduct({ publishState: true });
      editorPublishSaving = false;
      updateEditorPublishAction();
      return;
    }

    if (hasUnsavedDraftFormChanges()) {
      setStatus('Save changes before unpublishing this item, or cancel edits.');
      return;
    }

    editorPublishSaving = true;
    updateEditorPublishAction();
    await updateProductPublishedState(editingProductId, false, { keepEditor: true });
    editorPublishSaving = false;
    updateEditorPublishAction();
  };

  const undoProductChanges = async () => {
    if (!editingProductId || !isDraftFormDirty()) {
      updateUndoChangesAction();
      return;
    }

    const productId = editingProductId;
    if (undoProductChangesButton) undoProductChangesButton.disabled = true;
    setStatus('Restoring last saved product state...');
    await loadProductIntoForm(productId);
    draftFormSavedLabelActive = true;
    markDraftFormClean();
    syncEditorSaveLabels();
    setStatus('Changes undone. Product restored to the last saved state.');
  };

  const bulkUpdateFilteredPublishedState = async (shouldPublish) => {
    if (bulkPublishSaving) return;
    const ids = latestVisibleProducts.map((product) => product.id).filter(Boolean);
    const count = ids.length;
    if (!count) {
      setStatus('No filtered products to update.');
      return;
    }

    const confirmed = window.confirm(
      shouldPublish
        ? 'Publish ' + count + ' filtered products? Only products matching the current filters will be affected.'
        : 'Unpublish ' + count + ' filtered products? These items will be hidden from the live menu.'
    );
    if (!confirmed) return;

    bulkPublishSaving = true;
    updateBulkPublishControls();
    setStatus(shouldPublish ? 'Publishing filtered products...' : 'Unpublishing filtered products...');

    const { error } = await client
      .from('products')
      .update({ is_published: shouldPublish })
      .in('id', ids);

    if (error) {
      bulkPublishSaving = false;
      updateBulkPublishControls();
      setStatus('Unable to ' + (shouldPublish ? 'publish' : 'unpublish') + ' filtered products. ' + error.message);
      return;
    }

    bulkPublishSaving = false;
    await loadProducts();
    setStatus((shouldPublish ? 'Published ' : 'Unpublished ') + count + ' filtered products.');
  };

  const deleteDraftProduct = async (productId) => {
    const product = latestProducts.find((item) => item.id === productId);
    if (!product) {
      setStatus('Product could not be found in the current preview.');
      return;
    }

    if (product.is_published) {
      setStatus('Published products cannot be deleted yet.');
      return;
    }

    const confirmed = window.confirm('Delete this draft product? This cannot be undone.');
    if (!confirmed) return;

    setStatus('Deleting draft product...');
    const { error: sizeError } = await client
      .from('product_sizes')
      .delete()
      .eq('product_id', productId);

    if (sizeError) {
      setStatus('Unable to delete draft product variants. ' + sizeError.message);
      return;
    }

    const { error: productError } = await client
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('is_published', false);

    if (productError) {
      setStatus('Draft variants were deleted, but the product could not be deleted. ' + productError.message);
      await loadProducts();
      return;
    }

    if (editingProductId === productId) {
      resetDraftProductForm();
      populateDraftCategorySelect(latestCategories);
      setDraftFormDisabled(false);
    }

    await loadProducts();
    setStatus('Draft product deleted.');
  };

  if (variantGroupSelect) {
    variantGroupSelect.addEventListener('focus', () => {
      if (variantGroupSelect.value !== '__add_custom_sold_by__') {
        previousVariantGroupValue = variantGroupSelect.value || 'Each';
      }
    });

    variantGroupSelect.addEventListener('change', () => {
      if (variantGroupSelect.value === '__add_custom_sold_by__') {
        if (customVariantInput) customVariantInput.value = '';
        syncVariantGroupFields();
        if (customVariantInput) customVariantInput.focus();
        return;
      }
      previousVariantGroupValue = variantGroupSelect.value || 'Each';
      syncVariantGroupFields();
      maybeSyncDefaultVariantLabel();
    });
  }

  if (customVariantInput) {
    customVariantInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addCustomSoldByLabel();
      }
      if (event.key === 'Escape') {
        hideCustomSoldByCreate(true);
        setStatus('Custom sold-by cancelled.');
      }
    });
  }

  if (saveCustomSoldByButton) {
    saveCustomSoldByButton.addEventListener('click', addCustomSoldByLabel);
  }

  if (cancelCustomSoldByButton) {
    cancelCustomSoldByButton.addEventListener('click', () => {
      hideCustomSoldByCreate(true);
      setStatus('Custom sold-by cancelled.');
    });
  }

  if (addVariantButton && variantList) {
    addVariantButton.addEventListener('click', () => {
      const row = createVariantRow({ touched: true });
      variantList.appendChild(row);
      bindVariantRow(row);
      setVariantRowDisabled(row, false);
      updateRemoveButtons();
      markDraftFormDirty();
    });
  }

  getVariantRows().forEach(bindVariantRow);
  updateRemoveButtons();

  if (productSearchInput) {
    productSearchInput.addEventListener('input', () => {
      productSearchQuery = productSearchInput.value.trim();
      if (clearProductSearchButton) clearProductSearchButton.disabled = !productSearchQuery;
      renderProducts(latestProducts);
    });
  }

  if (clearProductSearchButton && productSearchInput) {
    clearProductSearchButton.addEventListener('click', () => {
      productSearchInput.value = '';
      productSearchQuery = '';
      clearProductSearchButton.disabled = true;
      renderProducts(latestProducts);
      productSearchInput.focus();
    });
  }

  if (bulkPublishFilteredButton) {
    bulkPublishFilteredButton.addEventListener('click', () => bulkUpdateFilteredPublishedState(true));
  }

  if (bulkUnpublishFilteredButton) {
    bulkUnpublishFilteredButton.addEventListener('click', () => bulkUpdateFilteredPublishedState(false));
  }

  if (productStatusFilter) {
    productStatusFilter.addEventListener('change', () => {
      selectedProductStatusFilter = productStatusFilter.value || 'all';
      renderProducts(latestProducts);
    });
  }

  if (productListSortSelect) {
    productListSortSelect.addEventListener('change', () => {
      selectedProductListSort = productListSortSelect.value || 'menu';
      renderProducts(latestProducts);
    });
  }

  if (draftCategorySelect) {
    draftCategorySelect.addEventListener('focus', () => {
      if (draftCategorySelect.value !== '__create_category__') {
        previousDraftCategoryValue = draftCategorySelect.value;
      }
    });
    draftCategorySelect.addEventListener('change', async () => {
      if (draftCategorySelect.value === '__create_category__') {
        hideInlineCategoryRename();
        renderDraftProductSections([], '');
        hideInlineDraftSectionCreate(false);
        showInlineCategoryCreate();
      } else {
        previousDraftCategoryValue = draftCategorySelect.value;
        hideInlineCategoryCreate(false);
        hideInlineCategoryRename();
        hideInlineDraftSectionCreate(false);
        await loadDraftCategorySections(getDraftCategoryId(), '');
      }
      updateCategoryActionButtons();
    });
  }

  if (saveInlineCategoryButton) {
    saveInlineCategoryButton.addEventListener('click', createInlineCategory);
  }

  if (inlineCategoryNameInput) {
    inlineCategoryNameInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        createInlineCategory();
      }
      if (event.key === 'Escape') {
        hideInlineCategoryCreate(true);
        await loadDraftCategorySections(getDraftCategoryId(), previousDraftSectionValue);
      }
    });
  }

  if (cancelInlineCategoryButton) {
    cancelInlineCategoryButton.addEventListener('click', async () => {
      hideInlineCategoryCreate(true);
      await loadDraftCategorySections(getDraftCategoryId(), previousDraftSectionValue);
      setStatus('Category creation cancelled.');
    });
  }

  if (draftSectionSelect) {
    draftSectionSelect.addEventListener('focus', () => {
      if (draftSectionSelect.value !== '__create_section__') {
        previousDraftSectionValue = draftSectionSelect.value;
      }
    });
    draftSectionSelect.addEventListener('change', () => {
      if (draftSectionSelect.value === '__create_section__') {
        showInlineDraftSectionCreate();
      } else {
        previousDraftSectionValue = draftSectionSelect.value;
        hideInlineDraftSectionCreate(false);
      }
    });
  }

  if (saveInlineDraftSectionButton) {
    saveInlineDraftSectionButton.addEventListener('click', createInlineDraftSection);
  }

  if (inlineDraftSectionNameInput) {
    inlineDraftSectionNameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        createInlineDraftSection();
      }
      if (event.key === 'Escape') {
        hideInlineDraftSectionCreate(true);
        setStatus('Section creation cancelled.');
      }
    });
  }

  if (cancelInlineDraftSectionButton) {
    cancelInlineDraftSectionButton.addEventListener('click', () => {
      hideInlineDraftSectionCreate(true);
      setStatus('Section creation cancelled.');
    });
  }

  if (renameSelectedCategoryButton) {
    renameSelectedCategoryButton.addEventListener('click', showInlineCategoryRename);
  }

  if (saveInlineCategoryRenameButton) {
    saveInlineCategoryRenameButton.addEventListener('click', renameSelectedCategory);
  }

  if (inlineCategoryRenameInput) {
    inlineCategoryRenameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        renameSelectedCategory();
      }
      if (event.key === 'Escape') {
        hideInlineCategoryRename();
      }
    });
  }

  if (cancelInlineCategoryRenameButton) {
    cancelInlineCategoryRenameButton.addEventListener('click', () => {
      hideInlineCategoryRename();
      setStatus('Category rename cancelled.');
    });
  }

  if (deleteSelectedCategoryButton) {
    deleteSelectedCategoryButton.addEventListener('click', deleteSelectedCategoryIfUnused);
  }

  if (productSectionFilter) {
    productSectionFilter.addEventListener('change', () => {
      const value = productSectionFilter.value || 'all';
      if (value === '__create_section__') {
        productSectionFilter.value = selectedSectionFilter || 'all';
        showInlineSectionCreate();
        return;
      }
      selectedSectionFilter = value;
      hideInlineSectionCreate();
      hideInlineSectionRename();
      updateSectionActionButtons();
      renderProducts(latestProducts);
    });
  }

  if (saveInlineSectionButton) {
    saveInlineSectionButton.addEventListener('click', createInlineSection);
  }

  if (inlineSectionNameInput) {
    inlineSectionNameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        createInlineSection();
      }
      if (event.key === 'Escape') {
        hideInlineSectionCreate();
        setStatus('Section creation cancelled.');
      }
    });
  }

  if (cancelInlineSectionButton) {
    cancelInlineSectionButton.addEventListener('click', () => {
      hideInlineSectionCreate();
      setStatus('Section creation cancelled.');
    });
  }

  if (renameSelectedSectionButton) {
    renameSelectedSectionButton.addEventListener('click', showInlineSectionRename);
  }

  if (saveInlineSectionRenameButton) {
    saveInlineSectionRenameButton.addEventListener('click', renameSelectedSection);
  }

  if (inlineSectionRenameInput) {
    inlineSectionRenameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        renameSelectedSection();
      }
      if (event.key === 'Escape') {
        hideInlineSectionRename();
        setStatus('Section rename cancelled.');
      }
    });
  }

  if (cancelInlineSectionRenameButton) {
    cancelInlineSectionRenameButton.addEventListener('click', () => {
      hideInlineSectionRename();
      setStatus('Section rename cancelled.');
    });
  }

  if (deleteSelectedSectionButton) {
    deleteSelectedSectionButton.addEventListener('click', deleteSelectedSectionIfUnused);
  }

  if (openProductEditorButton) {
    openProductEditorButton.addEventListener('click', openCreateProductEditor);
  }

  if (backToProductsButton) {
    backToProductsButton.addEventListener('click', () => {
      returnToProductList('Returned to product list.');
    });
  }

  if (ownerAccountToggle) {
    ownerAccountToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleOwnerAccountMenu();
    });
  }

  if (ownerAccountMenu) {
    ownerAccountMenu.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }

  document.addEventListener('click', (event) => {
    if (!ownerAccount || ownerAccount.contains(event.target)) return;
    closeOwnerAccountMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOwnerAccountMenu();
  });

  if (menuManagerSubnavToggle) {
    menuManagerSubnavToggle.addEventListener('click', () => {
      const isExpanded = menuManagerSubnavToggle.getAttribute('aria-expanded') === 'true';
      setSubnavExpanded(menuManagerSubnavToggle, menuManagerSubnav, !isExpanded);
    });
  }

  if (mobileMenuManagerSubnavToggle) {
    mobileMenuManagerSubnavToggle.addEventListener('click', () => {
      const isExpanded = mobileMenuManagerSubnavToggle.getAttribute('aria-expanded') === 'true';
      setSubnavExpanded(mobileMenuManagerSubnavToggle, mobileMenuManagerSubnav, !isExpanded);
    });
  }

  menuManagerViewTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const nextView = tab.dataset.menuManagerViewTab || 'products';
      if (nextView === 'products') {
        showProductListView();
      } else {
        setMenuManagerView(nextView);
      }
      if (tab.closest('.mobile-more-drawer')) {
        const mobileMoreClose = document.querySelector('.mobile-more-close[data-more-close]');
        if (mobileMoreClose) mobileMoreClose.click();
      }
    });
  });

  collapsibleToggles.forEach((toggle) => {
    setCollapsibleExpanded(toggle, toggle.getAttribute('aria-expanded') === 'true');
    toggle.addEventListener('click', () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      const shouldExpand = !isExpanded;
      setCollapsibleExpanded(toggle, shouldExpand);
      if (shouldExpand && toggle.dataset.collapsibleTarget === 'option-groups-content') {
        loadOptionGroups();
      }
    });
  });

  setMenuManagerView(activeMenuManagerView);
  setProductSubview(activeProductSubview);

  if (displayOrderCategorySelect) {
    displayOrderCategorySelect.addEventListener('change', handleDisplayOrderCategoryChange);
  }

  if (displayOrderSectionSelect) {
    displayOrderSectionSelect.addEventListener('change', handleDisplayOrderSectionChange);
  }

  if (resetDisplayOrderButton) {
    resetDisplayOrderButton.addEventListener('click', () => {
      if (displayOrderSaving) return;
      sortableProducts = displayOrderOriginalProducts.slice();
      setDisplayOrderDirty(false);
      renderDisplayOrderList();
    });
  }

  if (saveDisplayOrderButton) {
    saveDisplayOrderButton.addEventListener('click', saveDisplayOrder);
  }

  if (draftForm) {
    draftForm.addEventListener('submit', saveDraftProduct);
    draftForm.addEventListener('input', markDraftFormDirty);
    draftForm.addEventListener('change', markDraftFormDirty);
  }

  if (productBadgeInput) {
    productBadgeInput.addEventListener('input', (event) => {
      event.stopPropagation();
    });

    productBadgeInput.addEventListener('change', (event) => {
      event.stopPropagation();
    });

    productBadgeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addProductBadgeFromInput();
      }
    });
  }

  if (editorPublishActionButton) {
    editorPublishActionButton.addEventListener('click', updateEditingProductPublishedState);
  }

  if (undoProductChangesButton) {
    undoProductChangesButton.addEventListener('click', undoProductChanges);
  }

  if (optionGroupForm) {
    optionGroupForm.addEventListener('submit', saveOptionGroup);
  }

  if (resetOptionGroupButton) {
    resetOptionGroupButton.addEventListener('click', () => {
      resetOptionGroupForm();
      setOptionManagerStatus('Option group form reset.');
    });
  }

  if (optionChoiceForm) {
    optionChoiceForm.addEventListener('submit', saveOptionChoice);
  }

  if (resetOptionChoiceButton) {
    resetOptionChoiceButton.addEventListener('click', () => {
      resetOptionChoiceForm();
      setOptionManagerStatus('Option choice form reset.');
    });
  }

  if (showAttachOptionGroupButton) {
    showAttachOptionGroupButton.addEventListener('click', openProductOptionAttachForm);
  }

  if (saveProductOptionAttachmentButton) {
    saveProductOptionAttachmentButton.addEventListener('click', saveProductOptionAttachment);
  }

  if (cancelProductOptionAttachmentButton) {
    cancelProductOptionAttachmentButton.addEventListener('click', () => {
      resetProductOptionAttachForm();
      setProductOptionStatus(editingProductId ? 'Attach cancelled.' : 'Save the product before attaching option groups.');
    });
  }

  if (productOptionGroupSelect) {
    productOptionGroupSelect.addEventListener('change', syncProductOptionAttachmentLimits);
  }

  if (productOptionAttachForm) {
    const requiredInput = productOptionAttachForm.querySelector('[name="is_required"]');
    if (requiredInput) requiredInput.addEventListener('change', syncProductOptionAttachmentLimits);
  }

  if (cancelEditButton) {
    cancelEditButton.addEventListener('click', () => {
      returnToProductList('Edit cancelled. Product list restored.');
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      if (!email || !password) {
        setStatus('Enter the owner email and password.');
        return;
      }

      setStatus('Signing in...');
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        setSignedInState(false);
        setStatus('Sign in failed. ' + error.message);
        return;
      }

      if (passwordInput) passwordInput.value = '';
      setSignedInState(true, email);
      closeOwnerAccountMenu();
      await loadCategories();
      await loadProducts();
    });
  }

  if (signOutButton) {
    signOutButton.addEventListener('click', async () => {
      setStatus('Signing out...');
      const { error } = await client.auth.signOut();
      if (error) {
        setStatus('Sign out failed. ' + error.message);
        return;
      }
      latestCategories = [];
      setSignedInState(false);
      closeOwnerAccountMenu();
      restoreStaticCategories();
      resetProductPreview();
      resetDraftProductForm();
      setStatus('Signed out.');
    });
  }

  refreshSession();
})();
(() => {
  const ordersRoot = document.querySelector('[data-supabase-incoming-orders]');
  if (!ordersRoot) return;

  const SUPABASE_URL = 'https://tjqnmyjttqukowcehzmq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tkWA-7LTA9R5wKw7_vi_ng_YDYnS1M0';

  const STATUS_LABELS = {
    submitted: 'New',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready: 'Ready',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  const ORDER_STATUS_ACTIONS = {
    submitted: [
      { label: 'Accept', nextStatus: 'accepted', timestampField: 'accepted_at' },
      { label: 'Cancel', nextStatus: 'cancelled', timestampField: 'cancelled_at', tone: 'cancel' },
    ],
    accepted: [
      { label: 'Mark Preparing', nextStatus: 'preparing', timestampField: 'preparing_at' },
      { label: 'Cancel', nextStatus: 'cancelled', timestampField: 'cancelled_at', tone: 'cancel' },
    ],
    preparing: [
      { label: 'Mark Ready', nextStatus: 'ready', timestampField: 'ready_at' },
      { label: 'Cancel', nextStatus: 'cancelled', timestampField: 'cancelled_at', tone: 'cancel' },
    ],
    ready: [
      { label: 'Complete', nextStatus: 'completed', timestampField: 'completed_at' },
      { label: 'Cancel', nextStatus: 'cancelled', timestampField: 'cancelled_at', tone: 'cancel' },
    ],
    completed: [],
    cancelled: [],
  };

  const authForm = ordersRoot.querySelector('[data-auth-form]');
  const emailInput = document.getElementById('owner-email');
  const passwordInput = document.getElementById('owner-password');
  const signInButton = ordersRoot.querySelector('[data-sign-in]');
  const signOutButton = ordersRoot.querySelector('[data-sign-out]');
  const authStatus = ordersRoot.querySelector('[data-orders-auth-status]');
  const ownerAccount = ordersRoot.querySelector('[data-owner-account]');
  const ownerAccountToggle = ordersRoot.querySelector('[data-owner-account-toggle]');
  const ownerAccountMenu = ordersRoot.querySelector('[data-owner-account-menu]');
  const ownerSignedOutPanel = ordersRoot.querySelector('[data-owner-signed-out]');
  const ownerSignedInPanel = ordersRoot.querySelector('[data-owner-signed-in]');
  const ownerAccountLabel = ordersRoot.querySelector('[data-owner-account-label]');
  const ownerAccountEmail = ordersRoot.querySelector('[data-owner-account-email]');
  const ownerAccountInitials = ordersRoot.querySelector('[data-owner-account-initials]');
  const orderList = ordersRoot.querySelector('[data-order-list]');
  const orderDetail = ordersRoot.querySelector('[data-order-detail]');
  const orderStatusLabel = ordersRoot.querySelector('[data-order-status-label]');
  const filterButtons = Array.from(ordersRoot.querySelectorAll('[data-order-status-filter]'));
  const submittedCount = ordersRoot.querySelector('[data-orders-count-submitted]');
  const preparingCount = ordersRoot.querySelector('[data-orders-count-preparing]');
  const readyCount = ordersRoot.querySelector('[data-orders-count-ready]');
  const todayTotal = ordersRoot.querySelector('[data-orders-today-total]');

  let activeStatus = 'submitted';
  let isOwnerSignedIn = false;
  let signedInOwnerEmail = '';
  let latestOrders = [];
  let itemCountByOrderId = new Map();
  let orderItemsByOrderId = new Map();
  let orderItemsLoadError = '';
  let selectedOrderId = '';
  let ordersLoading = false;
  let activeOrderAction = null;
  let activePaymentAction = null;
  let ordersRealtimeChannel = null;
  let realtimeRefreshInFlight = false;
  let realtimeRefreshQueued = false;
  const recentlyReceivedOrderIds = new Set();
  const recentlyReceivedOrderTimers = new Map();

  const hasSupabaseConfig = SUPABASE_URL !== 'SUPABASE_URL'
    && SUPABASE_PUBLISHABLE_KEY !== 'SUPABASE_PUBLISHABLE_KEY'
    && SUPABASE_URL.startsWith('https://')
    && SUPABASE_PUBLISHABLE_KEY.length > 20;

  const setStatus = (message) => {
    if (authStatus) authStatus.textContent = message;
  };

  const setFormDisabled = (isDisabled) => {
    if (emailInput) emailInput.disabled = isDisabled;
    if (passwordInput) passwordInput.disabled = isDisabled;
    if (signInButton) signInButton.disabled = isDisabled;
  };

  const getOwnerInitials = (email) => {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) return 'CO';
    const localPart = cleanEmail.split('@')[0] || cleanEmail;
    return localPart
      .split(/[._\-\s]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('') || 'CO';
  };

  const closeOwnerAccountMenu = () => {
    if (!ownerAccountMenu || !ownerAccountToggle) return;
    ownerAccountMenu.hidden = true;
    ownerAccountToggle.setAttribute('aria-expanded', 'false');
  };

  const toggleOwnerAccountMenu = () => {
    if (!ownerAccountMenu || !ownerAccountToggle) return;
    const shouldOpen = ownerAccountMenu.hidden;
    ownerAccountMenu.hidden = !shouldOpen;
    ownerAccountToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
      const firstTarget = ownerAccountMenu.querySelector('input:not(:disabled), button:not(:disabled)');
      if (firstTarget && typeof firstTarget.focus === 'function') firstTarget.focus();
    }
  };

  const updateOwnerAccountUi = () => {
    if (ownerSignedOutPanel) ownerSignedOutPanel.hidden = isOwnerSignedIn;
    if (ownerSignedInPanel) ownerSignedInPanel.hidden = !isOwnerSignedIn;
    if (ownerAccountLabel) ownerAccountLabel.textContent = isOwnerSignedIn ? 'Owner' : 'Owner Login';
    if (ownerAccountEmail) ownerAccountEmail.textContent = signedInOwnerEmail ? 'Signed in as ' + signedInOwnerEmail : 'Owner access active.';
    if (ownerAccountInitials) ownerAccountInitials.textContent = getOwnerInitials(signedInOwnerEmail);
    if (signInButton) signInButton.disabled = isOwnerSignedIn;
    if (signOutButton) signOutButton.disabled = !isOwnerSignedIn;
  };

  const setSignedInState = (isSignedIn, email = '') => {
    isOwnerSignedIn = isSignedIn;
    signedInOwnerEmail = isSignedIn ? (email || signedInOwnerEmail) : '';
    updateOwnerAccountUi();
  };

  const formatCurrency = (value, currency = 'PHP') => {
    const amount = Number(value || 0);
    try {
      return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: currency || 'PHP',
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (error) {
      return 'PHP ' + amount.toFixed(2);
    }
  };

  const formatOrderDate = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatOrderAge = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 0) return formatOrderDate(value);
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return diffMinutes + ' min ago';
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return diffHours + ' hr' + (diffHours === 1 ? '' : 's') + ' ago';
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return diffDays + ' day' + (diffDays === 1 ? '' : 's') + ' ago';
    return formatOrderDate(value);
  };

  const getOrderSource = (order) => {
    const source = String(order && order.source ? order.source : '').trim().toLowerCase();
    return source || 'website';
  };

  const getFulfillmentType = (order) => {
    const type = String(order && order.fulfillment_type ? order.fulfillment_type : '').trim().toLowerCase();
    return type === 'delivery' ? 'delivery' : 'pickup';
  };

  const getFulfillmentLabel = (order) => getFulfillmentType(order) === 'delivery' ? 'Delivery' : 'Pick-up';

  const getDetailedFulfillmentLabel = (order) => {
    if (getFulfillmentType(order) !== 'delivery') return 'Pick-up';
    const deliveryOption = formatDeliveryOption(order && order.delivery_option);
    return deliveryOption && deliveryOption !== '-' ? 'Delivery - ' + deliveryOption : 'Delivery';
  };

  const getCustomerTypeLabel = (order) => {
    const deliveryAddress = String(order && order.delivery_address ? order.delivery_address : '').trim().toLowerCase();
    if (deliveryAddress === 'returning customer') return 'Returning customer';
    return 'New customer';
  };

  const formatPaymentMethod = (value) => {
    const method = String(value || '').trim();
    if (!method) return '-';
    const normalized = method.toLowerCase();
    if (normalized === 'cod') return 'COD';
    if (normalized === 'gcash') return 'GCash';
    return formatOptionLabel(method);
  };

  const isDeliveryConfirmationComplete = (order) => {
    const status = normalizeOrderStatus(order && order.status);
    const feeStatus = String(order && order.delivery_fee_status ? order.delivery_fee_status : '').trim().toLowerCase();
    return ['accepted', 'preparing', 'ready', 'completed'].includes(status)
      || feeStatus === 'confirmed'
      || feeStatus === 'waived';
  };

  const formatDeliveryOption = (value) => {
    const option = String(value || '').trim().toLowerCase();
    if (option === 'curv_rider') return 'CURV Rider';
    if (option === 'lalamove') return 'Lalamove';
    return option ? formatOptionLabel(option) : '-';
  };

  const formatDeliveryFeeStatus = (value) => {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'to_confirm') return 'To confirm';
    if (status === 'confirmed') return 'Confirmed';
    if (status === 'waived') return 'Waived';
    if (status === 'not_applicable') return 'Not applicable';
    return status ? formatOptionLabel(status) : 'Not applicable';
  };

  const normalizePaymentStatus = (status) => {
    const cleanStatus = String(status || '').trim().toLowerCase();
    return cleanStatus || 'unpaid';
  };

  const formatPaymentStatus = (status) => {
    const cleanStatus = normalizePaymentStatus(status);
    if (cleanStatus === 'unpaid') return 'Unpaid';
    if (cleanStatus === 'pending') return 'Pending';
    if (cleanStatus === 'paid') return 'Paid';
    if (cleanStatus === 'refunded') return 'Refunded';
    return formatOptionLabel(cleanStatus);
  };

  const formatOptionLabel = (value) => String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase());

  const stringifyOptionValue = (value) => {
    if (value === null || value === undefined || value === '') return '';
    if (Array.isArray(value)) return value.map(stringifyOptionValue).filter(Boolean).join(', ');
    if (typeof value === 'object') {
      const preferredValue = value.label || value.name || value.value || value.choice || value.option;
      if (preferredValue && typeof preferredValue !== 'object') return String(preferredValue).trim();
      return Object.entries(value)
        .map(([key, nestedValue]) => {
          const cleanValue = stringifyOptionValue(nestedValue);
          return cleanValue ? formatOptionLabel(key) + ': ' + cleanValue : '';
        })
        .filter(Boolean)
        .join(' / ');
    }
    return String(value).trim();
  };

  const formatOrderItemOptions = (options) => {
    if (!options) return [];
    if (typeof options === 'string') {
      const cleanOptions = options.trim();
      if (!cleanOptions || cleanOptions === '{}') return [];
      try {
        return formatOrderItemOptions(JSON.parse(cleanOptions));
      } catch (error) {
        return [cleanOptions];
      }
    }
    if (Array.isArray(options)) return options.map(stringifyOptionValue).filter(Boolean);
    if (typeof options !== 'object' || !Object.keys(options).length) return [];
    return Object.entries(options)
      .map(([key, value]) => {
        const cleanValue = stringifyOptionValue(value);
        return cleanValue ? formatOptionLabel(key) + ': ' + cleanValue : '';
      })
      .filter(Boolean);
  };

  const makeElement = (tagName, className, text) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const renderDetailSection = (title, rows, className = '') => {
    const section = makeElement('section', 'order-detail-section' + (className ? ' ' + className : ''));
    section.appendChild(makeElement('h4', '', title));

    const grid = makeElement('dl', 'order-detail-section-grid');
    rows
      .filter(row => row && row[1] !== null && row[1] !== undefined && row[1] !== '')
      .forEach(([label, value]) => {
        const row = document.createElement('div');
        row.append(makeElement('dt', '', label), makeElement('dd', '', value));
        grid.appendChild(row);
      });

    section.appendChild(grid);
    return section;
  };

  const normalizeOrderStatus = (status) => String(status || '').trim().toLowerCase();

  const renderOrderDetailPlaceholder = (title = 'Select an order', message = 'Order contact, fulfillment, payment, and total details will appear here after selecting an order.') => {
    if (!orderDetail) return;
    orderDetail.innerHTML = '';
    const placeholder = makeElement('div', 'order-detail-placeholder');
    placeholder.append(makeElement('h3', '', title), makeElement('p', '', message));
    orderDetail.appendChild(placeholder);
  };

  const renderOrderEmptyState = (title, message, tone = '') => {
    if (!orderList) return;
    orderList.innerHTML = '';
    const empty = makeElement('div', 'order-empty-state' + (tone ? ' ' + tone : ''));
    empty.dataset.orderEmpty = '';
    empty.append(makeElement('h3', '', title), makeElement('p', '', message));
    orderList.appendChild(empty);
  };

  const renderOrderItemsSection = (order) => {
    const section = makeElement('section', 'order-detail-section order-detail-items');
    section.appendChild(makeElement('h4', '', 'Items'));

    if (orderItemsLoadError) {
      section.appendChild(makeElement('p', 'order-detail-items-empty is-error', orderItemsLoadError));
      return section;
    }

    const items = orderItemsByOrderId.get(order.id) || [];
    if (!items.length) {
      section.appendChild(makeElement('p', 'order-detail-items-empty', 'No item details found for this order.'));
      return section;
    }

    const list = makeElement('div', 'order-detail-item-list');
    items.forEach((item) => {
      const quantity = Number(item.quantity || 0);
      const quantityLabel = (quantity > 0 ? quantity : 1) + 'x';
      const card = makeElement('article', 'order-detail-item');
      const itemHead = makeElement('div', 'order-detail-item-head');
      const itemTitle = makeElement('div', 'order-detail-item-title');
      itemTitle.append(
        makeElement('span', 'order-detail-item-quantity', quantityLabel),
        makeElement('strong', '', item.product_name || 'Menu item'),
      );
      itemHead.append(
        itemTitle,
        makeElement('span', '', formatCurrency(item.line_total, order.currency)),
      );

      const metaParts = [];
      if (item.variant_label) metaParts.push(item.variant_label);
      metaParts.push('Unit ' + formatCurrency(item.unit_price, order.currency));
      if (item.category_name) metaParts.push(item.category_name);

      card.append(itemHead, makeElement('p', 'order-detail-item-meta', metaParts.filter(Boolean).join(' · ')));

      const optionLines = formatOrderItemOptions(item.options);
      if (optionLines.length) {
        card.appendChild(makeElement('p', 'order-detail-item-options', 'Options: ' + optionLines.join(' · ')));
      }

      if (item.item_note) {
        card.appendChild(makeElement('p', 'order-detail-item-note', 'Note: ' + item.item_note));
      }

      list.appendChild(card);
    });

    section.appendChild(list);
    return section;
  };

  const renderDeliveryDetailsSection = (order) => {
    if (getFulfillmentType(order) !== 'delivery') return null;

    const isConfirmed = isDeliveryConfirmationComplete(order);
    const deliveryFee = order.delivery_fee === null || order.delivery_fee === undefined
      ? 'To be confirmed'
      : formatCurrency(order.delivery_fee, order.currency);
    const feeStatus = isConfirmed ? 'Confirmed' : formatDeliveryFeeStatus(order.delivery_fee_status);
    const deliveryNote = isConfirmed
      ? 'Delivery fee and actual total should match the Loyverse receipt preview sent in Messenger.'
      : 'Confirm delivery fee and actual total in Loyverse/Messenger before accepting.';
    const rows = [
      ['Delivery method', formatDeliveryOption(order.delivery_option)],
      ['Address', order.delivery_address || '-'],
      ['Delivery fee', deliveryFee],
      ['Fee status', feeStatus],
    ];

    const section = renderDetailSection('Delivery Details', rows, 'order-delivery-details');
    section.insertBefore(makeElement('p', 'order-delivery-note', deliveryNote), section.querySelector('.order-detail-section-grid'));
    return section;
  };

  const renderTotalsSection = (order) => {
    const isDelivery = getFulfillmentType(order) === 'delivery';
    const subtotal = Number(order.subtotal || order.total || 0);
    const hasDeliveryFee = order.delivery_fee !== null && order.delivery_fee !== undefined;
    const deliveryFee = hasDeliveryFee ? Number(order.delivery_fee || 0) : 0;
    const rows = [
      ['Order subtotal', formatCurrency(subtotal, order.currency)],
    ];

    if (isDelivery) {
      rows.push(['Delivery fee', hasDeliveryFee ? formatCurrency(deliveryFee, order.currency) : 'To be confirmed']);
      rows.push(['Actual total', hasDeliveryFee ? formatCurrency(subtotal + deliveryFee, order.currency) : 'To be confirmed']);
    } else {
      rows.push(['Order total', formatCurrency(order.total || subtotal, order.currency)]);
    }

    return renderDetailSection('Totals', rows, 'order-totals-details');
  };

  const renderPaymentDetailsSection = (order) => {
    const paymentStatus = normalizePaymentStatus(order && order.payment_status);
    const section = makeElement('section', 'order-detail-section order-payment-details');
    section.appendChild(makeElement('h4', '', 'Payment'));

    const statusRow = makeElement('div', 'order-payment-status-row');
    statusRow.append(
      makeElement('span', 'order-payment-status-label', 'Status'),
      makeElement('strong', 'order-payment-status-value', formatPaymentStatus(paymentStatus)),
    );

    const helper = makeElement('p', 'order-payment-note', 'Use only after payment is verified or COD is received.');
    section.append(statusRow, helper);

    if (paymentStatus === 'unpaid' || paymentStatus === 'pending' || paymentStatus === 'paid') {
      const nextStatus = paymentStatus === 'paid' ? 'unpaid' : 'paid';
      const isSaving = activePaymentAction
        && activePaymentAction.orderId === order.id
        && activePaymentAction.nextStatus === nextStatus;
      const buttonClass = 'auth-button order-payment-button'
        + (nextStatus === 'unpaid' ? ' auth-button-secondary' : '');
      const button = makeElement('button', buttonClass, isSaving ? 'Saving...' : (nextStatus === 'paid' ? 'Mark Paid' : 'Mark Unpaid'));
      button.type = 'button';
      button.disabled = Boolean(activePaymentAction) || Boolean(activeOrderAction) || ordersLoading;
      button.addEventListener('click', () => handlePaymentStatusAction(order, nextStatus));
      section.appendChild(button);
    }

    return section;
  };

  const renderOrderDetail = (order) => {
    if (!orderDetail) return;
    if (!order) {
      renderOrderDetailPlaceholder();
      return;
    }

    const statusKey = normalizeOrderStatus(order.status);
    orderDetail.innerHTML = '';
    const heading = makeElement('div', 'order-detail-heading');
    heading.append(
      makeElement('h3', '', order.order_number || 'Order'),
    );

    const headingBadges = makeElement('div', 'order-detail-badges');
    headingBadges.append(
      makeElement('span', 'order-status-badge', STATUS_LABELS[statusKey] || order.status || 'Order'),
      makeElement('span', 'order-source-badge', getOrderSource(order)),
    );
    heading.appendChild(headingBadges);

    const createdDisplay = formatOrderDate(order.created_at);
    const ageDisplay = formatOrderAge(order.created_at);
    const isDelivery = getFulfillmentType(order) === 'delivery';
    const headerSection = renderDetailSection('Order', [
      ['Status', STATUS_LABELS[statusKey] || order.status || 'Order'],
      ['Created', ageDisplay ? ageDisplay + ' / ' + createdDisplay : createdDisplay],
    ], 'order-header-details');
    const customerSection = renderDetailSection('Customer', [
      ['Name', order.customer_name || '-'],
      ['Phone', order.customer_phone || '-'],
      ['Customer type', isDelivery ? getCustomerTypeLabel(order) : null],
      ['Payment method', formatPaymentMethod(order.payment_method)],
      ['Payment status', formatPaymentStatus(order.payment_status)],
    ], 'order-customer-details');
    const fulfillmentRows = [
      ['Method', getDetailedFulfillmentLabel(order)],
      [isDelivery ? 'Preferred delivery time' : 'Preferred pickup time', order.pickup_time || '-'],
    ];
    if (isDelivery) {
      fulfillmentRows.splice(1, 0, ['Address', order.delivery_address || '-']);
    }
    const fulfillmentSection = renderDetailSection('Fulfillment', fulfillmentRows, 'order-fulfillment-details');
    const detailNodes = [heading, headerSection, customerSection, fulfillmentSection];

    if (order.customer_email || order.customer_notes) {
      const notes = makeElement('div', 'order-detail-notes');
      if (order.customer_email) notes.appendChild(makeElement('p', '', 'Email: ' + order.customer_email));
      if (order.customer_notes) notes.appendChild(makeElement('p', '', 'Notes: ' + order.customer_notes));
      detailNodes.push(notes);
    }

    const deliveryDetails = renderDeliveryDetailsSection(order);
    if (deliveryDetails) detailNodes.push(deliveryDetails);
    detailNodes.push(renderOrderItemsSection(order));
    detailNodes.push(renderTotalsSection(order));
    detailNodes.push(renderPaymentDetailsSection(order));

    const actions = ORDER_STATUS_ACTIONS[statusKey] || [];
    if (actions.length) {
      const actionRow = makeElement('div', 'order-action-row');
      actions.forEach((action) => {
        const isSaving = activeOrderAction
          && activeOrderAction.orderId === order.id
          && activeOrderAction.nextStatus === action.nextStatus;
        const buttonClass = 'auth-button order-action-button'
          + (action.tone === 'cancel' ? ' auth-button-secondary is-cancel' : '');
        const button = makeElement('button', buttonClass, isSaving ? 'Saving...' : action.label);
        button.type = 'button';
        button.disabled = Boolean(activeOrderAction) || Boolean(activePaymentAction) || ordersLoading;
        button.dataset.orderAction = action.nextStatus;
        button.addEventListener('click', () => handleOrderStatusAction(order, action));
        actionRow.appendChild(button);
      });
      detailNodes.push(actionRow);
    }

    orderDetail.append(...detailNodes);
  };

  const renderOrders = () => {
    if (!orderList) return;
    if (!isOwnerSignedIn) {
      renderOrderEmptyState('Owner sign-in required', 'Sign in with owner access to load incoming orders.');
      renderOrderDetailPlaceholder('Select an order', 'Sign in to load order details.');
      return;
    }

    if (ordersLoading) {
      renderOrderEmptyState('Loading orders...', 'Fetching the latest incoming orders from Supabase.');
      return;
    }

    if (!latestOrders.length) {
      const label = STATUS_LABELS[activeStatus] || 'selected';
      renderOrderEmptyState('No ' + label.toLowerCase() + ' orders', 'There are no orders in this status yet.');
      renderOrderDetailPlaceholder();
      return;
    }

    orderList.innerHTML = '';
    latestOrders.forEach((order) => {
      const card = document.createElement('button');
      card.type = 'button';
      let cardClass = 'order-card' + (order.id === selectedOrderId ? ' is-selected' : '');
      if (recentlyReceivedOrderIds.has(order.id)) cardClass += ' is-new-arrival';
      card.className = cardClass;
      card.dataset.orderId = order.id || '';

      const head = makeElement('div', 'order-card-head');
      const badgeGroup = makeElement('span', 'order-card-badge-group');
      badgeGroup.append(
        makeElement('span', 'order-fulfillment-badge', getFulfillmentLabel(order)),
        makeElement('span', 'order-source-badge', getOrderSource(order)),
        makeElement('span', 'order-status-badge', STATUS_LABELS[order.status] || order.status || 'Order'),
      );
      head.append(
        makeElement('span', 'order-number', order.order_number || 'Order'),
        badgeGroup,
      );

      const meta = makeElement('div', 'order-card-meta');
      const ageDisplay = formatOrderAge(order.created_at);
      const isDelivery = getFulfillmentType(order) === 'delivery';
      meta.append(
        makeElement('span', 'order-age', ageDisplay || formatOrderDate(order.created_at)),
        makeElement('span', '', (isDelivery ? 'Subtotal ' : '') + formatCurrency(isDelivery ? (order.subtotal || order.total) : order.total, order.currency)),
      );

      const customer = makeElement('div', 'order-card-customer');
      customer.append(
        makeElement('strong', '', order.customer_name || 'Guest'),
        makeElement('span', '', order.customer_phone || 'No phone'),
      );

      const itemCount = itemCountByOrderId.get(order.id);
      if (typeof itemCount === 'number') {
        meta.appendChild(makeElement('span', '', itemCount + (itemCount === 1 ? ' item' : ' items')));
      }

      card.append(head, customer, meta);
      card.addEventListener('click', () => {
        selectedOrderId = order.id || '';
        if (recentlyReceivedOrderIds.has(order.id)) {
          recentlyReceivedOrderIds.delete(order.id);
          if (recentlyReceivedOrderTimers.has(order.id)) {
            window.clearTimeout(recentlyReceivedOrderTimers.get(order.id));
            recentlyReceivedOrderTimers.delete(order.id);
          }
        }
        if (typeof window.curvHideIncomingOrderBadge === 'function') window.curvHideIncomingOrderBadge();
        renderOrders();
        renderOrderDetail(order);
      });
      orderList.appendChild(card);
    });

    const selectedOrder = latestOrders.find(order => order.id === selectedOrderId) || latestOrders[0];
    if (selectedOrder) {
      selectedOrderId = selectedOrder.id || '';
      renderOrderDetail(selectedOrder);
      const selectedCard = orderList.querySelector('[data-order-id="' + CSS.escape(selectedOrderId) + '"]');
      if (selectedCard) selectedCard.classList.add('is-selected');
    }
  };

  const updateFilterUi = () => {
    filterButtons.forEach((button) => {
      const isActive = button.dataset.orderStatusFilter === activeStatus;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (orderStatusLabel) orderStatusLabel.textContent = STATUS_LABELS[activeStatus] || 'Orders';
  };

  const getStatusName = () => String(STATUS_LABELS[activeStatus] || 'selected').toLowerCase();

  const getLoadedStatusMessage = (count) => {
    const statusName = getStatusName();
    if (count === 0) return 'No ' + statusName + ' orders loaded.';
    return 'Loaded ' + count + ' ' + statusName + ' order' + (count === 1 ? '.' : 's.');
  };
  const resetSummary = () => {
    if (submittedCount) submittedCount.textContent = '0';
    if (preparingCount) preparingCount.textContent = '0';
    if (readyCount) readyCount.textContent = '0';
    if (todayTotal) todayTotal.textContent = formatCurrency(0, 'PHP');
  };

  const loadOrderSummary = async () => {
    resetSummary();
    if (!isOwnerSignedIn) return;

    const { data, error } = await client
      .from('orders')
      .select('status,total,currency,created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) return;

    const counts = { submitted: 0, preparing: 0, ready: 0 };
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    let todayAmount = 0;
    let todayCurrency = 'PHP';

    (data || []).forEach((order) => {
      if (Object.prototype.hasOwnProperty.call(counts, order.status)) counts[order.status] += 1;
      const createdKey = order.created_at
        ? new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
        : '';
      if (createdKey === todayKey) {
        todayAmount += Number(order.total || 0);
        todayCurrency = order.currency || todayCurrency;
      }
    });

    if (submittedCount) submittedCount.textContent = String(counts.submitted);
    if (preparingCount) preparingCount.textContent = String(counts.preparing);
    if (readyCount) readyCount.textContent = String(counts.ready);
    if (todayTotal) todayTotal.textContent = formatCurrency(todayAmount, todayCurrency);
  };

  const loadItemCounts = async (orders) => {
    itemCountByOrderId = new Map();
    orderItemsByOrderId = new Map();
    orderItemsLoadError = '';
    const orderIds = orders.map(order => order.id).filter(Boolean);
    if (!orderIds.length) return;

    const { data, error } = await client
      .from('order_items')
      .select('order_id,product_name,category_name,variant_label,quantity,unit_price,line_total,options,item_note,sort_order')
      .in('order_id', orderIds)
      .order('sort_order', { ascending: true });

    if (error) {
      orderItemsLoadError = 'Unable to load item details. ' + error.message;
      return;
    }

    (data || []).forEach((item) => {
      const currentCount = itemCountByOrderId.get(item.order_id) || 0;
      itemCountByOrderId.set(item.order_id, currentCount + 1);
      const items = orderItemsByOrderId.get(item.order_id) || [];
      items.push(item);
      orderItemsByOrderId.set(item.order_id, items);
    });
  };

  const handleOrderStatusAction = async (order, action) => {
    if (!order || !order.id || !action || !action.nextStatus || !action.timestampField) return;
    if (activeOrderAction || activePaymentAction || ordersLoading) return;

    if (action.nextStatus === 'cancelled') {
      const shouldCancel = window.confirm('Cancel ' + (order.order_number || 'this order') + '?');
      if (!shouldCancel) return;
    }

    activeOrderAction = { orderId: order.id, nextStatus: action.nextStatus };
    renderOrderDetail(order);
    setStatus(action.label + ' in progress...');

    const payload = { status: action.nextStatus };
    payload[action.timestampField] = new Date().toISOString();
    if (
      action.nextStatus === 'accepted'
      && getFulfillmentType(order) === 'delivery'
      && String(order.delivery_fee_status || '').trim().toLowerCase() === 'to_confirm'
    ) {
      payload.delivery_fee_status = 'confirmed';
    }

    const { error } = await client
      .from('orders')
      .update(payload)
      .eq('id', order.id);

    if (error) {
      activeOrderAction = null;
      renderOrderDetail(order);
      setStatus('Unable to update ' + (order.order_number || 'order') + '. ' + error.message);
      return;
    }

    activeOrderAction = null;
    activeStatus = action.nextStatus;
    updateFilterUi();
    await loadOrderSummary();
    if (typeof window.curvRefreshIncomingOrderBadge === 'function') await window.curvRefreshIncomingOrderBadge();
    await loadOrders();
    setStatus((order.order_number || 'Order') + ' moved to ' + String(STATUS_LABELS[action.nextStatus] || action.nextStatus).toLowerCase() + '.');
  };

  const handlePaymentStatusAction = async (order, nextStatus) => {
    if (!order || !order.id || !nextStatus) return;
    if (activePaymentAction || activeOrderAction || ordersLoading) return;

    activePaymentAction = { orderId: order.id, nextStatus };
    renderOrderDetail(order);
    setStatus((nextStatus === 'paid' ? 'Marking payment paid' : 'Marking payment unpaid') + '...');

    const { error } = await client
      .from('orders')
      .update({ payment_status: nextStatus })
      .eq('id', order.id);

    if (error) {
      activePaymentAction = null;
      renderOrderDetail(order);
      setStatus('Unable to update payment for ' + (order.order_number || 'order') + '. ' + error.message);
      return;
    }

    activePaymentAction = null;
    await loadOrders({ preserveSelection: true });
    setStatus((order.order_number || 'Order') + ' payment marked ' + formatPaymentStatus(nextStatus).toLowerCase() + '.');
  };

  const loadOrders = async ({ preserveSelection = false } = {}) => {
    if (!isOwnerSignedIn) {
      latestOrders = [];
      itemCountByOrderId = new Map();
      orderItemsByOrderId = new Map();
      orderItemsLoadError = '';
      selectedOrderId = '';
      activePaymentAction = null;
      renderOrders();
      setStatus('Ready for owner sign in.');
      return;
    }

    ordersLoading = true;
    if (!preserveSelection) selectedOrderId = '';
    updateFilterUi();
    setStatus('Loading ' + getStatusName() + ' orders...');
    renderOrders();

    const { data, error } = await client
      .from('orders')
      .select('id,order_number,status,source,customer_name,customer_phone,customer_email,fulfillment_type,pickup_time,customer_notes,subtotal,total,currency,payment_method,payment_status,delivery_option,delivery_address,delivery_fee,delivery_fee_status,created_at')
      .eq('status', activeStatus)
      .order('created_at', { ascending: false });

    ordersLoading = false;

    if (error) {
      latestOrders = [];
      itemCountByOrderId = new Map();
      orderItemsByOrderId = new Map();
      orderItemsLoadError = '';
      renderOrderEmptyState('Unable to load orders', error.message, 'is-error');
      renderOrderDetailPlaceholder('Unable to load order details', 'Resolve the Supabase error, then try again.');
      setStatus('Unable to load orders. ' + error.message);
      return;
    }

    latestOrders = data || [];
    await loadItemCounts(latestOrders);
    renderOrders();
    setStatus(getLoadedStatusMessage(latestOrders.length));

  };

  if (!hasSupabaseConfig) {
    setStatus('Supabase config missing. Add project URL and publishable key before connecting.');
    setFormDisabled(true);
    if (signOutButton) signOutButton.disabled = true;
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    setStatus('Supabase client could not load. Check the admin page script connection.');
    setFormDisabled(true);
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  const markRecentlyReceivedOrder = (order) => {
    const orderId = order && order.id ? String(order.id) : '';
    const incomingStatus = normalizeOrderStatus(order && order.status);
    if (!orderId || incomingStatus !== 'submitted') return;
    recentlyReceivedOrderIds.add(orderId);
    if (recentlyReceivedOrderTimers.has(orderId)) {
      window.clearTimeout(recentlyReceivedOrderTimers.get(orderId));
    }
    recentlyReceivedOrderTimers.set(orderId, window.setTimeout(() => {
      recentlyReceivedOrderIds.delete(orderId);
      recentlyReceivedOrderTimers.delete(orderId);
      renderOrders();
    }, 10000));
  };

  const refreshOrdersFromRealtime = async (incomingOrder) => {
    if (!isOwnerSignedIn) return;
    if (realtimeRefreshInFlight) {
      realtimeRefreshQueued = true;
      return;
    }

    realtimeRefreshInFlight = true;
    const incomingStatus = normalizeOrderStatus(incomingOrder && incomingOrder.status);
    try {
      markRecentlyReceivedOrder(incomingOrder);
      await loadOrderSummary();
      if (typeof window.curvRefreshIncomingOrderBadge === 'function') await window.curvRefreshIncomingOrderBadge();
      if (!incomingStatus || incomingStatus === activeStatus) {
        await loadOrders({ preserveSelection: true });
      }
      setStatus(incomingStatus === 'submitted' ? 'New order received.' : 'Order queue refreshed.');
    } catch (error) {
      setStatus('Realtime refresh failed. ' + (error && error.message ? error.message : 'Manual refresh still works.'));
    } finally {
      realtimeRefreshInFlight = false;
      if (realtimeRefreshQueued) {
        realtimeRefreshQueued = false;
        await refreshOrdersFromRealtime(incomingOrder);
      }
    }
  };

  const unsubscribeFromOrdersRealtime = () => {
    if (!ordersRealtimeChannel) return;
    const channel = ordersRealtimeChannel;
    ordersRealtimeChannel = null;
    client.removeChannel(channel);
  };

  const subscribeToOrdersRealtime = () => {
    if (ordersRealtimeChannel || !isOwnerSignedIn) return;
    ordersRealtimeChannel = client
      .channel('incoming-orders-admin')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          refreshOrdersFromRealtime(payload && payload.new);
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setStatus('Realtime refresh unavailable. Manual refresh still works.');
        }
      });
  };

  const refreshSession = async () => {
    const { data } = await client.auth.getSession();
    const isSignedIn = Boolean(data && data.session && data.session.user);
    setSignedInState(isSignedIn, data && data.session && data.session.user ? data.session.user.email : '');
    if (isSignedIn) {
      await loadOrderSummary();
      await loadOrders();
      subscribeToOrdersRealtime();
    } else {
      unsubscribeFromOrdersRealtime();
      latestOrders = [];
      itemCountByOrderId = new Map();
      orderItemsByOrderId = new Map();
      orderItemsLoadError = '';
      selectedOrderId = '';
      resetSummary();
      renderOrders();
      setStatus('Ready for owner sign in.');
    }
  };

  if (ownerAccountToggle) {
    ownerAccountToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleOwnerAccountMenu();
    });
  }

  if (ownerAccountMenu) {
    ownerAccountMenu.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }

  document.addEventListener('click', (event) => {
    if (!ownerAccount || ownerAccount.contains(event.target)) return;
    closeOwnerAccountMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOwnerAccountMenu();
  });

  filterButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const nextStatus = button.dataset.orderStatusFilter || 'submitted';
      if (nextStatus === activeStatus || ordersLoading || activeOrderAction) return;
      activeStatus = nextStatus;
      updateFilterUi();
      await loadOrders();
    });
  });

  if (authForm) {
    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      if (!email || !password) {
        setStatus('Enter the owner email and password.');
        return;
      }

      setStatus('Signing in...');
      setFormDisabled(true);
      const { error } = await client.auth.signInWithPassword({ email, password });
      setFormDisabled(false);
      if (error) {
        setSignedInState(false);
        resetSummary();
        renderOrders();
        setStatus('Sign in failed. ' + error.message);
        return;
      }

      if (passwordInput) passwordInput.value = '';
      setSignedInState(true, email);
      closeOwnerAccountMenu();
      await loadOrderSummary();
      await loadOrders();
      subscribeToOrdersRealtime();
    });
  }

  if (signOutButton) {
    signOutButton.addEventListener('click', async () => {
      setStatus('Signing out...');
      const { error } = await client.auth.signOut();
      if (error) {
        setStatus('Sign out failed. ' + error.message);
        return;
      }
      setSignedInState(false);
      unsubscribeFromOrdersRealtime();
      closeOwnerAccountMenu();
      recentlyReceivedOrderTimers.forEach((timer) => window.clearTimeout(timer));
      recentlyReceivedOrderTimers.clear();
      recentlyReceivedOrderIds.clear();
      latestOrders = [];
      itemCountByOrderId = new Map();
      orderItemsByOrderId = new Map();
      orderItemsLoadError = '';
      selectedOrderId = '';
      resetSummary();
      if (typeof window.curvHideIncomingOrderBadge === 'function') window.curvHideIncomingOrderBadge();
      renderOrders();
      setStatus('Signed out.');
    });
  }

  window.addEventListener('pagehide', unsubscribeFromOrdersRealtime);

  updateFilterUi();
  renderOrders();
  refreshSession();
})();
