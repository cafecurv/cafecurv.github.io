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
  const staticCategoryMarkup = categoryList ? categoryList.innerHTML : '';

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

  const restoreStaticCategories = () => {
    if (categoryList && staticCategoryMarkup) categoryList.innerHTML = staticCategoryMarkup;
    if (categoryStatus) categoryStatus.textContent = 'Static shell';
  };

  const renderCategories = (categories) => {
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
      restoreStaticCategories();
      setStatus('Unable to load categories. ' + error.message);
      return;
    }

    renderCategories(data || []);
    if (categoryStatus) categoryStatus.textContent = 'Supabase read-only';
    setStatus('Connected as owner. Categories loaded in read-only mode.');
  };

  const refreshSession = async () => {
    const { data } = await client.auth.getSession();
    const isSignedIn = Boolean(data && data.session && data.session.user);
    setSignedInState(isSignedIn);
    if (isSignedIn) {
      await loadCategories();
    } else {
      restoreStaticCategories();
      setStatus('Ready for owner sign in.');
    }
  };

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
      restoreStaticCategories();
      setStatus('Signed out.');
    });
  }

  refreshSession();
})();