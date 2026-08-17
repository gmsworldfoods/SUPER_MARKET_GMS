function initNavigation() {
    const header = document.getElementById('site-header');
    const menuToggle = document.getElementById('mobile-menu-toggle');
    const mobileDrawer = document.getElementById('mobile-drawer');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const drawerClose = document.getElementById('drawer-close');
    const backToTop = document.getElementById('back-to-top');

    // Ensure body scroll lock is cleared when navigation initializes
    document.body.classList.remove('drawer-open', 'modal-open');

    if (header) {
        requestAnimationFrame(() => header.classList.add('header-visible'));
    }

    if (menuToggle && mobileDrawer) {
        menuToggle.addEventListener('click', () => openDrawer(mobileDrawer, drawerOverlay, menuToggle));
    }
    if (drawerClose) {
        drawerClose.addEventListener('click', () => closeDrawer(mobileDrawer, drawerOverlay, menuToggle));
    }
    if (drawerOverlay) {
        drawerOverlay.addEventListener('click', () => closeDrawer(mobileDrawer, drawerOverlay, menuToggle));
    }

    if (mobileDrawer) {
        // Event delegation so dynamically created subcategory links close the drawer on mobile
        mobileDrawer.addEventListener('click', (e) => {
            if (e.target.closest('a')) {
                closeDrawer(mobileDrawer, drawerOverlay, menuToggle);
            }
        });
    }

    if (backToTop) {
        window.addEventListener('scroll', () => {
            backToTop.classList.toggle('visible', window.scrollY > 400);
        });
        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    highlightActiveNav();
    buildMobileCategoryList();
    buildSubNavCategoryDropdown();
    initSubNavCategories();
    initBrowseSectionNav();
    initFixedMobileHeaderOffset();
    if (typeof updateHeaderBadges === 'function') updateHeaderBadges();
}

/** Keep body padding in sync with fixed mobile header height. */
function syncMobileHeaderOffset() {
    const stack = document.getElementById('header-stack');
    if (!stack) return;

    if (window.matchMedia('(max-width: 767px)').matches) {
        document.documentElement.style.setProperty(
            '--mobile-header-offset',
            `${stack.offsetHeight}px`
        );
    } else {
        document.documentElement.style.removeProperty('--mobile-header-offset');
    }
}

function initFixedMobileHeaderOffset() {
    syncMobileHeaderOffset();
    window.addEventListener('resize', syncMobileHeaderOffset);
    window.addEventListener('orientationchange', syncMobileHeaderOffset);
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(syncMobileHeaderOffset).catch(() => {});
    }
    requestAnimationFrame(syncMobileHeaderOffset);
}

function getHeaderScrollOffset() {
    const stack = document.getElementById('header-stack');
    return stack ? stack.offsetHeight + 12 : 132;
}

function revealHomeSection(target) {
    if (!target) return;
    target.classList.add('home-scroll-reveal');
    target.querySelectorAll('.fade-in-section, .fade-in-item').forEach(el => {
        el.classList.add('visible');
        if (window.fadeObserver) window.fadeObserver.unobserve(el);
    });
}

function scrollToHomeSection(sectionId) {
    const target = document.getElementById(sectionId);
    if (!target) return false;

    const top = target.getBoundingClientRect().top + window.scrollY - getHeaderScrollOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    revealHomeSection(target);
    return true;
}

function initBrowseSectionNav() {
    document.querySelectorAll('a.browse-nav-link--section').forEach(link => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href') || '';
            const hashPos = href.indexOf('#');
            if (hashPos < 0) return;

            const sectionId = href.slice(hashPos + 1);
            if (!sectionId) return;

            const onHome = document.body.dataset.page === 'home';
            const isHomeHash = href.startsWith('#');

            if (onHome && (isHomeHash || href.startsWith('index.html#'))) {
                e.preventDefault();
                scrollToHomeSection(sectionId);
                history.replaceState(null, '', '#' + sectionId);
            }
        });
    });
}

function resetHomePageScroll() {
    if (document.body.dataset.page !== 'home') return;
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    const hash = (window.location.hash || '').replace(/^#/, '').trim();
    // Preserve deep-links like #categories / #cultures — scroll after layout paints
    if (hash) {
        const scrollToHash = () => {
            if (typeof scrollToHomeSection === 'function') {
                scrollToHomeSection(hash);
            } else {
                const el = document.getElementById(hash);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };
        requestAnimationFrame(() => setTimeout(scrollToHash, 50));
        return;
    }
    window.scrollTo(0, 0);
}

function openDrawer(drawer, overlay, toggle) {
    drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('drawer-open');
}

function closeDrawer(drawer, overlay, toggle) {
    drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('drawer-open');
}

function highlightActiveNav() {
    // no sub-nav links to highlight in current layout
}

function buildMobileCategoryList() {
    const list = document.getElementById('mobile-category-list');
    if (!list) return;

    const cats = getCategoryStats();
    const subs = getSubcategoryStats();

    const subsByParent = {};
    subs.forEach(s => {
        if (!subsByParent[s.ProductCategoryID]) subsByParent[s.ProductCategoryID] = [];
        subsByParent[s.ProductCategoryID].push(s);
    });

    list.innerHTML = cats.map(cat => {
        const catSubs = subsByParent[cat.ProductCategoryID] || [];
        const subItems = catSubs.map(s => `
            <li class="mobile-sub-item">
                <a href="products.html?category=${encodeURIComponent(cat.CategoryName)}&subcategory=${encodeURIComponent(s.SubCategoryName)}">
                    <span class="mobile-sub-name">${s.SubCategoryName}</span>
                    <span class="mobile-cat-count">${s.Product_Count}</span>
                </a>
            </li>
        `).join('');

        return `
            <li class="mobile-cat-item">
                <a href="products.html?category=${encodeURIComponent(cat.CategoryName)}" class="mobile-cat-link">
                    ${cat.CategoryName}
                    <span class="mobile-cat-count">${cat.Product_Count}</span>
                </a>
                ${catSubs.length ? `<ul class="mobile-sub-list">${subItems}</ul>` : ''}
            </li>
        `;
    }).join('');
}

function buildSubNavCategoryDropdown() {
    const dropdown = document.getElementById('subnav-cat-dropdown');
    if (!dropdown) return;

    const cats = getCategoryStats();
    const subs = getSubcategoryStats();

    const subsByParent = {};
    subs.forEach(s => {
        if (!subsByParent[s.ProductCategoryID]) subsByParent[s.ProductCategoryID] = [];
        subsByParent[s.ProductCategoryID].push(s);
    });

    dropdown.innerHTML = `
        <div class="sub-nav-dropdown-grid">
            ${cats.map(cat => {
                const ph = getCategoryPlaceholder(cat.CategoryName);
                const imageUrl = getCategoryImage(cat.CategoryName);
                const catSubs = subsByParent[cat.ProductCategoryID] || [];
                const subLinks = catSubs.slice(0, 6).map(s => `
                    <a class="sub-nav-sub-link" href="products.html?category=${encodeURIComponent(cat.CategoryName)}&subcategory=${encodeURIComponent(s.SubCategoryName)}">
                        ${s.SubCategoryName}
                        <small>${s.Product_Count}</small>
                    </a>
                `).join('');
                const moreLink = catSubs.length > 6
                    ? `<a class="sub-nav-more-link" href="products.html?category=${encodeURIComponent(cat.CategoryName)}">View all ${cat.Product_Count} products →</a>`
                    : '';
                return `
                    <div class="sub-nav-cat-col">
                        <a class="sub-nav-cat-heading" href="products.html?category=${encodeURIComponent(cat.CategoryName)}">
                            <span class="sub-nav-cat-icon" style="background:${ph.gradient}">
                                <img src="${escapeHtmlAttr(imageUrl)}" alt="" loading="lazy" decoding="async"
                                    onerror="this.hidden=true;this.nextElementSibling.hidden=false">
                                <i class="fa-solid ${ph.icon}" hidden aria-hidden="true"></i>
                            </span>
                            <span>
                                <strong>${cat.CategoryName}</strong>
                                <small>${cat.Product_Count.toLocaleString()} products</small>
                            </span>
                        </a>
                        ${subLinks ? `<div class="sub-nav-sub-group">${subLinks}</div>` : ''}
                        ${moreLink}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function initSubNavCategories() {
    const wrap = document.getElementById('subnav-categories-wrap');
    const btn = document.getElementById('subnav-categories-btn');
    const dropdown = document.getElementById('subnav-cat-dropdown');
    if (!wrap || !btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = wrap.classList.toggle('open');
        btn.setAttribute('aria-expanded', open);
    });

    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) {
            wrap.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
        }
    });

    // Event delegation so links still close the menu after re-renders
    dropdown.addEventListener('click', (e) => {
        if (e.target.closest('a')) {
            wrap.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
        }
    });
}

function initScrollAnimations() {
    window.fadeObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                window.fadeObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.fade-in-section, .fade-in-item').forEach(el => {
        window.fadeObserver.observe(el);
    });
}

