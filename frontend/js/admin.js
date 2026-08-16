'use strict';

/* ── UI helpers ─────────────────────────────────────────── */
const UI = {
    showLoading() { document.getElementById('loading-overlay')?.classList.remove('hidden'); },
    hideLoading() { document.getElementById('loading-overlay')?.classList.add('hidden'); },

    toast(msg, type = 'success') {
        const c = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        el.textContent = msg;
        c.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    },

    confirm(title, message, { okLabel = 'Confirm', okClass = 'adm-btn--danger', cancelLabel = 'Cancel' } = {}) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-modal');
            document.getElementById('confirm-title').textContent = title;
            document.getElementById('confirm-message').textContent = message;
            const ok = document.getElementById('confirm-ok');
            const cancel = document.getElementById('confirm-cancel');
            const closeBtn = modal.querySelector('.confirm-close');
            ok.textContent = okLabel;
            ok.className = `adm-btn ${okClass}`;
            cancel.textContent = cancelLabel;
            modal.classList.remove('hidden');
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                modal.classList.add('hidden');
                ok.onclick = null;
                cancel.onclick = null;
                if (closeBtn) closeBtn.onclick = null;
                resolve(value);
            };
            ok.onclick = () => finish(true);
            cancel.onclick = () => finish(false);
            if (closeBtn) closeBtn.onclick = () => finish(false);
        });
    },

    async withLoading(fn) {
        UI.showLoading();
        try { return await fn(); }
        catch (e) { UI.toast(e.message || 'Something went wrong', 'error'); throw e; }
        finally { UI.hideLoading(); }
    },

    fmtMoney(n) { return `£${Number(n || 0).toFixed(2)}`; },
    fmtDate(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    },
    esc(s) {
        const d = document.createElement('div');
        d.textContent = s ?? '';
        return d.innerHTML;
    },
    cssUrl(url) {
        return encodeURI(String(url ?? '')).replace(/'/g, '%27');
    },
    statusBadge(status) {
        const map = {
            pending: 'amber', confirmed: 'blue', shipped: 'purple',
            delivered: 'green', cancelled: 'red', active: 'green', inactive: 'red',
        };
        return `<span class="badge badge--${map[status] || 'gray'}">${UI.esc(status)}</span>`;
    },
    stockBadge(qty) {
        if (qty <= 0) return '<span class="badge badge--red">Out of Stock</span>';
        if (qty <= 19) return `<span class="badge badge--amber">${qty}</span>`;
        return `<span class="badge badge--green">${qty}</span>`;
    },
    stars(n) {
        const r = Math.min(5, Math.max(0, parseInt(n, 10) || 0));
        return '<span class="stars">' + '★'.repeat(r) + '☆'.repeat(5 - r) + '</span>';
    },
};

/* ── Client-side TTL cache (avoids re-fetching on every nav click) ── */
const _ac = {};
const _acGen = {};
const _acPending = {};
const _AC_TTL = 600000; // 10 minutes — survives reloads within an admin session
const _AC_STORE_KEY = 'gms_admin_cache_v1';
const _AC_PERSIST_KEYS = new Set([
    'banners', 'cultures', 'testimonials', 'spotlight',
    'dashboard', 'categories', 'stats', 'settings', 'discountedProducts',
    'brands', 'kitchenCultures',
]);

function acHydrate() {
    try {
        const raw = sessionStorage.getItem(_AC_STORE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const now = Date.now();
        Object.entries(parsed).forEach(([key, entry]) => {
            if (entry && typeof entry.t === 'number' && now - entry.t < _AC_TTL) {
                _ac[key] = entry;
            }
        });
    } catch (_) {}
}

function acPersist() {
    try {
        const subset = {};
        const recentProductKeys = Object.keys(_ac)
            .filter(key => key.startsWith('products:'))
            .sort((a, b) => _ac[b].t - _ac[a].t)
            .slice(0, 8);
        const recentProductDetails = Object.keys(_ac)
            .filter(key => key.startsWith('product:'))
            .sort((a, b) => _ac[b].t - _ac[a].t)
            .slice(0, 8);
        Object.keys(_ac).forEach(key => {
            if (
                _AC_PERSIST_KEYS.has(key)
                || key.startsWith('subcategories:')
                || recentProductKeys.includes(key)
                || recentProductDetails.includes(key)
            ) {
                subset[key] = _ac[key];
            }
        });
        sessionStorage.setItem(_AC_STORE_KEY, JSON.stringify(subset));
    } catch (_) {}
}

function acGet(key) {
    const e = _ac[key];
    if (!e || Date.now() - e.t > _AC_TTL) return null;
    return e.v;
}
function acSet(key, val) {
    _ac[key] = { t: Date.now(), v: val };
    acPersist();
}
function acDel(...keys) {
    keys.forEach(k => {
        delete _ac[k];
        delete _acPending[k];
        _acGen[k] = (_acGen[k] || 0) + 1;
    });
    acPersist();
}
function acClear() {
    Object.keys(_ac).forEach(k => {
        delete _ac[k];
        _acGen[k] = (_acGen[k] || 0) + 1;
    });
    try { sessionStorage.removeItem(_AC_STORE_KEY); } catch (_) {}
}

function markAdminSession(active) {
    document.documentElement.classList.toggle('admin-session', active);
}

function syncAdminTokenFromCustomerSession() {
    if (AdminAPI.getToken()) return AdminAPI.getToken();
    if (typeof CustomerAPI === 'undefined') return null;
    const user = CustomerAPI.getUser();
    const token = CustomerAPI.getToken();
    if (token && user?.role === 'admin') {
        AdminAPI.setSession(token, user);
        return token;
    }
    return null;
}

async function clearAllAuthSessions() {
    const adminToken = AdminAPI.getToken();
    const customerToken = typeof CustomerAPI !== 'undefined' ? CustomerAPI.getToken() : null;
    if (adminToken) await AdminAPI.logout().catch(() => {});
    if (customerToken && customerToken !== adminToken) {
        await CustomerAPI.logout().catch(() => {});
    }
    AdminAPI.clearSession();
    if (typeof CustomerAPI !== 'undefined') CustomerAPI.clearSession();
}

function redirectToLogin() {
    window.location.replace('/login.html?next=/admin');
}

function redirectToStorefront() {
    window.location.replace('/index.html');
}

function showAdminExitLoading(message) {
    let overlay = document.getElementById('admin-exit-loading');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'admin-exit-loading';
        overlay.className = 'login-loading-overlay';
        overlay.setAttribute('role', 'status');
        overlay.innerHTML = `
            <div class="login-loading-card">
                <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                <p id="admin-exit-loading-msg">Please wait…</p>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    const msg = overlay.querySelector('#admin-exit-loading-msg');
    if (msg) msg.textContent = message || 'Please wait…';
    overlay.hidden = false;
    document.body.classList.add('login-loading-active');
}

function waitAtLeastAdmin(startedAt, minMs) {
    return Promise.resolve();
}

async function exitToStorefront() {
    showAdminExitLoading('Signing you out…');
    _appReady = false;
    markAdminSession(false);
    acClear();
    document.getElementById('admin-shell')?.classList.add('hidden');
    await clearAllAuthSessions();
    redirectToStorefront();
}

async function exitToLogin() {
    showAdminExitLoading('Signing you out…');
    _appReady = false;
    markAdminSession(false);
    acClear();
    document.getElementById('admin-shell')?.classList.add('hidden');
    await clearAllAuthSessions();
    redirectToLogin();
}

function sleep(ms) {
    return Promise.resolve();
}

let _appReady = false;

async function validateAdminSession() {
    const token = AdminAPI.getToken();
    if (!token) return false;

    hideSessionWarning();
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const user = await AdminAPI.me();
            if (user.role !== 'admin') {
                await exitToStorefront();
                return false;
            }
            AdminAPI.setSession(token, user);
            return true;
        } catch (err) {
            const status = err?.status;
            if (status === 401 || status === 403) {
                await exitToLogin();
                return false;
            }
        }
    }
    showSessionWarning();
    return true;
}

function showSessionWarning() {
    document.getElementById('session-warning')?.classList.remove('hidden');
}

function hideSessionWarning() {
    document.getElementById('session-warning')?.classList.add('hidden');
}

function updateNotificationBadge(stats) {
    const n = stats?.lowStock ?? stats?.flagged_products ?? 0;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}
function acClearProducts() {
    Object.keys(_ac).filter(k => k.startsWith('products:') || k.startsWith('product:')).forEach(k => {
        delete _ac[k];
        delete _acPending[k];
        _acGen[k] = (_acGen[k] || 0) + 1;
    });
    acPersist();
    acDel('stats');
}

async function acFetch(key, fn, { fresh = false } = {}) {
    if (!fresh) {
        const hit = acGet(key);
        if (hit !== null) return hit;
        if (_acPending[key]) return _acPending[key];
    }
    const gen = _acGen[key] || 0;
    const pending = Promise.resolve().then(fn);
    if (!fresh) _acPending[key] = pending;
    try {
        const data = await pending;
        // Ignore stale in-flight responses invalidated while the request was pending.
        if ((_acGen[key] || 0) === gen) acSet(key, data);
        return data;
    } finally {
        if (_acPending[key] === pending) delete _acPending[key];
    }
}

/** Refresh cached data in the background after painting a stale snapshot. */
function acRevalidate(key, fn, onData, { isStale } = {}) {
    setTimeout(async () => {
        try {
            const data = await acFetch(key, fn, { fresh: true });
            if (isStale && isStale()) return;
            onData(data);
        } catch (err) {
            if (err.name !== 'AbortError') console.error(err);
        }
    }, 0);
}

function closeGenericModal() {
    const modal = document.getElementById('generic-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    const saveBtn = document.getElementById('generic-modal-save');
    if (saveBtn) {
        saveBtn.style.display = '';
        saveBtn.onclick = null;
    }
    const deleteBtn = document.getElementById('generic-modal-delete');
    if (deleteBtn) {
        deleteBtn.classList.add('hidden');
        deleteBtn.onclick = null;
    }
    const activeWrap = document.getElementById('generic-modal-active-wrap');
    if (activeWrap) activeWrap.classList.add('hidden');
    const activeChk = document.getElementById('m-ban-active');
    if (activeChk) activeChk.checked = true;
    const activeState = document.getElementById('generic-modal-active-state');
    if (activeState) {
        activeState.textContent = 'Active';
        activeState.className = 'modal-active-label modal-active-label--on';
    }
    const body = document.getElementById('generic-modal-body');
    if (body) body.innerHTML = '';
}

function sectionSpinner() {
    return '<div class="adm-section-loading"><div class="spinner"></div></div>';
}

function updateProductsSubtitle(stats, data = null) {
    const el = document.getElementById('products-subtitle');
    if (!el || !stats) return;
    let text = `${stats.total_products.toLocaleString()} products across ${stats.total_categories} categories`;
    if (data?.count_capped) text += ' · 500+ search matches';
    el.textContent = text;
}

function setProductsTableLoading(loading) {
    const tbody = document.querySelector('#products-table tbody');
    if (!tbody || !loading) return;
    tbody.innerHTML = `<tr><td colspan="9" class="adm-table-loading">${sectionSpinner()}</td></tr>`;
}

let _productsRenderGen = 0;

function prefetchAdminData() {
    const warm = () => Promise.all([
        acFetch('stats', () => AdminAPI.stats()),
        acFetch('categories', () => AdminAPI.categories()),
        acFetch('settings', () => AdminAPI.settings()),
    ]).catch(() => {});

    if ('requestIdleCallback' in window) {
        requestIdleCallback(warm, { timeout: 2000 });
    } else {
        setTimeout(warm, 500);
    }
}

/* ── App state ──────────────────────────────────────────── */
const state = {
    section: 'dashboard',
    categories: [],
    subcategories: [],
    selectedCategoryId: null,
    products: { page: 1, perPage: 25, items: [], total: 0, selected: new Set() },
    discountedSelected: new Set(),
    editingProductId: null,
    productImages: [],
    pendingImageFiles: [],
    pendingImageUrls: [],
};

const SPOTLIGHT_PRODUCT_SECTIONS = [
    { key: 'featured', flag: 'is_featured', title: 'Featured Products', subtitle: 'Homepage featured strip', icon: 'fa-star' },
    { key: 'bestSellers', flag: 'is_best_seller', title: 'Best Sellers', subtitle: 'Top selling picks', icon: 'fa-ranking-star' },
    { key: 'newArrivals', flag: 'is_new_arrival', title: 'New Arrivals', subtitle: 'Recently added items', icon: 'fa-wand-magic-sparkles' },
    { key: 'hotOffers', flag: 'is_hot_offer', title: 'Hot Offers', subtitle: 'Deals and promotions', icon: 'fa-fire' },
    { key: 'exclusive', flag: 'is_exclusive', title: 'Exclusive Products', subtitle: 'GMS exclusives', icon: 'fa-gem' },
];

const DASHBOARD_SPOTLIGHT_KPIS = SPOTLIGHT_PRODUCT_SECTIONS.map(s => ({
    key: s.key,
    label: s.title,
    icon: s.icon,
    trend: s.subtitle,
}));

const ADMIN_SECTIONS = new Set([
    'dashboard', 'products', 'categories', 'spotlight',
    'banners', 'cultures', 'testimonials', 'contact-messages', 'discounts', 'coupons', 'settings',
]);
const ADMIN_SECTION_KEY = 'gms_admin_section_v1';

function getSectionFromUrl() {
    const hash = (location.hash || '').replace(/^#/, '').trim().toLowerCase();
    if (ADMIN_SECTIONS.has(hash)) return hash;
    try {
        const saved = localStorage.getItem(ADMIN_SECTION_KEY);
        if (saved && ADMIN_SECTIONS.has(saved)) return saved;
    } catch (_) {}
    return 'dashboard';
}

function persistSection(name) {
    if (!ADMIN_SECTIONS.has(name)) return;
    try { localStorage.setItem(ADMIN_SECTION_KEY, name); } catch (_) {}
    const nextHash = `#${name}`;
    if (location.hash !== nextHash) {
        history.replaceState(null, '', `${location.pathname}${location.search}${nextHash}`);
    }
}

/* ── Navigation ─────────────────────────────────────────── */
function showSection(name, { updateUrl = true } = {}) {
    if (!ADMIN_SECTIONS.has(name)) name = 'dashboard';
    state.section = name;
    document.querySelectorAll('.adm-section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`section-${name}`)?.classList.remove('hidden');
    document.querySelectorAll('.adm-nav-link').forEach(a => {
        a.classList.toggle('active', a.dataset.section === name);
    });
    if (updateUrl) persistSection(name);
    loadSection(name);
}

async function loadSection(name) {
    try {
        switch (name) {
            case 'dashboard': await renderDashboard(); break;
            case 'products': await renderProducts(); break;
            case 'categories': await renderCategories(); break;
            case 'spotlight': await renderSpotlight(); break;
            case 'banners': await renderBanners(); break;
            case 'cultures': await renderCultures(); break;
            case 'testimonials': await renderTestimonials(); break;
            case 'contact-messages': await renderContactMessages(); break;
            case 'discounts': await renderDiscounts(); break;
            case 'coupons': await renderCoupons(); break;
            case 'settings': await renderSettings(); break;
        }
    } catch (e) {
        console.error(e);
    }
}

/* ── Auth ───────────────────────────────────────────────── */
async function initAuth() {
    if (window.location.protocol === 'file:') {
        document.body.innerHTML = '<p style="padding:2rem;font-family:Inter,sans-serif;max-width:36rem;margin:0 auto">Open store management via the site: <strong>http://127.0.0.1:8000/admin</strong> after running <code>python run.py</code>. Do not open admin.html as a file.</p>';
        return;
    }

    const token = syncAdminTokenFromCustomerSession() || AdminAPI.getToken();
    if (!token) {
        redirectToLogin();
        return;
    }

    acHydrate();
    const cachedUser = AdminAPI.getUser();

    // Restore a previously authenticated admin session immediately. Every API
    // request is still protected server-side, while validation runs quietly.
    if (cachedUser?.role === 'admin') {
        enterApp(cachedUser);
        validateAdminSession().catch(() => showSessionWarning());
        return;
    }

    UI.showLoading();
    try {
        const valid = await validateAdminSession();
        if (valid) enterApp(AdminAPI.getUser());
    } finally {
        UI.hideLoading();
    }
}

function enterApp(user) {
    if (_appReady) return;
    _appReady = true;
    markAdminSession(true);
    if (typeof CustomerAPI !== 'undefined' && user?.role === 'admin') {
        CustomerAPI.setSession(AdminAPI.getToken(), user);
    }
    document.getElementById('admin-shell').classList.remove('hidden');
    document.getElementById('dashboard-date').textContent = new Date().toLocaleDateString('en-GB', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    acFetch('settings', () => AdminAPI.settings())
        .then(s => { if (typeof applySiteSettings === 'function') applySiteSettings(s); })
        .catch(() => {});
    acFetch('stats', () => AdminAPI.stats())
        .then(s => updateProductsSubtitle(s))
        .catch(() => {});
    prefetchAdminData();
    showSection(getSectionFromUrl());
}

function siteLogoUrl() {
    return (typeof getSiteSettings === 'function' && getSiteSettings().store_logo_url) || '';
}

/* ── Dashboard ──────────────────────────────────────────── */
function paintDashboard(data) {
    const grid = document.getElementById('kpi-grid');
    if (!grid) return;

    updateNotificationBadge(data.catalogStats || {});

    const counts = data.spotlightCounts || {};
    grid.className = 'kpi-grid kpi-grid--spotlight';
    grid.innerHTML = DASHBOARD_SPOTLIGHT_KPIS.map(k => `
        <button type="button" class="kpi-card kpi-card--link" data-goto-spotlight="${k.key}">
            <div>
                <div class="kpi-card-label">${k.label}</div>
                <div class="kpi-card-value">${(counts[k.key] ?? 0).toLocaleString()}</div>
                <div class="kpi-card-trend up">${k.trend}</div>
            </div>
            <div class="kpi-card-icon"><i class="fa-solid ${k.icon}"></i></div>
        </button>`).join('');

    grid.querySelectorAll('[data-goto-spotlight]').forEach(btn => {
        btn.onclick = () => showSection('spotlight');
    });
}

async function renderDashboard({ fresh = false } = {}) {
    const grid = document.getElementById('kpi-grid');
    if (!grid) return;

    const cached = !fresh ? acGet('dashboard') : null;
    if (cached) {
        paintDashboard(cached);
        acRevalidate('dashboard', () => AdminAPI.dashboard(), paintDashboard, {
            isStale: () => state.section !== 'dashboard',
        });
        return;
    }

    if (!grid.querySelector('.kpi-card')) grid.innerHTML = sectionSpinner();
    try {
        const data = await acFetch('dashboard', () => AdminAPI.dashboard(), { fresh });
        paintDashboard(data);
    } catch (e) {
        if (!grid.querySelector('.kpi-card')) {
            UI.toast(e.message || 'Could not load dashboard', 'error');
        }
    }
}

function spotlightCategoryLabel(p) {
    const cat = p.categoryName || '';
    const sub = p.subCategoryName || '';
    if (cat && sub) return `${cat} › ${sub}`;
    return cat || sub || '—';
}

function renderSpotlightProductList(items) {
    if (!items?.length) {
        return '<p class="spotlight-cell-empty">No products in this section yet</p>';
    }
    return `
        <div class="adm-table-wrap spotlight-table-wrap">
            <table class="adm-table">
                <thead>
                    <tr>
                        <th class="no-sort spotlight-col-thumb"></th>
                        <th class="no-sort">Product</th>
                        <th class="no-sort">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(p => `
                    <tr>
                        <td class="spotlight-col-thumb"><img class="thumb" src="${UI.esc(absImageUrl(p.primaryImageUrl || siteLogoUrl()))}" alt=""></td>
                        <td>
                            <strong>${UI.esc(p.productName)}</strong><br>
                            <small style="color:#6b7a8d">${UI.esc(spotlightCategoryLabel(p))}</small>
                        </td>
                        <td>
                            <div class="adm-table-actions">
                                <button type="button" data-spotlight-edit="${UI.esc(p.productId)}" title="Edit"><i class="fa-solid fa-pencil"></i></button>
                                <button type="button" class="del" data-spotlight-remove="${UI.esc(p.productId)}" title="Remove"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

function renderSpotlightTestimonialList(items) {
    if (!items?.length) {
        return '<p class="spotlight-cell-empty">No featured testimonials yet</p>';
    }
    return `
        <div class="adm-table-wrap spotlight-table-wrap">
            <table class="adm-table">
                <thead>
                    <tr>
                        <th class="no-sort spotlight-col-thumb">Avatar</th>
                        <th class="no-sort">Customer</th>
                        <th class="no-sort">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(t => `
                    <tr>
                        <td class="spotlight-col-thumb"><span class="badge badge--green spotlight-avatar">${UI.esc(t.customerInitial || t.customerName?.[0] || '?')}</span></td>
                        <td>
                            <strong>${UI.esc(t.customerName)}</strong> ${UI.stars(t.rating)}<br>
                            <small style="color:#6b7a8d">${UI.esc(((t.quote || '').length > 80 ? (t.quote || '').slice(0, 80) + '…' : (t.quote || '')) || '—')}</small>
                        </td>
                        <td>
                            <div class="adm-table-actions">
                                <button type="button" data-testimonial-edit="${t.id}" title="Edit"><i class="fa-solid fa-pencil"></i></button>
                                <button type="button" class="del" data-testimonial-unfeature="${t.id}" title="Remove"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

async function renderSpotlight({ fresh = false } = {}) {
    const grid = document.getElementById('spotlight-grid');
    if (!grid) return;

    const cached = !fresh ? acGet('spotlight') : null;
    if (cached) {
        paintSpotlightGrid(cached);
        acRevalidate('spotlight', () => AdminAPI.spotlight(), paintSpotlightGrid, {
            isStale: () => state.section !== 'spotlight',
        });
        return;
    }

    if (!grid.querySelector('.spotlight-cell')) {
        grid.innerHTML = `<div class="adm-card" style="padding:32px;text-align:center;color:var(--adm-muted)">${sectionSpinner()}<p style="margin:12px 0 0">Loading spotlight sections…</p></div>`;
    }

    try {
        const data = await acFetch('spotlight', () => AdminAPI.spotlight(), { fresh });
        paintSpotlightGrid(data);
    } catch (e) {
        grid.innerHTML = `
            <div class="adm-card" style="padding:24px">
                <p style="margin:0 0 8px;color:var(--adm-danger)"><strong>Could not load Spotlight</strong></p>
                <p style="margin:0;color:var(--adm-muted)">${UI.esc(e.message || 'Request failed')}</p>
                <p style="margin:12px 0 0;color:var(--adm-muted);font-size:.875rem">Restart the site (<code>python run.py</code>) and hard-refresh this page (Ctrl+F5).</p>
            </div>`;
    }
}

function paintSpotlightGrid(data) {
    const grid = document.getElementById('spotlight-grid');
    const subtitle = document.getElementById('spotlight-subtitle');
    if (!grid || !data) return;

    const counts = data.counts || {};
    const totalProducts = SPOTLIGHT_PRODUCT_SECTIONS.reduce((n, s) => n + (counts[s.key] || 0), 0);
    if (subtitle) {
        subtitle.textContent =
            `${totalProducts.toLocaleString()} spotlight products · ${(counts.testimonials ?? 0).toLocaleString()} featured testimonials`;
    }

    const productCells = SPOTLIGHT_PRODUCT_SECTIONS.map(section => `
        <div class="adm-card spotlight-cell" data-spotlight-section="${section.key}">
            <div class="spotlight-cell-header">
                <div>
                    <h3><i class="fa-solid ${section.icon}" style="margin-right:6px;color:var(--adm-green)"></i>${section.title}</h3>
                    <p>${section.subtitle}</p>
                </div>
                <span class="spotlight-cell-count">${counts[section.key] ?? 0}</span>
            </div>
            <div class="spotlight-cell-list">
                ${renderSpotlightProductList(data.sections?.[section.key])}
            </div>
            <div style="padding:12px 18px;border-top:1px solid var(--adm-border)">
                <button type="button" class="adm-btn adm-btn--outline adm-btn--sm" data-spotlight-add="${section.key}" data-spotlight-flag="${section.flag}">
                    <i class="fa-solid fa-plus"></i> Add Product
                </button>
            </div>
        </div>`).join('');

    const testimonialCell = `
        <div class="adm-card spotlight-cell" data-spotlight-section="testimonials">
            <div class="spotlight-cell-header">
                <div>
                    <h3><i class="fa-solid fa-quote-left" style="margin-right:6px;color:var(--adm-green)"></i>Customer Testimonials</h3>
                    <p>Shown on the homepage</p>
                </div>
                <span class="spotlight-cell-count">${counts.testimonials ?? 0}</span>
            </div>
            <div class="spotlight-cell-list">
                ${renderSpotlightTestimonialList(data.testimonials)}
            </div>
            <div style="padding:12px 18px;border-top:1px solid var(--adm-border)">
                <button type="button" class="adm-btn adm-btn--outline adm-btn--sm" id="spotlight-add-testimonial">
                    <i class="fa-solid fa-plus"></i> Add Testimonial
                </button>
            </div>
        </div>`;

    grid.innerHTML = productCells + testimonialCell;

    grid.querySelectorAll('[data-spotlight-add]').forEach(btn => {
        btn.onclick = () => openSpotlightProductPicker(btn.dataset.spotlightAdd, btn.dataset.spotlightFlag);
    });

    grid.querySelectorAll('[data-spotlight-edit]').forEach(btn => {
        btn.onclick = () => openProductPanel(btn.dataset.spotlightEdit);
    });

    grid.querySelectorAll('[data-spotlight-remove]').forEach(btn => {
        btn.onclick = async () => {
            const cell = btn.closest('[data-spotlight-section]');
            const sectionKey = cell?.dataset.spotlightSection;
            const section = SPOTLIGHT_PRODUCT_SECTIONS.find(s => s.key === sectionKey);
            if (!section) return;
            await UI.withLoading(() => AdminAPI.updateProduct(btn.dataset.spotlightRemove, { [section.flag]: false }));
            UI.toast('Removed from section');
            acDel('spotlight', 'dashboard'); acClearProducts();
            renderSpotlight({ fresh: true });
            if (state.section === 'dashboard') renderDashboard();
        };
    });

    grid.querySelectorAll('[data-testimonial-edit]').forEach(btn => {
        btn.onclick = async () => {
            const items = await acFetch('testimonials', () => AdminAPI.testimonials(), { fresh: true });
            openTestimonialModal(parseInt(btn.dataset.testimonialEdit, 10), items);
        };
    });

    grid.querySelectorAll('[data-testimonial-unfeature]').forEach(btn => {
        btn.onclick = async () => {
            await UI.withLoading(() => AdminAPI.updateTestimonial(btn.dataset.testimonialUnfeature, { is_featured: false }));
            UI.toast('Removed from spotlight');
            acDel('spotlight', 'testimonials');
            renderSpotlight({ fresh: true });
        };
    });

    document.getElementById('spotlight-add-testimonial').onclick = async () => {
        const items = await acFetch('testimonials', () => AdminAPI.testimonials(), { fresh: true });
        openTestimonialModal(null, items, true);
    };
}

async function openSpotlightProductPicker(sectionKey, flagField) {
    const spotlight = await acFetch('spotlight', () => AdminAPI.spotlight());
    const inSection = new Set((spotlight.sections?.[sectionKey] || []).map(p => p.productId));
    const sectionMeta = SPOTLIGHT_PRODUCT_SECTIONS.find(s => s.key === sectionKey);

    document.getElementById('generic-modal-title').textContent = `Add to ${sectionMeta?.title || 'Section'}`;
    document.getElementById('generic-modal-body').innerHTML = `
        <input type="search" class="adm-input" id="spotlight-picker-search" placeholder="Search by product name or brand…" autocomplete="off">
        <div id="spotlight-picker-list" class="spotlight-picker-list">
            <p class="spotlight-cell-empty" style="padding:16px">Type to search products</p>
        </div>`;
    document.getElementById('generic-modal').classList.remove('hidden');
    document.getElementById('generic-modal-save').style.display = 'none';

    const listEl = document.getElementById('spotlight-picker-list');
    const renderPicker = async (search = '') => {
        const res = await AdminAPI.products(
            { search, per_page: 40, page: 1 },
            { scope: 'spotlight-picker' },
        );
        const available = (res.items || []).filter(p => !inSection.has(p.productId));
        listEl.innerHTML = available.length
            ? available.map(p => `
                <button type="button" class="spotlight-picker-item" data-pick-product="${UI.esc(p.productId)}">
                    <img src="${UI.esc(absImageUrl(p.primaryImageUrl || siteLogoUrl()))}" alt="">
                    <span>${UI.esc(p.productName)}</span>
                </button>`).join('')
            : `<p class="spotlight-cell-empty" style="padding:16px">${search ? 'No matching products' : 'No products available to add'}</p>`;

        listEl.querySelectorAll('[data-pick-product]').forEach(btn => {
            btn.onclick = async () => {
                await UI.withLoading(() => AdminAPI.updateProduct(btn.dataset.pickProduct, { [flagField]: true }));
                closeGenericModal();
                UI.toast('Product added to section');
                acDel('spotlight', 'dashboard'); acClearProducts();
                renderSpotlight({ fresh: true });
                if (state.section === 'dashboard') renderDashboard();
            };
        });
    };

    const searchInput = document.getElementById('spotlight-picker-search');
    searchInput.oninput = debounce(() => renderPicker(searchInput.value.trim()), 300);
    renderPicker();
    searchInput.focus();
}

/* ── Products ───────────────────────────────────────────── */
async function loadCategoriesCache() {
    if (!state.categories.length) {
        state.categories = await acFetch('categories', () => AdminAPI.categories());
    }
    return state.categories;
}

function getProductsFilterParams(overrides = {}) {
    return {
        search: document.getElementById('products-search').value.trim(),
        category_id: document.getElementById('products-cat-filter').value,
        subcategory_id: document.getElementById('products-subcat-filter').value,
        stock: document.getElementById('products-stock-filter').value,
        active_filter: document.getElementById('products-active-filter')?.value || 'active',
        sort: document.getElementById('products-sort-filter').value || 'none',
        ...overrides,
    };
}

function populateProductsCategoryFilter() {
    const catSel = document.getElementById('products-cat-filter');
    if (!catSel || catSel.options.length > 1) return;
    state.categories.forEach(c => {
        const option = document.createElement('option');
        option.value = c.category_id;
        option.textContent = c.category_name;
        catSel.appendChild(option);
    });
}

async function renderProducts({ fresh = false } = {}) {
    const gen = ++_productsRenderGen;
    loadCategoriesCache()
        .then(populateProductsCategoryFilter)
        .catch(err => console.error(err));

    const params = getProductsFilterParams({
        page: state.products.page,
        per_page: state.products.perPage,
    });
    const productsKey = 'products:' + JSON.stringify(params);
    const statsCached = acGet('stats');
    if (statsCached) updateProductsSubtitle(statsCached);

    const dataCached = !fresh && acGet(productsKey);
    if (dataCached) {
        paintProductsTable(dataCached, statsCached);
        // Stale-while-revalidate: cached rows paint instantly, then refresh
        // quietly so changes from another admin session still appear.
        setTimeout(async () => {
            try {
                const latest = await acFetch(
                    productsKey,
                    () => AdminAPI.products(params, { scope: 'products-list' }),
                    { fresh: true },
                );
                if (gen === _productsRenderGen) paintProductsTable(latest, statsCached);
            } catch (err) {
                if (err.name !== 'AbortError') console.error(err);
            }
        }, 0);
        return;
    }

    setProductsTableLoading(true);

    try {
        const fetches = [
            acFetch(productsKey, () => AdminAPI.products(params, { scope: 'products-list' }), { fresh }),
        ];
        if (!statsCached) {
            fetches.push(acFetch('stats', () => AdminAPI.stats(), { fresh }));
        }
        const results = await Promise.all(fetches);
        if (gen !== _productsRenderGen) return;

        const data = results[0];
        const stats = statsCached || results[1];
        if (stats) updateProductsSubtitle(stats, data);
        paintProductsTable(data, stats);
    } catch (e) {
        if (e.name === 'AbortError') return;
        UI.toast(e.message || 'Could not load products', 'error');
    }
}

function paintProductsTable(data, stats) {
    if (stats) updateProductsSubtitle(stats, data);
    const items = data.items || [];
    state.products.items = items;
    state.products.total = data.total_count;

    const tbody = document.querySelector('#products-table tbody');
    tbody.innerHTML = items.map(p => {
        const badges = [];
        if (p.isBestSeller) badges.push('Best');
        if (p.isNewArrival) badges.push('New');
        if (p.isHotOffer) badges.push('Hot');
        if (p.isExclusive) badges.push('Excl');
        if (p.isFeatured) badges.push('Feat');
        if (p.isWholesale) badges.push('Whsl');
        const inactiveClass = p.isActive === false ? ' adm-row-inactive' : '';
        return `<tr class="${inactiveClass.trim()}" data-id="${UI.esc(p.productId)}">
            <td><input type="checkbox" class="prod-cb" value="${UI.esc(p.productId)}" ${state.products.selected.has(p.productId) ? 'checked' : ''}></td>
            <td><img class="thumb" src="${UI.esc(p.primaryImageUrl || siteLogoUrl())}" alt="" loading="lazy"></td>
            <td><strong>${UI.esc(p.productName)}</strong><br><small style="color:#6b7a8d">${UI.esc(p.brand || '')}</small></td>
            <td>${UI.esc(p.categoryName)} › ${UI.esc(p.subCategoryName)}</td>
            <td>${p.discountPercent > 0 ? `<span class="badge badge--pink">-${p.discountPercent}%</span>` : '<span style="color:#9aa5b1">—</span>'}</td>
            <td>${UI.stockBadge(p.stockQuantity)}</td>
            <td><label class="toggle"><input type="checkbox" class="prod-active-toggle" data-id="${UI.esc(p.productId)}" ${p.isActive ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
            <td><div class="badge-chips">${badges.map(b => `<span class="badge-chip">${b}</span>`).join('')}</div></td>
            <td><div class="adm-table-actions">
                <button type="button" data-edit="${UI.esc(p.productId)}" title="Edit"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" data-dup="${UI.esc(p.productId)}" title="Duplicate"><i class="fa-solid fa-copy"></i></button>
                <button type="button" class="del" data-del="${UI.esc(p.productId)}" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`;
    }).join('') || '<tr><td colspan="9">No products found</td></tr>';

    bindProductTableEvents();
    bindProductTableHeaderSort();
    renderProductsPagination(data);
}

const PRODUCT_HEADER_SORT = {
    productName: ['name_asc', 'name_desc'],
    categoryName: ['category_asc', 'category_desc'],
    discountPercent: ['discount_desc', 'discount_asc'],
    stockQuantity: ['stock_desc', 'stock_asc'],
};

function bindProductTableHeaderSort() {
    const current = document.getElementById('products-sort-filter')?.value || 'none';
    document.querySelectorAll('#products-table th[data-sort]').forEach(th => {
        const key = th.dataset.sort;
        const options = PRODUCT_HEADER_SORT[key];
        if (!options) return;
        th.classList.add('sortable');
        th.classList.toggle('sort-asc', current === options[0]);
        th.classList.toggle('sort-desc', current === options[1]);
        th.onclick = () => {
            const sel = document.getElementById('products-sort-filter');
            const cur = sel.value;
            sel.value = cur === options[0] ? options[1] : options[0];
            state.products.page = 1;
            renderProducts();
        };
    });
}

function renderProductsPagination(data) {
    const el = document.getElementById('products-pagination');
    const start = (data.current_page - 1) * data.per_page + 1;
    const end = Math.min(data.current_page * data.per_page, data.total_count);
    const totalLabel = data.count_capped
        ? `${data.total_count.toLocaleString()}+`
        : data.total_count.toLocaleString();
    const cappedNote = data.count_capped
        ? ' <span class="adm-pagination-note">(search limited to first 500 matches — refine filters)</span>'
        : '';

    /* Update filter-card subheading */
    const showingEl = document.getElementById('products-filter-showing');
    if (showingEl) showingEl.textContent = `Showing ${start}–${end} of ${totalLabel} products`;

    el.innerHTML = `
        <span>Showing ${start}–${end} of ${totalLabel}${cappedNote}</span>
        <div style="display:flex;gap:12px;align-items:center">
            <select class="adm-select" id="products-per-page">
                <option value="25" ${state.products.perPage === 25 ? 'selected' : ''}>25 / page</option>
                <option value="50" ${state.products.perPage === 50 ? 'selected' : ''}>50 / page</option>
                <option value="100" ${state.products.perPage === 100 ? 'selected' : ''}>100 / page</option>
            </select>
            <div class="adm-pagination-btns">
                <button type="button" id="prod-prev" ${data.current_page <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
                <button type="button" class="active">${data.current_page}</button>
                <button type="button" id="prod-next" ${data.current_page >= data.total_pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
            </div>
        </div>`;
    document.getElementById('products-per-page').onchange = (e) => {
        state.products.perPage = parseInt(e.target.value, 10);
        state.products.page = 1;
        renderProducts();
    };
    const prevBtn = document.getElementById('prod-prev');
    const nextBtn = document.getElementById('prod-next');
    if (prevBtn) prevBtn.onclick = () => { state.products.page--; renderProducts({ fresh: true }); };
    if (nextBtn) nextBtn.onclick = () => { state.products.page++; renderProducts({ fresh: true }); };
}

function bindProductTableEvents() {
    document.querySelectorAll('.prod-cb').forEach(cb => {
        cb.onchange = () => {
            if (cb.checked) state.products.selected.add(cb.value);
            else state.products.selected.delete(cb.value);
            updateBulkBar();
        };
    });
    document.querySelectorAll('.prod-active-toggle').forEach(t => {
        t.onchange = async () => {
            const productId = t.dataset.id;
            const isActive = t.checked;
            try {
                await UI.withLoading(() => AdminAPI.updateProduct(productId, { is_active: isActive }));
                acClearProducts(); acDel('stats', 'dashboard', 'spotlight', 'discountedProducts');
                UI.toast(isActive ? 'Product activated' : 'Product deactivated');
                await renderProducts({ fresh: true });
            } catch (err) {
                t.checked = !isActive;
                UI.toast(err.message || 'Could not update product', 'error');
            }
        };
    });
    document.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => openProductPanel(b.dataset.edit); });
    document.querySelectorAll('[data-dup]').forEach(b => { b.onclick = () => duplicateProduct(b.dataset.dup); });
    document.querySelectorAll('[data-del]').forEach(b => {
        b.onclick = async () => {
            const productId = b.dataset.del;
            if (!await UI.confirm('Delete Product', 'Permanently delete this product from the database? This cannot be undone.')) return;
            try {
                await UI.withLoading(() => AdminAPI.deleteProduct(productId));
                acClearProducts(); acDel('stats', 'dashboard', 'spotlight', 'discountedProducts');
                state.products.items = state.products.items.filter(p => p.productId !== productId);
                state.products.selected.delete(productId);
                UI.toast('Product deleted');
                await renderProducts();
            } catch (err) {
                UI.toast(err.message || 'Could not delete product', 'error');
            }
        };
    });
}

function updateBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const n = state.products.selected.size;
    const onPage = document.querySelectorAll('.prod-cb').length;
    if (n) {
        bar.classList.remove('hidden');
        document.getElementById('bulk-count').textContent =
            `${n} selected on this page${onPage ? ` (${onPage} shown)` : ''}`;
    } else {
        bar.classList.add('hidden');
    }
}

function absImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
    return AdminAPI.url(url.startsWith('/') ? url : `/${url}`);
}

function clearProductImagesState() {
    state.productImages = [];
    state.pendingImageFiles.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    state.pendingImageFiles = [];
    state.pendingImageUrls = [];
    const fileInput = document.getElementById('pf-image-file');
    if (fileInput) fileInput.value = '';
    document.getElementById('pf-image-url').value = '';
    updateProductImagesSaveHint();
    renderProductImageGallery();
}

function setProductImages(images) {
    state.productImages = Array.isArray(images) ? images.map(img => ({ ...img })) : [];
    renderProductImageGallery();
}

function updateProductImagesSaveHint() {
    const hint = document.getElementById('pf-images-save-hint');
    if (!hint) return;
    const isNew = !state.editingProductId;
    const hasPending = state.pendingImageFiles.length > 0 || state.pendingImageUrls.length > 0;
    hint.classList.toggle('hidden', !isNew || !hasPending);
    if (!hint.classList.contains('hidden')) {
        hint.textContent = 'New product — pending images will upload when you click Save Product.';
    }
}

function renderProductImageGallery() {
    const gallery = document.getElementById('pf-image-gallery');
    if (!gallery) return;

    const savedHtml = state.productImages.map(img => `
        <div class="product-image-card ${img.isPrimary ? 'is-primary' : ''}" data-image-id="${img.id}">
            <img src="${UI.esc(absImageUrl(img.imageUrl))}" alt="${UI.esc(img.altText || 'Product image')}">
            <div class="product-image-card-actions">
                <button type="button" class="${img.isPrimary ? 'is-primary-btn' : ''}" data-set-primary="${img.id}" title="Set as primary">
                    <i class="fa-solid fa-star"></i>
                </button>
                <button type="button" class="del" data-del-image="${img.id}" title="Remove">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>`).join('');

    const pendingFilesHtml = state.pendingImageFiles.map((item, idx) => `
        <div class="product-image-card" data-pending-file="${idx}">
            <span class="product-image-pending">Pending</span>
            <img src="${UI.esc(item.previewUrl)}" alt="Pending upload">
            <div class="product-image-card-actions">
                <button type="button" class="del" data-rm-pending-file="${idx}" title="Remove">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>`).join('');

    const pendingUrlsHtml = state.pendingImageUrls.map((url, idx) => `
        <div class="product-image-card" data-pending-url="${idx}">
            <span class="product-image-pending">Pending URL</span>
            <img src="${UI.esc(absImageUrl(url))}" alt="Pending image URL">
            <div class="product-image-card-actions">
                <button type="button" class="del" data-rm-pending-url="${idx}" title="Remove">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>`).join('');

    gallery.innerHTML = savedHtml + pendingFilesHtml + pendingUrlsHtml;

    gallery.querySelectorAll('[data-set-primary]').forEach(btn => {
        btn.onclick = async () => {
            if (!state.editingProductId) return;
            await UI.withLoading(() => AdminAPI.setPrimaryProductImage(state.editingProductId, btn.dataset.setPrimary));
            state.productImages.forEach(img => { img.isPrimary = String(img.id) === btn.dataset.setPrimary; });
            renderProductImageGallery();
            acClearProducts(); acDel(`product:${state.editingProductId}`);
            UI.toast('Primary image updated');
        };
    });

    gallery.querySelectorAll('[data-del-image]').forEach(btn => {
        btn.onclick = async () => {
            if (!state.editingProductId) return;
            if (!await UI.confirm('Remove image', 'Delete this image from the product?')) return;
            await UI.withLoading(() => AdminAPI.deleteProductImage(state.editingProductId, btn.dataset.delImage));
            state.productImages = state.productImages.filter(img => String(img.id) !== btn.dataset.delImage);
            renderProductImageGallery();
            acClearProducts(); acDel(`product:${state.editingProductId}`);
            UI.toast('Image removed');
        };
    });

    gallery.querySelectorAll('[data-rm-pending-file]').forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.rmPendingFile, 10);
            const item = state.pendingImageFiles[idx];
            if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
            state.pendingImageFiles.splice(idx, 1);
            updateProductImagesSaveHint();
            renderProductImageGallery();
        };
    });

    gallery.querySelectorAll('[data-rm-pending-url]').forEach(btn => {
        btn.onclick = () => {
            state.pendingImageUrls.splice(parseInt(btn.dataset.rmPendingUrl, 10), 1);
            updateProductImagesSaveHint();
            renderProductImageGallery();
        };
    });
}

async function addProductImageFromUrl() {
    const url = document.getElementById('pf-image-url').value.trim();
    if (!url) {
        UI.toast('Enter an image URL', 'error');
        return;
    }
    if (state.editingProductId) {
        const img = await UI.withLoading(() => AdminAPI.addProductImageUrl(state.editingProductId, {
            image_url: url,
            is_primary: state.productImages.length === 0,
        }));
        state.productImages.push(img);
        if (img.isPrimary) state.productImages.forEach(i => { if (i.id !== img.id) i.isPrimary = false; });
        document.getElementById('pf-image-url').value = '';
        renderProductImageGallery();
        acClearProducts(); acDel(`product:${state.editingProductId}`);
        UI.toast('Image added');
    } else {
        state.pendingImageUrls.push(url);
        document.getElementById('pf-image-url').value = '';
        updateProductImagesSaveHint();
        renderProductImageGallery();
    }
}

async function handleProductImageFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('image/'));
    if (!files.length) {
        UI.toast('Please choose image files only', 'error');
        return;
    }
    if (state.editingProductId) {
        const res = await UI.withLoading(() => AdminAPI.uploadProductImages(
            state.editingProductId,
            files,
            state.productImages.length === 0,
        ));
        const added = res.items || [];
        if (added.some(i => i.isPrimary)) {
            state.productImages.forEach(i => { i.isPrimary = false; });
        }
        state.productImages.push(...added);
        document.getElementById('pf-image-file').value = '';
        renderProductImageGallery();
        acClearProducts(); acDel(`product:${state.editingProductId}`);
        UI.toast(added.length > 1 ? `${added.length} images uploaded` : 'Image uploaded');
    } else {
        files.forEach(file => {
            state.pendingImageFiles.push({ file, previewUrl: URL.createObjectURL(file) });
        });
        document.getElementById('pf-image-file').value = '';
        updateProductImagesSaveHint();
        renderProductImageGallery();
    }
}

async function uploadPendingProductImages(productId) {
    if (!productId) return;
    if (state.pendingImageFiles.length) {
        const res = await AdminAPI.uploadProductImages(
            productId,
            state.pendingImageFiles.map(item => item.file),
            state.productImages.length === 0,
        );
        state.pendingImageFiles.forEach(item => {
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        state.pendingImageFiles = [];
        const added = res.items || [];
        if (added.some(i => i.isPrimary)) state.productImages.forEach(i => { i.isPrimary = false; });
        state.productImages.push(...added);
    }
    for (const url of [...state.pendingImageUrls]) {
        const img = await AdminAPI.addProductImageUrl(productId, {
            image_url: url,
            is_primary: state.productImages.length === 0,
        });
        if (img.isPrimary) state.productImages.forEach(i => { i.isPrimary = false; });
        state.productImages.push(img);
    }
    state.pendingImageUrls = [];
    updateProductImagesSaveHint();
    renderProductImageGallery();
}

async function populateBrandList() {
    const list = document.getElementById('brand-list');
    if (!list || list.dataset.loaded) return;
    try {
        const brands = await acFetch('brands', () => AdminAPI.brands());
        list.innerHTML = brands.map(b => `<option value="${UI.esc(b)}">`).join('');
        list.dataset.loaded = '1';
    } catch (_) {}
}

async function populateKitchenCultureSelect(selected = '') {
    const sel = document.getElementById('pf-kitchen-culture');
    if (!sel) return;
    let options = [{ key: '', label: 'None' }];
    try {
        const rows = await acFetch('kitchenCultures', () => AdminAPI.kitchenCultures());
        if (Array.isArray(rows) && rows.length) options = [{ key: '', label: 'None' }, ...rows];
    } catch (_) {}
    sel.innerHTML = options.map(o =>
        `<option value="${UI.esc(o.key)}"${o.key === selected ? ' selected' : ''}>${UI.esc(o.label)}</option>`
    ).join('');
}

let _productPanelGen = 0;

async function openProductPanel(productId = null) {
    const gen = ++_productPanelGen;
    state.editingProductId = productId;
    document.getElementById('product-panel-title').textContent = productId ? 'Edit Product' : 'Add New Product';
    const modal = document.getElementById('product-modal');
    const saveBtn = document.getElementById('save-product-btn');
    const deleteBtn = document.getElementById('delete-product-btn');
    const catSel = document.getElementById('pf-category');

    document.querySelectorAll('#product-tabs .adm-tab').forEach((t, i) => {
        t.classList.toggle('active', i === 0);
    });
    ['details', 'pricing', 'images', 'visibility'].forEach((name, i) => {
        document.getElementById(`tab-${name}`).classList.toggle('hidden', i !== 0);
    });
    deleteBtn.style.display = productId ? '' : 'none';
    deleteBtn.onclick = productId ? () => confirmDeleteProduct(productId) : null;
    saveBtn.disabled = !!productId;

    if (productId) {
        const row = state.products.items.find(p => p.productId === productId);
        if (row) fillProductForm(row);
        else clearProductForm();
    } else {
        clearProductForm();
    }

    clearProductImagesState();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    let ready = false;
    try {
        const [categories, product] = await Promise.all([
            loadCategoriesCache(),
            productId
                ? acFetch(`product:${productId}`, () => AdminAPI.product(productId))
                : Promise.resolve(null),
            populateBrandList(),
            populateKitchenCultureSelect(),
        ]);
        if (gen !== _productPanelGen) return;

        catSel.innerHTML = categories.map(c =>
            `<option value="${c.category_id}">${UI.esc(c.category_name)}</option>`
        ).join('');
        catSel.onchange = () => populateSubcatSelect('pf-subcategory', catSel.value);

        if (product) {
            fillProductForm(product);
            setProductImages(product.images || []);
            document.getElementById('pf-kitchen-culture').value = product.kitchenCulture || '';
        } else if (!productId) {
            clearProductForm();
        }

        await populateSubcatSelect(
            'pf-subcategory',
            product?.categoryId || catSel.value,
            product?.subCategoryId,
        );
        ready = true;
    } catch (err) {
        if (gen === _productPanelGen) {
            UI.toast(err.message || 'Could not load product details', 'error');
        }
    } finally {
        if (gen === _productPanelGen) saveBtn.disabled = !ready;
    }
}

function closeProductModal() {
    _productPanelGen++;
    document.getElementById('product-modal').classList.add('hidden');
    document.body.style.overflow = '';
}

async function confirmDeleteProduct(productId) {
    const p = state.products.items.find(x => x.productId === productId);
    const name = p?.productName || productId;
    const yes = await UI.confirm(
        'Delete Product',
        `Permanently delete "${name}" from the database? This cannot be undone.`,
        { okLabel: 'Yes, Delete', okClass: 'adm-btn--danger' }
    );
    if (!yes) return;
    try {
        await UI.withLoading(() => AdminAPI.deleteProduct(productId));
        closeProductModal();
        acClearProducts(); acDel('stats', 'dashboard', 'spotlight', 'discountedProducts');
        state.products.items = state.products.items.filter(p => p.productId !== productId);
        state.products.selected.delete(productId);
        UI.toast('Product deleted');
        await renderProducts();
    } catch (err) {
        UI.toast(err.message || 'Could not delete product', 'error');
    }
}

function fillProductForm(p) {
    document.getElementById('pf-name').value = p.productName || '';
    document.getElementById('pf-brand').value = p.brand || '';
    document.getElementById('pf-category').value = p.categoryId || '';
    document.getElementById('pf-unit').value = p.unitLabel || p.packType || '';
    document.getElementById('pf-weight').value = p.weightKG ?? '';
    document.getElementById('pf-description').value = p.productDescription || '';
    document.getElementById('pf-discount').value = p.discountPercent ?? 0;
    document.getElementById('pf-stock').value = p.stockQuantity ?? 0;
    document.getElementById('pf-min-qty').value = p.minOrderQty ?? 1;
    document.getElementById('pf-wholesale').checked = !!p.isWholesale;
    document.getElementById('pf-active').checked = p.isActive !== false;
    document.getElementById('pf-featured').checked = !!p.isFeatured;
    document.getElementById('pf-best').checked = !!p.isBestSeller;
    document.getElementById('pf-new').checked = !!p.isNewArrival;
    document.getElementById('pf-hot').checked = !!p.isHotOffer;
    document.getElementById('pf-exclusive').checked = !!p.isExclusive;
    const kitchenSel = document.getElementById('pf-kitchen-culture');
    if (kitchenSel) kitchenSel.value = p.kitchenCulture || '';
    updateDiscountPreview();
}

function clearProductForm() {
    ['pf-name','pf-brand','pf-unit','pf-weight','pf-description','pf-discount','pf-stock'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('pf-min-qty').value = 1;
    document.getElementById('pf-discount').value = 0;
    ['pf-wholesale','pf-featured','pf-best','pf-new','pf-hot','pf-exclusive'].forEach(id => {
        document.getElementById(id).checked = false;
    });
    document.getElementById('pf-active').checked = true;
    const kitchenSel = document.getElementById('pf-kitchen-culture');
    if (kitchenSel) kitchenSel.value = '';
    clearProductImagesState();
}

async function populateSubcatSelect(selId, catId, selected) {
    if (!catId) {
        document.getElementById(selId).innerHTML = '';
        return;
    }
    const subs = await acFetch(
        `subcategories:${catId}`,
        () => AdminAPI.subcategories(catId),
    );
    const sel = document.getElementById(selId);
    sel.innerHTML = subs.map(s => `<option value="${s.subcategory_id}">${UI.esc(s.subcategory_name)}</option>`).join('');
    if (selected) sel.value = selected;
}

async function saveProduct() {
    const discountPct = Math.min(100, Math.max(0, parseInt(document.getElementById('pf-discount').value, 10) || 0));
    const body = {
        product_name: document.getElementById('pf-name').value.trim(),
        brand: document.getElementById('pf-brand').value.trim(),
        category_id: document.getElementById('pf-category').value,
        subcategory_id: document.getElementById('pf-subcategory').value,
        unit_label: document.getElementById('pf-unit').value.trim(),
        weight_kg: parseFloat(document.getElementById('pf-weight').value) || null,
        description: document.getElementById('pf-description').value.trim(),
        discount_percent: discountPct,
        stock_quantity: parseInt(document.getElementById('pf-stock').value, 10) || 0,
        min_order_qty: parseInt(document.getElementById('pf-min-qty').value, 10) || 1,
        is_wholesale: document.getElementById('pf-wholesale').checked,
        is_active: document.getElementById('pf-active').checked,
        is_featured: document.getElementById('pf-featured').checked,
        is_best_seller: document.getElementById('pf-best').checked,
        is_new_arrival: document.getElementById('pf-new').checked,
        is_hot_offer: discountPct > 0 || document.getElementById('pf-hot').checked,
        is_exclusive: document.getElementById('pf-exclusive').checked,
        kitchen_culture: document.getElementById('pf-kitchen-culture')?.value || null,
    };
    if (!body.product_name || !body.category_id || !body.subcategory_id) {
        UI.toast('Please fill required fields', 'error');
        return;
    }
    if (discountPct === 0) {
        body.compare_price = null;
    }
    let productId = state.editingProductId;
    const isNew = !productId;
    await UI.withLoading(async () => {
        if (productId) {
            await AdminAPI.updateProduct(productId, body);
        } else {
            productId = 'P' + Date.now().toString(36).toUpperCase();
            await AdminAPI.createProduct({ ...body, product_id: productId, selling_price: 0 });
            state.editingProductId = productId;
        }
        await uploadPendingProductImages(productId);
    });
    closeProductModal();
    acClearProducts(); acDel(`product:${productId}`, 'stats', 'dashboard', 'spotlight', 'discountedProducts');
    UI.toast(isNew ? 'Product created successfully' : 'Product updated successfully');
    if (state.section === 'spotlight') renderSpotlight({ fresh: true });
    else if (state.section === 'dashboard') renderDashboard();
    else renderProducts();
}

async function duplicateProduct(id) {
    try {
        const p = await UI.withLoading(() => AdminAPI.product(id));
        if (!p) return;
        state.editingProductId = null;
        await openProductPanel();
        fillProductForm({ ...p, productName: p.productName + ' (Copy)' });
    } catch (err) {
        UI.toast(err.message || 'Could not duplicate product', 'error');
    }
}

function updateDiscountPreview() {
    const pct = parseInt(document.getElementById('pf-discount').value, 10) || 0;
    const el = document.getElementById('pf-discount-preview');
    el.textContent = pct > 0 ? `-${pct}%` : '';
    el.style.display = pct > 0 ? 'inline-flex' : 'none';
}

function exportProductsCsv() {
    exportProductsCsvAsync().catch(err => UI.toast(err.message || 'Export failed', 'error'));
}

async function exportProductsCsvAsync() {
    const filterParams = getProductsFilterParams();
    const all = [];
    let page = 1;
    const per_page = 500;
    let totalExpected = null;

    await UI.withLoading(async () => {
        while (true) {
            const res = await AdminAPI.products(
                { ...filterParams, page, per_page },
                { cancelPrevious: false },
            );
            if (totalExpected === null) totalExpected = res.total_count;
            all.push(...(res.items || []));
            if (page >= res.total_pages) break;
            page++;
        }
    });

    const rows = [['Product ID', 'Name', 'Brand', 'Category', 'Subcategory', 'Discount %', 'Stock', 'Active']];
    all.forEach(p => {
        rows.push([
            p.productId,
            p.productName,
            p.brand,
            p.categoryName,
            p.subCategoryName,
            p.discountPercent || 0,
            p.stockQuantity,
            p.isActive,
        ]);
    });

    const suffix = filterParams.category_id ? '-filtered' : '';
    downloadCsv(rows, `products-export${suffix}.csv`);

    if (totalExpected != null && all.length < totalExpected) {
        UI.toast(`Exported ${all.length} of ${totalExpected}+ products (search capped at 500)`, 'error');
    } else {
        UI.toast(`Exported ${all.length} product${all.length === 1 ? '' : 's'}`);
    }
}

/* ── Categories ───────────────────────────────────────── */
async function renderCategories() {
    state.categories = acGet('categories') || await acFetch('categories', () => AdminAPI.categories());
    const list = document.getElementById('category-list');
    list.innerHTML = state.categories.map(c => `
        <div class="cat-card ${state.selectedCategoryId === c.category_id ? 'selected' : ''}" data-cat="${c.category_id}">
            <img src="${UI.esc(c.icon_image_url || siteLogoUrl())}" alt="">
            <div class="cat-card-info">
                <strong>${UI.esc(c.category_name)}</strong>
                <span class="badge badge--gray">${c.item_count} items</span>
            </div>
            <label class="toggle" onclick="event.stopPropagation()"><input type="checkbox" class="cat-toggle" data-id="${c.category_id}" ${c.is_active ? 'checked' : ''}><span class="toggle-slider"></span></label>
            <div class="cat-card-actions">
                <button type="button" class="adm-icon-btn" data-edit-cat="${c.category_id}" style="background:#f0f2f5;color:#333"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" class="adm-icon-btn" data-del-cat="${c.category_id}" style="background:#fef2f2;color:#dc2626"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`).join('');

    list.querySelectorAll('.cat-card').forEach(card => {
        card.onclick = () => { state.selectedCategoryId = card.dataset.cat; renderCategories(); renderSubcategories(); };
    });
    list.querySelectorAll('.cat-toggle').forEach(t => {
        t.onchange = async () => {
            await UI.withLoading(() => AdminAPI.updateCategory(t.dataset.id, { is_active: t.checked }));
            acDel('categories', 'stats');
            state.categories = [];
            UI.toast('Category updated');
            renderCategories();
        };
    });
    list.querySelectorAll('[data-edit-cat]').forEach(b => b.onclick = (e) => { e.stopPropagation(); openCategoryModal(b.dataset.editCat); });
    list.querySelectorAll('[data-del-cat]').forEach(b => b.onclick = async (e) => {
        e.stopPropagation();
        if (!await UI.confirm('Delete Category', 'Deactivate this category?')) return;
        await UI.withLoading(() => AdminAPI.deleteCategory(b.dataset.delCat));
        acDel('categories', 'stats'); state.categories = [];
        UI.toast('Category deactivated');
        renderCategories();
    });

    if (!state.selectedCategoryId && state.categories.length) state.selectedCategoryId = state.categories[0].category_id;
    renderSubcategories();
}

async function renderSubcategories() {
    const cat = state.categories.find(c => c.category_id === state.selectedCategoryId);
    document.getElementById('subcat-panel-title').textContent = cat ? `Subcategories in ${cat.category_name}` : 'Subcategories';
    if (!state.selectedCategoryId) return;
    const subs = await acFetch('subs:' + state.selectedCategoryId, () => AdminAPI.subcategories(state.selectedCategoryId));
    document.querySelector('#subcategories-table tbody').innerHTML = subs.map(s => `
        <tr>
            <td>${UI.esc(s.subcategory_name)}</td>
            <td>${UI.esc(s.slug)}</td>
            <td>${s.product_count}</td>
            <td><label class="toggle"><input type="checkbox" class="sub-toggle" data-id="${s.subcategory_id}" ${s.is_active ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
            <td><div class="adm-table-actions">
                <button type="button" data-edit-sub="${s.subcategory_id}"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" class="del" data-del-sub="${s.subcategory_id}"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`).join('') || '<tr><td colspan="5">No subcategories</td></tr>';

    document.querySelectorAll('.sub-toggle').forEach(t => {
        t.onchange = async () => {
            await UI.withLoading(() => AdminAPI.updateSubcategory(t.dataset.id, { is_active: t.checked }));
            acDel('categories', 'subs:' + state.selectedCategoryId);
            state.categories = [];
            UI.toast('Subcategory updated');
            renderSubcategories();
        };
    });

    document.querySelectorAll('[data-edit-sub]').forEach(b => {
        b.onclick = () => openSubcategoryModal(b.dataset.editSub, subs);
    });
    document.querySelectorAll('[data-del-sub]').forEach(b => {
        b.onclick = async () => {
            if (!await UI.confirm('Delete Subcategory', 'Deactivate this subcategory?')) return;
            await UI.withLoading(() => AdminAPI.deleteSubcategory(b.dataset.delSub));
            acDel('categories', 'subs:' + state.selectedCategoryId);
            state.categories = [];
            UI.toast('Subcategory deactivated');
            renderSubcategories();
        };
    });
}

function openCategoryModal(catId = null) {
    const cat = state.categories.find(c => c.category_id === catId);
    document.getElementById('generic-modal-title').textContent = cat ? 'Edit Category' : 'Add Category';
    document.getElementById('generic-modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-field"><label>Category ID</label><input class="adm-input" id="m-cat-id" value="${cat?.category_id || ''}" ${cat ? 'readonly' : ''}></div>
            <div class="form-field"><label>Name</label><input class="adm-input" id="m-cat-name" value="${UI.esc(cat?.category_name || '')}"></div>
            <div class="form-field"><label>Slug</label><input class="adm-input" id="m-cat-slug" value="${UI.esc(cat?.slug || '')}"></div>
            <div class="form-field"><label>Description</label><textarea class="adm-textarea" id="m-cat-desc">${UI.esc(cat?.description || '')}</textarea></div>
            <div class="form-field"><label>Icon Image URL (200×200)</label><input class="adm-input" id="m-cat-icon" value="${UI.esc(cat?.icon_image_url || '')}"></div>
            <div class="form-field"><label>Banner Image URL (800×500)</label><input class="adm-input" id="m-cat-banner" value="${UI.esc(cat?.banner_image_url || '')}"></div>
            <div class="form-field"><label>Display Order</label><input type="number" class="adm-input" id="m-cat-order" value="${cat?.display_order ?? 0}"></div>
            <div class="form-field"><label>Active</label><label class="toggle"><input type="checkbox" id="m-cat-active" ${cat?.is_active !== false ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
        </div>`;
    document.getElementById('generic-modal').classList.remove('hidden');
    document.getElementById('generic-modal-save').onclick = async () => {
        const body = {
            category_id: document.getElementById('m-cat-id').value.trim(),
            category_name: document.getElementById('m-cat-name').value.trim(),
            slug: document.getElementById('m-cat-slug').value.trim(),
            description: document.getElementById('m-cat-desc').value.trim(),
            icon_image_url: document.getElementById('m-cat-icon').value.trim(),
            banner_image_url: document.getElementById('m-cat-banner').value.trim(),
            display_order: parseInt(document.getElementById('m-cat-order').value, 10) || 0,
            is_active: document.getElementById('m-cat-active').checked,
        };
        await UI.withLoading(() => cat ? AdminAPI.updateCategory(cat.category_id, body) : AdminAPI.createCategory(body));
        closeGenericModal();
        acDel('categories', 'stats'); state.categories = [];
        UI.toast('Category saved');
        renderCategories();
    };
}

function openSubcategoryModal(subId = null, subs = []) {
    const sub = subId ? subs.find(s => String(s.subcategory_id) === String(subId)) : null;
    document.getElementById('generic-modal-title').textContent = sub ? 'Edit Subcategory' : 'Add Subcategory';
    document.getElementById('generic-modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-field"><label>Subcategory ID</label><input class="adm-input" id="m-sub-id" value="${UI.esc(sub?.subcategory_id || '')}" ${sub ? 'readonly' : ''}></div>
            <div class="form-field"><label>Name</label><input class="adm-input" id="m-sub-name" value="${UI.esc(sub?.subcategory_name || '')}"></div>
            <div class="form-field"><label>Slug</label><input class="adm-input" id="m-sub-slug" value="${UI.esc(sub?.slug || '')}"></div>
            <div class="form-field"><label>Description</label><textarea class="adm-textarea" id="m-sub-desc">${UI.esc(sub?.description || '')}</textarea></div>
            <div class="form-field"><label>Active</label><label class="toggle"><input type="checkbox" id="m-sub-active" ${sub?.is_active !== false ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
        </div>`;
    document.getElementById('generic-modal').classList.remove('hidden');
    document.getElementById('generic-modal-save').style.display = '';
    document.getElementById('generic-modal-save').onclick = async () => {
        const body = {
            subcategory_id: document.getElementById('m-sub-id').value.trim(),
            category_id: state.selectedCategoryId,
            subcategory_name: document.getElementById('m-sub-name').value.trim(),
            slug: document.getElementById('m-sub-slug').value.trim(),
            description: document.getElementById('m-sub-desc').value.trim(),
            is_active: document.getElementById('m-sub-active').checked,
        };
        if (!body.subcategory_id || !body.subcategory_name) {
            UI.toast('ID and name are required', 'error');
            return;
        }
        await UI.withLoading(() => sub
            ? AdminAPI.updateSubcategory(sub.subcategory_id, body)
            : AdminAPI.createSubcategory(body));
        closeGenericModal();
        acDel('categories', 'subs:' + state.selectedCategoryId);
        state.categories = [];
        UI.toast(sub ? 'Subcategory updated' : 'Subcategory created');
        renderSubcategories();
    };
}

/* ── Banners ────────────────────────────────────────────── */
const BANNER_CLICK_DESTINATIONS = [
    { key: 'featured', label: 'Featured products' },
    { key: 'bestSellers', label: 'Best Sellers' },
    { key: 'newArrivals', label: 'New Arrivals' },
    { key: 'hotOffers', label: 'Hot Offers' },
    { key: 'exclusive', label: 'Exclusive products' },
];

const BANNER_LINK_SPOTLIGHT_OPTIONS = BANNER_CLICK_DESTINATIONS;

const BANNER_SPOTLIGHT_LINK_KEYS = new Set(BANNER_LINK_SPOTLIGHT_OPTIONS.map(s => s.key));

function isBannerSpotlightLinkType(type) {
    return BANNER_SPOTLIGHT_LINK_KEYS.has(type);
}

function getBannerLinkTypeSelectValue(parsed) {
    if (parsed.type === 'spotlight' && parsed.spotlight) return parsed.spotlight;
    return parsed.type;
}

function resolveBannerLinkUrl(linkType, fields) {
    if (isBannerSpotlightLinkType(linkType)) {
        return buildBannerLinkUrl('spotlight', { spotlight: linkType });
    }
    return buildBannerLinkUrl(linkType, fields);
}

function parseBannerLink(linkUrl) {
    if (!linkUrl || !String(linkUrl).trim()) return { type: 'auto' };
    const raw = String(linkUrl).trim();
    try {
        const base = raw.startsWith('http') ? raw : `http://local/${raw.replace(/^\//, '')}`;
        const url = new URL(base);
        const section = url.searchParams.get('section');
        if (section) return { type: 'spotlight', spotlight: section };
        const sub = url.searchParams.get('subcategory');
        if (sub) {
            return {
                type: 'subcategory',
                subcategory: sub,
                category: url.searchParams.get('category') || '',
            };
        }
        const cat = url.searchParams.get('category');
        if (cat) return { type: 'category', category: cat };
        if (raw.includes('products.html')) return { type: 'custom', custom: raw };
    } catch (_) { /* fall through */ }
    return { type: 'custom', custom: raw };
}

function buildBannerLinkUrl(type, { category, subcategory, spotlight, custom }) {
    switch (type) {
        case 'category':
            return category ? `products.html?category=${encodeURIComponent(category)}` : '';
        case 'subcategory':
            return subcategory ? `products.html?subcategory=${encodeURIComponent(subcategory)}` : '';
        case 'spotlight':
            return spotlight ? `products.html?section=${encodeURIComponent(spotlight)}` : '';
        case 'custom':
            return (custom || '').trim();
        case 'auto':
        default:
            return '';
    }
}

function formatBannerLinkLabel(linkUrl) {
    const parsed = parseBannerLink(linkUrl);
    if (parsed.type === 'auto') return 'Auto · category by slide order';
    if (parsed.type === 'category') return `Category · ${parsed.category}`;
    if (parsed.type === 'subcategory') return `Subcategory · ${parsed.subcategory}`;
    if (parsed.type === 'spotlight') {
        const match = BANNER_LINK_SPOTLIGHT_OPTIONS.find(s => s.key === parsed.spotlight);
        return `Spotlight · ${match?.label || parsed.spotlight}`;
    }
    return parsed.custom ? `Custom · ${parsed.custom}` : 'No link';
}

async function loadBannerSubcategoryOptions(categoryId, selectedSubName = '') {
    const sel = document.getElementById('m-ban-subcategory');
    if (!sel) return;
    if (!categoryId) {
        sel.innerHTML = '<option value="">Select category first</option>';
        sel.disabled = true;
        return;
    }
    const subs = await acFetch(
        `subcategories:${categoryId || 'all'}`,
        () => AdminAPI.subcategories(categoryId),
    );
    sel.disabled = false;
    sel.innerHTML = '<option value="">Select subcategory…</option>' + subs.map(s =>
        `<option value="${UI.esc(s.subcategory_name)}"${s.subcategory_name === selectedSubName ? ' selected' : ''}>${UI.esc(s.subcategory_name)}</option>`
    ).join('');
}

function bindBannerLinkForm() {
    const typeSel = document.getElementById('m-ban-link-type');
    const catSel = document.getElementById('m-ban-category');
    const subPanel = document.getElementById('m-ban-subcategory-panel');
    const catPanel = document.getElementById('m-ban-category-panel');
    const customPanel = document.getElementById('m-ban-custom-panel');

    const syncPanels = () => {
        const t = typeSel.value;
        catPanel?.classList.toggle('is-visible', t === 'category' || t === 'subcategory');
        subPanel?.classList.toggle('is-visible', t === 'subcategory');
        customPanel?.classList.toggle('is-visible', t === 'custom');
    };

    typeSel.onchange = syncPanels;
    catSel.onchange = async () => {
        if (typeSel.value === 'subcategory') {
            await loadBannerSubcategoryOptions(catSel.value);
        }
    };
    syncPanels();
}

function updateBannerImagePreview(url) {
    const el = document.getElementById('m-ban-image-preview');
    if (!el) return;
    if (!url) {
        el.innerHTML = '';
        el.classList.add('hidden');
        return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<img src="${UI.esc(absImageUrl(url))}" alt="Banner preview">`;
}

function bindBannerImageUpload() {
    const fileInput = document.getElementById('m-ban-image-file');
    const uploadBtn = document.getElementById('m-ban-image-upload-btn');
    const urlInput = document.getElementById('m-ban-img');
    if (!fileInput || !uploadBtn || !urlInput) return;

    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        try {
            const res = await UI.withLoading(() => AdminAPI.uploadBannerImage(file));
            const imageUrl = res.imageUrl || res.url || '';
            if (!imageUrl) throw new Error('Upload did not return an image URL');
            urlInput.value = imageUrl;
            updateBannerImagePreview(imageUrl);
            UI.toast('Banner image uploaded');
        } catch (err) {
            console.error(err);
            UI.toast(err.message || 'Image upload failed', 'error');
        }
    };
    urlInput.oninput = () => updateBannerImagePreview(urlInput.value.trim());
}

async function renderBanners({ fresh = false } = {}) {
    const scrollActive = document.getElementById('banner-scroll-active');
    const scrollInactive = document.getElementById('banner-scroll-inactive');
    const cached = !fresh ? acGet('banners') : null;
    if (cached) {
        paintBanners(cached);
        acRevalidate('banners', () => AdminAPI.banners(), paintBanners, {
            isStale: () => state.section !== 'banners',
        });
        return cached;
    }
    if (scrollActive && !scrollActive.querySelector('.banner-card, p')) {
        scrollActive.innerHTML = sectionSpinner();
    }
    if (scrollInactive && !scrollInactive.querySelector('.banner-card, p')) {
        scrollInactive.innerHTML = sectionSpinner();
    }
    const banners = await acFetch('banners', () => AdminAPI.banners(), { fresh });
    paintBanners(banners);
    return banners;
}

function bannerCardHtml(b, position) {
    const pos = (b.position ?? b.display_order ?? position) + 1;
    const canLeft = b.can_move_left !== false && position > 0;
    const canRight = b.can_move_right !== false;
    return `
        <div class="banner-card" style="background-image:url('${UI.cssUrl(b.image_url)}')">
            <div class="banner-card-order">
                <button type="button" class="adm-icon-btn banner-move-btn" data-move-banner="${b.id}" data-dir="left" title="Move earlier" ${canLeft ? '' : 'disabled'}><i class="fa-solid fa-chevron-left"></i></button>
                <span class="banner-card-pos">${pos}</span>
                <button type="button" class="adm-icon-btn banner-move-btn" data-move-banner="${b.id}" data-dir="right" title="Move later" ${canRight ? '' : 'disabled'}><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <div class="banner-card-overlay">
                <strong>${UI.esc(b.title)}</strong>
                <small>${UI.esc(b.subtitle || '')}</small>
                <span class="banner-card-dest">${UI.esc(formatBannerLinkLabel(b.link_url))}</span>
            </div>
            <div class="banner-card-actions">
                <button type="button" class="adm-icon-btn" data-edit-banner="${b.id}" style="background:rgba(255,255,255,.9);color:#333"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" class="adm-icon-btn" data-del-banner="${b.id}" style="background:rgba(255,255,255,.9);color:#dc2626"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;
}

function bindBannerCardActions(banners) {
    document.querySelectorAll('[data-edit-banner]').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            try {
                const list = acGet('banners') || banners || await acFetch('banners', () => AdminAPI.banners());
                await openBannerModal(Number(btn.dataset.editBanner), list || []);
            } catch (err) {
                console.error(err);
                UI.toast(err.message || 'Could not open banner editor', 'error');
            }
        };
    });
    document.querySelectorAll('[data-del-banner]').forEach(btn => btn.onclick = async () => {
        if (!await UI.confirm('Delete Banner', 'Permanently delete this banner?')) return;
        await UI.withLoading(() => AdminAPI.deleteBanner(btn.dataset.delBanner));
        acDel('banners');
        UI.toast('Banner removed');
        renderBanners({ fresh: true });
    });
    document.querySelectorAll('[data-move-banner]').forEach(btn => btn.onclick = async (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        try {
            await UI.withLoading(() => AdminAPI.moveBanner(btn.dataset.moveBanner, btn.dataset.dir));
            acDel('banners');
            UI.toast('Banner order updated');
            renderBanners({ fresh: true });
        } catch (err) {
            UI.toast(err.message || 'Could not reorder banner', 'error');
        }
    });
}

function paintBanners(banners) {
    const scrollActive = document.getElementById('banner-scroll-active');
    const scrollInactive = document.getElementById('banner-scroll-inactive');
    if (!scrollActive || !scrollInactive) return;

    const active = (banners || []).filter(b => b.is_active !== false);
    const inactive = (banners || []).filter(b => b.is_active === false);

    scrollActive.innerHTML = active.length
        ? active.map((b, i) => bannerCardHtml(b, i)).join('')
        : '<p class="banner-row-empty">No active banners. Turn Active on in a banner or add a new slide.</p>';
    scrollInactive.innerHTML = inactive.length
        ? inactive.map((b, i) => bannerCardHtml(b, i)).join('')
        : '<p class="banner-row-empty">No inactive banners.</p>';

    bindBannerCardActions(banners);
}

async function openBannerModal(id = null, banners = []) {
    const b = id != null ? banners.find(x => x.id == id) : null;
    const activeCount = (banners || []).filter(x => x.is_active !== false).length;
    const categories = state.categories.length
        ? state.categories
        : await acFetch('categories', () => AdminAPI.categories());
    state.categories = categories;
    const allSubcategories = await acFetch('subs:all', () => AdminAPI.subcategories());
    const parsed = parseBannerLink(b?.link_url || '');
    const linkTypeValue = getBannerLinkTypeSelectValue(parsed);

    const categoryOptions = categories.map(c =>
        `<option value="${UI.esc(c.category_id)}">${UI.esc(c.category_name)}</option>`
    ).join('');
    const spotlightDestinationOptions = BANNER_LINK_SPOTLIGHT_OPTIONS.map(s =>
        `<option value="${UI.esc(s.key)}"${linkTypeValue === s.key ? ' selected' : ''}>${UI.esc(s.label)}</option>`
    ).join('');

    document.getElementById('generic-modal-title').textContent = b ? 'Edit Hero Banner' : 'Add Hero Banner';
    document.getElementById('generic-modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-field form-field--full"><label>Title</label><input class="adm-input" id="m-ban-title" value="${UI.esc(b?.title || '')}"></div>
            <div class="form-field form-field--full"><label>Subtitle</label><input class="adm-input" id="m-ban-sub" value="${UI.esc(b?.subtitle || '')}"></div>
            <div class="form-field form-field--full">
                <label>Upload from computer</label>
                <div class="image-upload-row">
                    <input type="file" id="m-ban-image-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
                    <button type="button" class="adm-btn adm-btn--outline" id="m-ban-image-upload-btn">
                        <i class="fa-solid fa-upload"></i> Choose file
                    </button>
                    <span class="form-hint" style="margin:0">JPG, PNG, WebP or GIF</span>
                </div>
            </div>
            <div class="form-field form-field--full">
                <label for="m-ban-img">Or paste image URL</label>
                <input class="adm-input" id="m-ban-img" placeholder="assets/promotion-banners/banner.png" value="${UI.esc(b?.image_url || '')}">
                <p class="form-hint">Recommended 1920×600. Uploads are stored on Cloudinary.</p>
            </div>
            <div id="m-ban-image-preview" class="banner-image-preview${b?.image_url ? '' : ' hidden'}">
                ${b?.image_url ? `<img src="${UI.esc(absImageUrl(b.image_url))}" alt="Banner preview">` : ''}
            </div>
            <div class="form-field form-field--full">
                <label>Click destination</label>
                <select class="adm-select" id="m-ban-link-type">
                    <option value="auto"${linkTypeValue === 'auto' ? ' selected' : ''}>Auto — category by slide order</option>
                    <option value="category"${linkTypeValue === 'category' ? ' selected' : ''}>Category</option>
                    <option value="subcategory"${linkTypeValue === 'subcategory' ? ' selected' : ''}>Subcategory</option>
                    ${spotlightDestinationOptions}
                    <option value="custom"${linkTypeValue === 'custom' ? ' selected' : ''}>Custom URL</option>
                </select>
            </div>
            <div class="form-field form-field--full banner-link-panel" id="m-ban-category-panel">
                <label>Category</label>
                <select class="adm-select" id="m-ban-category">
                    <option value="">Select category…</option>
                    ${categoryOptions}
                </select>
            </div>
            <div class="form-field form-field--full banner-link-panel" id="m-ban-subcategory-panel">
                <label>Subcategory</label>
                <select class="adm-select" id="m-ban-subcategory" disabled>
                    <option value="">Select category first</option>
                </select>
            </div>
            <div class="form-field form-field--full banner-link-panel" id="m-ban-custom-panel">
                <label>Custom link URL</label>
                <input class="adm-input" id="m-ban-custom" placeholder="products.html or full URL" value="${UI.esc(parsed.custom || '')}">
            </div>
            <div class="form-field"><label>Display order [No of banners (Active) : ${activeCount}]</label><input type="number" class="adm-input" id="m-ban-order" min="0" value="${b?.display_order ?? activeCount}"></div>
        </div>`;

    document.getElementById('generic-modal').classList.remove('hidden');
    document.getElementById('generic-modal-save').style.display = '';

    /* Active toggle in header */
    const activeWrap = document.getElementById('generic-modal-active-wrap');
    const activeChk = document.getElementById('m-ban-active');
    const activeState = document.getElementById('generic-modal-active-state');
    activeWrap.classList.remove('hidden');
    activeChk.checked = b?.is_active !== false;
    activeState.textContent = activeChk.checked ? 'Active' : 'Inactive';
    activeState.className = 'modal-active-label ' + (activeChk.checked ? 'modal-active-label--on' : 'modal-active-label--off');
    activeChk.onchange = () => {
        activeState.textContent = activeChk.checked ? 'Active' : 'Inactive';
        activeState.className = 'modal-active-label ' + (activeChk.checked ? 'modal-active-label--on' : 'modal-active-label--off');
    };

    /* Show delete button only when editing an existing banner */
    const deleteBtn = document.getElementById('generic-modal-delete');
    if (b) {
        deleteBtn.classList.remove('hidden');
        deleteBtn.onclick = async () => {
            if (!confirm(`Delete this banner? This cannot be undone.`)) return;
            await UI.withLoading(() => AdminAPI.deleteBanner(b.id));
            closeGenericModal();
            acDel('banners');
            UI.toast('Banner deleted');
            renderBanners({ fresh: true });
        };
    } else {
        deleteBtn.classList.add('hidden');
        deleteBtn.onclick = null;
    }

    bindBannerLinkForm();
    bindBannerImageUpload();

    /* Wire save onclick immediately so it works even if pre-fill awaits are slow */
    document.getElementById('generic-modal-save').onclick = async () => {
        const linkType = document.getElementById('m-ban-link-type').value;
        const catSelEl = document.getElementById('m-ban-category');
        const categoryName = catSelEl.selectedIndex > 0
            ? catSelEl.options[catSelEl.selectedIndex].text
            : '';
        const body = {
            title: document.getElementById('m-ban-title').value.trim(),
            subtitle: document.getElementById('m-ban-sub').value.trim(),
            image_url: document.getElementById('m-ban-img').value.trim(),
            link_url: resolveBannerLinkUrl(linkType, {
                category: categoryName,
                subcategory: document.getElementById('m-ban-subcategory').value,
                custom: document.getElementById('m-ban-custom').value,
            }),
            display_order: parseInt(document.getElementById('m-ban-order').value, 10) || 0,
            is_active: document.getElementById('m-ban-active').checked,
        };
        if (!body.image_url) { UI.toast('Banner image is required — upload a file or paste a URL', 'error'); return; }
        if (linkType === 'category' && !categoryName) { UI.toast('Select a category', 'error'); return; }
        if (linkType === 'subcategory' && !body.link_url) { UI.toast('Select a subcategory', 'error'); return; }

        await UI.withLoading(() => b ? AdminAPI.updateBanner(b.id, body) : AdminAPI.createBanner(body));
        closeGenericModal();
        acDel('banners');
        UI.toast('Banner saved');
        renderBanners({ fresh: true });
    };

    /* Pre-fill dropdowns (async, happens after onclick is already wired) */
    const catSel = document.getElementById('m-ban-category');
    if (parsed.type === 'subcategory' && parsed.subcategory) {
        const match = allSubcategories.find(s => s.subcategory_name === parsed.subcategory);
        if (match) {
            catSel.value = match.category_id;
            await loadBannerSubcategoryOptions(match.category_id, parsed.subcategory);
        }
    } else if (parsed.type === 'category' && parsed.category) {
        const cat = categories.find(c => c.category_name === parsed.category);
        if (cat) catSel.value = cat.category_id;
    }
}

/* ── Cultures ───────────────────────────────────────────── */
function formatCultureLinkLabel(linkUrl) {
    const url = (linkUrl || '').trim();
    if (!url || url === 'products.html') return 'Products page';
    return url.length > 40 ? `${url.slice(0, 37)}…` : url;
}

function updateCultureImagePreview(url) {
    const el = document.getElementById('m-cul-image-preview');
    if (!el) return;
    if (!url) {
        el.innerHTML = '';
        el.classList.add('hidden');
        return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<img src="${UI.esc(absImageUrl(url))}" alt="Culture banner preview">`;
}

function bindCultureImageUpload() {
    const fileInput = document.getElementById('m-cul-image-file');
    const uploadBtn = document.getElementById('m-cul-image-upload-btn');
    const urlInput  = document.getElementById('m-cul-img');
    if (!fileInput || !uploadBtn || !urlInput) return;

    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        try {
            const res = await UI.withLoading(() => AdminAPI.uploadCultureImage(file));
            const imageUrl = res.imageUrl || res.url || '';
            if (!imageUrl) throw new Error('Upload did not return an image URL');
            urlInput.value = imageUrl;
            updateCultureImagePreview(imageUrl);
            UI.toast('Culture banner uploaded');
        } catch (err) {
            UI.toast(err.message || 'Image upload failed', 'error');
        }
    };
    urlInput.oninput = () => updateCultureImagePreview(urlInput.value.trim());
}

async function renderCultures({ fresh = false } = {}) {
    const scrollActive = document.getElementById('culture-scroll-active');
    const scrollInactive = document.getElementById('culture-scroll-inactive');
    const cached = !fresh ? acGet('cultures') : null;
    if (cached) {
        paintCultures(cached);
        acRevalidate('cultures', () => AdminAPI.cultures(), paintCultures, {
            isStale: () => state.section !== 'cultures',
        });
        return cached;
    }
    if (scrollActive && !scrollActive.querySelector('.banner-card, p')) {
        scrollActive.innerHTML = sectionSpinner();
    }
    if (scrollInactive && !scrollInactive.querySelector('.banner-card, p')) {
        scrollInactive.innerHTML = sectionSpinner();
    }
    const cultures = await acFetch('cultures', () => AdminAPI.cultures(), { fresh });
    paintCultures(cultures);
    return cultures;
}

function cultureCardHtml(c, position) {
    const pos = (c.position ?? c.display_order ?? position) + 1;
    const canLeft = c.can_move_left !== false && position > 0;
    const canRight = c.can_move_right !== false;
    return `
        <div class="banner-card" style="background-image:url('${UI.cssUrl(c.image_url)}')">
            <div class="banner-card-order">
                <button type="button" class="adm-icon-btn banner-move-btn" data-move-culture="${c.id}" data-dir="left" title="Move earlier" ${canLeft ? '' : 'disabled'}><i class="fa-solid fa-chevron-left"></i></button>
                <span class="banner-card-pos">${pos}</span>
                <button type="button" class="adm-icon-btn banner-move-btn" data-move-culture="${c.id}" data-dir="right" title="Move later" ${canRight ? '' : 'disabled'}><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <div class="banner-card-overlay">
                <strong>${UI.esc(c.title)}</strong>
                <span class="banner-card-dest">${UI.esc(formatCultureLinkLabel(c.link_url))}</span>
            </div>
            <div class="banner-card-actions">
                <button type="button" class="adm-icon-btn" data-edit-culture="${c.id}" style="background:rgba(255,255,255,.9);color:#333"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" class="adm-icon-btn" data-del-culture="${c.id}" style="background:rgba(255,255,255,.9);color:#dc2626"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;
}

function bindCultureCardActions(cultures) {
    document.querySelectorAll('[data-edit-culture]').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            try {
                const list = acGet('cultures') || cultures || await acFetch('cultures', () => AdminAPI.cultures());
                await openCultureModal(Number(btn.dataset.editCulture), list || []);
            } catch (err) {
                console.error(err);
                UI.toast(err.message || 'Could not open culture editor', 'error');
            }
        };
    });
    document.querySelectorAll('[data-del-culture]').forEach(btn => btn.onclick = async () => {
        if (!await UI.confirm('Delete Culture Banner', 'Permanently delete this culture banner?')) return;
        await UI.withLoading(() => AdminAPI.deleteCulture(btn.dataset.delCulture));
        acDel('cultures');
        UI.toast('Culture banner removed');
        renderCultures({ fresh: true });
    });
    document.querySelectorAll('[data-move-culture]').forEach(btn => btn.onclick = async (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        try {
            await UI.withLoading(() => AdminAPI.moveCulture(btn.dataset.moveCulture, btn.dataset.dir));
            acDel('cultures');
            UI.toast('Culture order updated');
            renderCultures({ fresh: true });
        } catch (err) {
            UI.toast(err.message || 'Could not reorder culture banner', 'error');
        }
    });
}

function paintCultures(cultures) {
    const scrollActive = document.getElementById('culture-scroll-active');
    const scrollInactive = document.getElementById('culture-scroll-inactive');
    if (!scrollActive || !scrollInactive) return;

    const active = (cultures || []).filter(c => c.is_active !== false);
    const inactive = (cultures || []).filter(c => c.is_active === false);

    scrollActive.innerHTML = active.length
        ? active.map((c, i) => cultureCardHtml(c, i)).join('')
        : '<p class="banner-row-empty">No active culture banners. Turn Active on or add a new banner.</p>';
    scrollInactive.innerHTML = inactive.length
        ? inactive.map((c, i) => cultureCardHtml(c, i)).join('')
        : '<p class="banner-row-empty">No inactive culture banners.</p>';

    bindCultureCardActions(cultures);
}

/* ── Culture Modal (tabbed) ──────────────────────────────── */
let _cultureModalCultureId = null;
let _cultureModalKitchenCultures = [];

function _closeCultureModal() {
    document.getElementById('culture-modal').classList.add('hidden');
    _cultureModalCultureId = null;
    // Reset to first tab
    document.querySelectorAll('#culture-tabs .adm-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    document.getElementById('ctab-products').classList.remove('hidden');
    document.getElementById('ctab-image').classList.add('hidden');
}

function _switchCultureTab(key) {
    document.querySelectorAll('#culture-tabs .adm-tab').forEach(t => t.classList.toggle('active', t.dataset.ctab === key));
    document.getElementById('ctab-products').classList.toggle('hidden', key !== 'products');
    document.getElementById('ctab-image').classList.toggle('hidden', key !== 'image');
    if (key === 'products') _loadCultureProducts();
}

async function _loadCultureProducts() {
    const tbody = document.getElementById('culture-products-tbody');
    if (!tbody) return;
    const keySelect = document.getElementById('m-cul-kitchen-key');
    const key = keySelect?.value || '';
    const hint = document.getElementById('culture-products-hint');

    if (!key) {
        tbody.innerHTML = `<tr><td colspan="4" class="adm-empty">Select a Kitchen Culture in the "Culture Image" tab to view products.</td></tr>`;
        if (hint) hint.textContent = 'Select a Kitchen Culture to see associated products.';
        return;
    }
    const label = _cultureModalKitchenCultures.find(k => k.key === key)?.label || key;
    if (hint) hint.textContent = `Products assigned to "${label}" — shown on the Products page culture filter.`;
    tbody.innerHTML = `<tr><td colspan="4" class="adm-table-loading">${sectionSpinner()}</td></tr>`;

    try {
        const data = await AdminAPI.products({ kitchen_culture: key, per_page: 500, active_filter: 'all' });
        const items = data.items || [];
        _renderCultureProductTable(tbody, items, key);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="4" class="adm-empty">Failed to load products.</td></tr>`;
    }
}

function _renderCultureProductTable(tbody, items, key) {
    if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="adm-empty">No products assigned to this culture yet. Use the search above to add products.</td></tr>`;
        return;
    }
    tbody.innerHTML = items.map(p => {
        const name = p.product_name || p.productName || '';
        const cat = p.category_name || p.categoryName || '';
        const sub = p.subcategory_name || p.subCategoryName || '';
        const img = absImageUrl(p.primary_image_url || p.primaryImageUrl || siteLogoUrl());
        const pId = p.product_id || p.productId || '';
        return `<tr>
            <td class="spotlight-col-thumb"><img class="thumb" src="${UI.esc(img)}" alt=""></td>
            <td><strong>${UI.esc(name)}</strong><br><small style="color:#6b7a8d">${UI.esc(pId)}</small></td>
            <td><small>${UI.esc(cat)}${sub ? ' › ' + sub : ''}</small></td>
            <td><div class="adm-table-actions">
                <button type="button" class="adm-icon-btn" title="Edit product" onclick="_cultureEditProduct('${UI.esc(pId)}')"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" class="adm-icon-btn adm-icon-btn--danger" title="Remove from culture" onclick="_cultureRemoveProduct('${UI.esc(pId)}')"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`;
    }).join('');
    _bindCultureProductSearch(key);
}

async function _cultureEditProduct(productId) {
    _closeCultureModal();
    await openProductPanel(productId);
}

async function _cultureRemoveProduct(productId) {
    if (!confirm(`Remove this product from the culture filter?`)) return;
    try {
        await UI.withLoading(() => AdminAPI.updateProduct(productId, { kitchen_culture: '' }));
        acDel('products:page:0', 'products:all');
        UI.toast('Product removed from culture');
        await _loadCultureProducts();
    } catch(e) { UI.toast('Failed to remove product', 'error'); }
}

function _bindCultureProductSearch(currentKey) {
    const searchInput = document.getElementById('culture-product-search');
    const addBtn = document.getElementById('culture-product-add-btn');
    const dropdown = document.getElementById('culture-product-search-results');
    if (!searchInput || !addBtn || !dropdown) return;

    let searchTimer;
    searchInput.oninput = () => {
        clearTimeout(searchTimer);
        const q = searchInput.value.trim();
        if (q.length < 2) { dropdown.classList.add('hidden'); dropdown.innerHTML = ''; return; }
        searchTimer = setTimeout(async () => {
            try {
                const data = await AdminAPI.products({ search: q, limit: 12 });
                const results = (data.items || []).filter(p => {
                    const k = p.kitchen_culture || p.kitchenCulture || '';
                    return k !== currentKey;
                });
                if (!results.length) {
                    dropdown.innerHTML = `<div class="culture-search-item" style="cursor:default;color:#6b7a8d">No matching products found</div>`;
                } else {
                    dropdown.innerHTML = results.map(p => {
                        const name = p.product_name || p.productName || '';
                        const pId = p.product_id || p.productId || '';
                        const img = absImageUrl(p.primary_image_url || p.primaryImageUrl || siteLogoUrl());
                        return `<div class="culture-search-item" data-pid="${UI.esc(pId)}">
                            <img src="${UI.esc(img)}" alt="">
                            <span>${UI.esc(name)}</span>
                        </div>`;
                    }).join('');
                    dropdown.querySelectorAll('.culture-search-item[data-pid]').forEach(item => {
                        item.onclick = async () => {
                            try {
                                await UI.withLoading(() => AdminAPI.updateProduct(item.dataset.pid, { kitchen_culture: currentKey }));
                                acDel('products:page:0', 'products:all');
                                UI.toast('Product added to culture');
                                searchInput.value = '';
                                dropdown.classList.add('hidden');
                                await _loadCultureProducts();
                            } catch(e) { UI.toast('Failed to assign product', 'error'); }
                        };
                    });
                }
                dropdown.classList.remove('hidden');
            } catch(e) { dropdown.classList.add('hidden'); }
        }, 320);
    };

    addBtn.onclick = () => searchInput.focus();
    document.addEventListener('click', function hideSearch(e) {
        if (!dropdown.contains(e.target) && e.target !== searchInput && e.target !== addBtn) {
            dropdown.classList.add('hidden');
            document.removeEventListener('click', hideSearch);
        }
    });
}

async function openCultureModal(id = null, cultures = []) {
    const c = id != null ? cultures.find(x => x.id == id) : null;
    const activeCount = (cultures || []).filter(x => x.is_active !== false).length;
    _cultureModalCultureId = c?.id ?? null;

    // Populate kitchen culture dropdown
    try {
        if (!_cultureModalKitchenCultures.length) {
            _cultureModalKitchenCultures = await AdminAPI.kitchenCultures();
        }
    } catch(e) { _cultureModalKitchenCultures = []; }

    const keySelect = document.getElementById('m-cul-kitchen-key');
    if (keySelect) {
        // Parse existing link_url to guess the key e.g. products.html?culture=asian
        let existingKey = '';
        if (c?.link_url) {
            try {
                const url = new URL(c.link_url, window.location.origin);
                existingKey = url.searchParams.get('culture') || '';
            } catch(_) {}
        }
        keySelect.innerHTML = `<option value="">— None —</option>` +
            _cultureModalKitchenCultures.map(k =>
                `<option value="${UI.esc(k.key)}"${k.key === existingKey ? ' selected' : ''}>${UI.esc(k.label)}</option>`
            ).join('');
        // Auto-update link_url when key changes
        keySelect.onchange = () => {
            const linkInput = document.getElementById('m-cul-link');
            if (linkInput && keySelect.value) {
                linkInput.value = `products.html?culture=${encodeURIComponent(keySelect.value)}`;
            }
        };
    }

    // Populate image tab fields
    document.getElementById('culture-modal-title').textContent = c ? `Edit: ${c.title || 'Culture Banner'}` : 'Add Culture Banner';
    document.getElementById('m-cul-title').value = c?.title || '';
    document.getElementById('m-cul-img').value = c?.image_url || '';
    document.getElementById('m-cul-link').value = c?.link_url || 'products.html';
    document.getElementById('m-cul-order').value = c?.display_order ?? activeCount;
    const culActiveChk = document.getElementById('m-cul-active');
    const culActiveState = document.getElementById('culture-modal-active-state');
    culActiveChk.checked = c?.is_active !== false;
    const _updateCulActiveLabel = () => {
        culActiveState.textContent = culActiveChk.checked ? 'Active' : 'Inactive';
        culActiveState.className = 'modal-active-label ' + (culActiveChk.checked ? 'modal-active-label--on' : 'modal-active-label--off');
    };
    _updateCulActiveLabel();
    culActiveChk.onchange = _updateCulActiveLabel;
    updateCultureImagePreview(c?.image_url || '');

    // Delete button
    const delBtn = document.getElementById('culture-modal-delete');
    if (delBtn) {
        delBtn.style.display = c ? '' : 'none';
        delBtn.onclick = async () => {
            if (!await UI.confirm('Delete Culture Banner', `Permanently delete "${c?.title}"?`)) return;
            await UI.withLoading(() => AdminAPI.deleteCulture(c.id));
            _closeCultureModal();
            acDel('cultures');
            UI.toast('Culture banner deleted');
            renderCultures({ fresh: true });
        };
    }

    // Show modal at product list tab (or image tab for new)
    document.getElementById('culture-modal').classList.remove('hidden');
    if (c) {
        _switchCultureTab('products');
    } else {
        _switchCultureTab('image');
    }

    // Tab switching
    document.querySelectorAll('#culture-tabs .adm-tab').forEach(btn => {
        btn.onclick = () => _switchCultureTab(btn.dataset.ctab);
    });

    // Close buttons
    document.getElementById('culture-modal-close').onclick = _closeCultureModal;
    document.getElementById('culture-modal-cancel').onclick = _closeCultureModal;

    // Save
    document.getElementById('culture-modal-save').onclick = async () => {
        const keyVal = document.getElementById('m-cul-kitchen-key')?.value || '';
        const linkRaw = document.getElementById('m-cul-link').value.trim();
        const body = {
            title: document.getElementById('m-cul-title').value.trim() || 'Culture Banner',
            image_url: document.getElementById('m-cul-img').value.trim(),
            link_url: linkRaw || (keyVal ? `products.html?culture=${encodeURIComponent(keyVal)}` : 'products.html'),
            display_order: parseInt(document.getElementById('m-cul-order').value, 10) || 0,
            is_active: document.getElementById('m-cul-active').checked,
        };
        if (!body.image_url) {
            _switchCultureTab('image');
            UI.toast('Culture image is required — upload a file or paste a URL', 'error');
            return;
        }
        await UI.withLoading(() => c ? AdminAPI.updateCulture(c.id, body) : AdminAPI.createCulture(body));
        _closeCultureModal();
        acDel('cultures');
        UI.toast('Culture banner saved');
        renderCultures({ fresh: true });
    };

    bindCultureImageUpload();
}

/* ── Testimonials ───────────────────────────────────────── */
async function renderTestimonials({ fresh = false } = {}) {
    const tbody = document.querySelector('#testimonials-table tbody');
    const cached = !fresh ? acGet('testimonials') : null;
    if (cached) {
        paintTestimonials(cached);
        acRevalidate('testimonials', () => AdminAPI.testimonials(), paintTestimonials, {
            isStale: () => state.section !== 'testimonials',
        });
        return;
    }
    if (tbody && !tbody.querySelector('tr')) {
        tbody.innerHTML = `<tr><td colspan="7" class="adm-table-loading">${sectionSpinner()}</td></tr>`;
    }
    const items = await acFetch('testimonials', () => AdminAPI.testimonials(), { fresh });
    paintTestimonials(items);
}

function paintTestimonials(items) {
    const featured = items.filter(t => t.isFeatured).length;
    document.getElementById('testimonials-subtitle').textContent = `${featured} featured of ${items.length} testimonials`;
    document.querySelector('#testimonials-table tbody').innerHTML = items.map(t => `
        <tr>
            <td>${UI.esc(t.customerName)}</td>
            <td><span class="badge badge--green">${UI.esc(t.customerInitial || t.customerName?.[0] || '?')}</span></td>
            <td>${UI.stars(t.rating)}</td>
            <td class="quote-cell" data-full="${UI.esc(t.quote)}">${UI.esc(t.quote.length > 60 ? t.quote.slice(0, 60) + '…' : t.quote)}</td>
            <td><label class="toggle"><input type="checkbox" class="test-feat" data-id="${t.id}" ${t.isFeatured ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
            <td>${t.displayOrder}</td>
            <td><div class="adm-table-actions">
                <button type="button" data-edit-test="${t.id}"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" class="del" data-del-test="${t.id}"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`).join('') || '<tr><td colspan="7">No testimonials</td></tr>';

    document.querySelectorAll('.quote-cell').forEach(c => c.onclick = () => c.classList.toggle('expanded'));
    document.querySelectorAll('.test-feat').forEach(t => {
        t.onchange = async () => {
            await UI.withLoading(() => AdminAPI.updateTestimonial(t.dataset.id, { is_featured: t.checked }));
            acDel('testimonials', 'spotlight');
            UI.toast('Testimonial updated');
            renderTestimonials({ fresh: true });
        };
    });
    document.querySelectorAll('[data-del-test]').forEach(b => b.onclick = async () => {
        if (!await UI.confirm('Delete Testimonial', 'Remove this testimonial permanently?')) return;
        await UI.withLoading(() => AdminAPI.deleteTestimonial(b.dataset.delTest));
        acDel('testimonials', 'spotlight');
        UI.toast('Testimonial deleted');
        renderTestimonials({ fresh: true });
    });
    document.querySelectorAll('[data-edit-test]').forEach(b => b.onclick = () => openTestimonialModal(parseInt(b.dataset.editTest, 10), items));
}

function openTestimonialModal(id = null, items = [], featuredDefault = false) {
    const t = items.find(x => x.id === id);
    document.getElementById('generic-modal-title').textContent = t ? 'Edit Testimonial' : 'Add Testimonial';
    document.getElementById('generic-modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-field"><label>Customer Name</label><input class="adm-input" id="m-test-name" value="${UI.esc(t?.customerName || '')}"></div>
            <div class="form-field"><label>Initials</label><input class="adm-input" id="m-test-init" value="${UI.esc(t?.customerInitial || '')}" maxlength="5"></div>
            <div class="form-field"><label>Rating (1-5)</label><input type="number" class="adm-input" id="m-test-rating" min="1" max="5" value="${t?.rating ?? 5}"></div>
            <div class="form-field"><label>Quote</label><textarea class="adm-textarea" id="m-test-quote">${UI.esc(t?.quote || '')}</textarea></div>
            <div class="form-field"><label>Display Order</label><input type="number" class="adm-input" id="m-test-order" value="${t?.displayOrder ?? 0}"></div>
            <div class="form-field"><label>Verified Customer</label><label class="toggle"><input type="checkbox" id="m-test-verified" ${t?.isVerifiedCustomer !== false ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
            <div class="form-field"><label>Featured on homepage</label><label class="toggle"><input type="checkbox" id="m-test-featured" ${t ? (t.isFeatured ? 'checked' : '') : (featuredDefault ? 'checked' : '')}><span class="toggle-slider"></span></label></div>
        </div>`;
    document.getElementById('generic-modal').classList.remove('hidden');
    document.getElementById('generic-modal-save').style.display = '';
    document.getElementById('generic-modal-save').onclick = async () => {
        const body = {
            customer_name: document.getElementById('m-test-name').value.trim(),
            customer_initial: document.getElementById('m-test-init').value.trim(),
            rating: parseInt(document.getElementById('m-test-rating').value, 10) || 5,
            quote: document.getElementById('m-test-quote').value.trim(),
            display_order: parseInt(document.getElementById('m-test-order').value, 10) || 0,
            is_verified_customer: document.getElementById('m-test-verified').checked,
            is_featured: document.getElementById('m-test-featured').checked,
        };
        if (!body.customer_name || !body.quote) { UI.toast('Name and quote required', 'error'); return; }
        await UI.withLoading(() => t ? AdminAPI.updateTestimonial(t.id, body) : AdminAPI.createTestimonial(body));
        closeGenericModal();
        acDel('testimonials', 'spotlight');
        UI.toast('Testimonial saved');
        if (state.section === 'spotlight') renderSpotlight({ fresh: true });
        else renderTestimonials({ fresh: true });
    };
}

/* ── Contact Messages ───────────────────────────────────── */
async function renderContactMessages({ fresh = false } = {}) {
    const tbody = document.querySelector('#contact-messages-table tbody');
    const subtitle = document.getElementById('contact-messages-subtitle');
    if (!tbody) return;

    const cached = !fresh ? acGet('contactMessages') : null;
    if (cached) {
        paintContactMessages(cached);
        acRevalidate('contactMessages', () => AdminAPI.contactSubmissions(), paintContactMessages, {
            isStale: () => state.section !== 'contact-messages',
        });
        return;
    }

    let data;
    try {
        data = await acFetch('contactMessages', () => AdminAPI.contactSubmissions(), { fresh });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="adm-empty">Failed to load messages.</td></tr>`;
        return;
    }
    paintContactMessages(data);
}

function paintContactMessages(data) {
    const tbody = document.querySelector('#contact-messages-table tbody');
    const subtitle = document.getElementById('contact-messages-subtitle');
    if (!tbody || !data) return;

    // Update unread badge in nav
    const badge = document.getElementById('contact-unread-badge');
    if (badge) {
        if (data.unread > 0) {
            badge.textContent = data.unread;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    if (subtitle) subtitle.textContent = `${data.total} message${data.total !== 1 ? 's' : ''} — ${data.unread} unread`;

    if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="adm-empty">No contact messages yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.items.map(m => {
        const date = m.submittedAt ? new Date(m.submittedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
        const rowClass = m.isRead ? '' : 'contact-row--unread';
        const msgShort = UI.esc(m.message.length > 80 ? m.message.slice(0, 80) + '…' : m.message);
        return `<tr class="${rowClass}" data-id="${m.id}">
            <td style="white-space:nowrap">${date}</td>
            <td><strong>${UI.esc(m.name)}</strong></td>
            <td><a href="mailto:${UI.esc(m.email)}">${UI.esc(m.email)}</a></td>
            <td>${UI.esc(m.phone || '—')}</td>
            <td><span class="badge badge--blue">${UI.esc(m.enquiryType || 'General')}</span></td>
            <td title="${UI.esc(m.message)}">${msgShort}</td>
            <td>${m.isRead ? '<span class="badge badge--green">Read</span>' : '<span class="badge badge--orange">Unread</span>'}</td>
            <td class="adm-actions">
                ${!m.isRead ? `<button class="adm-icon-btn" title="Mark as read" onclick="markContactRead(${m.id})"><i class="fa-solid fa-envelope-open"></i></button>` : ''}
                <button class="adm-icon-btn adm-icon-btn--danger" title="Delete" onclick="deleteContactMsg(${m.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

async function markContactRead(id) {
    try {
        await AdminAPI.markContactRead(id);
        acDel('contactMessages');
        await renderContactMessages({ fresh: true });
    } catch(e) { UI.toast('Failed to mark as read', 'error'); }
}

async function deleteContactMsg(id) {
    if (!confirm('Delete this message?')) return;
    try {
        await AdminAPI.deleteContactSubmission(id);
        acDel('contactMessages');
        await renderContactMessages({ fresh: true });
        UI.toast('Message deleted');
    } catch(e) { UI.toast('Failed to delete', 'error'); }
}

/* ── Coupons ────────────────────────────────────────────── */
let couponsCache = [];

async function renderCoupons({ fresh = false } = {}) {
    const tbody = document.querySelector('#coupons-table tbody');
    const cached = !fresh ? acGet('coupons') : null;
    if (cached) {
        paintCoupons(cached);
        acRevalidate('coupons', () => AdminAPI.coupons(), paintCoupons, {
            isStale: () => state.section !== 'coupons',
        });
        return;
    }
    if (tbody && !tbody.querySelector('tr')) {
        tbody.innerHTML = `<tr><td colspan="6" class="adm-table-loading">${sectionSpinner()}</td></tr>`;
    }
    const items = await acFetch('coupons', () => AdminAPI.coupons(), { fresh });
    paintCoupons(items);
}

function paintCoupons(items) {
    couponsCache = items || [];
    document.querySelector('#coupons-table tbody').innerHTML = couponsCache.map((c, i) => `
        <tr>
            <td><code>${UI.esc(c.code)}</code></td>
            <td>${UI.esc(c.type)}</td>
            <td>${c.type === 'percent' ? `${c.value}%` : UI.fmtMoney(c.value)}</td>
            <td>${UI.fmtMoney(c.min)}</td>
            <td>${c.active !== false ? UI.statusBadge('active') : UI.statusBadge('inactive')}</td>
            <td><div class="adm-table-actions">
                <button type="button" data-edit-coupon="${i}" title="Edit"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" class="del" data-del-coupon="${i}" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`).join('') || '<tr><td colspan="6">No coupons yet. Add a promo code.</td></tr>';

    document.querySelectorAll('[data-edit-coupon]').forEach(b => {
        b.onclick = () => openCouponModal(couponsCache[parseInt(b.dataset.editCoupon, 10)], parseInt(b.dataset.editCoupon, 10));
    });
    document.querySelectorAll('[data-del-coupon]').forEach(b => b.onclick = async () => {
        const idx = parseInt(b.dataset.delCoupon, 10);
        if (!await UI.confirm('Delete Coupon', 'Remove this coupon code?')) return;
        const next = couponsCache.filter((_, i) => i !== idx);
        await UI.withLoading(() => AdminAPI.saveCoupons(next));
        acDel('coupons');
        UI.toast('Coupon deleted');
        renderCoupons({ fresh: true });
    });
}

function openCouponModal(coupon = null, index = -1) {
    document.getElementById('generic-modal-title').textContent = coupon ? 'Edit Coupon' : 'Add Coupon';
    document.getElementById('generic-modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-field"><label>Code</label><input class="adm-input" id="m-coupon-code" value="${UI.esc(coupon?.code || '')}" placeholder="SAVE10"></div>
            <div class="form-field"><label>Type</label><select class="adm-select" id="m-coupon-type">
                <option value="percent" ${coupon?.type === 'percent' ? 'selected' : ''}>Percent off</option>
                <option value="fixed" ${coupon?.type === 'fixed' ? 'selected' : ''}>Fixed amount</option>
            </select></div>
            <div class="form-field"><label>Value</label><input type="number" class="adm-input" id="m-coupon-value" min="0" step="0.01" value="${coupon?.value ?? 10}"></div>
            <div class="form-field"><label>Min order (£)</label><input type="number" class="adm-input" id="m-coupon-min" min="0" step="0.01" value="${coupon?.min ?? 0}"></div>
            <div class="form-field"><label>Active</label><label class="toggle"><input type="checkbox" id="m-coupon-active" ${coupon?.active !== false ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
        </div>`;
    document.getElementById('generic-modal').classList.remove('hidden');
    document.getElementById('generic-modal-save').style.display = '';
    document.getElementById('generic-modal-save').onclick = async () => {
        const item = {
            code: document.getElementById('m-coupon-code').value.trim().toUpperCase(),
            type: document.getElementById('m-coupon-type').value,
            value: parseFloat(document.getElementById('m-coupon-value').value) || 0,
            min: parseFloat(document.getElementById('m-coupon-min').value) || 0,
            active: document.getElementById('m-coupon-active').checked,
        };
        if (!item.code) { UI.toast('Coupon code is required', 'error'); return; }
        const next = [...couponsCache];
        if (index >= 0) next[index] = item;
        else next.push(item);
        await UI.withLoading(() => AdminAPI.saveCoupons(next));
        closeGenericModal();
        acDel('coupons');
        UI.toast('Coupon saved');
        renderCoupons({ fresh: true });
    };
}

/* ── Settings ───────────────────────────────────────────── */
const SETTINGS_GROUPS = [
    {
        id: 'identity', title: 'Store Identity', icon: 'fa-solid fa-store',
        fields: [
            { key: 'store_name',     label: 'Store name',    placeholder: 'GMS World Foods Ltd' },
            { key: 'store_tagline',  label: 'Tagline',       placeholder: 'Wholesale & Retail' },
            { key: 'store_logo_url', label: 'Logo image URL', placeholder: 'https://res.cloudinary.com/…', full: true },
        ],
    },
    {
        id: 'contact', title: 'Contact & Location', icon: 'fa-solid fa-location-dot',
        fields: [
            { key: 'store_phone',      label: 'Phone',                    placeholder: '+44 7802617847' },
            { key: 'whatsapp_number',  label: 'WhatsApp (digits only)',    placeholder: '447802617847', hint: 'UK country code + number, no spaces or + (e.g. 447802617847)' },
            { key: 'contact_email',    label: 'Contact email',             placeholder: 'gmsworldfood@gmail.com', full: true },
            { key: 'store_address',    label: 'Street address',            placeholder: '88–90 High Street', full: true },
            { key: 'store_city',       label: 'City',                      placeholder: 'West Drayton' },
            { key: 'store_postcode',   label: 'Postcode',                  placeholder: 'UB7 7DS' },
            { key: 'delivery_area',    label: 'Delivery area',             placeholder: 'West Drayton & surrounding areas', full: true },
            { key: 'maps_embed_url',   label: 'Google Maps embed URL',     placeholder: 'https://www.google.com/maps/embed?pb=…', full: true, hint: 'Paste the src="" value from Google Maps → Share → Embed a map' },
        ],
    },
    {
        id: 'hours', title: 'Opening Hours', icon: 'fa-regular fa-clock', cols: 3,
        fields: [
            { key: 'opening_hours',           label: 'Short summary (header / footer)', placeholder: 'Open Daily — Mon to Sun', full: true },
            { key: 'opening_hours_mon_fri',   label: 'Monday – Friday',                 placeholder: '8:00am – 9:00pm' },
            { key: 'opening_hours_saturday',  label: 'Saturday',                        placeholder: '8:00am – 9:00pm' },
            { key: 'opening_hours_sunday',    label: 'Sunday',                          placeholder: '9:00am – 8:00pm' },
        ],
    },
    {
        id: 'content', title: 'Storefront Content', icon: 'fa-solid fa-file-lines',
        fields: [
            { key: 'footer_desc',             label: 'Footer description',                    type: 'textarea', full: true, rows: 3 },
            { key: 'home_about_teaser',        label: 'Home page — About teaser (line 1)',     type: 'textarea', full: true, rows: 3 },
            { key: 'home_about_teaser_extra',  label: 'Home page — About teaser (line 2)',     type: 'textarea', full: true, rows: 3 },
            { key: 'about_us_text',            label: 'About Us page — Full text',             type: 'textarea', full: true, rows: 7, hint: 'Separate paragraphs with a blank line' },
        ],
    },
    {
        id: 'social', title: 'Social Media', icon: 'fa-solid fa-share-nodes', cols: 3,
        fields: [
            { key: 'social_facebook',  label: 'Facebook URL',    placeholder: 'https://facebook.com/yourpage' },
            { key: 'social_instagram', label: 'Instagram URL',   placeholder: 'https://instagram.com/yourhandle' },
            { key: 'social_twitter',   label: 'X (Twitter) URL', placeholder: 'https://x.com/yourhandle' },
        ],
    },
    {
        id: 'media', title: 'Media & Assets', icon: 'fa-solid fa-images',
        fields: [
            { key: 'newsletter_background_url', label: 'Newsletter — Background image URL', placeholder: 'https://…', full: true },
            { key: 'newsletter_visual_url',     label: 'Newsletter — Visual / promo image URL', placeholder: 'https://…', full: true },
            { key: 'store_hero_image_url',      label: 'Store hero image (About / Contact pages)', placeholder: 'https://…', full: true },
            { key: 'store_gallery_urls',        label: 'Store gallery image URLs', type: 'textarea', full: true, rows: 3, hint: 'JSON array of image URLs — e.g. ["https://…", "https://…"]' },
        ],
    },
];
/* Flat list kept for save iteration */
const SETTINGS_FIELDS = SETTINGS_GROUPS.flatMap(g => g.fields);

async function renderSettings({ fresh = false } = {}) {
    const container = document.getElementById('settings-form');
    if (!container) return;

    const cached = !fresh ? acGet('settings') : null;
    if (cached) {
        paintSettingsForm(cached);
        acRevalidate('settings', () => AdminAPI.settings(), paintSettingsForm, {
            isStale: () => state.section !== 'settings',
        });
        return;
    }

    const data = await acFetch('settings', () => AdminAPI.settings(), { fresh });
    paintSettingsForm(data);
}

function paintSettingsForm(data) {
    const container = document.getElementById('settings-form');
    if (!container || !data) return;

    container.innerHTML = SETTINGS_GROUPS.map(group => {
        const fieldsHtml = group.fields.map(f => {
            const val = UI.esc(data[f.key] || '');
            const hintHtml = f.hint ? `<p class="form-hint">${f.hint}</p>` : '';
            const cls = f.full ? 'form-field form-field--full' : 'form-field';
            if (f.type === 'textarea') {
                const rows = f.rows || 4;
                return `<div class="${cls}">
                    <label>${f.label}</label>
                    <textarea class="adm-textarea" id="set-${f.key}" rows="${rows}" placeholder="${UI.esc(f.placeholder || '')}">${val}</textarea>
                    ${hintHtml}
                </div>`;
            }
            return `<div class="${cls}">
                <label>${f.label}</label>
                <input class="adm-input" id="set-${f.key}" value="${val}" placeholder="${UI.esc(f.placeholder || '')}">
                ${hintHtml}
            </div>`;
        }).join('');

        const colsStyle = group.cols === 3
            ? 'style="grid-template-columns:repeat(3,1fr)"'
            : '';
        return `<div class="adm-card settings-group-card" id="settings-group-${group.id}">
            <div class="settings-group-header">
                <div class="settings-group-icon"><i class="${group.icon}"></i></div>
                <h3>${group.title}</h3>
            </div>
            <div class="form-grid settings-grid" ${colsStyle}>${fieldsHtml}</div>
        </div>`;
    }).join('');
}

async function saveSettingsForm() {
    const body = {};
    SETTINGS_FIELDS.forEach(f => {
        const el = document.getElementById(`set-${f.key}`);
        if (el) body[f.key] = el.value.trim();
    });
    await UI.withLoading(() => AdminAPI.saveSettings(body));
    acDel('settings', 'dashboard');
    UI.toast('Settings saved');
    if (typeof applySiteSettings === 'function') {
        acFetch('settings', () => AdminAPI.settings(), { fresh: true })
            .then(s => applySiteSettings(s))
            .catch(() => {});
    }
}

/* ── Discounts ──────────────────────────────────────────── */
function updateDiscountBulkBar() {
    const bar = document.getElementById('discount-bulk-bar');
    const n = state.discountedSelected.size;
    if (!bar) return;
    if (n) {
        bar.classList.remove('hidden');
        document.getElementById('discount-bulk-count').textContent = `${n} selected`;
    } else {
        bar.classList.add('hidden');
    }
}

function syncDiscountSelectAll() {
    const selectAll = document.getElementById('discounted-select-all');
    const cbs = document.querySelectorAll('.disc-cb');
    if (!selectAll) return;
    selectAll.checked = cbs.length > 0 && [...cbs].every(cb => state.discountedSelected.has(cb.value));
    selectAll.indeterminate = !selectAll.checked && [...cbs].some(cb => state.discountedSelected.has(cb.value));
}

function bindDiscountTableEvents() {
    document.querySelectorAll('.disc-cb').forEach(cb => {
        cb.onchange = () => {
            if (cb.checked) state.discountedSelected.add(cb.value);
            else state.discountedSelected.delete(cb.value);
            updateDiscountBulkBar();
            syncDiscountSelectAll();
        };
    });

    document.querySelectorAll('[data-rm-disc]').forEach(b => {
        b.onclick = async () => {
            await UI.withLoading(() => AdminAPI.bulkClearDiscounts({ product_ids: [b.dataset.rmDisc] }));
            state.discountedSelected.delete(b.dataset.rmDisc);
            acDel('discountedProducts', 'spotlight'); acClearProducts();
            UI.toast('Discount removed');
            renderDiscounts();
        };
    });
}

async function renderDiscounts({ fresh = false } = {}) {
    await loadCategoriesCache();
    const catSel = document.getElementById('discount-cat');
    if (catSel.options.length <= 1) {
        state.categories.forEach(c => {
            const o = document.createElement('option');
            o.value = c.category_id;
            o.textContent = c.category_name;
            catSel.appendChild(o);
        });
        catSel.onchange = async () => {
            const subs = await acFetch(
                `subcategories:${catSel.value || 'all'}`,
                () => AdminAPI.subcategories(catSel.value),
            );
            document.getElementById('discount-subcat').innerHTML =
                '<option value="">All in category</option>' +
                subs.map(s => `<option value="${s.subcategory_id}">${UI.esc(s.subcategory_name)}</option>`).join('');
        };
    }

    const cached = !fresh ? acGet('discountedProducts') : null;
    if (cached) {
        paintDiscountedProducts(cached);
        acRevalidate('discountedProducts', () => AdminAPI.discountedProducts(), paintDiscountedProducts, {
            isStale: () => state.section !== 'discounts',
        });
        return;
    }

    const items = await acFetch('discountedProducts', () => AdminAPI.discountedProducts(), { fresh });
    paintDiscountedProducts(items);
}

function paintDiscountedProducts(items) {
    const visibleIds = new Set(items.map(p => p.productId));
    state.discountedSelected.forEach(id => {
        if (!visibleIds.has(id)) state.discountedSelected.delete(id);
    });
    document.querySelector('#discounted-table tbody').innerHTML = items.map(p => `
        <tr>
            <td><input type="checkbox" class="disc-cb" value="${UI.esc(p.productId)}" ${state.discountedSelected.has(p.productId) ? 'checked' : ''}></td>
            <td>${UI.esc(p.productName)}</td>
            <td>${UI.esc(p.categoryName)}</td>
            <td>${UI.esc(p.subCategoryName || '—')}</td>
            <td><span class="badge badge--pink">-${p.discountPercent}%</span></td>
            <td><div class="adm-table-actions">
                <button type="button" class="del" data-rm-disc="${p.productId}" title="Remove discount"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`).join('') || '<tr><td colspan="6">No discounted products</td></tr>';

    bindDiscountTableEvents();
    updateDiscountBulkBar();
    syncDiscountSelectAll();
}

/* ── CSV helper ─────────────────────────────────────────── */
function downloadCsv(rows, filename) {
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = filename;
    a.click();
}

/* ── Init ───────────────────────────────────────────────── */
function bindEvents() {
    document.getElementById('logout-btn').onclick = () => exitToStorefront();

    document.querySelectorAll('.adm-nav-link[data-section]').forEach(a => {
        a.onclick = (e) => { e.preventDefault(); showSection(a.dataset.section); };
    });
    window.addEventListener('hashchange', () => {
        if (document.getElementById('admin-shell').classList.contains('hidden')) return;
        const section = getSectionFromUrl();
        if (section !== state.section) showSection(section, { updateUrl: false });
    });
    document.querySelectorAll('[data-goto]').forEach(a => {
        a.onclick = (e) => { e.preventDefault(); showSection(a.dataset.goto); };
    });
    document.getElementById('sidebar-toggle').onclick = () => {
        document.getElementById('adm-sidebar').classList.toggle('open');
    };

    document.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.onclick = () => {
            const q = btn.dataset.quick;
            if (q === 'product') { showSection('products'); openProductPanel(); }
            else if (q === 'discount') showSection('discounts');
            else if (q === 'banner') { showSection('banners'); openBannerModal().catch(console.error); }
        };
    });

    document.getElementById('add-product-btn').onclick = () => openProductPanel();
    document.getElementById('save-product-btn').onclick = saveProduct;
    document.querySelectorAll('.product-panel-close').forEach(b => b.onclick = closeProductModal);
    document.querySelectorAll('.generic-modal-close').forEach(b => b.onclick = closeGenericModal);

    document.getElementById('products-search').oninput = debounce(() => {
        state.products.page = 1;
        renderProducts();
    }, 450);
    document.getElementById('products-cat-filter').onchange = async () => {
        const categoryId = document.getElementById('products-cat-filter').value;
        const subs = await acFetch(
            `subcategories:${categoryId || 'all'}`,
            () => AdminAPI.subcategories(categoryId),
        );
        document.getElementById('products-subcat-filter').innerHTML =
            '<option value="">All</option>' + subs.map(s => `<option value="${s.subcategory_id}">${UI.esc(s.subcategory_name)}</option>`).join('');
        state.products.page = 1;
        renderProducts();
    };
    document.getElementById('products-subcat-filter').onchange = () => { state.products.page = 1; renderProducts(); };
    document.getElementById('products-stock-filter').onchange = () => { state.products.page = 1; renderProducts(); };
    document.getElementById('products-active-filter').onchange = () => { state.products.page = 1; renderProducts(); };
    document.getElementById('products-sort-filter').onchange = () => { state.products.page = 1; renderProducts(); };
    document.getElementById('products-reset-filters').onclick = () => {
        ['products-search','products-cat-filter','products-subcat-filter','products-stock-filter','products-active-filter'].forEach(id => {
            const el = document.getElementById(id);
            el.value = id === 'products-subcat-filter' ? '' : (el.tagName === 'SELECT' ? (id === 'products-active-filter' ? 'active' : '') : '');
        });
        document.getElementById('products-sort-filter').value = 'none';
        state.products.page = 1;
        renderProducts();
    };
    document.getElementById('products-select-all').onchange = (e) => {
        document.querySelectorAll('.prod-cb').forEach(cb => {
            cb.checked = e.target.checked;
            if (e.target.checked) state.products.selected.add(cb.value);
            else state.products.selected.delete(cb.value);
        });
        updateBulkBar();
    };
    document.querySelectorAll('[data-bulk]').forEach(btn => {
        btn.onclick = async () => {
            const action = btn.dataset.bulk;
            const ids = [...state.products.selected];
            if (!ids.length) return;
            if (action === 'delete' && !await UI.confirm('Bulk Delete', `Permanently delete ${ids.length} products from the database? This cannot be undone.`)) return;
            try {
                await UI.withLoading(() => AdminAPI.bulkProducts({ product_ids: ids, action: action === 'delete' ? 'delete' : action }));
                acClearProducts(); acDel('stats', 'dashboard', 'spotlight', 'discountedProducts');
                state.products.selected.clear();
                if (action === 'delete') {
                    const removed = new Set(ids);
                    state.products.items = state.products.items.filter(p => !removed.has(p.productId));
                }
                UI.toast('Bulk action completed');
                await renderProducts();
            } catch (err) {
                UI.toast(err.message || 'Bulk action failed', 'error');
            }
        };
    });
    document.getElementById('export-csv-btn').onclick = exportProductsCsv;

    document.getElementById('add-category-btn').onclick = () => openCategoryModal();
    document.getElementById('add-subcategory-btn').onclick = () => openSubcategoryModal();
    document.getElementById('add-banner-btn').onclick = () => openBannerModal().catch(console.error);
    document.getElementById('add-culture-btn').onclick = () => openCultureModal().catch(console.error);
    document.getElementById('add-testimonial-btn').onclick = () => openTestimonialModal();
    document.getElementById('add-coupon-btn').onclick = () => openCouponModal();
    document.getElementById('save-settings-btn').onclick = () => saveSettingsForm().catch(console.error);
    document.getElementById('notif-btn').onclick = () => {
        showSection('products');
        document.getElementById('products-stock-filter').value = 'low';
        state.products.page = 1;
        renderProducts({ fresh: true });
    };
    document.getElementById('apply-bulk-discount').onclick = async () => {
        const body = {
            category_id: document.getElementById('discount-cat').value,
            subcategory_id: document.getElementById('discount-subcat').value || undefined,
            discount_percent: parseInt(document.getElementById('discount-pct').value, 10) || 0,
        };
        if (!body.category_id) { UI.toast('Select a category', 'error'); return; }
        if (!await UI.confirm(
            'Apply bulk discount',
            `Apply ${body.discount_percent}% to active products in this category? Original prices are stored in compare price and restored when discounts are cleared.`,
        )) return;
        const res = await UI.withLoading(() => AdminAPI.bulkDiscount(body));
        acDel('discountedProducts', 'spotlight'); acClearProducts();
        UI.toast(`Discount applied to ${res.affected} products`);
        renderDiscounts();
    };
    document.getElementById('clear-discounts-btn').onclick = async () => {
        if (!await UI.confirm('Clear All Discounts', 'Remove all sale pricing and restore original prices from compare price?')) return;
        const res = await UI.withLoading(() => AdminAPI.clearDiscounts());
        state.discountedSelected.clear();
        acDel('discountedProducts', 'spotlight'); acClearProducts();
        UI.toast(`Cleared discounts on ${res.affected} products`);
        renderDiscounts();
    };
    document.getElementById('discounted-select-all').onchange = (e) => {
        document.querySelectorAll('.disc-cb').forEach(cb => {
            cb.checked = e.target.checked;
            if (e.target.checked) state.discountedSelected.add(cb.value);
            else state.discountedSelected.delete(cb.value);
        });
        updateDiscountBulkBar();
        syncDiscountSelectAll();
    };
    document.getElementById('discount-bulk-remove').onclick = async () => {
        const ids = [...state.discountedSelected];
        if (!ids.length) return;
        if (!await UI.confirm(
            'Remove Selected Discounts',
            `Remove discounts from ${ids.length} selected product${ids.length === 1 ? '' : 's'} and restore original prices?`,
        )) return;
        const res = await UI.withLoading(() => AdminAPI.bulkClearDiscounts({ product_ids: ids }));
        state.discountedSelected.clear();
        acDel('discountedProducts', 'spotlight'); acClearProducts();
        UI.toast(`Removed discounts from ${res.affected} product${res.affected === 1 ? '' : 's'}`);
        renderDiscounts();
    };

    document.querySelectorAll('#product-tabs .adm-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('#product-tabs .adm-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            ['details','pricing','images','visibility'].forEach(name => {
                document.getElementById(`tab-${name}`).classList.toggle('hidden', tab.dataset.tab !== name);
            });
        };
    });
    document.getElementById('pf-discount').oninput = updateDiscountPreview;
    document.getElementById('pf-image-upload-btn').onclick = () => document.getElementById('pf-image-file').click();
    document.getElementById('pf-image-file').onchange = (e) => {
        if (e.target.files?.length) handleProductImageFiles(e.target.files);
    };
    document.getElementById('pf-image-url-add').onclick = () => addProductImageFromUrl();
    document.getElementById('pf-image-url').onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addProductImageFromUrl(); }
    };
    const runGlobalProductSearch = debounce((term) => {
        showSection('products');
        document.getElementById('products-search').value = term;
        document.getElementById('global-search').value = term;
        state.products.page = 1;
        renderProducts();
    }, 450);

    document.getElementById('global-search').oninput = (e) => runGlobalProductSearch(e.target.value.trim());
    document.getElementById('global-search').onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runGlobalProductSearch.flush(e.target.value.trim());
        }
    };

}

function debounce(fn, ms) {
    let t;
    const debounced = (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
    debounced.flush = (...args) => {
        clearTimeout(t);
        fn(...args);
    };
    return debounced;
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    initAuth();
});
