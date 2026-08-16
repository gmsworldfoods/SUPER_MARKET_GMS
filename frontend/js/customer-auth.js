'use strict';

const PHONE_COUNTRIES = [
    { code: 'GB', name: 'United Kingdom', dial: '+44' },
    { code: 'IE', name: 'Ireland', dial: '+353' },
    { code: 'IN', name: 'India', dial: '+91' },
    { code: 'US', name: 'United States', dial: '+1' },
    { code: 'CA', name: 'Canada', dial: '+1' },
    { code: 'AU', name: 'Australia', dial: '+61' },
    { code: 'AE', name: 'United Arab Emirates', dial: '+971' },
    { code: 'PK', name: 'Pakistan', dial: '+92' },
    { code: 'BD', name: 'Bangladesh', dial: '+880' },
    { code: 'LK', name: 'Sri Lanka', dial: '+94' },
    { code: 'FR', name: 'France', dial: '+33' },
    { code: 'DE', name: 'Germany', dial: '+49' },
    { code: 'IT', name: 'Italy', dial: '+39' },
    { code: 'ES', name: 'Spain', dial: '+34' },
    { code: 'NL', name: 'Netherlands', dial: '+31' },
];

const PASSWORD_RULES = [
    { id: 'len', test: (value) => value.length >= 8, label: 'At least 8 characters' },
    { id: 'upper', test: (value) => /[A-Z]/.test(value), label: 'One uppercase letter' },
    { id: 'lower', test: (value) => /[a-z]/.test(value), label: 'One lowercase letter' },
    { id: 'num', test: (value) => /\d/.test(value), label: 'One number' },
    { id: 'special', test: (value) => /[^A-Za-z0-9]/.test(value), label: 'One special character' },
];

function passwordMeetsPolicy(value) {
    return PASSWORD_RULES.every((rule) => rule.test(value || ''));
}

function renderPasswordChecklist(container, value) {
    if (!container) return;
    container.innerHTML = PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value || '');
        return `
            <li class="password-rule${ok ? ' password-rule--ok' : ''}">
                <i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle'}" aria-hidden="true"></i>
                ${rule.label}
            </li>
        `;
    }).join('');
}

function getAccountDisplayName(user) {
    const name = (user?.name || user?.username || 'Account').trim();
    const first = name.split(/\s+/)[0] || 'Account';
    return first.length > 12 ? `${first.slice(0, 11)}…` : first;
}

/** Store admin only — never show Manage store for regular customers. */
const STORE_ADMIN_EMAIL = 'gmsworldfood@gmail.com';
const STORE_ADMIN_USERNAME = 'admin';

function isStoreAdmin(user) {
    if (!user || user.role !== 'admin') return false;
    const email = String(user.email || '').trim().toLowerCase();
    const username = String(user.username || '').trim().toLowerCase();
    return email === STORE_ADMIN_EMAIL && username === STORE_ADMIN_USERNAME;
}

function getHeaderAuthUser() {
    if (CustomerAPI.getToken()) {
        const user = CustomerAPI.getUser();
        if (user) return user;
    }
    if (typeof AdminAPI !== 'undefined' && AdminAPI.getToken()) {
        const user = AdminAPI.getUser();
        if (user) return user;
    }
    return null;
}

function getHeaderAuthToken() {
    return CustomerAPI.getToken()
        || (typeof AdminAPI !== 'undefined' ? AdminAPI.getToken() : null);
}

function persistAuthSession(token, user) {
    CustomerAPI.setSession(token, user);
    if (typeof AdminAPI !== 'undefined') {
        if (user?.role === 'admin') AdminAPI.setSession(token, user);
        else AdminAPI.clearSession();
    }
}

function clearAuthSession() {
    CustomerAPI.clearSession();
    if (typeof AdminAPI !== 'undefined') AdminAPI.clearSession();
}

function getDialCode(countryCode) {
    return PHONE_COUNTRIES.find((c) => c.code === countryCode)?.dial || '+44';
}

function stripDialCode(phone, countryCode) {
    if (!phone) return '';
    const dial = getDialCode(countryCode || 'GB');
    if (phone.startsWith(dial)) return phone.slice(dial.length);
    if (phone.startsWith('+')) return phone.replace(/^\+\d{1,4}/, '');
    return phone;
}

function getPhoneCountry(countryCode) {
    const code = (countryCode || 'GB').toUpperCase();
    return PHONE_COUNTRIES.find((c) => c.code === code) || PHONE_COUNTRIES[0];
}

function countryCodeToFlag(countryCode) {
    const code = String(countryCode || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '🌐';
    const base = 0x1F1E6;
    return String.fromCodePoint(
        base + code.charCodeAt(0) - 65,
        base + code.charCodeAt(1) - 65
    );
}

function renderPhoneCountryOptions(selectedCode) {
    const selected = (selectedCode || 'GB').toUpperCase();
    return PHONE_COUNTRIES.map((c) => {
        const flag = countryCodeToFlag(c.code);
        return `<option value="${c.code}"${c.code === selected ? ' selected' : ''}>${flag} ${c.name} (${c.dial})</option>`;
    }).join('');
}

function buildPhoneCountryTriggerHtml(country) {
    const flag = countryCodeToFlag(country.code);
    return `
        <span class="phone-country-flag" aria-hidden="true">${flag}</span>
        <span class="phone-country-text">
            <span class="phone-country-name">${escapeHtml(country.name)}</span>
            <span class="phone-country-dial">${escapeHtml(country.dial)}</span>
        </span>
        <i class="fa-solid fa-chevron-down phone-country-chevron" aria-hidden="true"></i>
    `;
}

function phoneCountryMatchesQuery(country, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const dial = country.dial.replace('+', '');
    return (
        country.name.toLowerCase().includes(q)
        || country.code.toLowerCase().includes(q)
        || dial.includes(q)
        || country.dial.toLowerCase().includes(q)
    );
}

function renderPhoneCountryListHtml(selectedCode, query) {
    const selected = (selectedCode || 'GB').toUpperCase();
    const filtered = PHONE_COUNTRIES.filter((c) => phoneCountryMatchesQuery(c, query));

    if (!filtered.length) {
        return '<li class="phone-country-empty" role="presentation">No countries found</li>';
    }

    return filtered.map((c) => {
        const isSelected = c.code === selected;
        const flag = countryCodeToFlag(c.code);
        return `
            <li class="phone-country-option${isSelected ? ' is-selected' : ''}"
                role="option"
                data-code="${c.code}"
                aria-selected="${isSelected ? 'true' : 'false'}">
                <span class="phone-country-flag" aria-hidden="true">${flag}</span>
                <span class="phone-country-name">${escapeHtml(c.name)}</span>
                <span class="phone-country-dial">${escapeHtml(c.dial)}</span>
            </li>
        `;
    }).join('');
}

function initPhoneCountryPicker(selectEl, selectedCode) {
    if (!selectEl) return;

    const initialCode = (selectedCode || selectEl.value || 'GB').toUpperCase();

    if (selectEl.dataset.pickerReady === '1') {
        selectEl.closest('.phone-country-picker')?._setPhoneCountry?.(initialCode);
        return;
    }

    selectEl.dataset.pickerReady = '1';
    selectEl.innerHTML = renderPhoneCountryOptions(initialCode);
    selectEl.classList.add('phone-country-select-native');
    selectEl.tabIndex = -1;
    selectEl.setAttribute('aria-hidden', 'true');

    const wrap = document.createElement('div');
    wrap.className = 'phone-country-picker';
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'phone-country-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('div');
    panel.className = 'phone-country-panel';
    panel.hidden = true;

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'phone-country-search';
    searchInput.placeholder = 'Search country or code…';
    searchInput.setAttribute('aria-label', 'Search phone country');
    searchInput.autocomplete = 'off';

    const list = document.createElement('ul');
    list.className = 'phone-country-menu';
    list.setAttribute('role', 'listbox');

    panel.appendChild(searchInput);
    panel.appendChild(list);
    wrap.appendChild(trigger);
    wrap.appendChild(panel);

    let searchQuery = '';

    function renderList() {
        list.innerHTML = renderPhoneCountryListHtml(selectEl.value, searchQuery);
    }

    function closePanel() {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        searchQuery = '';
        searchInput.value = '';
    }

    function openPanel() {
        document.querySelectorAll('.phone-country-picker').forEach((picker) => {
            if (picker !== wrap) picker._closePhoneCountryPanel?.();
        });
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        searchQuery = '';
        searchInput.value = '';
        renderList();
        requestAnimationFrame(() => searchInput.focus());
    }

    function setCountry(countryCode) {
        const country = getPhoneCountry(countryCode);
        selectEl.value = country.code;
        trigger.innerHTML = buildPhoneCountryTriggerHtml(country);
        trigger.setAttribute('aria-label', `Phone country: ${country.name}, ${country.dial}`);
        if (!panel.hidden) renderList();
    }

    wrap._setPhoneCountry = setCountry;
    wrap._closePhoneCountryPanel = closePanel;
    setCountry(initialCode);

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel.hidden) openPanel();
        else closePanel();
    });

    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        renderList();
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closePanel();
            trigger.focus();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const first = list.querySelector('.phone-country-option');
            if (!first) return;
            setCountry(first.dataset.code);
            closePanel();
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    list.addEventListener('click', (e) => {
        const option = e.target.closest('.phone-country-option');
        if (!option) return;
        setCountry(option.dataset.code);
        closePanel();
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });

    document.addEventListener('click', (e) => {
        if (wrap.contains(e.target)) return;
        closePanel();
    });
}

function populatePhoneCountrySelect(selectEl, selectedCode) {
    initPhoneCountryPicker(selectEl, selectedCode);
}

function bindPasswordToggles(root) {
    const scope = root || document;
    scope.querySelectorAll('.pass-toggle').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';

        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = targetId
                ? document.getElementById(targetId)
                : btn.closest('.pass-wrap')?.querySelector('input');
            const icon = btn.querySelector('i');
            if (!input) return;

            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            if (icon) icon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        });
    });
}

function ensureAccountHeaderShell() {
    if (document.getElementById('header-account-wrap')) return;

    const actions = document.querySelector('.header-actions');
    if (!actions) return;

    const wrap = document.createElement('div');
    wrap.id = 'header-account-wrap';
    wrap.className = 'header-account-wrap';
    wrap.innerHTML = `
        <div class="header-account-menu">
            <button type="button" class="header-action header-action--account" id="header-account-btn"
                aria-expanded="false" aria-haspopup="true" title="Sign in">
                <i class="fa-solid fa-circle-user" id="header-account-icon" aria-hidden="true"></i>
                <span class="header-action-label" id="header-account-label">Sign In</span>
            </button>
            <div class="header-account-dropdown" id="header-account-dropdown" hidden>
                <div class="header-account-dropdown-name" id="header-account-dropdown-name"></div>
                <a href="account.html" id="header-account-profile-link" hidden><i class="fa-solid fa-id-card"></i> My Profile</a>
                <button type="button" id="header-account-logout"><i class="fa-solid fa-right-from-bracket"></i> Sign out</button>
            </div>
        </div>
    `;

    const mobileToggle = document.getElementById('mobile-menu-toggle');
    if (mobileToggle) actions.insertBefore(wrap, mobileToggle);
    else actions.appendChild(wrap);

    bindAccountDropdownOnce();
}

function updateDrawerAdminLink(isAdmin) {
    const drawerNav = document.querySelector('.drawer-nav');
    if (!drawerNav) return;

    let link = document.getElementById('drawer-admin-link');

    // Only the store admin account ever sees "Manage store" in the mobile drawer
    if (!isAdmin) {
        if (link) link.remove();
        return;
    }

    if (!link) {
        link = document.createElement('a');
        link.id = 'drawer-admin-link';
        link.href = '/admin';
        link.innerHTML = '<i class="fa-solid fa-gauge-high"></i> Manage store';
        const profile = drawerNav.querySelector('a[href="account.html"]');
        if (profile) profile.insertAdjacentElement('afterend', link);
        else drawerNav.appendChild(link);
    }
    link.hidden = false;
}

function updateAccountHeaderLink(userOverride) {
    ensureAccountHeaderShell();

    const label = document.getElementById('header-account-label');
    const icon = document.getElementById('header-account-icon');
    const dropdownName = document.getElementById('header-account-dropdown-name');
    const profileLink = document.getElementById('header-account-profile-link');
    const btn = document.getElementById('header-account-btn');
    const dropdown = document.getElementById('header-account-dropdown');
    if (!label || !btn) return;

    const user = userOverride === undefined ? getHeaderAuthUser() : userOverride;
    const loggedIn = Boolean(user && getHeaderAuthToken());

    // Only show "Manage store" after server confirms the dedicated store-admin account.
    // Never trust cached session alone (avoids flashing the link for customers).
    const isConfirmedAdmin = (userOverride !== undefined) && loggedIn && isStoreAdmin(user);

    if (icon) {
        icon.className = 'fa-solid fa-circle-user';
    }

    if (profileLink) profileLink.hidden = !loggedIn;

    // Inject admin link only for store admin; remove entirely for everyone else
    let adminLink = document.getElementById('header-account-admin-link');
    if (isConfirmedAdmin) {
        if (!adminLink) {
            adminLink = document.createElement('a');
            adminLink.id = 'header-account-admin-link';
            adminLink.href = '/admin';
            adminLink.innerHTML = '<i class="fa-solid fa-gauge-high"></i> Manage store';
            // Insert between profile link and logout button
            const logoutBtn = document.getElementById('header-account-logout');
            if (logoutBtn) logoutBtn.insertAdjacentElement('beforebegin', adminLink);
            else dropdown && dropdown.appendChild(adminLink);
        }
        adminLink.hidden = false;
    } else if (adminLink) {
        adminLink.remove();
    }

    updateDrawerAdminLink(isConfirmedAdmin);

    if (loggedIn) {
        label.textContent = getAccountDisplayName(user);
        if (dropdownName) dropdownName.textContent = user.name || user.username || user.email || 'Account';
        btn.title = 'My account';
        btn.dataset.mode = 'menu';
    } else {
        label.textContent = 'Sign In';
        if (dropdownName) dropdownName.textContent = '';
        btn.title = 'Sign in';
        btn.dataset.mode = 'login';
        dropdown?.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
    }
}

function showAuthLoading(message) {
    let overlay = document.getElementById('login-loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'login-loading-overlay';
        overlay.className = 'login-loading-overlay';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        overlay.innerHTML = `
            <div class="login-loading-card">
                <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                <p id="auth-loading-message">Please wait…</p>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    const msg = overlay.querySelector('#auth-loading-message');
    if (msg) msg.textContent = message || 'Please wait…';
    overlay.hidden = false;
    document.body.classList.add('login-loading-active');
}

function hideAuthLoading() {
    const overlay = document.getElementById('login-loading-overlay');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('login-loading-active');
}

function waitAtLeast(startedAt, minMs) {
    return Promise.resolve();
}

function bindAccountDropdownOnce() {
    const wrap = document.getElementById('header-account-wrap');
    if (!wrap || wrap.dataset.bound === '1') return;
    wrap.dataset.bound = '1';

    wrap.addEventListener('click', (e) => {
        const btn = document.getElementById('header-account-btn');
        const dropdown = document.getElementById('header-account-dropdown');
        if (!btn || !dropdown) return;

        if (e.target.closest('#header-account-logout')) {
            e.preventDefault();
            e.stopPropagation();
            dropdown.setAttribute('hidden', '');
            btn.setAttribute('aria-expanded', 'false');

            const LOGOUT_LOADING_MS = 600;
            const started = Date.now();
            showAuthLoading('Signing you out…');

            const flushBasket = (typeof GmsShoppingStore !== 'undefined')
                ? GmsShoppingStore.onLogout()
                : Promise.resolve();

            flushBasket
                .catch(() => {})
                .then(() => CustomerAPI.logout())
                .catch(() => {})
                .finally(() => {
                    clearAuthSession();
                    try {
                        localStorage.removeItem('gms_recent_v1');
                        localStorage.removeItem('gms_recently_viewed');
                    } catch (_) {}
                    window.location.href = 'index.html';
                });
            return;
        }

        if (!e.target.closest('#header-account-btn')) return;

        if (btn.dataset.mode === 'login') {
            const page = document.body?.dataset?.page || '';
            const path = (window.location.pathname || '').split('/').pop() || 'index.html';
            let next = path;
            if (page === 'basket' || page === 'bucket') next = 'basket.html';
            else if (page === 'products') next = 'products.html' + (window.location.search || '');
            else if (page === 'account') next = 'account.html';
            else if (page === 'contact') next = 'contact.html';
            else if (page === 'about') next = 'about.html';
            else if (page === 'home') next = 'index.html';
            const q = window.location.search || '';
            const hash = window.location.hash || '';
            if (page === 'home' && hash) next = 'index.html' + hash;
            else if (page === 'products' && !window.location.search && q) next = 'products.html' + q;
            window.location.href = `login.html?next=${encodeURIComponent(next)}`;
            return;
        }

        e.stopPropagation();
        const open = dropdown.hasAttribute('hidden');
        dropdown.toggleAttribute('hidden', !open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('.header-account-menu')) return;
        const dropdown = document.getElementById('header-account-dropdown');
        const btn = document.getElementById('header-account-btn');
        dropdown?.setAttribute('hidden', '');
        btn?.setAttribute('aria-expanded', 'false');
    });
}

async function validateUserSession() {
    const token = getHeaderAuthToken();
    if (!token) return null;
    try {
        const profile = await CustomerAPI.me();
        if (profile.role !== 'customer' && profile.role !== 'admin') {
            clearAuthSession();
            return null;
        }
        persistAuthSession(token, profile);
        return profile;
    } catch (err) {
        // Only drop the session on auth failures — keep header login on network blips
        if (err && (err.status === 401 || err.status === 403)) {
            clearAuthSession();
            return null;
        }
        return CustomerAPI.getUser();
    }
}

function initCustomerHeaderAuth() {
    updateAccountHeaderLink();

    if (!getHeaderAuthToken()) {
        if (typeof GmsShoppingStore !== 'undefined') GmsShoppingStore.hydrate();
        return;
    }

    // Hide admin link while waiting for server role validation
    const adminLink = document.getElementById('header-account-admin-link');
    if (adminLink) adminLink.hidden = true;
    updateDrawerAdminLink(false);

    validateUserSession()
        .then(async (profile) => {
            updateAccountHeaderLink(profile);
            if (profile && typeof GmsShoppingStore !== 'undefined') {
                await GmsShoppingStore.syncFromServer();
            } else if (typeof GmsShoppingStore !== 'undefined') {
                GmsShoppingStore.hydrate();
            }
        })
        .catch(() => updateAccountHeaderLink(null));
}

function postLoginDestination() {
    const params = new URLSearchParams(window.location.search);
    const next = (params.get('next') || '').trim();
    if (!next || next.startsWith('http') || next.startsWith('//')) return 'index.html';
    if (next === 'admin' || next === '/admin' || next === 'admin.html') return '/admin';
    if (next.includes('.html') || next.startsWith('/')) return next.replace(/^\//, '') || 'index.html';
    return 'index.html';
}

function initLoginPage() {
    const form = document.getElementById('login-form');
    const errorEl = document.getElementById('login-error');
    if (!form) return;

    const existingUser = getHeaderAuthUser();
    if (existingUser && getHeaderAuthToken()) {
        window.location.replace(postLoginDestination());
        return;
    }

    // Preserve ?next= when user switches to Create account
    const nextParams = new URLSearchParams(window.location.search).get('next');
    const signupLink = document.getElementById('login-create-account-link')
        || document.querySelector('a[href="signup.html"], a[href="./signup.html"]');
    if (signupLink && nextParams) {
        signupLink.href = `signup.html?next=${encodeURIComponent(nextParams)}`;
    }

    const LOADING_MS = 600;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.add('hidden');
        }

        const login = form.login.value.trim();
        const password = form.password.value;
        const submitBtn = form.querySelector('button.btn-login, button[type="submit"]');
        const originalLabel = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Signing in…';
        }
        showAuthLoading('Signing you in…');

        const started = Date.now();
        try {
            const res = await CustomerAPI.login(login, password);
            if (res.user.role !== 'customer' && res.user.role !== 'admin') {
                throw new Error('This account cannot sign in here.');
            }
            persistAuthSession(res.session_token, res.user);
            if (typeof GmsShoppingStore !== 'undefined') {
                await GmsShoppingStore.onLogin();
            }
            window.location.href = postLoginDestination();
        } catch (err) {
            hideAuthLoading();
            if (errorEl) {
                errorEl.textContent = err.message || 'Sign in failed. Please try again.';
                errorEl.classList.remove('hidden');
            }
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalLabel || 'Sign In';
            }
        }
    });

    bindPasswordToggles(form);
}

function initSignupPage() {
    const form = document.getElementById('signup-form');
    const errorEl = document.getElementById('signup-error');
    const passwordInput = document.getElementById('signup-password');
    const confirmInput = document.getElementById('signup-password-confirm');
    const checklist = document.getElementById('password-checklist');
    const countrySelect = document.getElementById('signup-phone-country');
    if (!form) return;

    // Preserve ?next= when bouncing between login ↔ signup
    const nextParams = new URLSearchParams(window.location.search).get('next');
    const loginLink = document.querySelector('a[href="login.html"], a[href="./login.html"]');
    if (loginLink && nextParams) {
        loginLink.href = `login.html?next=${encodeURIComponent(nextParams)}`;
    }

    populatePhoneCountrySelect(countrySelect, 'GB');
    bindPasswordToggles(form);

    if (CustomerAPI.isLoggedIn()) {
        window.location.replace(postLoginDestination());
        return;
    }

    const updateChecklist = () => renderPasswordChecklist(checklist, passwordInput.value);
    passwordInput?.addEventListener('input', updateChecklist);
    updateChecklist();

    const LOADING_MS = 600;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.add('hidden');
        }

        const password = form.password.value;
        const confirmPassword = confirmInput?.value || '';

        if (!passwordMeetsPolicy(password)) {
            if (errorEl) {
                errorEl.textContent = 'Please meet all password requirements before signing up.';
                errorEl.classList.remove('hidden');
            }
            return;
        }
        if (password !== confirmPassword) {
            if (errorEl) {
                errorEl.textContent = 'Passwords do not match. Please confirm your password.';
                errorEl.classList.remove('hidden');
            }
            return;
        }

        const payload = {
            name: form.name.value.trim(),
            email: form.email.value.trim(),
            phone_country: form.phone_country.value,
            phone: form.phone.value.trim(),
            address: form.address.value.trim(),
            password,
        };

        const submitBtn = form.querySelector('button[type="submit"]');
        const submitLabel = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Creating account…';
        showAuthLoading('Creating your account…');

        const started = Date.now();
        try {
            const res = await CustomerAPI.register(payload);
            persistAuthSession(res.session_token, res.user);
            if (typeof GmsShoppingStore !== 'undefined') {
                await GmsShoppingStore.onLogin();
            }
            window.location.href = postLoginDestination();
        } catch (err) {
            hideAuthLoading();
            if (errorEl) {
                errorEl.textContent = err.message || 'Sign up failed. Please try again.';
                errorEl.classList.remove('hidden');
            }
            submitBtn.disabled = false;
            submitBtn.innerHTML = submitLabel;
        }
    });
}

function initAccountPage() {
    const form = document.getElementById('profile-form');
    const errorEl = document.getElementById('profile-error');
    const successEl = document.getElementById('profile-success');
    const card = document.querySelector('.auth-card--wide');
    if (!form) return;

    // Hide form until session is confirmed — avoids blank profile flash for guests
    form.hidden = true;
    if (card) {
        let gate = document.getElementById('account-auth-gate');
        if (!gate) {
            gate = document.createElement('div');
            gate.id = 'account-auth-gate';
            gate.className = 'account-auth-gate';
            gate.innerHTML = `
                <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                <p>Checking your account…</p>
            `;
            form.insertAdjacentElement('beforebegin', gate);
        }
        gate.hidden = false;
    }

    updateAccountHeaderLink();
    // Inline gate only — avoid full-screen overlay on account (faster)

    validateUserSession().then((profile) => {
        if (!profile) {
            window.location.replace('login.html?next=account.html');
            return;
        }

        const gate = document.getElementById('account-auth-gate');
        if (gate) gate.hidden = true;
        form.hidden = false;

        updateAccountHeaderLink(profile);
        fillProfileForm(profile);
        updateAccountManageStoreLink(profile);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (errorEl) errorEl.textContent = '';
            if (successEl) successEl.textContent = '';

            const submitBtn = form.querySelector('button[type="submit"]');
            const originalLabel = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving…';

            try {
                const updated = await CustomerAPI.updateProfile({
                    name: form.name.value.trim(),
                    phone_country: form.phone_country.value,
                    phone: form.phone.value.trim(),
                    address: form.address.value.trim(),
                });
                persistAuthSession(CustomerAPI.getToken(), updated);
                fillProfileForm(updated);
                updateAccountHeaderLink(updated);
                updateAccountManageStoreLink(updated);
                if (successEl) successEl.textContent = 'Your profile has been updated.';
            } catch (err) {
                if (errorEl) errorEl.textContent = err.message || 'Could not update profile.';
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalLabel;
            }
        });
    });
}

function updateAccountManageStoreLink(profile) {
    let link = document.getElementById('account-manage-store');
    if (!isStoreAdmin(profile)) {
        if (link) link.remove();
        return;
    }
    if (!link) {
        const card = document.querySelector('.auth-card--wide');
        const sub = card?.querySelector('.auth-card-sub');
        if (!card || !sub) return;
        link = document.createElement('a');
        link.id = 'account-manage-store';
        link.className = 'btn-login account-manage-store';
        link.href = '/admin';
        link.innerHTML = '<i class="fa-solid fa-gauge-high" aria-hidden="true"></i> Manage store';
        sub.insertAdjacentElement('afterend', link);
    }
    link.hidden = false;
}

function fillProfileForm(profile) {
    const form = document.getElementById('profile-form');
    if (!form || !profile) return;

    const country = profile.phone_country || 'GB';
    populatePhoneCountrySelect(form.phone_country, country);

    form.name.value = profile.name || '';
    form.email.value = profile.email || '';
    form.username.value = profile.username || '';
    form.phone.value = stripDialCode(profile.phone || '', country);
    form.address.value = profile.address || '';

    const welcome = document.getElementById('account-welcome');
    if (welcome) welcome.textContent = profile.name ? `Welcome back, ${profile.name}` : 'My Account';
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.dataset.page;
    if (page === 'login') initLoginPage();
    else if (page === 'signup') initSignupPage();
    else if (page === 'account') initAccountPage();
    else initCustomerHeaderAuth();

    // Keep header in sync across tabs when login/logout happens elsewhere
    window.addEventListener('storage', (e) => {
        if (e.key !== CustomerAPI.TOKEN_KEY && e.key !== CustomerAPI.USER_KEY) return;
        if (page === 'login' || page === 'signup') return;
        const user = getHeaderAuthUser();
        const token = getHeaderAuthToken();
        if (token && user) {
            updateAccountHeaderLink(user);
            if (typeof GmsShoppingStore !== 'undefined') {
                GmsShoppingStore.syncFromServer().catch(() => {});
            }
        } else {
            updateAccountHeaderLink(null);
            if (typeof GmsShoppingStore !== 'undefined') {
                GmsShoppingStore.reloadFromStorage();
            }
        }
    });
});

(function paintAccountHeaderFromCache() {
    const page = document.body?.dataset?.page;
    if (page === 'login' || page === 'signup') return;
    ensureAccountHeaderShell();
    // Never show "Manage store" from cache — always wait for server validation.
    // This prevents stale admin session data from flashing the link for regular users.
    updateAccountHeaderLink();
    const adminLink = document.getElementById('header-account-admin-link');
    if (adminLink) adminLink.hidden = true;
    updateDrawerAdminLink(false);
})();
