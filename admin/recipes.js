(() => {
  const root = document.querySelector('[data-recipes-page]');
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
  const EDITOR_STATES = {
    CLOSED: 'CLOSED',
    LOADING: 'LOADING',
    CREATE_READY: 'CREATE_READY',
    EDIT_READY: 'EDIT_READY',
    DIRTY: 'DIRTY',
    LOAD_ERROR: 'LOAD_ERROR',
    DISCARD_CONFIRM: 'DISCARD_CONFIRM',
    SAVING: 'SAVING',
    SAVE_ERROR: 'SAVE_ERROR',
    SAVE_SUCCESS: 'SAVE_SUCCESS',
    CONFLICT: 'CONFLICT',
  };

  const statusRegion = document.querySelector('[data-recipes-status]');
  const metricValues = new Map(Array.from(document.querySelectorAll('[data-recipes-metric]'))
    .map((element) => [element.dataset.recipesMetric, element]));
  const attentionState = document.querySelector('[data-recipes-attention-state]');
  const attentionTitle = document.querySelector('[data-recipes-attention-title]');
  const attentionCopy = document.querySelector('[data-recipes-attention-copy]');
  const attentionList = document.querySelector('[data-recipes-attention-list]');
  const searchInput = document.querySelector('[data-recipes-search]');
  const categoryFilter = document.querySelector('[data-recipes-category-filter]');
  const statusFilter = document.querySelector('[data-recipes-status-filter]');
  const clearFiltersButton = document.querySelector('[data-recipes-clear-filters]');
  const resultCount = document.querySelector('[data-recipes-result-count]');
  const tableShell = document.querySelector('[data-recipes-table-shell]');
  const listBody = document.querySelector('[data-recipes-list]');
  const loadingState = document.querySelector('[data-recipes-loading]');
  const signedOutState = document.querySelector('[data-recipes-signed-out]');
  const emptyState = document.querySelector('[data-recipes-empty-state]');
  const noResultsState = document.querySelector('[data-recipes-no-results]');
  const errorState = document.querySelector('[data-recipes-error]');
  const retryButton = document.querySelector('[data-recipes-retry]');
  const drawerLayer = document.querySelector('[data-recipes-drawer-layer]');
  const backdrop = document.querySelector('[data-recipes-drawer-backdrop]');
  const drawers = Array.from(document.querySelectorAll('[data-recipes-drawer]'));
  const closeButtons = Array.from(document.querySelectorAll('[data-recipes-drawer-close]'));
  const drawerTitle = document.querySelector('[data-recipes-drawer-title]');
  const detailMeta = document.querySelector('[data-recipes-detail-meta]');
  const detailStatus = document.querySelector('[data-recipes-detail-status]');
  const detailNotes = document.querySelector('[data-recipes-detail-notes]');
  const ingredientList = document.querySelector('[data-recipes-ingredient-list]');
  const editorDrawer = document.querySelector('[data-recipes-drawer="editor"]');
  const editorTitle = document.querySelector('[data-recipes-editor-title]');
  const editorMeta = document.querySelector('[data-recipes-editor-meta]');
  const editorStatus = document.querySelector('[data-recipes-editor-status]');
  const editorLoading = document.querySelector('[data-recipes-editor-loading]');
  const editorError = document.querySelector('[data-recipes-editor-error]');
  const editorErrorCopy = document.querySelector('[data-recipes-editor-error-copy]');
  const editorRetryButton = document.querySelector('[data-recipes-editor-retry]');
  const editorErrorCancelButton = document.querySelector('[data-recipes-editor-cancel-error]');
  const editorForm = document.querySelector('[data-recipes-editor-form]');
  const editorNotes = document.querySelector('[data-recipes-editor-notes]');
  const editorNotesCount = document.querySelector('[data-recipes-editor-notes-count]');
  const editorRowsContainer = document.querySelector('[data-recipes-editor-rows]');
  const addIngredientButton = document.querySelector('[data-recipes-add-ingredient]');
  const editorSummary = document.querySelector('[data-recipes-editor-summary]');
  const editorCancelButton = document.querySelector('[data-recipes-editor-cancel]');
  const editorSaveButton = document.querySelector('[data-recipes-editor-save]');
  const saveHelper = document.querySelector('[data-recipes-save-helper]');
  const saveErrorPanel = document.querySelector('[data-recipes-save-error]');
  const saveErrorTitle = document.querySelector('[data-recipes-save-error-title]');
  const saveErrorCopy = document.querySelector('[data-recipes-save-error-copy]');
  const saveRetryButton = document.querySelector('[data-recipes-save-retry]');
  const saveErrorKeepButton = document.querySelector('[data-recipes-save-error-keep]');
  const saveCloseButton = document.querySelector('[data-recipes-save-close]');
  const saveReloadPageButton = document.querySelector('[data-recipes-save-reload-page]');
  const conflictPanel = document.querySelector('[data-recipes-conflict]');
  const conflictTitle = document.querySelector('[data-recipes-conflict-title]');
  const conflictCopy = document.querySelector('[data-recipes-conflict-copy]');
  const conflictKeepButton = document.querySelector('[data-recipes-conflict-keep]');
  const conflictCancelButton = document.querySelector('[data-recipes-conflict-cancel]');
  const conflictReloadButton = document.querySelector('[data-recipes-conflict-reload]');
  const conflictReloadConfirm = document.querySelector('[data-recipes-conflict-confirm]');
  const conflictReloadCancelButton = document.querySelector('[data-recipes-conflict-reload-cancel]');
  const conflictReloadConfirmButton = document.querySelector('[data-recipes-conflict-reload-confirm]');
  const discardConfirm = document.querySelector('[data-recipes-discard-confirm]');
  const keepEditingButton = document.querySelector('[data-recipes-keep-editing]');
  const discardEditorButton = document.querySelector('[data-recipes-discard-editor]');
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

  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  let client = null;
  let pageState = STATES.AUTH_LOADING;
  let isOwnerSignedIn = false;
  let signedInOwnerEmail = '';
  let loadSequence = 0;
  let detailSequence = 0;
  let activeLoadSessionKey = '';
  let activeDashboardLoadPromise = null;
  let searchTimer = 0;
  let recipeRows = [];
  let filteredRows = [];
  let categories = [];
  let activeDrawer = null;
  let lastFocusedElement = null;
  let pickerItems = null;
  let pickerLoadPromise = null;
  let pickerGeneration = 0;
  let editorSequence = 0;
  let editorState = EDITOR_STATES.CLOSED;
  let editorMode = 'create';
  let editorSummaryRow = null;
  let editorRows = [];
  let editorRowCounter = 0;
  let editorInitialSnapshot = '';
  let editorAttemptedCloseElement = null;
  let editorPendingAfterDiscard = null;
  let editorLastValidation = { isValid: true, problems: [] };
  let editorBaseline = null;
  let isSavingRecipe = false;
  let saveSequence = 0;
  let hasUnresolvedConflict = false;
  let saveRefreshFailed = false;

  const DASH = '-';
  const MAX_RECIPE_LINES = 100;
  const MAX_RECIPE_NOTES = 500;
  const recipeQuantityPattern = /^\d+(?:\.\d{1,3})?$/;

  const statusLabels = {
    ready: 'Ready',
    needs_attention: 'Needs Attention',
    not_configured: 'Not Configured',
  };

  const setStatus = (message = '') => {
    if (!statusRegion) return;
    statusRegion.textContent = message;
    statusRegion.hidden = !message;
  };

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

  const clearElement = (element) => {
    if (!element) return;
    while (element.firstChild) element.removeChild(element.firstChild);
  };

  const isEditorDirtyState = () => !saveRefreshFailed && [
    EDITOR_STATES.DIRTY,
    EDITOR_STATES.DISCARD_CONFIRM,
    EDITOR_STATES.SAVING,
    EDITOR_STATES.SAVE_ERROR,
    EDITOR_STATES.CONFLICT,
  ].includes(editorState);

  const setBeforeUnloadProtection = () => {
    window.onbeforeunload = isEditorDirtyState()
      ? (event) => {
        event.preventDefault();
        event.returnValue = '';
        return '';
      }
      : null;
  };

  const createTextElement = (tagName, className, text) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  };

  const getFocusable = (drawer) => Array.from(drawer.querySelectorAll(focusableSelector))
    .filter((element) => element.offsetParent !== null || element === document.activeElement);

  const getStableFocusFallback = () => {
    if (searchInput && searchInput.isConnected && !searchInput.disabled) return searchInput;
    const pageTitle = document.getElementById('recipes-title');
    if (pageTitle && pageTitle.isConnected) {
      pageTitle.setAttribute('tabindex', '-1');
      return pageTitle;
    }
    return null;
  };

  const openDrawer = (drawerName, trigger) => {
    const drawer = drawers.find((item) => item.dataset.recipesDrawer === drawerName);
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
  };

  const closeDrawer = ({ restoreFocus = true } = {}) => {
    if (!activeDrawer || !drawerLayer || !backdrop) return;
    drawerLayer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('inventory-drawer-open');
    drawers.forEach((item) => {
      item.hidden = true;
    });
    drawerLayer.hidden = true;
    backdrop.hidden = true;
    if (activeDrawer === editorDrawer) {
      resetEditor({ keepTrigger: true });
    }
    activeDrawer = null;
    detailSequence += 1;
    const focusTarget = lastFocusedElement && lastFocusedElement.isConnected
      ? lastFocusedElement
      : getStableFocusFallback();
    if (restoreFocus && focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  };

  const requestCloseDrawer = (trigger = document.activeElement) => {
    if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.SAVING) {
      return;
    }
    if (activeDrawer === editorDrawer && saveRefreshFailed) {
      closeDrawer();
      return;
    }
    if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.CONFLICT) {
      conflictTitle?.focus();
      return;
    }
    if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.DIRTY) {
      editorPendingAfterDiscard = null;
      showDiscardConfirm(trigger);
      return;
    }
    if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.SAVE_ERROR) {
      editorPendingAfterDiscard = null;
      showDiscardConfirm(trigger);
      return;
    }
    if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.DISCARD_CONFIRM) {
      return;
    }
    closeDrawer();
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

  const setRecipesNavActive = () => {
    document.querySelectorAll('[data-nav-item]').forEach((item) => {
      const isRecipes = item.dataset.navItem === 'recipes';
      item.classList.toggle('is-active', isRecipes);
      if (isRecipes) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    document.querySelectorAll('.mobile-more-item').forEach((item) => {
      const isRecipes = item.getAttribute('href') === 'recipes.html';
      item.classList.toggle('is-active', isRecipes);
      if (isRecipes) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  };

  const parseNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, '').trim());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  const formatInteger = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(parseNumber(value));

  const formatDecimal = (value) => {
    const numeric = parseNumber(value);
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: Number.isInteger(numeric) ? 0 : 1,
      maximumFractionDigits: 3,
    }).format(numeric);
  };

  const formatDate = (value) => {
    if (!value) return 'Never updated';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never updated';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  };

  const getStatusLabel = (status) => statusLabels[status] || 'Needs Review';

  const normalizeRecipeRow = (row) => {
    const status = row.recipe_status || 'not_configured';
    return {
      productId: row.product_id || '',
      productName: row.product_name || 'Untitled product',
      categoryId: row.category_id || '',
      categoryName: row.category_name || 'Uncategorized',
      productSizeId: row.product_size_id || '',
      productSizeLabel: row.product_size_label || 'Standard',
      productSizeSortOrder: parseNumber(row.product_size_sort_order),
      recipeId: row.recipe_id || '',
      recipeExists: row.recipe_exists === true,
      ingredientLineCount: parseNumber(row.ingredient_line_count),
      inactiveIngredientCount: parseNumber(row.inactive_ingredient_count),
      recipeStatus: status,
      approximateCanMake: row.approximate_can_make === null || row.approximate_can_make === undefined
        ? null
        : parseNumber(row.approximate_can_make),
      recipeNotes: row.recipe_notes || '',
      recipeUpdatedAt: row.recipe_updated_at || '',
    };
  };

  const getCanMakeText = (row) => {
    if (row.approximateCanMake !== null) {
      if (row.approximateCanMake === 0) return '0 servings';
      return `About ${formatInteger(row.approximateCanMake)} serving${row.approximateCanMake === 1 ? '' : 's'}`;
    }
    if (row.recipeStatus === 'not_configured') return 'Not configured';
    return 'Needs review';
  };

  const getAttentionReason = (row) => {
    if (row.ingredientLineCount === 0) return 'Recipe has no ingredients.';
    if (row.inactiveIngredientCount > 0) return 'Recipe uses an inactive inventory item.';
    return 'Recipe needs review.';
  };

  const getFilters = () => ({
    search: (searchInput?.value || '').trim().toLowerCase(),
    category: categoryFilter?.value || 'all',
    status: statusFilter?.value || 'all',
  });

  const applyFilters = () => {
    const filters = getFilters();
    filteredRows = recipeRows.filter((row) => {
      if (filters.search && !row.productName.toLowerCase().includes(filters.search)) return false;
      if (filters.category !== 'all' && row.categoryId !== filters.category) return false;
      if (filters.status !== 'all' && row.recipeStatus !== filters.status) return false;
      return true;
    });
  };

  const groupRowsByProduct = (rows) => {
    const groups = [];
    const groupMap = new Map();
    rows.forEach((row) => {
      const key = row.productId || row.productName;
      if (!groupMap.has(key)) {
        const group = {
          productId: row.productId,
          productName: row.productName,
          categoryName: row.categoryName,
          rows: [],
        };
        groupMap.set(key, group);
        groups.push(group);
      }
      groupMap.get(key).rows.push(row);
    });
    return groups;
  };

  const getProductCount = (rows) => new Set(rows.map((row) => row.productId || row.productName)).size;

  const getSizeWord = (count) => `size${count === 1 ? '' : 's'}`;

  const getProductWord = (count) => `product${count === 1 ? '' : 's'}`;

  const renderCategoryOptions = () => {
    if (!categoryFilter) return;
    const selectedValue = categoryFilter.value || 'all';
    clearElement(categoryFilter);
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Categories';
    categoryFilter.appendChild(allOption);

    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      categoryFilter.appendChild(option);
    });

    categoryFilter.value = Array.from(categoryFilter.options).some((option) => option.value === selectedValue)
      ? selectedValue
      : 'all';
  };

  const renderMetrics = () => {
    const sellableSizes = recipeRows.length;
    const configuredRecipes = recipeRows.filter((row) => row.recipeExists && row.recipeStatus === 'ready').length;
    const needsAttention = recipeRows.filter((row) => row.recipeStatus === 'needs_attention').length;
    const notConfigured = recipeRows.filter((row) => row.recipeStatus === 'not_configured').length;
    const values = {
      'sellable-sizes': sellableSizes,
      'configured-recipes': configuredRecipes,
      'needs-attention': needsAttention,
      'not-configured': notConfigured,
    };

    metricValues.forEach((element, key) => {
      element.textContent = pageState === STATES.READY ? formatInteger(values[key] || 0) : DASH;
    });
  };

  const createStatusChip = (status) => {
    const chip = createTextElement('span', `inventory-status-chip recipes-status-${status.replace(/_/g, '-')}`, getStatusLabel(status));
    return chip;
  };

  const createViewButton = (row, className = 'inventory-row-action') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = 'View Recipe';
    button.dataset.recipesDrawerOpen = 'details';
    button.dataset.recipesProductSizeId = row.productSizeId || '';
    button.dataset.recipesAction = 'view';
    button.addEventListener('click', () => {
      if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.SAVING) return;
      if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.CONFLICT) {
        conflictTitle?.focus();
        return;
      }
      if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.SAVE_ERROR) {
        editorPendingAfterDiscard = () => openRecipeDetails(row, button);
        showDiscardConfirm(button);
        return;
      }
      if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.DIRTY) {
        editorPendingAfterDiscard = () => openRecipeDetails(row, button);
        showDiscardConfirm(button);
        return;
      }
      openRecipeDetails(row, button);
    });
    return button;
  };

  const createEditorButton = (row, label, className = 'inventory-row-action') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.dataset.recipesDrawerOpen = 'editor';
    button.dataset.recipesProductSizeId = row.productSizeId || '';
    button.dataset.recipesAction = label === 'Configure Recipe' ? 'configure' : 'edit';
    button.addEventListener('click', () => {
      openRecipeEditor(row, button);
    });
    return button;
  };

  const getEditorReturnTarget = () => {
    const productSizeId = editorBaseline?.productSizeId
      || lastFocusedElement?.dataset?.recipesProductSizeId
      || editorSummaryRow?.productSizeId
      || '';
    if (!productSizeId) return null;
    const triggerAction = lastFocusedElement?.dataset?.recipesAction || '';
    const sourceAction = ['configure', 'edit'].includes(triggerAction)
      ? triggerAction
      : (editorMode === 'create' ? 'configure' : 'edit');
    return {
      productSizeId,
      sourceAction,
      action: sourceAction === 'configure' ? 'edit' : sourceAction,
    };
  };

  const findRecipeActionButton = (target) => {
    if (!target || !target.productSizeId || !target.action) return null;
    return Array.from(document.querySelectorAll('[data-recipes-product-size-id][data-recipes-action]'))
      .find((button) => button.dataset.recipesProductSizeId === target.productSizeId
        && button.dataset.recipesAction === target.action
        && !button.disabled
        && button.isConnected) || null;
  };

  const rebindEditorReturnFocus = (target) => {
    lastFocusedElement = findRecipeActionButton(target) || getStableFocusFallback();
  };

  const renderAttention = () => {
    clearElement(attentionList);
    const attentionRows = recipeRows.filter((row) => row.recipeStatus === 'needs_attention');

    if (pageState === STATES.AUTH_LOADING || pageState === STATES.LOADING) {
      if (attentionState) attentionState.hidden = false;
      if (attentionList) attentionList.hidden = true;
      if (attentionTitle) attentionTitle.textContent = 'Checking recipes...';
      if (attentionCopy) attentionCopy.textContent = 'Recipe alerts will appear here.';
      return;
    }

    if (pageState === STATES.SIGNED_OUT) {
      if (attentionState) attentionState.hidden = false;
      if (attentionList) attentionList.hidden = true;
      if (attentionTitle) attentionTitle.textContent = 'Sign in to view recipe alerts.';
      if (attentionCopy) attentionCopy.textContent = 'Owner access is required before recipe data appears.';
      return;
    }

    if (pageState === STATES.ERROR) {
      if (attentionState) attentionState.hidden = false;
      if (attentionList) attentionList.hidden = true;
      if (attentionTitle) attentionTitle.textContent = "Couldn't load recipe alerts.";
      if (attentionCopy) attentionCopy.textContent = 'Try loading recipes again.';
      return;
    }

    if (!attentionRows.length) {
      if (attentionState) attentionState.hidden = false;
      if (attentionList) attentionList.hidden = true;
      if (attentionTitle) attentionTitle.textContent = 'Nothing needs attention right now.';
      if (attentionCopy) attentionCopy.textContent = 'Recipes that need review will appear here.';
      return;
    }

    if (attentionState) attentionState.hidden = true;
    if (attentionList) attentionList.hidden = false;

    attentionRows.forEach((row) => {
      const item = document.createElement('article');
      item.className = 'inventory-alert-row recipes-alert-row';

      const copy = document.createElement('div');
      copy.appendChild(createTextElement('strong', 'inventory-alert-title', `${row.productName} - ${row.productSizeLabel}`));
      copy.appendChild(createTextElement('p', 'inventory-alert-detail', getAttentionReason(row)));
      const detail = [
        `${row.ingredientLineCount} ingredient${row.ingredientLineCount === 1 ? '' : 's'}`,
        row.inactiveIngredientCount > 0 ? `${row.inactiveIngredientCount} inactive` : '',
      ].filter(Boolean).join(' | ');
      copy.appendChild(createTextElement('p', 'inventory-alert-detail', detail));
      item.appendChild(copy);
      item.appendChild(createViewButton(row, 'inventory-row-action inventory-alert-action'));
      attentionList.appendChild(item);
    });
  };

  const renderRecipeRows = (rows) => {
    clearElement(listBody);
    const groups = groupRowsByProduct(rows);

    groups.forEach((group) => {
      const groupRow = document.createElement('tr');
      groupRow.className = 'recipes-product-group-row';
      const groupCell = document.createElement('th');
      groupCell.scope = 'rowgroup';
      groupCell.colSpan = 6;
      const header = document.createElement('div');
      header.className = 'recipes-product-group-header';
      header.appendChild(createTextElement('strong', 'recipes-product-group-title', group.productName));
      header.appendChild(createTextElement(
        'span',
        'recipes-product-group-meta',
        `${group.categoryName} | ${group.rows.length} ${getSizeWord(group.rows.length)}`,
      ));
      groupCell.appendChild(header);
      groupRow.appendChild(groupCell);
      listBody.appendChild(groupRow);

      group.rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.className = 'recipes-size-row';

      const sizeCell = document.createElement('td');
      sizeCell.dataset.label = 'Size';
      sizeCell.textContent = row.productSizeLabel;
      tr.appendChild(sizeCell);

      const statusCell = document.createElement('td');
      statusCell.dataset.label = 'Recipe Status';
      statusCell.appendChild(createStatusChip(row.recipeStatus));
      tr.appendChild(statusCell);

      const ingredientsCell = document.createElement('td');
      ingredientsCell.dataset.label = 'Ingredients';
      ingredientsCell.textContent = `${row.ingredientLineCount} ingredient${row.ingredientLineCount === 1 ? '' : 's'}`;
      if (row.inactiveIngredientCount > 0) {
        ingredientsCell.appendChild(createTextElement('span', 'inventory-expired-note', `${row.inactiveIngredientCount} inactive`));
      }
      tr.appendChild(ingredientsCell);

      const canMakeCell = document.createElement('td');
      canMakeCell.dataset.label = 'Can Make';
      canMakeCell.textContent = getCanMakeText(row);
      tr.appendChild(canMakeCell);

      const updatedCell = document.createElement('td');
      updatedCell.dataset.label = 'Updated';
      updatedCell.textContent = formatDate(row.recipeUpdatedAt);
      tr.appendChild(updatedCell);

      const actionCell = document.createElement('td');
      actionCell.dataset.label = 'Action';
      const actionWrap = document.createElement('div');
      actionWrap.className = 'inventory-row-actions';
      if (row.recipeStatus === 'not_configured') {
        actionWrap.appendChild(createEditorButton(row, 'Configure Recipe'));
      } else {
        actionWrap.appendChild(createViewButton(row));
        actionWrap.appendChild(createEditorButton(row, 'Edit Recipe'));
      }
      actionCell.appendChild(actionWrap);
      tr.appendChild(actionCell);

      listBody.appendChild(tr);
      });
    });
  };

  const renderRecipes = () => {
    renderMetrics();
    renderCategoryOptions();
    if (pageState === STATES.READY) {
      applyFilters();
      renderAttention();
      renderRecipeRows(filteredRows);
    } else {
      filteredRows = [];
      clearElement(listBody);
      renderAttention();
    }
    updateFilterControlState();
    updateListState();
  };

  const updateListState = () => {
    const filters = getFilters();
    const searchActive = Boolean(filters.search);
    const categoryActive = filters.category !== 'all';
    const statusActive = filters.status !== 'all';
    const filtersActive = searchActive || categoryActive || statusActive;
    const shouldShowTable = pageState === STATES.READY && filteredRows.length > 0;
    const noRows = pageState === STATES.READY && recipeRows.length === 0;
    const noResults = pageState === STATES.READY && recipeRows.length > 0 && filteredRows.length === 0;
    const visibleState = pageState === STATES.AUTH_LOADING || pageState === STATES.LOADING
      ? 'loading'
      : pageState === STATES.SIGNED_OUT
        ? 'signed-out'
        : pageState === STATES.ERROR
          ? 'error'
          : shouldShowTable
            ? 'rows'
            : noResults
              ? 'no-results'
              : noRows
                ? 'empty'
                : 'rows';

    if (clearFiltersButton) clearFiltersButton.hidden = pageState !== STATES.READY || !filtersActive;
    if (tableShell) tableShell.hidden = !shouldShowTable;
    if (loadingState) loadingState.hidden = visibleState !== 'loading';
    if (signedOutState) signedOutState.hidden = visibleState !== 'signed-out';
    if (errorState) errorState.hidden = visibleState !== 'error';
    if (emptyState) emptyState.hidden = visibleState !== 'empty';
    if (noResultsState) noResultsState.hidden = visibleState !== 'no-results';

    if (resultCount) {
      if (pageState === STATES.READY && recipeRows.length > 0) {
        const totalProductCount = getProductCount(recipeRows);
        const filteredProductCount = getProductCount(filteredRows);
        resultCount.hidden = false;
        resultCount.textContent = filtersActive
          ? `Showing ${filteredRows.length} of ${recipeRows.length} ${getSizeWord(recipeRows.length)} across ${filteredProductCount} ${getProductWord(filteredProductCount)}`
          : `${recipeRows.length} sellable ${getSizeWord(recipeRows.length)} across ${totalProductCount} ${getProductWord(totalProductCount)}`;
      } else {
        resultCount.hidden = true;
        resultCount.textContent = '';
      }
    }
  };

  const setPageState = (nextState) => {
    pageState = nextState;
    if (nextState === STATES.AUTH_LOADING) setStatus('Loading...');
    else if (nextState === STATES.SIGNED_OUT) setStatus('Sign in to view recipes.');
    else if (nextState === STATES.LOADING) setStatus('Loading recipes...');
    else if (nextState === STATES.ERROR) setStatus("Couldn't load recipes.");
    else setStatus('');
    renderRecipes();
  };

  const clearRecipeState = () => {
    recipeRows = [];
    filteredRows = [];
    categories = [];
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = 'all';
    if (statusFilter) statusFilter.value = 'all';
    clearElement(ingredientList);
  };

  const loadRecipeData = async () => {
    if (!client || !isOwnerSignedIn) return { ok: false, reason: 'signed_out' };
    const sessionKey = signedInOwnerEmail || 'owner';
    if (pageState === STATES.LOADING && activeLoadSessionKey === sessionKey) {
      return { ok: false, reason: 'stale' };
    }
    activeLoadSessionKey = sessionKey;
    const sequence = loadSequence + 1;
    loadSequence = sequence;
    setPageState(STATES.LOADING);

    let loadPromise;
    loadPromise = (async () => {
      try {
        const result = await client
          .from('inventory_recipe_summary')
          .select('product_id,product_name,category_id,category_name,product_size_id,product_size_label,product_size_sort_order,recipe_id,recipe_exists,ingredient_line_count,inactive_ingredient_count,recipe_status,approximate_can_make,recipe_notes,recipe_updated_at')
          .order('product_name', { ascending: true })
          .order('product_size_sort_order', { ascending: true })
          .order('product_size_label', { ascending: true });

        if (result.error) throw result.error;
        if (sequence !== loadSequence || !isOwnerSignedIn) return { ok: false, reason: 'stale' };

        recipeRows = (result.data || []).map(normalizeRecipeRow);
        const categoryMap = new Map();
        recipeRows.forEach((row) => {
          if (row.categoryId && !categoryMap.has(row.categoryId)) {
            categoryMap.set(row.categoryId, { id: row.categoryId, name: row.categoryName });
          }
        });
        categories = Array.from(categoryMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        setPageState(STATES.READY);
        return { ok: true };
      } catch (error) {
        console.error('Recipes read failed:', error);
        if (sequence !== loadSequence) return { ok: false, reason: 'stale' };
        try {
          const { data } = await client.auth.getSession();
          const user = data && data.session && data.session.user;
          if (!user) {
            handleAuthState(false);
            return { ok: false, reason: 'signed_out' };
          }
        } catch (sessionError) {
          console.error('Recipes session check failed:', sessionError);
        }
        setPageState(STATES.ERROR);
        return { ok: false, reason: 'error' };
      } finally {
        if (sequence === loadSequence) activeLoadSessionKey = '';
        if (activeDashboardLoadPromise === loadPromise) activeDashboardLoadPromise = null;
      }
    })();

    activeDashboardLoadPromise = loadPromise;
    return loadPromise;
  };

  const setDetailStatus = (message = '') => {
    if (!detailStatus) return;
    detailStatus.textContent = message;
    detailStatus.hidden = !message;
  };

  const setEditorStatus = (message = '') => {
    if (!editorStatus) return;
    editorStatus.textContent = message;
    editorStatus.hidden = !message;
  };

  const setEditorState = (nextState) => {
    editorState = nextState;
    const isLoading = nextState === EDITOR_STATES.LOADING;
    const isError = nextState === EDITOR_STATES.LOAD_ERROR;
    const isConfirming = nextState === EDITOR_STATES.DISCARD_CONFIRM;
    const isSaving = nextState === EDITOR_STATES.SAVING;
    const isSaveError = nextState === EDITOR_STATES.SAVE_ERROR;
    const isConflict = nextState === EDITOR_STATES.CONFLICT;
    const isTerminalRefreshFailure = isSaveError && saveRefreshFailed;
    if (editorLoading) editorLoading.hidden = !isLoading;
    if (editorError) editorError.hidden = !isError;
    if (discardConfirm) discardConfirm.hidden = !isConfirming;
    if (saveErrorPanel) saveErrorPanel.hidden = !isSaveError;
    if (conflictPanel) conflictPanel.hidden = !isConflict;
    if (conflictReloadConfirm) conflictReloadConfirm.hidden = true;
    if (editorForm) editorForm.hidden = isLoading || isError || isConfirming;
    if (editorDrawer) {
      editorDrawer.setAttribute('aria-busy', isSaving ? 'true' : 'false');
    }
    setEditorControlsDisabled(isLoading || isSaving || isTerminalRefreshFailure, {
      allowDrawerClose: isTerminalRefreshFailure,
    });
    updateSaveButtonState();
    setBeforeUnloadProtection();
  };

  const resetEditor = ({ keepTrigger = false } = {}) => {
    editorSequence += 1;
    editorMode = 'create';
    editorSummaryRow = null;
    editorRows = [];
    editorInitialSnapshot = '';
    editorAttemptedCloseElement = null;
    editorPendingAfterDiscard = null;
    editorLastValidation = { isValid: true, problems: [] };
    editorBaseline = null;
    isSavingRecipe = false;
    hasUnresolvedConflict = false;
    saveRefreshFailed = false;
    if (!keepTrigger) lastFocusedElement = null;
    if (editorTitle) editorTitle.textContent = 'Recipe Editor';
    clearElement(editorMeta);
    clearElement(editorRowsContainer);
    if (editorNotes) {
      editorNotes.value = '';
      editorNotes.removeAttribute('aria-invalid');
    }
    if (editorNotesCount) editorNotesCount.textContent = '0 / 500';
    if (editorSummary) {
      editorSummary.hidden = true;
      editorSummary.replaceChildren();
    }
    setEditorStatus('');
    setEditorState(EDITOR_STATES.CLOSED);
  };

  const getEditorReadyState = () => (editorMode === 'edit' ? EDITOR_STATES.EDIT_READY : EDITOR_STATES.CREATE_READY);

  const normalizeBaselineFromRow = (row) => ({
    productSizeId: row.productSizeId || '',
    recipeId: row.recipeId || '',
    recipeExists: row.recipeExists === true,
    recipeUpdatedAt: row.recipeUpdatedAt || '',
    recipeStatus: row.recipeStatus || 'not_configured',
    recipeNotes: row.recipeNotes || '',
  });

  const fetchFreshSummaryRow = async (productSizeId) => {
    if (!client || !productSizeId) return null;
    const result = await client
      .from('inventory_recipe_summary')
      .select('product_id,product_name,category_id,category_name,product_size_id,product_size_label,product_size_sort_order,recipe_id,recipe_exists,ingredient_line_count,inactive_ingredient_count,recipe_status,approximate_can_make,recipe_notes,recipe_updated_at')
      .eq('product_size_id', productSizeId)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data ? normalizeRecipeRow(result.data) : null;
  };

  const normalizePickerItem = (row) => ({
    itemId: row.item_id || '',
    itemName: row.item_name || 'Unnamed item',
    categoryName: row.category_name || 'Uncategorized',
    unitAbbreviation: row.unit_abbreviation || '',
  });

  const loadPickerItems = async () => {
    if (pickerItems) return pickerItems;
    if (pickerLoadPromise) return pickerLoadPromise;
    if (!client || !isOwnerSignedIn) throw new Error('Sign in before loading inventory ingredients.');

    const requestGeneration = pickerGeneration;
    const requestPromise = client
      .from('inventory_stock_summary')
      .select('item_id,item_name,category_name,unit_abbreviation,is_active')
      .eq('is_active', true)
      .order('category_name', { ascending: true })
      .order('item_name', { ascending: true })
      .then((result) => {
        if (result.error) throw result.error;
        const loadedItems = (result.data || [])
          .filter((row) => row.is_active !== false)
          .map(normalizePickerItem)
          .filter((item) => item.itemId);
        if (requestGeneration === pickerGeneration && isOwnerSignedIn) {
          pickerItems = loadedItems;
          return pickerItems;
        }
        return [];
      })
      .finally(() => {
        if (pickerLoadPromise === requestPromise) pickerLoadPromise = null;
      });

    pickerLoadPromise = requestPromise;
    return pickerLoadPromise;
  };

  const clearPickerCache = () => {
    pickerGeneration += 1;
    pickerItems = null;
    pickerLoadPromise = null;
  };

  const getPickerItem = (itemId) => (pickerItems || []).find((item) => item.itemId === itemId) || null;

  const getEditorItemName = (row) => {
    const activeItem = getPickerItem(row.itemId);
    if (activeItem) return activeItem.itemName;
    if (row.unavailableItem) return row.unavailableItem.itemName;
    return 'ingredient';
  };

  const getEditorUnit = (row) => {
    const activeItem = getPickerItem(row.itemId);
    if (activeItem) return activeItem.unitAbbreviation;
    if (row.unavailableItem) return row.unavailableItem.unitAbbreviation;
    return '';
  };

  const createEditorRow = (overrides = {}) => {
    editorRowCounter += 1;
    return {
      rowId: `recipe-line-${Date.now()}-${editorRowCounter}`,
      itemId: '',
      quantity: '',
      unavailableItem: null,
      touched: false,
      ...overrides,
    };
  };

  const getEditorSnapshot = () => JSON.stringify({
    notes: editorNotes ? editorNotes.value : '',
    lines: editorRows.map((row) => ({
      itemId: row.itemId || '',
      quantity: row.quantity || '',
      unavailableItemId: row.unavailableItem ? row.unavailableItem.itemId : '',
    })),
  });

  const updateNotesCount = () => {
    if (!editorNotesCount || !editorNotes) return;
    editorNotesCount.textContent = `${editorNotes.value.length} / ${MAX_RECIPE_NOTES}`;
  };

  const setEditorControlsDisabled = (isDisabled, { allowDrawerClose = false } = {}) => {
    if (editorNotes) editorNotes.disabled = isDisabled;
    if (addIngredientButton) addIngredientButton.disabled = isDisabled || editorRows.length >= MAX_RECIPE_LINES;
    if (editorCancelButton) editorCancelButton.disabled = isDisabled;
    if (editorSaveButton) editorSaveButton.disabled = true;
    editorDrawer?.querySelectorAll('[data-recipes-drawer-close]').forEach((button) => {
      button.disabled = isDisabled && !allowDrawerClose;
    });
    if (!editorRowsContainer) return;
    editorRowsContainer.querySelectorAll('select, input, button').forEach((control) => {
      control.disabled = isDisabled || (control.matches('[data-recipes-remove-ingredient]') && editorRows.length <= 0);
    });
  };

  const renderEditorHeader = (row) => {
    if (editorTitle) editorTitle.textContent = `${row.productName} - ${row.productSizeLabel}`;
    clearElement(editorMeta);
    if (!editorMeta) return;
    [
      row.categoryName,
      getStatusLabel(row.recipeStatus),
      row.recipeExists ? `Updated ${formatDate(row.recipeUpdatedAt)}` : 'No recipe yet',
    ].forEach((text) => {
      editorMeta.appendChild(createTextElement('span', 'recipes-detail-pill', text));
    });
  };

  const addOption = (select, value, text, { disabled = false, selected = false } = {}) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.disabled = disabled;
    option.selected = selected;
    select.appendChild(option);
    return option;
  };

  const buildIngredientSelectOptions = (select, row) => {
    clearElement(select);
    addOption(select, '', 'Choose ingredient...');

    const activeItem = getPickerItem(row.itemId);
    if (row.unavailableItem && !activeItem) {
      const label = row.unavailableItem.isArchived ? 'Archived' : 'Unavailable';
      addOption(select, row.unavailableItem.itemId, `${label} - ${row.unavailableItem.itemName}`, {
        disabled: true,
        selected: true,
      });
    }

    const groups = new Map();
    (pickerItems || []).forEach((item) => {
      const groupName = item.categoryName || 'Uncategorized';
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push(item);
    });

    Array.from(groups.entries()).forEach(([categoryName, items]) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = categoryName;
      items.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.itemId;
        option.textContent = item.itemName;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });

    select.value = row.itemId || '';
  };

  const getQuantityValidationMessage = (value) => {
    const raw = value.trim();
    if (!raw) return 'Enter a quantity.';
    if (!recipeQuantityPattern.test(raw)) return 'Use plain decimal notation with up to three decimal places.';
    const integerPart = raw.split('.')[0].replace(/^0+/, '') || '0';
    if (integerPart.length > 11) return 'Use 11 or fewer digits before the decimal point.';
    const isZero = raw.replace(/[.0]/g, '') === '';
    if (isZero) return 'Quantity must be greater than zero.';
    return '';
  };

  const renderEditorRows = () => {
    clearElement(editorRowsContainer);
    if (!editorRowsContainer) return;

    editorRows.forEach((row, index) => {
      const number = index + 1;
      const rowElement = document.createElement('article');
      rowElement.className = 'recipes-editor-row';
      rowElement.dataset.editorRowId = row.rowId;

      const ingredientId = `${row.rowId}-ingredient`;
      const quantityId = `${row.rowId}-quantity`;
      const unitId = `${row.rowId}-unit`;
      const messageId = `${row.rowId}-message`;

      const ingredientField = document.createElement('label');
      ingredientField.className = 'admin-field recipes-editor-ingredient-field';
      ingredientField.setAttribute('for', ingredientId);
      ingredientField.appendChild(createTextElement('span', '', `Ingredient ${number}`));
      const select = document.createElement('select');
      select.id = ingredientId;
      select.dataset.editorIngredient = row.rowId;
      select.setAttribute('aria-describedby', messageId);
      buildIngredientSelectOptions(select, row);
      ingredientField.appendChild(select);
      rowElement.appendChild(ingredientField);

      const quantityField = document.createElement('label');
      quantityField.className = 'admin-field recipes-editor-quantity-field';
      quantityField.setAttribute('for', quantityId);
      quantityField.appendChild(createTextElement('span', '', `Quantity for Ingredient ${number}`));
      const quantityWrap = document.createElement('div');
      quantityWrap.className = 'recipes-editor-quantity-wrap';
      const quantityInput = document.createElement('input');
      quantityInput.id = quantityId;
      quantityInput.type = 'text';
      quantityInput.inputMode = 'decimal';
      quantityInput.autocomplete = 'off';
      quantityInput.value = row.quantity;
      quantityInput.dataset.editorQuantity = row.rowId;
      quantityInput.setAttribute('aria-describedby', `${unitId} ${messageId}`);
      const unitLabel = document.createElement('span');
      unitLabel.className = 'recipes-editor-unit';
      unitLabel.id = unitId;
      unitLabel.textContent = getEditorUnit(row) || 'unit';
      unitLabel.setAttribute('aria-label', `Unit for Ingredient ${number}`);
      quantityWrap.appendChild(quantityInput);
      quantityWrap.appendChild(unitLabel);
      quantityField.appendChild(quantityWrap);
      rowElement.appendChild(quantityField);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'inventory-row-action recipes-remove-ingredient';
      removeButton.dataset.recipesRemoveIngredient = row.rowId;
      removeButton.textContent = 'Remove';
      removeButton.setAttribute('aria-label', `Remove ${getEditorItemName(row)} ingredient`);
      rowElement.appendChild(removeButton);

      const message = document.createElement('p');
      message.className = 'recipes-editor-row-message';
      message.id = messageId;
      message.dataset.editorRowMessage = row.rowId;
      message.setAttribute('aria-live', 'polite');
      rowElement.appendChild(message);

      if (row.unavailableItem && !getPickerItem(row.itemId)) {
        message.textContent = row.unavailableItem.isArchived
          ? 'This ingredient is archived. Remove or replace it before saving.'
          : 'This ingredient is unavailable. Remove or replace it before saving.';
        message.classList.add('is-warning');
      }

      editorRowsContainer.appendChild(rowElement);
    });

    if (addIngredientButton) addIngredientButton.disabled = editorRows.length >= MAX_RECIPE_LINES;
  };

  const validateEditor = ({ show = false, focus = false } = {}) => {
    const problems = [];
    const seenItems = new Map();
    let firstInvalidControl = null;
    let completeLineCount = 0;

    if (editorRows.length > MAX_RECIPE_LINES) {
      problems.push('Recipes can have at most 100 ingredient rows.');
    }

    editorRows.forEach((row, index) => {
      const number = index + 1;
      const rowElement = editorRowsContainer?.querySelector(`[data-editor-row-id="${row.rowId}"]`);
      const select = rowElement?.querySelector('[data-editor-ingredient]');
      const quantityInput = rowElement?.querySelector('[data-editor-quantity]');
      const message = rowElement?.querySelector('[data-editor-row-message]');
      const rowMessages = [];

      select?.removeAttribute('aria-invalid');
      quantityInput?.removeAttribute('aria-invalid');
      if (message && !(row.unavailableItem && !getPickerItem(row.itemId))) {
        message.textContent = '';
        message.classList.remove('is-warning');
      }

      if (!row.itemId) {
        rowMessages.push(`Choose Ingredient ${number}.`);
        if (!firstInvalidControl) firstInvalidControl = select;
        select?.setAttribute('aria-invalid', 'true');
      } else if (!getPickerItem(row.itemId)) {
        const unavailableLabel = row.unavailableItem && row.unavailableItem.isArchived ? 'archived' : 'unavailable';
        rowMessages.push(`Ingredient ${number} is ${unavailableLabel}.`);
        if (!firstInvalidControl) firstInvalidControl = select;
        select?.setAttribute('aria-invalid', 'true');
      } else {
        completeLineCount += 1;
        if (seenItems.has(row.itemId)) {
          rowMessages.push(`Ingredient ${number} is duplicated.`);
          if (!firstInvalidControl) firstInvalidControl = select;
          select?.setAttribute('aria-invalid', 'true');
        }
        seenItems.set(row.itemId, true);
      }

      const quantityMessage = getQuantityValidationMessage(row.quantity);
      if (quantityMessage) {
        rowMessages.push(`Ingredient ${number}: ${quantityMessage}`);
        if (!firstInvalidControl) firstInvalidControl = quantityInput;
        quantityInput?.setAttribute('aria-invalid', 'true');
      }

      if (rowMessages.length) {
        problems.push(...rowMessages);
        if (show || row.touched || (row.unavailableItem && !getPickerItem(row.itemId))) {
          if (message) {
            message.textContent = rowMessages.join(' ');
            if (row.unavailableItem && !getPickerItem(row.itemId)) message.classList.add('is-warning');
          }
        }
      }
    });

    if (completeLineCount === 0) {
      problems.unshift('Add at least one complete ingredient line.');
    }

    const notesLength = (editorNotes?.value || '').trim().length;
    editorNotes?.removeAttribute('aria-invalid');
    if (notesLength > MAX_RECIPE_NOTES) {
      problems.push('Recipe notes must be 500 characters or fewer.');
      editorNotes?.setAttribute('aria-invalid', 'true');
      if (!firstInvalidControl) firstInvalidControl = editorNotes;
    }

    const uniqueProblems = Array.from(new Set(problems));
    editorLastValidation = { isValid: uniqueProblems.length === 0, problems: uniqueProblems };

    if (editorSummary) {
      editorSummary.replaceChildren();
      if (show && uniqueProblems.length) {
        const heading = createTextElement('strong', '', 'Fix these before saving:');
        const list = document.createElement('ul');
        uniqueProblems.forEach((problem) => {
          const item = document.createElement('li');
          item.textContent = problem;
          list.appendChild(item);
        });
        editorSummary.appendChild(heading);
        editorSummary.appendChild(list);
        editorSummary.hidden = false;
      } else {
        editorSummary.hidden = true;
      }
    }

    if (focus && firstInvalidControl && typeof firstInvalidControl.focus === 'function') {
      firstInvalidControl.focus();
    }

    return editorLastValidation;
  };

  const hasValidSaveExpectation = () => {
    if (!editorBaseline || !editorBaseline.productSizeId) return false;
    if (editorMode === 'create') {
      return editorBaseline.recipeExists === false
        && !editorBaseline.recipeId
        && !editorBaseline.recipeUpdatedAt;
    }
    return editorBaseline.recipeExists === true
      && Boolean(editorBaseline.recipeId)
      && Boolean(editorBaseline.recipeUpdatedAt);
  };

  const getSaveHelperText = () => {
    if (saveRefreshFailed) return 'Recipe was saved, but the display could not refresh. Reload the Recipes page.';
    if (editorState === EDITOR_STATES.SAVING) return 'Saving recipe...';
    if (hasUnresolvedConflict || editorState === EDITOR_STATES.CONFLICT) return 'Reload the latest recipe before saving.';
    if (![EDITOR_STATES.DIRTY, EDITOR_STATES.SAVE_ERROR].includes(editorState)) return 'Make a change to enable saving.';
    if (!editorLastValidation.isValid) return 'Fix the highlighted fields before saving.';
    if (!hasValidSaveExpectation()) return 'Reload the editor before saving.';
    return 'Ready to save this recipe.';
  };

  const updateSaveButtonState = () => {
    const canSave = isOwnerSignedIn
      && editorState === EDITOR_STATES.DIRTY
      && !hasUnresolvedConflict
      && !isSavingRecipe
      && !saveRefreshFailed
      && editorLastValidation.isValid
      && hasValidSaveExpectation();

    if (editorSaveButton) editorSaveButton.disabled = !canSave;
    if (saveHelper) saveHelper.textContent = getSaveHelperText();
  };

  const updateEditorDirtyState = () => {
    if (![EDITOR_STATES.CREATE_READY, EDITOR_STATES.EDIT_READY, EDITOR_STATES.DIRTY, EDITOR_STATES.SAVE_SUCCESS, EDITOR_STATES.SAVE_ERROR].includes(editorState)) return;
    const isDirty = getEditorSnapshot() !== editorInitialSnapshot;
    if (isDirty && editorState !== EDITOR_STATES.DIRTY) {
      setEditorState(EDITOR_STATES.DIRTY);
    } else if (!isDirty && editorState === EDITOR_STATES.DIRTY) {
      setEditorState(editorMode === 'edit' ? EDITOR_STATES.EDIT_READY : EDITOR_STATES.CREATE_READY);
    }
  };

  const handleEditorChanged = ({ validate = true, show = false } = {}) => {
    updateNotesCount();
    if (validate) validateEditor({ show });
    if (hasUnresolvedConflict && editorState !== EDITOR_STATES.CONFLICT) {
      setEditorStatus('Reload the latest recipe before saving again.');
    }
    updateEditorDirtyState();
    updateSaveButtonState();
  };

  const focusEditorInitialField = () => {
    const target = editorMode === 'edit'
      ? (editorNotes || editorRowsContainer?.querySelector('[data-editor-ingredient]'))
      : editorRowsContainer?.querySelector('[data-editor-ingredient]');
    if (target && typeof target.focus === 'function') target.focus();
  };

  const focusNewIngredientRow = (rowId) => {
    const target = editorRowsContainer?.querySelector(`[data-editor-ingredient="${rowId}"]`);
    if (target && typeof target.focus === 'function') target.focus();
  };

  const showDiscardConfirm = (trigger = document.activeElement) => {
    editorAttemptedCloseElement = trigger;
    setEditorState(EDITOR_STATES.DISCARD_CONFIRM);
    requestAnimationFrame(() => {
      keepEditingButton?.focus();
    });
  };

  const keepEditing = () => {
    setEditorState(EDITOR_STATES.DIRTY);
    const target = editorAttemptedCloseElement;
    editorAttemptedCloseElement = null;
    editorPendingAfterDiscard = null;
    if (target && typeof target.focus === 'function') target.focus();
  };

  const discardEditorChanges = () => {
    const pending = editorPendingAfterDiscard;
    closeDrawer({ restoreFocus: !pending });
    if (typeof pending === 'function') {
      editorPendingAfterDiscard = null;
      pending();
    }
  };

  const setEditorLoadError = (message) => {
    if (editorErrorCopy) editorErrorCopy.textContent = message || 'Try again before editing this recipe.';
    setEditorStatus('');
    setEditorState(EDITOR_STATES.LOAD_ERROR);
  };

  const normalizeRecipeLineForEditor = (line) => {
    const itemId = line.inventory_item_id || '';
    const isActive = line.inventory_item_is_active !== false;
    const activePickerItem = getPickerItem(itemId);
    return createEditorRow({
      itemId,
      quantity: line.quantity_required === null || line.quantity_required === undefined
        ? ''
        : String(line.quantity_required),
      unavailableItem: activePickerItem ? null : {
        itemId,
        itemName: line.inventory_item_name || 'Unavailable ingredient',
        unitAbbreviation: line.unit_abbreviation || '',
        isArchived: !isActive,
      },
    });
  };

  const loadRecipeLinesForEditor = async (row) => {
    if (!row.recipeExists || !row.recipeId) return [];
    const result = await client
      .from('inventory_recipe_line_details')
      .select('recipe_id,recipe_line_id,inventory_item_id,inventory_item_name,inventory_item_is_active,quantity_required,unit_abbreviation,sort_order,recipe_notes')
      .eq('recipe_id', row.recipeId)
      .order('sort_order', { ascending: true })
      .order('inventory_item_name', { ascending: true });
    if (result.error) throw result.error;
    return result.data || [];
  };

  const applyBackendEditorData = (freshRow, lines, { statusMessage = '', preserveState = false } = {}) => {
    editorSummaryRow = freshRow;
    editorMode = freshRow.recipeExists ? 'edit' : 'create';
    editorBaseline = normalizeBaselineFromRow(freshRow);
    renderEditorHeader(freshRow);

    if (editorNotes) {
      const lineNotes = lines.find((line) => line.recipe_notes !== null && line.recipe_notes !== undefined)?.recipe_notes;
      editorNotes.value = freshRow.recipeExists ? (lineNotes ?? freshRow.recipeNotes ?? '') : '';
    }

    editorRows = freshRow.recipeExists
      ? lines.map(normalizeRecipeLineForEditor)
      : [createEditorRow()];
    if (!editorRows.length) editorRows = [createEditorRow()];

    renderEditorRows();
    updateNotesCount();
    editorInitialSnapshot = getEditorSnapshot();
    hasUnresolvedConflict = false;
    saveRefreshFailed = false;
    setEditorStatus(statusMessage || (freshRow.recipeExists ? 'Editing the latest saved recipe.' : 'Preparing a new recipe.'));
    if (preserveState) {
      setEditorControlsDisabled(editorState === EDITOR_STATES.LOADING || editorState === EDITOR_STATES.SAVING);
    } else {
      setEditorState(freshRow.recipeExists ? EDITOR_STATES.EDIT_READY : EDITOR_STATES.CREATE_READY);
    }
    const initialValidation = validateEditor({ show: false });
    if (freshRow.recipeExists && !initialValidation.isValid) validateEditor({ show: true });
    updateSaveButtonState();
  };

  const buildRecipeSavePayload = () => {
    const validation = validateEditor({ show: true, focus: true });
    if (!validation.isValid || !editorBaseline || !editorBaseline.productSizeId) return null;

    const p_lines = editorRows.map((row, index) => ({
      inventory_item_id: row.itemId,
      quantity_required: row.quantity.trim(),
      sort_order: index,
    }));

    const trimmedNotes = (editorNotes?.value || '').trim();

    return {
      p_product_size_id: editorBaseline.productSizeId,
      p_lines,
      p_notes: trimmedNotes || null,
      p_expected_recipe_id: editorMode === 'edit' ? editorBaseline.recipeId : null,
      p_expected_updated_at: editorMode === 'edit' ? editorBaseline.recipeUpdatedAt : null,
    };
  };

  const getBackendErrorDetail = (error) => {
    if (!error) return '';
    return String(error.details || error.detail || error.code || error.message || '');
  };

  const mapRecipeSaveError = (error) => {
    const detail = getBackendErrorDetail(error);
    if (detail.includes('INV_RECIPE_CONFLICT')) {
      return {
        kind: 'conflict',
        message: 'This recipe changed after you opened it. Reload the latest version before saving.',
      };
    }
    if (detail.includes('INV_RECIPE_EXPECTATION_INVALID')) {
      return {
        kind: 'reload_required',
        message: 'The recipe version information is incomplete. Reload the latest recipe before saving.',
      };
    }
    if (detail.includes('INV_AUTH_REQUIRED') || detail.includes('INV_ADMIN_REQUIRED') || error?.status === 401 || error?.status === 403) {
      return {
        kind: 'auth',
        message: 'Your owner session may have expired. Sign in again and retry.',
      };
    }
    const validationMessages = {
      INV_RECIPE_NOTES_TOO_LONG: 'Recipe notes must be 500 characters or fewer.',
      INV_RECIPE_LINES_INVALID: 'Recipe lines were not formatted correctly. Reload the editor and try again.',
      INV_RECIPE_LINES_REQUIRED: 'Add at least one ingredient before saving.',
      INV_RECIPE_TOO_MANY_LINES: 'Recipes can have at most 100 ingredients.',
      INV_RECIPE_LINE_INVALID: 'Choose an ingredient for every recipe line.',
      INV_RECIPE_ITEM_NOT_FOUND: 'One ingredient could not be found. Reload the editor and try again.',
      INV_RECIPE_ITEM_INACTIVE: 'Archived ingredients must be removed or replaced before saving.',
      INV_RECIPE_INVALID_QUANTITY: 'Each ingredient needs a valid quantity greater than zero.',
      INV_RECIPE_QUANTITY_SCALE: 'Quantities can use up to three decimal places.',
      INV_RECIPE_INVALID_SORT_ORDER: 'Recipe line order was not valid. Reload the editor and try again.',
      INV_RECIPE_DUPLICATE_ITEM: 'Each ingredient can appear only once in a recipe.',
      INV_RECIPE_PRODUCT_SIZE_REQUIRED: 'Choose a product size before saving.',
      INV_RECIPE_PRODUCT_SIZE_NOT_FOUND: 'This menu size may have changed or been removed. Reload Recipes and try again.',
    };
    const matchedCode = Object.keys(validationMessages).find((code) => detail.includes(code));
    if (matchedCode) {
      return { kind: 'validation', message: validationMessages[matchedCode] };
    }
    return {
      kind: 'unknown',
      message: "CURV couldn't save the recipe. Check your connection and try again.",
    };
  };

  const setSaveErrorState = (message, { refreshFailed = false } = {}) => {
    saveRefreshFailed = refreshFailed;
    if (saveErrorCopy) saveErrorCopy.textContent = message;
    if (saveRetryButton) saveRetryButton.hidden = refreshFailed;
    if (saveErrorKeepButton) saveErrorKeepButton.hidden = refreshFailed;
    if (saveCloseButton) saveCloseButton.hidden = !refreshFailed;
    if (saveReloadPageButton) saveReloadPageButton.hidden = !refreshFailed;
    setEditorStatus('');
    setEditorState(EDITOR_STATES.SAVE_ERROR);
    requestAnimationFrame(() => {
      if (refreshFailed) saveCloseButton?.focus();
      else saveErrorTitle?.focus();
    });
  };

  const setConflictState = (
    message = 'This recipe changed after you opened it. Reload the latest version before saving.',
    { title = 'This recipe changed after you opened it.' } = {},
  ) => {
    hasUnresolvedConflict = true;
    if (conflictTitle) conflictTitle.textContent = title;
    if (conflictCopy) conflictCopy.textContent = message;
    setEditorStatus('');
    setEditorState(EDITOR_STATES.CONFLICT);
    updateSaveButtonState();
    requestAnimationFrame(() => {
      conflictTitle?.focus();
    });
  };

  const refreshEditorAfterSave = async (productSizeId, sequence) => {
    const freshRow = await fetchFreshSummaryRow(productSizeId);
    if (sequence !== saveSequence || !isOwnerSignedIn) return false;
    if (!freshRow) throw new Error('Saved recipe summary row was not found after save.');
    const lines = await loadRecipeLinesForEditor(freshRow);
    if (sequence !== saveSequence || !isOwnerSignedIn) return false;
    applyBackendEditorData(freshRow, lines, { statusMessage: 'Recipe saved.', preserveState: true });
    validateEditor({ show: false });
    updateSaveButtonState();
    return true;
  };

  const resolvePostSaveDashboardRefresh = async (initialResult, sequence) => {
    let result = initialResult;
    if (result?.reason === 'stale') {
      const activeLoad = activeDashboardLoadPromise;
      if (activeLoad) {
        result = await activeLoad;
        if (sequence !== saveSequence || !isOwnerSignedIn) return { ok: false, reason: 'stale' };
        if (result?.ok && pageState === STATES.READY) return result;
        if (result?.reason === 'signed_out') return result;
      } else if (pageState === STATES.READY) {
        return { ok: true };
      }
      result = await loadRecipeData();
      if (sequence !== saveSequence || !isOwnerSignedIn) return { ok: false, reason: 'stale' };
      if (result?.reason === 'stale' && pageState === STATES.READY) return { ok: true };
      if (result?.reason === 'stale') return { ok: false, reason: 'error' };
    }
    if (result?.ok && pageState === STATES.READY) return result;
    return result || { ok: false, reason: 'error' };
  };

  const saveRecipe = async () => {
    if (!client || !isOwnerSignedIn || isSavingRecipe || hasUnresolvedConflict || saveRefreshFailed) return;
    if (![EDITOR_STATES.DIRTY, EDITOR_STATES.SAVE_ERROR].includes(editorState)) return;

    const payload = buildRecipeSavePayload();
    if (!payload || !hasValidSaveExpectation()) {
      updateSaveButtonState();
      return;
    }

    try {
      const { data } = await client.auth.getSession();
      if (!data || !data.session || !data.session.user) {
        setSaveErrorState('Your owner session may have expired. Sign in again and retry.');
        return;
      }
    } catch (error) {
      console.error('Recipe save session check failed:', error);
      setSaveErrorState('Your owner session may have expired. Sign in again and retry.');
      return;
    }

    const sequence = saveSequence + 1;
    saveSequence = sequence;
    const productSizeId = payload.p_product_size_id;
    const returnFocusTarget = getEditorReturnTarget();
    isSavingRecipe = true;
    setEditorStatus('Saving recipe...');
    setEditorState(EDITOR_STATES.SAVING);

    try {
      const { data, error } = await client.rpc('inventory_replace_recipe', payload);
      if (sequence !== saveSequence || !isOwnerSignedIn) return;
      if (error) throw error;

      const confirmation = Array.isArray(data) ? data[0] : data;
      if (!confirmation || confirmation.ok === false) {
        throw new Error('Recipe save did not return a successful confirmation.');
      }

      try {
        const refreshed = await refreshEditorAfterSave(productSizeId, sequence);
        if (!refreshed) return;
        const dashboardResult = await resolvePostSaveDashboardRefresh(await loadRecipeData(), sequence);
        if (sequence !== saveSequence) return;
        if (!dashboardResult.ok) {
          if (dashboardResult.reason === 'signed_out') return;
          if (dashboardResult.reason === 'stale') return;
          setSaveErrorState('Recipe was saved, but the latest display could not be refreshed. Reload the Recipes page.', {
            refreshFailed: true,
          });
          return;
        }
        rebindEditorReturnFocus(returnFocusTarget);
        setEditorState(EDITOR_STATES.SAVE_SUCCESS);
        requestAnimationFrame(() => {
          editorStatus?.focus?.();
          if (!editorStatus || editorStatus.hidden) {
            const closeButton = editorDrawer?.querySelector('[data-recipes-drawer-close]');
            closeButton?.focus();
          }
        });
      } catch (refreshError) {
        console.error('Recipe saved but refresh failed:', refreshError);
        if (sequence !== saveSequence) return;
        setSaveErrorState('Recipe was saved, but the latest display could not be refreshed. Reload the Recipes page.', {
          refreshFailed: true,
        });
      }
    } catch (error) {
      console.error('Recipe save failed:', error);
      if (sequence !== saveSequence) return;
      const mapped = mapRecipeSaveError(error);
      if (mapped.kind === 'conflict') {
        setConflictState(mapped.message);
      } else if (mapped.kind === 'reload_required') {
        setConflictState(mapped.message, { title: 'Reload latest recipe before saving.' });
      } else {
        setSaveErrorState(mapped.message);
      }
    } finally {
      if (sequence === saveSequence) {
        isSavingRecipe = false;
        updateSaveButtonState();
        if (editorState === EDITOR_STATES.SAVING) setEditorState(EDITOR_STATES.DIRTY);
      }
    }
  };

  const openRecipeEditor = async (row, trigger, { force = false } = {}) => {
    if (activeDrawer === editorDrawer && editorState === EDITOR_STATES.SAVING) return;
    if (!force && activeDrawer === editorDrawer && editorState === EDITOR_STATES.CONFLICT) {
      conflictTitle?.focus();
      return;
    }
    if (!force && activeDrawer === editorDrawer && editorState === EDITOR_STATES.SAVE_ERROR) {
      editorPendingAfterDiscard = () => openRecipeEditor(row, trigger, { force: true });
      showDiscardConfirm(trigger);
      return;
    }
    if (!force && activeDrawer === editorDrawer && editorState === EDITOR_STATES.DIRTY) {
      editorPendingAfterDiscard = () => openRecipeEditor(row, trigger, { force: true });
      showDiscardConfirm(trigger);
      return;
    }

    editorSequence += 1;
    const sequence = editorSequence;
    editorSummaryRow = row;
    editorMode = row.recipeExists ? 'edit' : 'create';
    editorBaseline = null;
    hasUnresolvedConflict = false;
    saveRefreshFailed = false;
    renderEditorHeader(row);
    setEditorStatus('Loading editor...');
    clearElement(editorRowsContainer);
    if (editorNotes) editorNotes.value = '';
    updateNotesCount();
    openDrawer('editor', trigger);
    setEditorState(EDITOR_STATES.LOADING);

    try {
      await loadPickerItems();
      if (sequence !== editorSequence || !isOwnerSignedIn || editorSummaryRow !== row) return;
      const freshRow = await fetchFreshSummaryRow(row.productSizeId);
      if (sequence !== editorSequence || !isOwnerSignedIn || editorSummaryRow !== row) return;
      if (!freshRow) {
        setEditorLoadError('This menu size may have changed or been removed. Reload Recipes and try again.');
        return;
      }
      editorSummaryRow = freshRow;
      editorMode = freshRow.recipeExists ? 'edit' : 'create';
      editorBaseline = normalizeBaselineFromRow(freshRow);
      renderEditorHeader(freshRow);

      const lines = await loadRecipeLinesForEditor(freshRow);
      if (sequence !== editorSequence || !isOwnerSignedIn) return;
      applyBackendEditorData(freshRow, lines);
      requestAnimationFrame(focusEditorInitialField);
    } catch (error) {
      console.error('Recipe editor load failed:', error);
      if (sequence !== editorSequence) return;
      setEditorLoadError("Couldn't load recipe editor data. Try again.");
    }
  };

  const renderDetailHeader = (row) => {
    if (drawerTitle) drawerTitle.textContent = `${row.productName} - ${row.productSizeLabel}`;
    clearElement(detailMeta);
    if (!detailMeta) return;
    [
      row.categoryName,
      getStatusLabel(row.recipeStatus),
      getCanMakeText(row),
    ].forEach((text) => {
      detailMeta.appendChild(createTextElement('span', 'recipes-detail-pill', text));
    });
    if (detailNotes) detailNotes.textContent = row.recipeNotes || 'No recipe notes.';
  };

  const renderIngredients = (lines, row) => {
    clearElement(ingredientList);
    if (!ingredientList) return;
    if (!lines.length) {
      const empty = document.createElement('div');
      empty.className = 'recipes-ingredient-empty';
      empty.appendChild(createTextElement(
        'p',
        '',
        row && row.recipeExists
          ? 'This recipe has no ingredients yet.'
          : 'No recipe has been configured for this size yet.',
      ));
      ingredientList.appendChild(empty);
      return;
    }

    lines.forEach((line) => {
      const item = document.createElement('article');
      item.className = 'recipes-ingredient-row';
      const copy = document.createElement('div');
      copy.appendChild(createTextElement('strong', 'inventory-item-name', line.inventory_item_name || 'Inventory item'));
      copy.appendChild(createTextElement(
        'span',
        'inventory-item-meta',
        `${formatDecimal(line.quantity_required)} ${line.unit_abbreviation || ''} required | ${formatDecimal(line.usable_stock)} ${line.unit_abbreviation || ''} usable`,
      ));
      if (line.inventory_item_is_active === false) {
        copy.appendChild(createTextElement(
          'p',
          'recipes-warning-text',
          'This inventory item is inactive and should be replaced or reactivated.',
        ));
      }
      item.appendChild(copy);
      item.appendChild(createStatusChip(line.inventory_item_is_active === false ? 'needs_attention' : 'ready'));
      ingredientList.appendChild(item);
    });
  };

  const openRecipeDetails = async (row, trigger) => {
    renderDetailHeader(row);
    clearElement(ingredientList);
    setDetailStatus(row.recipeExists ? 'Loading ingredients...' : '');
    if (!row.recipeExists) {
      renderIngredients([], row);
      openDrawer('details', trigger);
      return;
    }

    openDrawer('details', trigger);
    const sequence = detailSequence + 1;
    detailSequence = sequence;

    try {
      const result = await client
        .from('inventory_recipe_line_details')
        .select('recipe_id,product_id,product_name,product_size_id,product_size_label,recipe_line_id,inventory_item_id,inventory_item_name,inventory_item_is_active,quantity_required,unit_abbreviation,usable_stock,sort_order,recipe_notes')
        .eq('recipe_id', row.recipeId)
        .order('sort_order', { ascending: true })
        .order('inventory_item_name', { ascending: true });

      if (result.error) throw result.error;
      if (sequence !== detailSequence || !activeDrawer) return;
      setDetailStatus('');
      renderIngredients(result.data || [], row);
    } catch (error) {
      console.error('Recipe details read failed:', error);
      if (sequence !== detailSequence) return;
      clearElement(ingredientList);
      setDetailStatus("Couldn't load recipe ingredients. Try again.");
    }
  };

  const syncEditorRowFromSelect = (select) => {
    const row = editorRows.find((item) => item.rowId === select.dataset.editorIngredient);
    if (!row) return;
    row.itemId = select.value;
    row.touched = true;
    if (getPickerItem(row.itemId)) row.unavailableItem = null;
    renderEditorRows();
    handleEditorChanged({ show: true });
    const nextSelect = editorRowsContainer?.querySelector(`[data-editor-ingredient="${row.rowId}"]`);
    nextSelect?.focus();
  };

  const syncEditorRowFromQuantity = (input) => {
    const row = editorRows.find((item) => item.rowId === input.dataset.editorQuantity);
    if (!row) return;
    row.quantity = input.value;
    row.touched = true;
    handleEditorChanged({ show: true });
  };

  const addEditorIngredientRow = () => {
    if (editorRows.length >= MAX_RECIPE_LINES) {
      validateEditor({ show: true, focus: true });
      return;
    }
    const row = createEditorRow({ touched: true });
    editorRows.push(row);
    renderEditorRows();
    handleEditorChanged({ show: true });
    requestAnimationFrame(() => focusNewIngredientRow(row.rowId));
  };

  const removeEditorIngredientRow = (rowId) => {
    editorRows = editorRows.filter((row) => row.rowId !== rowId);
    if (!editorRows.length) editorRows = [createEditorRow({ touched: true })];
    renderEditorRows();
    handleEditorChanged({ show: true });
  };

  const handleAuthState = (isSignedIn, email = '') => {
    setSignedInState(isSignedIn, email);
    if (!isSignedIn) {
      loadSequence += 1;
      editorSequence += 1;
      saveSequence += 1;
      isSavingRecipe = false;
      activeLoadSessionKey = '';
      activeDashboardLoadPromise = null;
      clearPickerCache();
      closeDrawer({ restoreFocus: false });
      resetEditor();
      clearRecipeState();
      setPageState(STATES.SIGNED_OUT);
      return;
    }
    loadRecipeData();
  };

  const updateFilterControlState = () => {
    const disabled = pageState !== STATES.READY;
    [searchInput, categoryFilter, statusFilter, clearFiltersButton].forEach((control) => {
      if (control) control.disabled = disabled;
    });
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
      console.error('Recipes auth check failed:', error);
      setPageState(STATES.ERROR);
    }
  };

  editorRowsContainer?.addEventListener('change', (event) => {
    const select = event.target.closest('[data-editor-ingredient]');
    if (select) syncEditorRowFromSelect(select);
  });

  editorRowsContainer?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-editor-quantity]');
    if (input) syncEditorRowFromQuantity(input);
  });

  editorRowsContainer?.addEventListener('blur', (event) => {
    if (event.target.closest('[data-editor-ingredient], [data-editor-quantity]')) {
      validateEditor({ show: true });
    }
  }, true);

  editorRowsContainer?.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-recipes-remove-ingredient]');
    if (!removeButton) return;
    removeEditorIngredientRow(removeButton.dataset.recipesRemoveIngredient);
  });

  editorNotes?.addEventListener('input', () => {
    handleEditorChanged({ show: true });
  });

  editorNotes?.addEventListener('blur', () => {
    validateEditor({ show: true });
  });

  editorForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    validateEditor({ show: true, focus: true });
    updateSaveButtonState();
  });

  editorSaveButton?.addEventListener('click', () => {
    saveRecipe();
  });

  saveRetryButton?.addEventListener('click', () => {
    saveRecipe();
  });

  saveErrorKeepButton?.addEventListener('click', () => {
    setEditorState(EDITOR_STATES.DIRTY);
    updateSaveButtonState();
    editorNotes?.focus();
  });

  saveCloseButton?.addEventListener('click', () => {
    closeDrawer();
  });

  saveReloadPageButton?.addEventListener('click', () => {
    window.location.reload();
  });

  conflictKeepButton?.addEventListener('click', () => {
    setEditorState(EDITOR_STATES.DIRTY);
    setEditorStatus('Reload the latest recipe before saving again.');
    updateSaveButtonState();
    editorNotes?.focus();
  });

  conflictCancelButton?.addEventListener('click', () => {
    closeDrawer();
  });

  conflictReloadButton?.addEventListener('click', () => {
    if (conflictReloadConfirm) conflictReloadConfirm.hidden = false;
    requestAnimationFrame(() => {
      conflictReloadCancelButton?.focus();
    });
  });

  conflictReloadCancelButton?.addEventListener('click', () => {
    if (conflictReloadConfirm) conflictReloadConfirm.hidden = true;
    conflictReloadButton?.focus();
  });

  conflictReloadConfirmButton?.addEventListener('click', () => {
    const row = editorSummaryRow;
    if (!row) return;
    hasUnresolvedConflict = false;
    openRecipeEditor(row, lastFocusedElement, { force: true });
  });

  addIngredientButton?.addEventListener('click', addEditorIngredientRow);

  editorCancelButton?.addEventListener('click', () => {
    requestCloseDrawer(editorCancelButton);
  });

  editorRetryButton?.addEventListener('click', () => {
    if (editorSummaryRow) openRecipeEditor(editorSummaryRow, lastFocusedElement, { force: true });
  });

  editorErrorCancelButton?.addEventListener('click', () => {
    closeDrawer();
  });

  keepEditingButton?.addEventListener('click', keepEditing);

  discardEditorButton?.addEventListener('click', discardEditorChanges);

  closeButtons.forEach((button) => {
    button.addEventListener('click', () => requestCloseDrawer(button));
  });

  backdrop?.addEventListener('click', () => {
    const focusedEditorControl = activeDrawer === editorDrawer && editorDrawer.contains(document.activeElement)
      ? document.activeElement
      : null;
    requestCloseDrawer(focusedEditorControl || document.activeElement);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeDrawer) {
      event.preventDefault();
      requestCloseDrawer(document.activeElement);
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
      console.error('Recipes sign in failed:', error);
      setStatus('Sign in failed. Check the owner email and password.');
    } finally {
      setFormDisabled(false);
      updateOwnerAccountUi();
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
      console.error('Recipes sign out failed:', error);
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
      renderRecipeRows(filteredRows);
      updateListState();
    }, 250);
  });

  [categoryFilter, statusFilter].forEach((control) => {
    control?.addEventListener('change', () => {
      if (pageState !== STATES.READY) return;
      applyFilters();
      renderRecipeRows(filteredRows);
      updateListState();
    });
  });

  clearFiltersButton?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = 'all';
    if (statusFilter) statusFilter.value = 'all';
    applyFilters();
    renderRecipeRows(filteredRows);
    updateListState();
  });

  retryButton?.addEventListener('click', () => {
    loadRecipeData();
  });

  setRecipesNavActive();
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
