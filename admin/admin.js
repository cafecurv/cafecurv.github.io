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
  const categoryList = document.querySelector('[data-category-list]');
  const categoryStatus = document.querySelector('[data-category-status]');
  const productList = document.querySelector('[data-product-list]');
  const productStatus = document.querySelector('[data-product-status]');
  const productCount = document.querySelector('[data-product-count]');
  const draftForm = document.querySelector('[data-draft-product-form]');
  const draftCategorySelect = document.getElementById('draft-product-category');
  const variantGroupSelect = document.getElementById('draft-variant-group');
  const customVariantField = document.querySelector('[data-custom-variant-field]');
  const customVariantInput = document.getElementById('draft-custom-variant-group');
  const variantList = document.querySelector('[data-variant-list]');
  const addVariantButton = document.querySelector('[data-add-variant]');
  const createDraftButton = document.querySelector('[data-create-draft]');
  const cancelEditButton = document.querySelector('[data-cancel-edit]');
  const draftProductTitle = document.getElementById('draft-product-title');
  const productFilterBar = document.querySelector('[data-product-filter-bar]');
  const productFilterList = document.querySelector('[data-product-filter-list]');
  const staticCategoryMarkup = categoryList ? categoryList.innerHTML : '';
  let latestCategories = [];
  let latestProducts = [];
  let selectedCategoryFilter = 'all';
  let editingProductId = null;
  let variantRowCount = 1;

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

  const setSignedInState = (isSignedIn) => {
    if (signInButton) signInButton.disabled = isSignedIn;
    if (signOutButton) signOutButton.disabled = !isSignedIn;
  };

  const setCreateMode = () => {
    editingProductId = null;
    if (draftProductTitle) draftProductTitle.textContent = 'Create Draft Product';
    if (createDraftButton) createDraftButton.textContent = 'Create Draft Product';
    if (cancelEditButton) {
      cancelEditButton.hidden = true;
      cancelEditButton.disabled = true;
    }
  };

  const setEditMode = (productId) => {
    editingProductId = productId;
    if (draftProductTitle) draftProductTitle.textContent = 'Edit Draft Product';
    if (createDraftButton) createDraftButton.textContent = 'Save Draft Product';
    if (cancelEditButton) {
      cancelEditButton.hidden = false;
      cancelEditButton.disabled = false;
    }
  };

  const getVariantRows = () => variantList ? Array.from(variantList.querySelectorAll('[data-variant-row]')) : [];

  const getSelectedVariantGroup = () => {
    if (!variantGroupSelect) return 'Each';
    if (variantGroupSelect.value === 'Custom') {
      return customVariantInput ? customVariantInput.value.trim() : '';
    }
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
    const isCustom = variantGroupSelect && variantGroupSelect.value === 'Custom';
    if (customVariantField) customVariantField.hidden = !isCustom;
    if (customVariantInput) customVariantInput.disabled = !isCustom || (variantGroupSelect && variantGroupSelect.disabled);
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
      });
    }

    if (removeButton) {
      removeButton.addEventListener('click', () => {
        if (getVariantRows().length <= 1) return;
        row.remove();
        updateRemoveButtons();
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

  const setDraftFormDisabled = (isDisabled) => {
    if (!draftForm) return;
    draftForm.querySelectorAll('input, select, textarea, button').forEach((field) => {
      field.disabled = isDisabled;
    });
    syncVariantGroupFields();
    updateRemoveButtons();
  };

  const resetDraftProductForm = () => {
    if (draftForm) draftForm.reset();
    if (variantGroupSelect) variantGroupSelect.value = 'Each';
    if (customVariantInput) customVariantInput.value = '';
    const availableInput = draftForm ? draftForm.querySelector('[name="is_available"]') : null;
    if (availableInput) availableInput.checked = true;
    resetVariantRows();
    setCreateMode();
    syncVariantGroupFields();
    maybeSyncDefaultVariantLabel();
    if (draftCategorySelect) {
      draftCategorySelect.innerHTML = '<option value="">Sign in to load categories</option>';
    }
    setDraftFormDisabled(true);
  };

  const populateDraftCategorySelect = (categories) => {
    if (!draftCategorySelect) return;
    draftCategorySelect.innerHTML = '<option value="">Select a category</option>';
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      draftCategorySelect.appendChild(option);
    });
  };

  const renderProductFilters = (categories) => {
    if (!productFilterBar || !productFilterList) return;
    productFilterList.innerHTML = '';
    productFilterBar.hidden = !categories.length;
    if (!categories.length) return;

    const makeFilterButton = (label, value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = value === selectedCategoryFilter ? 'product-filter-button is-active' : 'product-filter-button';
      button.textContent = label;
      button.dataset.categoryFilter = value;
      button.addEventListener('click', () => {
        selectedCategoryFilter = value;
        renderProductFilters(latestCategories);
        renderProducts(latestProducts);
      });
      return button;
    };

    productFilterList.appendChild(makeFilterButton('All', 'all'));
    categories.forEach((category) => {
      productFilterList.appendChild(makeFilterButton(category.name, category.id));
    });
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
    selectedCategoryFilter = 'all';
    if (productStatus) productStatus.textContent = 'Locked';
    if (productCount) productCount.textContent = 'Sign in to load products.';
    if (productFilterBar) productFilterBar.hidden = true;
    if (productFilterList) productFilterList.innerHTML = '';
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

  const renderCategories = (categories) => {
    latestCategories = categories;
    populateDraftCategorySelect(categories);
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

  const renderProducts = (products) => {
    latestProducts = products || [];
    if (!productList) return;
    productList.innerHTML = '';

    const visibleProducts = selectedCategoryFilter === 'all'
      ? latestProducts
      : latestProducts.filter((product) => product.category_id === selectedCategoryFilter);

    if (!latestProducts.length) {
      if (productStatus) productStatus.textContent = 'Supabase draft list';
      if (productCount) productCount.textContent = '0 products';
      renderProductEmptyState('No products in Supabase yet.', 'Create a draft product to see it here.');
      return;
    }

    if (!visibleProducts.length) {
      if (productStatus) productStatus.textContent = 'Supabase draft list';
      if (productCount) productCount.textContent = latestProducts.length === 1 ? '1 product total' : latestProducts.length + ' products total';
      renderProductEmptyState('No products in this category.', 'Choose All or another category to continue reviewing draft products.');
      return;
    }

    if (productStatus) productStatus.textContent = 'Supabase draft list';
    if (productCount) {
      const totalText = latestProducts.length === 1 ? '1 product total' : latestProducts.length + ' products total';
      productCount.textContent = selectedCategoryFilter === 'all'
        ? totalText
        : visibleProducts.length + ' shown ? ' + totalText;
    }

    visibleProducts.forEach((product) => {
      const card = document.createElement('article');
      card.className = 'product-preview-card';

      const top = document.createElement('div');
      top.className = 'product-card-top';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'product-card-title';
      title.textContent = product.name;
      const category = document.createElement('p');
      category.className = 'product-card-category';
      category.textContent = product.category ? product.category.name : 'Uncategorized';
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
            cost.textContent = ' - Cost ' + formatPrice(variant.cost);
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
      if (!product.is_published) {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'product-action-button';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => loadProductIntoForm(product.id));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'product-action-button is-danger';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', () => deleteDraftProduct(product.id));

        const publishButton = document.createElement('button');
        publishButton.type = 'button';
        publishButton.className = 'product-action-button is-publish';
        publishButton.textContent = 'Publish';
        publishButton.addEventListener('click', () => updateProductPublishedState(product.id, true));

        actions.append(editButton, deleteButton, publishButton);
      } else {
        const lockedButton = document.createElement('button');
        lockedButton.type = 'button';
        lockedButton.className = 'product-action-button';
        lockedButton.disabled = true;
        lockedButton.textContent = 'Edit Locked';

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

  const loadProductIntoForm = (productId) => {
    const product = latestProducts.find((item) => item.id === productId);
    if (!product) {
      setStatus('Product could not be found in the current preview.');
      return;
    }

    if (product.is_published) {
      setStatus('Published products cannot be edited yet.');
      return;
    }

    resetDraftProductForm();
    populateDraftCategorySelect(latestCategories);
    setDraftFormDisabled(false);

    draftForm.elements.name.value = product.name || '';
    draftForm.elements.category_id.value = product.category_id || '';
    draftForm.elements.image_url.value = product.image_url || '';
    draftForm.elements.description.value = product.description || '';
    draftForm.elements.notes.value = product.notes || '';
    draftForm.elements.is_available.checked = Boolean(product.is_available);
    draftForm.elements.is_curv_pick.checked = Boolean(product.is_curv_pick);
    draftForm.elements.is_seasonal.checked = Boolean(product.is_seasonal);

    const knownGroups = ['Each', 'Size', 'Pieces', 'Weight / Volume', 'Pack / Box'];
    const groupName = product.variant_group_name || 'Each';
    if (variantGroupSelect) {
      variantGroupSelect.value = knownGroups.includes(groupName) ? groupName : 'Custom';
    }
    if (customVariantInput) {
      customVariantInput.value = knownGroups.includes(groupName) ? '' : groupName;
    }
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
    draftForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('Editing draft product. Save changes or cancel edit.');
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

  const loadProducts = async () => {
    if (productStatus) productStatus.textContent = 'Loading';
    if (productCount) productCount.textContent = 'Loading products...';

    const { data, error } = await client
      .from('products')
      .select('id,category_id,name,description,image_url,notes,is_available,is_published,is_curv_pick,is_seasonal,sort_order,variant_group_name,category:categories(id,name,sort_order),product_sizes(id,label,price,cost,sort_order)')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .order('sort_order', { referencedTable: 'product_sizes', ascending: true });

    if (error) {
      resetProductPreview();
      setStatus('Unable to load products. ' + error.message);
      return;
    }

    const products = (data || []).slice().sort((a, b) => {
      const categorySortA = a.category && Number.isFinite(a.category.sort_order) ? a.category.sort_order : 9999;
      const categorySortB = b.category && Number.isFinite(b.category.sort_order) ? b.category.sort_order : 9999;
      return categorySortA - categorySortB
        || (a.sort_order || 0) - (b.sort_order || 0)
        || String(a.name).localeCompare(String(b.name));
    });

    renderProducts(products);
    setStatus('Connected as owner. Categories and products loaded.');
  };

  const refreshSession = async () => {
    const { data } = await client.auth.getSession();
    const isSignedIn = Boolean(data && data.session && data.session.user);
    setSignedInState(isSignedIn);
    if (isSignedIn) {
      await loadCategories();
      await loadProducts();
    } else {
      latestCategories = [];
      restoreStaticCategories();
      resetProductPreview();
      resetDraftProductForm();
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

    return {
      value: {
        category_id: categoryId,
        name,
        description: String(formData.get('description') || '').trim() || null,
        image_url: String(formData.get('image_url') || '').trim() || null,
        notes: String(formData.get('notes') || '').trim() || null,
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

  const saveDraftProduct = async (event) => {
    event.preventDefault();

    if (!latestCategories.length) {
      setStatus('Load categories before saving a draft product.');
      return;
    }

    const validation = validateDraftProductForm();
    if (!validation || validation.error) {
      setStatus(validation ? validation.error : 'Draft product form is unavailable.');
      return;
    }

    const draft = validation.value;
    const isEditing = Boolean(editingProductId);
    if (createDraftButton) createDraftButton.disabled = true;
    if (cancelEditButton) cancelEditButton.disabled = true;
    setStatus(isEditing ? 'Saving draft product...' : 'Creating draft product...');

    const productPayload = {
      category_id: draft.category_id,
      name: draft.name,
      description: draft.description,
      image_url: draft.image_url,
      notes: draft.notes,
      is_available: draft.is_available,
      is_curv_pick: draft.is_curv_pick,
      is_seasonal: draft.is_seasonal,
      is_published: false,
      variant_group_name: draft.variant_group_name,
      sort_order: 0,
    };

    let productId = editingProductId;

    if (isEditing) {
      const { error: productError } = await client
        .from('products')
        .update(productPayload)
        .eq('id', editingProductId)
        .eq('is_published', false);

      if (productError) {
        setStatus('Unable to update draft product. ' + productError.message);
        if (createDraftButton) createDraftButton.disabled = false;
        if (cancelEditButton) cancelEditButton.disabled = false;
        return;
      }

      const { error: deleteSizesError } = await client
        .from('product_sizes')
        .delete()
        .eq('product_id', editingProductId);

      if (deleteSizesError) {
        await loadProducts();
        setStatus('Draft product was updated, but existing variants could not be replaced. ' + deleteSizesError.message);
        if (createDraftButton) createDraftButton.disabled = false;
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
        setStatus('Unable to create draft product. ' + productError.message);
        if (createDraftButton) createDraftButton.disabled = false;
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
      setStatus((isEditing ? 'Draft product was updated, but variants could not be saved. ' : 'Draft product row was created, but variants could not be saved. ') + sizeError.message);
      if (createDraftButton) createDraftButton.disabled = false;
      if (cancelEditButton) cancelEditButton.disabled = !isEditing;
      return;
    }

    resetDraftProductForm();
    populateDraftCategorySelect(latestCategories);
    setDraftFormDisabled(false);
    await loadProducts();
    setStatus(isEditing ? 'Draft product updated.' : 'Draft product created.');
  };

  const updateProductPublishedState = async (productId, shouldPublish) => {
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

    if (shouldPublish && editingProductId === productId) {
      resetDraftProductForm();
      populateDraftCategorySelect(latestCategories);
      setDraftFormDisabled(false);
    }

    await loadProducts();
    setStatus(shouldPublish ? 'Product published in admin.' : 'Product unpublished and returned to draft.');
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
    variantGroupSelect.addEventListener('change', () => {
      syncVariantGroupFields();
      maybeSyncDefaultVariantLabel();
    });
  }

  if (customVariantInput) {
    customVariantInput.addEventListener('input', maybeSyncDefaultVariantLabel);
  }

  if (addVariantButton && variantList) {
    addVariantButton.addEventListener('click', () => {
      const row = createVariantRow({ touched: true });
      variantList.appendChild(row);
      bindVariantRow(row);
      setVariantRowDisabled(row, false);
      updateRemoveButtons();
    });
  }

  getVariantRows().forEach(bindVariantRow);
  updateRemoveButtons();

  if (draftForm) {
    draftForm.addEventListener('submit', saveDraftProduct);
  }

  if (cancelEditButton) {
    cancelEditButton.addEventListener('click', () => {
      resetDraftProductForm();
      populateDraftCategorySelect(latestCategories);
      setDraftFormDisabled(false);
      setStatus('Edit cancelled. Create mode restored.');
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
      setSignedInState(true);
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
      restoreStaticCategories();
      resetProductPreview();
      resetDraftProductForm();
      setStatus('Signed out.');
    });
  }

  refreshSession();
})();
