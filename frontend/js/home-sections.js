/* Home page — hero slider, top categories carousel & product strips */

function escHeroAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function bannerImageUrl(banner) {
    if (!banner) return '';
    return (banner.imageUrl || banner.image_url || '').trim();
}

function bannerLinkUrl(banner) {
    if (!banner) return '';
    return (banner.linkUrl || banner.link_url || '').trim();
}

async function prefetchHeroBanners() {
    const existing = typeof getPromotionBanners === 'function' ? getPromotionBanners() : [];
    if (existing.length) return existing;
    try {
        const res = await fetch('/api/v1/banners');
        if (!res.ok) return [];
        const rows = await res.json();
        const mapped = (rows || []).map(b => ({
            imageUrl: b.image_url || b.imageUrl,
            linkUrl: b.link_url || b.linkUrl,
            title: b.title
        })).filter(b => bannerImageUrl(b));
        if (typeof setPromotionBanners === 'function') {
            setPromotionBanners(mapped);
        } else {
            window.PROMOTION_BANNERS = mapped;
            window.PROMOTION_BANNER_IMAGES = mapped.map(b => bannerImageUrl(b));
        }
        return mapped;
    } catch (err) {
        console.error('Hero banners fetch failed:', err);
        return [];
    }
}

function getHeroSlideHref(slide, index) {
    if (slide.href) return slide.href;
    if (typeof getCategoryStats === 'function') {
        const cats = getCategoryStats();
        if (cats[index]) {
            return `products.html?category=${encodeURIComponent(cats[index].CategoryName)}`;
        }
    }
    return 'products.html';
}

function loadHeroSlides() {
    const banners = typeof getPromotionBanners === 'function'
        ? getPromotionBanners()
        : (typeof PROMOTION_BANNERS !== 'undefined' ? PROMOTION_BANNERS : []);
    if (Array.isArray(banners) && banners.length) {
        return banners
            .map((banner, index) => ({
                image: bannerImageUrl(banner),
                href: bannerLinkUrl(banner) || getHeroSlideHref({}, index),
                title: banner.title || `Shop category ${index + 1}`
            }))
            .filter(slide => slide.image);
    }
    const images = typeof PROMOTION_BANNER_IMAGES !== 'undefined' && Array.isArray(PROMOTION_BANNER_IMAGES)
        ? PROMOTION_BANNER_IMAGES
        : [];
    return images
        .filter(src => typeof src === 'string' && src.trim())
        .map((src, index) => ({
            image: src.trim(),
            href: getHeroSlideHref({}, index),
            title: `Promotion ${index + 1}`
        }));
}

let cultureBannersData = [];
let cultureBannersTimer = null;

async function prefetchCultureBanners() {
    if (cultureBannersData.length) return cultureBannersData;
    const metaCultures = (window.__INITIAL_METADATA__ && window.__INITIAL_METADATA__.cultures) ||
                         (typeof CATEGORY_METADATA !== 'undefined' && CATEGORY_METADATA && CATEGORY_METADATA.cultures);
    let rows = metaCultures;
    if (!rows || !rows.length) {
        try {
            const res = await fetch('/api/v1/cultures');
            if (res.ok) rows = await res.json();
        } catch (err) {
            console.error('Culture banners fetch failed:', err);
        }
    }
    cultureBannersData = (rows || []).map(b => ({
        image: (b.image_url || b.imageUrl || '').trim(),
        href: (b.link_url || b.linkUrl || 'products.html').trim() || 'products.html',
        title: b.title || '',
    })).filter(b => b.image);
    return cultureBannersData;
}

const TOP_BANNER_COPY = {
    'Dry grocery & staples': 'Rice, lentils, spices, masalas and everyday pantry essentials.',
    'Snacks & confectionery': 'Biscuits, namkeen, chocolates and sweets from trusted brands.',
    'Beverages': 'Tea, coffee, soft drinks, juices and refreshing drinks.',
    'Fresh produce': 'Fresh vegetables, herbs and specialty produce for UK kitchens.',
    'Frozen, meat & ready-to-cook': 'Frozen meat, poultry, fish and ready-to-cook ranges.',
    'Condiments, sauces & pickles': 'Pickles, chutneys, sauces, honey and spreads.',
    'Dairy, eggs & chilled': 'Milk, cheese, eggs and chilled dairy essentials.',
    'Household & personal care': 'Cleaning, toiletries and everyday household supplies.',
    'Bakery, pasta & noodles': 'Bread, noodles, pasta, cereals and bakery favourites.',
    DEFAULT: 'Quality products for retail and wholesale customers across the UK.'
};

const HOME_PRODUCT_STRIPS = [
    { gridId: 'featured-products-grid', getProducts: () => getFeaturedProducts(), discountOffset: 0 },
    { gridId: 'best-sellers-grid', getProducts: () => getBestSellerProducts(), discountOffset: 1 },
    { gridId: 'new-arrivals-grid', getProducts: () => getNewArrivalProducts(), discountOffset: 2 },
    { gridId: 'hot-offers-grid', getProducts: () => getHotOfferProducts(), discountOffset: 3 },
    { gridId: 'exclusive-products-grid', getProducts: () => getExclusiveProducts(), discountOffset: 4 }
];

function buildHeroSlidesHTML(heroSlides) {
    return heroSlides.map((slide, i) => `
        <div class="hero-slide${i === 0 ? ' active' : ''}" data-index="${i}" aria-hidden="${i !== 0}">
            <a href="${escHeroAttr(slide.href)}" class="hero-slide-link" aria-label="${escHeroAttr(slide.title || `View promotion ${i + 1}`)}">
                <img class="hero-slide-bg" src="${escHeroAttr(slide.image)}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async">
            </a>
        </div>
    `).join('');
}

function stopHeroSliderAutoplay(slider) {
    if (!slider) return;
    if (slider._heroTimer) {
        clearInterval(slider._heroTimer);
        slider._heroTimer = null;
    }
}

function bindHeroSliderControls(slider, { slidesChanged = false } = {}) {
    stopHeroSliderAutoplay(slider);

    const dotsWrap = document.getElementById('hero-slider-dots');
    const prevBtn = document.getElementById('hero-slider-prev');
    const nextBtn = document.getElementById('hero-slider-next');

    const getSlides = () => slider.querySelectorAll('.hero-slide');
    const slides = getSlides();
    if (!slides.length) return;

    if (slidesChanged || !dotsWrap?.children.length) {
        if (dotsWrap) {
            dotsWrap.innerHTML = Array.from(slides).map((_, i) => `
                <button type="button" class="hero-dot${i === 0 ? ' active' : ''}" data-index="${i}"
                    aria-label="Go to slide ${i + 1}"></button>
            `).join('');
        }
    }

    if (typeof slider._heroIndex !== 'number') slider._heroIndex = 0;

    function getSlideDirection(from, to, total) {
        if (from === to) return 'next';
        if (from === total - 1 && to === 0) return 'next';
        if (from === 0 && to === total - 1) return 'prev';
        return to > from ? 'next' : 'prev';
    }

    function clearSlideMotion(slideEls) {
        slideEls.forEach((s) => {
            s.classList.remove('hero-slide--leave', 'hero-slide--enter', 'hero-slide--from-next', 'hero-slide--from-prev');
        });
    }

    function goTo(index, { animate = true } = {}) {
        const slideEls = getSlides();
        const dots = dotsWrap ? dotsWrap.querySelectorAll('.hero-dot') : [];
        if (!slideEls.length) return;

        const total = slideEls.length;
        const from = slider._heroIndex;
        const to = ((index % total) + total) % total;

        if (from === to) {
            slideEls.forEach((s, i) => {
                s.classList.toggle('active', i === to);
                s.setAttribute('aria-hidden', i !== to);
            });
            dots.forEach((d, i) => d.classList.toggle('active', i === to));
            return;
        }

        const direction = getSlideDirection(from, to, total);
        const fromEl = slideEls[from];
        const toEl = slideEls[to];

        clearSlideMotion(slideEls);

        if (animate && fromEl && toEl) {
            toEl.classList.add('hero-slide--enter', direction === 'next' ? 'hero-slide--from-next' : 'hero-slide--from-prev');

            requestAnimationFrame(() => {
                fromEl.classList.add('hero-slide--leave', direction === 'next' ? 'hero-slide--from-next' : 'hero-slide--from-prev');
                fromEl.classList.remove('active');
                toEl.classList.add('active');
            });

            const finishMotion = (e) => {
                if (e.propertyName !== 'opacity') return;
                clearSlideMotion(slideEls);
                fromEl.removeEventListener('transitionend', finishMotion);
            };
            fromEl.addEventListener('transitionend', finishMotion);
        } else {
            slideEls.forEach((s, i) => {
                s.classList.toggle('active', i === to);
                s.setAttribute('aria-hidden', i !== to);
            });
        }

        if (animate && fromEl && toEl) {
            slideEls.forEach((s, i) => {
                if (i !== from && i !== to) {
                    s.classList.remove('active');
                    s.setAttribute('aria-hidden', true);
                }
            });
            fromEl.setAttribute('aria-hidden', true);
            toEl.setAttribute('aria-hidden', false);
        } else {
            slideEls.forEach((s, i) => {
                s.setAttribute('aria-hidden', i !== to);
            });
        }

        slider._heroIndex = to;
        dots.forEach((d, i) => d.classList.toggle('active', i === to));
    }

    function next() {
        const total = getSlides().length;
        if (total <= 1) return;
        goTo(slider._heroIndex + 1);
    }

    function prev() {
        const total = getSlides().length;
        if (total <= 1) return;
        goTo(slider._heroIndex - 1);
    }

    function startAutoplay() {
        stopHeroSliderAutoplay(slider);
        const total = getSlides().length;
        if (total <= 1) return;
        slider._heroTimer = setInterval(next, 5500);
    }

    slider._heroGoTo = goTo;
    slider._heroNext = next;
    slider._heroPrev = prev;
    slider._heroStartAutoplay = startAutoplay;

    if (!slider.dataset.heroBound) {
        slider.dataset.heroBound = '1';

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                slider._heroNext?.();
                slider._heroStartAutoplay?.();
            });
        }
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                slider._heroPrev?.();
                slider._heroStartAutoplay?.();
            });
        }
        if (dotsWrap) {
            dotsWrap.addEventListener('click', (e) => {
                const dot = e.target.closest('.hero-dot');
                if (!dot) return;
                slider._heroGoTo?.(parseInt(dot.dataset.index, 10));
                slider._heroStartAutoplay?.();
            });
        }

        slider.addEventListener('mouseenter', () => stopHeroSliderAutoplay(slider));
        slider.addEventListener('mouseleave', () => slider._heroStartAutoplay?.());
    }

    goTo(slidesChanged ? 0 : slider._heroIndex, { animate: !slidesChanged });
    startAutoplay();
}

function heroSlidesFingerprint(slides) {
    return slides.map(s => `${s.image}|${s.href}|${s.title || ''}`).join(';;');
}

function renderHeroSlides(slider, heroSlides) {
    stopHeroSliderAutoplay(slider);
    slider.querySelectorAll('.hero-slide').forEach(el => el.remove());

    const anchor = slider.querySelector('.hero-slider-prev') || slider.firstChild;
    const html = buildHeroSlidesHTML(heroSlides);
    if (anchor) {
        anchor.insertAdjacentHTML('beforebegin', html);
    } else {
        slider.insertAdjacentHTML('afterbegin', html);
    }

    delete slider.dataset.heroBound;
    const dotsWrap = document.getElementById('hero-slider-dots');
    if (dotsWrap) dotsWrap.innerHTML = '';
    slider._heroIndex = 0;
}

async function refreshHeroSlider() {
    const slider = document.getElementById('hero-slider');
    if (!slider) return;

    let heroSlides = loadHeroSlides();
    if (!heroSlides.length && typeof prefetchHeroBanners === 'function') {
        await prefetchHeroBanners();
        heroSlides = loadHeroSlides();
    }
    if (!heroSlides.length) return;

    const fingerprint = heroSlidesFingerprint(heroSlides);
    let slidesChanged = false;
    if (slider.dataset.heroSlides !== fingerprint) {
        slider.dataset.heroSlides = fingerprint;
        renderHeroSlides(slider, heroSlides);
        slidesChanged = true;
    }

    bindHeroSliderControls(slider, { slidesChanged });
}

function buildCultureBannersHTML() {
    const items = cultureBannersData.length
        ? cultureBannersData
        : [];
    if (!items.length) {
        return `
            <div class="top-cat-culture-empty" style="padding:1rem 0;color:var(--text-muted,#64748b);font-size:.9rem">
                Culture banners will appear here once published.
            </div>
        `;
    }
    return items.map((item, i) => `
        <a href="${escHeroAttr(item.href)}" class="top-cat-banner top-cat-culture-banner" aria-label="${escHeroAttr(item.title || `Explore world foods culture ${i + 1}`)}">
            <img src="${escHeroAttr(item.image)}" alt="${escHeroAttr(item.title || `World foods culture ${i + 1}`)}" width="390" height="160" loading="lazy" decoding="async">
        </a>
    `).join('');
}

function renderTopCategories() {
    const carousel = document.getElementById('top-cat-carousel');
    if (!carousel) return;

    const cats = getCategoryStats().slice().sort((a, b) => b.Product_Count - a.Product_Count);
    if (!cats.length) {
        carousel.innerHTML = Array.from({ length: 6 }, () => `
            <div class="top-cat-card top-cat-card--skeleton" aria-hidden="true">
                <div class="top-cat-card-image">
                    <div class="skeleton skeleton-image" style="height:100%;min-height:88px;border-radius:12px;"></div>
                </div>
                <span class="top-cat-card-name"><span class="skeleton" style="display:block;height:12px;width:70%;margin:8px auto 0;"></span></span>
            </div>
        `).join('');
        return;
    }

    carousel.innerHTML = cats.map(cat => {
        const name = normalizeCategoryName(cat.CategoryName);
        return `
            <a href="products.html?category=${encodeURIComponent(cat.CategoryName)}" class="top-cat-card">
                <div class="top-cat-card-image">
                    ${renderCategoryCardImageHTML(cat.CategoryName)}
                </div>
                <span class="top-cat-card-name">${name}</span>
            </a>
        `;
    }).join('');

    paintCultureBanners();
}

async function paintCultureBanners() {
    const bannersTop = document.getElementById('top-cat-banners-top');
    const bannersBottom = document.getElementById('top-cat-banners-bottom');

    const paint = () => {
        if (!bannersTop) return;
        bannersTop.className = 'top-cat-banners top-cat-banners--cultures';
        bannersTop.innerHTML = buildCultureBannersHTML();
        initTopCatCultureBannersCarousel();
    };

    // Paint bundled fallback assets immediately; replace them with managed
    // culture banners when the API response arrives.
    paint();
    if (bannersBottom) bannersBottom.innerHTML = '';

    if (typeof prefetchCultureBanners === 'function') {
        await prefetchCultureBanners();
        if (cultureBannersData.length) paint();
    }
}

function initTopCatCultureBannersCarousel() {
    const carousel = document.getElementById('top-cat-banners-top');
    if (!carousel) return;

    if (cultureBannersTimer) {
        clearInterval(cultureBannersTimer);
        cultureBannersTimer = null;
    }

    const cards = carousel.querySelectorAll('.top-cat-culture-banner');
    if (cards.length <= 1) return;

    const getScrollStep = () => {
        const card = carousel.querySelector('.top-cat-culture-banner');
        if (!card) return 320;
        const gap = parseFloat(getComputedStyle(carousel).columnGap || getComputedStyle(carousel).gap) || 20;
        return card.offsetWidth + gap;
    };

    const scrollNext = () => {
        const step = getScrollStep();
        const maxScroll = carousel.scrollWidth - carousel.clientWidth;
        if (maxScroll <= 0) return;

        if (carousel.scrollLeft >= maxScroll - 4) {
            carousel.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
            carousel.scrollBy({ left: step, behavior: 'smooth' });
        }
    };

    const startAutoplay = () => {
        if (cultureBannersTimer) clearInterval(cultureBannersTimer);
        cultureBannersTimer = setInterval(scrollNext, 2000);
    };

    const stopAutoplay = () => {
        if (cultureBannersTimer) {
            clearInterval(cultureBannersTimer);
            cultureBannersTimer = null;
        }
    };

    if (!carousel.dataset.cultureCarouselBound) {
        carousel.addEventListener('mouseenter', stopAutoplay);
        carousel.addEventListener('mouseleave', startAutoplay);
        carousel.addEventListener('touchstart', stopAutoplay, { passive: true });
        carousel.addEventListener('touchend', startAutoplay, { passive: true });
        carousel.dataset.cultureCarouselBound = 'true';
    }

    startAutoplay();
}

function initTopCatCarousel() {
    const track = document.getElementById('top-cat-carousel');
    const prev = document.getElementById('top-cat-prev');
    const next = document.getElementById('top-cat-next');
    if (!track) return;

    const scrollAmount = () => Math.min(track.clientWidth * 0.75, 320);

    if (prev) {
        prev.addEventListener('click', () => {
            track.scrollBy({ left: -scrollAmount(), behavior: 'smooth' });
        });
    }
    if (next) {
        next.addEventListener('click', () => {
            track.scrollBy({ left: scrollAmount(), behavior: 'smooth' });
        });
    }
}

function renderProductStrip(gridId, products, discountOffset) {
    const grid = document.getElementById(gridId);
    if (!grid) return;

    const section = grid.closest('.section');
    if (!products.length) {
        grid.innerHTML = '';
        if (section) section.style.display = 'none';
        return;
    }
    if (section) section.style.display = '';

    grid.innerHTML = products.map((product, index) =>
        buildProductCardHTML(product, index, discountOffset)
    ).join('');

    bindProductCards(grid);

    if (typeof observeFadeElements === 'function') {
        observeFadeElements(grid.querySelectorAll('.fp-card'));
    }

    initProductStripCarousel(gridId);
}

/** Enable seamless loop scrolling for strips with fewer cards (manual drag still loops). */
function initProductStripInfiniteLoop(gridId) {
    const grid = document.getElementById(gridId);
    if (!grid || typeof setupFpGridInfiniteLoop !== 'function') return;
    const originals = grid.querySelectorAll('.fp-card:not([data-fp-clone="1"])');
    if (originals.length < 2) return;
    setupFpGridInfiniteLoop(grid);
    if (!grid.dataset.fpLoopScrollBound) {
        grid.addEventListener('scroll', () => normalizeFpGridScroll(grid), { passive: true });
        grid.dataset.fpLoopScrollBound = '1';
    }
}

function renderHomeProductSkeletons(count = 6) {
    const skeletons = Array.from({ length: count }, () => `
        <article class="fp-card skeleton-card" aria-hidden="true">
            <div class="fp-image-area">
                <div class="skeleton skeleton-image fp-skeleton-image"></div>
            </div>
            <div class="fp-content">
                <div class="skeleton skeleton-badge"></div>
                <div class="skeleton skeleton-title"></div>
            </div>
        </article>
    `).join('');

    HOME_PRODUCT_STRIPS.forEach(({ gridId }) => {
        const grid = document.getElementById(gridId);
        if (!grid || grid.children.length) return;
        grid.innerHTML = skeletons;
    });
}

function renderHomeProductStrips() {
    HOME_PRODUCT_STRIPS.forEach(({ gridId, getProducts, discountOffset }) => {
        renderProductStrip(gridId, getProducts(), discountOffset);
    });
}

function renderFeaturedProducts() {
    renderHomeProductStrips();
}

function initProductStripCarousel(gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const count = grid.querySelectorAll('.fp-card').length;
    if (count >= 7) {
        initFpGridAutoScroll(gridId, { minCards: 7, intervalMs: 2000 });
    } else {
        initProductStripInfiniteLoop(gridId);
    }
}


let testimonialsTimer = null;

function buildTestimonialCardHTML(item) {
    return `
        <article class="testimonial-card">
            <div class="testimonial-card__top">
                <i class="fa-solid fa-quote-left testimonial-quote-icon" aria-hidden="true"></i>
                <div class="testimonial-stars" aria-label="5 out of 5 stars">
                    <i class="fa-solid fa-star"></i>
                    <i class="fa-solid fa-star"></i>
                    <i class="fa-solid fa-star"></i>
                    <i class="fa-solid fa-star"></i>
                    <i class="fa-solid fa-star"></i>
                </div>
            </div>
            <p class="testimonial-text">${item.text}</p>
            <div class="testimonial-author">
                <span class="testimonial-avatar">${item.initials}</span>
                <div class="testimonial-author__meta">
                    <span class="testimonial-name">${item.name}</span>
                    <span class="testimonial-role">Verified Customer</span>
                </div>
            </div>
        </article>
    `;
}

function renderTestimonials() {
    const carousel = document.getElementById('testimonials-carousel');
    if (!carousel) return;

    const metaTestimonials = (window.__INITIAL_METADATA__ && window.__INITIAL_METADATA__.testimonials) ||
                             (typeof CATEGORY_METADATA !== 'undefined' && CATEGORY_METADATA && CATEGORY_METADATA.testimonials);
    const getItems = metaTestimonials && metaTestimonials.length
        ? Promise.resolve(metaTestimonials)
        : fetch('/api/v1/testimonials').then(r => r.ok ? r.json() : []).catch(() => []);

    getItems.then(items => {
        const list = Array.isArray(items) ? items : [];
        const section = carousel.closest('.section');
        if (!list.length) {
            carousel.innerHTML = '';
            if (section) section.style.display = 'none';
            return;
        }
        if (section) section.style.display = '';
        carousel.innerHTML = list.map(buildTestimonialCardHTML).join('');
        if (typeof observeFadeElements === 'function') {
            observeFadeElements(carousel.querySelectorAll('.testimonial-card'));
        }
        initTestimonialsCarousel();
    });
}

function initTestimonialsCarousel() {
    const carousel = document.getElementById('testimonials-carousel');
    if (!carousel) return;

    if (testimonialsTimer) {
        clearInterval(testimonialsTimer);
        testimonialsTimer = null;
    }

    const cards = carousel.querySelectorAll('.testimonial-card');
    if (cards.length <= 3) return;

    const getScrollStep = () => {
        const card = carousel.querySelector('.testimonial-card');
        if (!card) return 320;
        const gap = parseFloat(getComputedStyle(carousel).columnGap || getComputedStyle(carousel).gap) || 20;
        return card.offsetWidth + gap;
    };

    const scrollNext = () => {
        const step = getScrollStep();
        const maxScroll = carousel.scrollWidth - carousel.clientWidth;
        if (maxScroll <= 0) return;

        if (carousel.scrollLeft >= maxScroll - 4) {
            carousel.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
            carousel.scrollBy({ left: step, behavior: 'smooth' });
        }
    };

    const startAutoplay = () => {
        if (testimonialsTimer) clearInterval(testimonialsTimer);
        testimonialsTimer = setInterval(scrollNext, 2000);
    };

    const stopAutoplay = () => {
        if (testimonialsTimer) {
            clearInterval(testimonialsTimer);
            testimonialsTimer = null;
        }
    };

    if (!carousel.dataset.carouselBound) {
        carousel.addEventListener('mouseenter', stopAutoplay);
        carousel.addEventListener('mouseleave', startAutoplay);
        carousel.addEventListener('touchstart', stopAutoplay, { passive: true });
        carousel.addEventListener('touchend', startAutoplay, { passive: true });
        carousel.dataset.carouselBound = 'true';
    }

    startAutoplay();
}
