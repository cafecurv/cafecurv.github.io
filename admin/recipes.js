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
  let searchTimer = 0;
  let recipeRows = [];
  let filteredRows = [];
  let categories = [];
  let activeDrawer = null;
  let lastFocusedElement = null;

  const DASH = '-';

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

  const createTextElement = (tagName, className, text) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  };

  const getFocusable = (drawer) => Array.from(drawer.querySelectorAll(focusableSelector))
    .filter((element) => element.offsetParent !== null || element === document.activeElement);

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
    detailSequence += 1;
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
    button.addEventListener('click', () => {
      openRecipeDetails(row, button);
    });
    return button;
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
      actionWrap.appendChild(createViewButton(row));
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
    if (!client || !isOwnerSignedIn) return;
    const sessionKey = signedInOwnerEmail || 'owner';
    if (pageState === STATES.LOADING && activeLoadSessionKey === sessionKey) return;
    activeLoadSessionKey = sessionKey;
    const sequence = loadSequence + 1;
    loadSequence = sequence;
    setPageState(STATES.LOADING);

    try {
      const result = await client
        .from('inventory_recipe_summary')
        .select('product_id,product_name,category_id,category_name,product_size_id,product_size_label,product_size_sort_order,recipe_id,recipe_exists,ingredient_line_count,inactive_ingredient_count,recipe_status,approximate_can_make,recipe_notes,recipe_updated_at')
        .order('product_name', { ascending: true })
        .order('product_size_sort_order', { ascending: true })
        .order('product_size_label', { ascending: true });

      if (result.error) throw result.error;
      if (sequence !== loadSequence || !isOwnerSignedIn) return;

      recipeRows = (result.data || []).map(normalizeRecipeRow);
      const categoryMap = new Map();
      recipeRows.forEach((row) => {
        if (row.categoryId && !categoryMap.has(row.categoryId)) {
          categoryMap.set(row.categoryId, { id: row.categoryId, name: row.categoryName });
        }
      });
      categories = Array.from(categoryMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      setPageState(STATES.READY);
    } catch (error) {
      console.error('Recipes read failed:', error);
      if (sequence !== loadSequence) return;
      try {
        const { data } = await client.auth.getSession();
        const user = data && data.session && data.session.user;
        if (!user) {
          clearRecipeState();
          setSignedInState(false);
          setPageState(STATES.SIGNED_OUT);
          return;
        }
      } catch (sessionError) {
        console.error('Recipes session check failed:', sessionError);
      }
      setPageState(STATES.ERROR);
    } finally {
      if (sequence === loadSequence) activeLoadSessionKey = '';
    }
  };

  const setDetailStatus = (message = '') => {
    if (!detailStatus) return;
    detailStatus.textContent = message;
    detailStatus.hidden = !message;
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

  const handleAuthState = (isSignedIn, email = '') => {
    setSignedInState(isSignedIn, email);
    if (!isSignedIn) {
      loadSequence += 1;
      activeLoadSessionKey = '';
      closeDrawer();
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
