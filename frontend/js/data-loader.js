const ALL_PRODUCTS = [];
const PRODUCT_BY_NAME = new Map();
const PRODUCT_BY_DISPLAY = new Map();
const PRODUCT_BY_ID = new Map();
let uniqueLocationIds = [];

let CATEGORY_STATS = [];
let SUBCATEGORY_STATS = [];
let PRODUCT_IMAGE_BY_ID = {};
let PROMOTION_BANNER_IMAGES = [];
let PROMOTION_BANNERS = [];

function setPromotionBanners(banners) {
    PROMOTION_BANNERS = Array.isArray(banners) ? banners : [];
    PROMOTION_BANNER_IMAGES = PROMOTION_BANNERS
        .map(b => (b && (b.imageUrl || b.image_url)) || '')
        .filter(Boolean);
}

function getPromotionBanners() {
    if (Array.isArray(PROMOTION_BANNERS) && PROMOTION_BANNERS.length) {
        return PROMOTION_BANNERS;
    }
    if (Array.isArray(window.PROMOTION_BANNERS) && window.PROMOTION_BANNERS.length) {
        return window.PROMOTION_BANNERS;
    }
    return [];
}

const API_BASE = '';
let _dataReadyPromise = null;
let _dataReady = false;
let _metadataReadyPromise = null;
let _metadataReady = false;
let _homeProductsReadyPromise = null;
let _warmupReadyPromise = null;

function sleepMs(ms) {
    return Promise.resolve();
}

function whenServerWarmupReady(timeoutMs = 0) {
    return Promise.resolve(null);
}

async function fetchJsonWithRetry(url, { retries = 3, cacheMode = undefined } = {}) {
    let lastError = null;
    const fetchOpts = cacheMode ? { cache: cacheMode } : {};
    for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
            const res = await fetch(url, fetchOpts);
            if (res.status === 502 || res.status === 503 || res.status === 504) {
                lastError = new Error(`Temporary upstream error (${res.status})`);
                continue;
            }
            if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}`);
            return await res.json();
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error(`Request failed for ${url}`);
}

function formatDisplayName(str) {
    if (!str) return '';
    return str
        .split(/\s+/)
        .map(word => {
            if (!word) return '';
            if (/^[A-Z0-9/&-]{1,6}$/.test(word)) return word;
            const unitMatch = word.match(/^(\d+(?:\.\d+)?)(g|kg|ml|l|lt|ltr|cl|oz|lb|pcs?|pk|m|cm|mm)$/i);
            if (unitMatch) return unitMatch[1] + unitMatch[2].toLowerCase();
            const expanded = word.replace(/(\d+)([A-Za-z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2');
            return expanded.split(/\s+/).map(part =>
                part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
            ).join(' ');
        })
        .join(' ')
        .replace(/\s+\/\s+/g, ' / ')
        .trim();
}

function normalizeCategoryName(str) {
    if (!str) return '';
    let name = str.trim().replace(/\.+$/, '');
    if (name.includes('/')) {
        return name.split('/').map(part => {
            const cleaned = part.trim().replace(/\.+$/, '');
            return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
        }).join(' / ');
    }
    if (name === name.toUpperCase() || name === name.toLowerCase()) {
        return name.split(/\s+/).map(word =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function normalizeApiProduct(product) {
    return {
        productId: product.productId,
        categoryId: product.categoryId,
        categoryName: product.categoryName,
        subCategoryId: product.subCategoryId,
        subCategoryName: product.subCategoryName,
        productName: product.productName,
        displayName: product.displayName || formatDisplayName(product.productName),
        weightKG: product.weightKG,
        packType: product.packType || '',
        locationId: 52,
        salesUnitTypeId: 1,
        flaggedCategoryMismatch: false,
        productDescription: product.productDescription || '',
        isFeatured: product.isFeatured === true,
        isBestSeller: product.isBestSeller === true,
        isNewArrival: product.isNewArrival === true,
        isHotOffer: product.isHotOffer === true,
        isExclusive: product.isExclusive === true,
        discountPercent: parseInt(product.discountPercent, 10) || 0,
        sellingPrice: Number(product.sellingPrice) || 0,
        kitchenCulture: product.kitchenCulture || null,
        primaryImageUrl: product.primaryImageUrl || '',
    };
}

function buildProductIndexFromApi(products) {
    ALL_PRODUCTS.length = 0;

    products.forEach(product => {
        if (HIDDEN_CATEGORIES.has(product.categoryName)) return;
        ALL_PRODUCTS.push(normalizeApiProduct(product));
    });

    const locSet = new Set();

    ALL_PRODUCTS.forEach(p => {
        locSet.add(p.locationId);
    });

    uniqueLocationIds = Array.from(locSet).sort((a, b) => a - b);
    rebuildProductLookup();
}

function mergeProductsIntoCatalog(products) {
    if (!Array.isArray(products) || !products.length) return;

    let added = false;
    products.forEach(product => {
        if (HIDDEN_CATEGORIES.has(product.categoryName)) return;
        const normalized = normalizeApiProduct(product);
        if (PRODUCT_BY_NAME.has(normalized.productName)) return;
        ALL_PRODUCTS.push(normalized);
        added = true;
    });

    if (added) rebuildProductLookup();
    buildImageMapsFromProducts(products);
}

function buildProductIndex() {
    if (ALL_PRODUCTS.length) return;
}

function rebuildProductLookup() {
    PRODUCT_BY_NAME.clear();
    PRODUCT_BY_DISPLAY.clear();
    PRODUCT_BY_ID.clear();

    ALL_PRODUCTS.forEach(product => {
        PRODUCT_BY_NAME.set(product.productName, product);
        PRODUCT_BY_NAME.set(product.productName.toUpperCase(), product);
        if (product.displayName) {
            PRODUCT_BY_DISPLAY.set(product.displayName, product);
            PRODUCT_BY_DISPLAY.set(product.displayName.toUpperCase(), product);
        }
        if (product.productId != null) {
            PRODUCT_BY_ID.set(product.productId, product);
            PRODUCT_BY_ID.set(String(product.productId), product);
        }
    });
}

function buildImageMaps(byId, products) {
    PRODUCT_IMAGE_BY_ID = { ...(byId || {}) };
    (products || []).forEach(p => {
        const url = (byId && byId[p.productId]) || p.primaryImageUrl || '';
        if (!url || p.productId == null) return;
        PRODUCT_IMAGE_BY_ID[p.productId] = url;
        PRODUCT_IMAGE_BY_ID[String(p.productId)] = url;
    });
}

function buildImageMapsFromProducts(products) {
    const byId = {};
    (products || []).forEach(p => {
        const url = p.primaryImageUrl || '';
        if (!url || p.productId == null) return;
        byId[p.productId] = url;
        byId[String(p.productId)] = url;
    });
    buildImageMaps(byId, products || []);
}

const HIDDEN_CATEGORIES = new Set([
    'oyster', 'lottery', 'vape', 'LOTTERY PAYOUT', 'PAYPOINT'
]);

// Short-lived browser cache so revisits feel instant (same UI/API shape)
const CATALOG_CACHE_TTL_MS = 8 * 60 * 1000;
const CATALOG_META_CACHE_KEY = 'gms_catalog_meta_v2';
const CATALOG_HOME_CACHE_KEY = 'gms_catalog_home_v2';
const CATALOG_PRODUCTS_CACHE_KEY = 'gms_catalog_products_v2';

function _readCatalogCache(key) {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (Date.now() - (parsed.ts || 0) > CATALOG_CACHE_TTL_MS) return null;
        return parsed.data;
    } catch (_) {
        return null;
    }
}

function _writeCatalogCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) {
        // Quota exceeded — ignore; network path still works
    }
}

async function fetchCatalogMetadata() {
    const cached = _readCatalogCache(CATALOG_META_CACHE_KEY);
    if (cached) return cached;
    await whenServerWarmupReady();
    const data = await fetchJsonWithRetry(`${API_BASE}/api/v1/catalog/metadata`);
    _writeCatalogCache(CATALOG_META_CACHE_KEY, data);
    return data;
}

async function fetchCatalogProductsBulk() {
    const cached = _readCatalogCache(CATALOG_PRODUCTS_CACHE_KEY);
    if (cached) return cached;
    await whenServerWarmupReady();
    const data = await fetchJsonWithRetry(`${API_BASE}/api/v1/catalog/products-bulk`);
    _writeCatalogCache(CATALOG_PRODUCTS_CACHE_KEY, data);
    return data;
}

async function fetchHomeProducts() {
    const cached = _readCatalogCache(CATALOG_HOME_CACHE_KEY);
    if (cached) return cached;
    await whenServerWarmupReady();
    const data = await fetchJsonWithRetry(`${API_BASE}/api/v1/catalog/home-products`);
    _writeCatalogCache(CATALOG_HOME_CACHE_KEY, data);
    return data;
}

async function fetchCartProducts(productNames) {
    const names = Array.from(new Set((productNames || []).map(name => String(name || '').trim()).filter(Boolean)));
    if (!names.length) return [];
    await whenServerWarmupReady();
    const data = await fetchJsonWithRetry(
        `${API_BASE}/api/v1/catalog/cart-products?names=${encodeURIComponent(names.join(','))}`
    );
    return (data && data.products) || [];
}

async function fetchCatalogBootstrap() {
    await whenServerWarmupReady();
    return fetchJsonWithRetry(`${API_BASE}/api/v1/catalog/bootstrap`);
}

function applyCatalogMetadata(data) {
    CATEGORY_STATS = data.categoryStats || [];
    SUBCATEGORY_STATS = data.subcategoryStats || [];
    setPromotionBanners(Array.isArray(data.promotionBanners) ? data.promotionBanners : []);
    if (!PROMOTION_BANNERS.length && Array.isArray(data.promotionBannerImages)) {
        PROMOTION_BANNER_IMAGES = data.promotionBannerImages.filter(Boolean);
    }
    if (data.siteSettings && typeof applySiteSettings === 'function') {
        applySiteSettings(data.siteSettings);
    }
    if (document.body.dataset.page === 'home' && typeof refreshHeroSlider === 'function') {
        refreshHeroSlider();
    }
    _metadataReady = true;
    document.dispatchEvent(new CustomEvent('gms:metadata-ready'));
}

function finalizeCatalogLoad() {
    _dataReady = true;
    document.dispatchEvent(new CustomEvent('gms:catalog-ready'));
}

function loadCatalogProductsOnly(productsPayload) {
    const products = (productsPayload && productsPayload.products) || [];
    buildImageMapsFromProducts(products);
    buildProductIndexFromApi(products);
    finalizeCatalogLoad();
}

function loadCatalogFromBootstrap(data) {
    applyCatalogMetadata(data);
    const products = data.products || [];
    buildImageMaps(data.productImageById || {}, products);
    buildProductIndexFromApi(products);
    finalizeCatalogLoad();
}

function whenMetadataReady() {
    if (_metadataReady) return Promise.resolve();
    if (window.__INITIAL_METADATA__) {
        applyCatalogMetadata(window.__INITIAL_METADATA__);
        return Promise.resolve();
    }
    if (!_metadataReadyPromise) {
        _metadataReadyPromise = fetchCatalogMetadata()
            .then(applyCatalogMetadata)
            .catch(err => {
                _metadataReadyPromise = null;
                console.error('Failed to load catalog metadata:', err);
                throw err;
            });
    }
    return _metadataReadyPromise;
}

function whenCatalogReady() {
    if (_dataReady) return Promise.resolve();
    if (window.__INITIAL_BOOTSTRAP__) {
        loadCatalogFromBootstrap(window.__INITIAL_BOOTSTRAP__);
        return Promise.resolve();
    }
    if (window.__INITIAL_PRODUCTS__) {
        if (window.__INITIAL_METADATA__) applyCatalogMetadata(window.__INITIAL_METADATA__);
        loadCatalogProductsOnly(window.__INITIAL_PRODUCTS__);
        return Promise.resolve();
    }
    if (!_dataReadyPromise) {
        // Metadata + products in parallel (metadata is not required to start products fetch)
        _dataReadyPromise = Promise.all([
            whenMetadataReady(),
            fetchCatalogProductsBulk(),
        ])
            .then(([, productsPayload]) => loadCatalogProductsOnly(productsPayload))
            .catch(err => {
                console.warn('Split catalog load failed, falling back to bootstrap:', err);
                return fetchCatalogBootstrap()
                    .then(loadCatalogFromBootstrap)
                    .catch(bootstrapErr => {
                        _dataReadyPromise = null;
                        console.error('Failed to load catalog from API:', bootstrapErr);
                        throw bootstrapErr;
                    });
            });
    }
    return _dataReadyPromise;
}

function whenHomeProductsReady() {
    if (ALL_PRODUCTS.length) return Promise.resolve();
    if (window.__INITIAL_HOME_PRODUCTS__) {
        mergeProductsIntoCatalog((window.__INITIAL_HOME_PRODUCTS__ && window.__INITIAL_HOME_PRODUCTS__.products) || []);
        return Promise.resolve();
    }
    if (!_homeProductsReadyPromise) {
        _homeProductsReadyPromise = fetchHomeProducts()
            .then(payload => {
                mergeProductsIntoCatalog((payload && payload.products) || []);
            })
            .catch(err => {
                _homeProductsReadyPromise = null;
                console.error('Failed to load homepage products:', err);
                throw err;
            });
    }
    return _homeProductsReadyPromise;
}

// Auto-consume SSR pre-loaded state on script initialization
if (typeof window !== 'undefined') {
    if (window.__INITIAL_METADATA__) {
        applyCatalogMetadata(window.__INITIAL_METADATA__);
    }
    if (window.__INITIAL_HOME_PRODUCTS__) {
        mergeProductsIntoCatalog((window.__INITIAL_HOME_PRODUCTS__ && window.__INITIAL_HOME_PRODUCTS__.products) || []);
    }
    if (window.__INITIAL_BOOTSTRAP__) {
        loadCatalogFromBootstrap(window.__INITIAL_BOOTSTRAP__);
    } else if (window.__INITIAL_PRODUCTS__) {
        loadCatalogProductsOnly(window.__INITIAL_PRODUCTS__);
    }
}

function getCategoryStats() {
    return CATEGORY_STATS.filter(c => !HIDDEN_CATEGORIES.has(c.CategoryName));
}

function getSubcategoryStats() {
    return SUBCATEGORY_STATS.filter(s => !HIDDEN_CATEGORIES.has(s.CategoryName));
}

function getSubcategoriesForCategory(categoryNameOrId) {
    const stats = getSubcategoryStats();
    if (typeof categoryNameOrId === 'number' || /^[A-Z]{3}\d{2}$/.test(String(categoryNameOrId))) {
        return stats.filter(s => s.ProductCategoryID === categoryNameOrId);
    }
    const upper = String(categoryNameOrId).toUpperCase();
    return stats.filter(s =>
        s.CategoryName.toUpperCase() === upper ||
        normalizeCategoryName(s.CategoryName).toUpperCase() === upper
    );
}

function getTotalProductCount() {
    if (ALL_PRODUCTS.length) return ALL_PRODUCTS.length;
    return getCategoryStats().reduce((sum, cat) => sum + cat.Product_Count, 0);
}

function getFlaggedProducts(flagKey, count) {
    const flagged = ALL_PRODUCTS
        .filter(p => p[flagKey] === true)
        .sort((a, b) => a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' }));
    if (count == null || count <= 0) return flagged;
    return flagged.slice(0, count);
}

function getFeaturedProducts(count) {
    return getFlaggedProducts('isFeatured', count);
}

function getBestSellerProducts(count) {
    return getFlaggedProducts('isBestSeller', count);
}

function getNewArrivalProducts(count) {
    return getFlaggedProducts('isNewArrival', count);
}

function getHotOfferProducts(count) {
    return getFlaggedProducts('isHotOffer', count);
}

function getExclusiveProducts(count) {
    return getFlaggedProducts('isExclusive', count);
}

function resolveStoredProductKey(key) {
    if (key == null) return null;

    if (typeof key === 'object') {
        if (key.productName) {
            const byName = PRODUCT_BY_NAME.get(key.productName)
                || PRODUCT_BY_NAME.get(String(key.productName).toUpperCase());
            if (byName) return byName;
        }
        if (key.productId != null) {
            const byId = PRODUCT_BY_ID.get(key.productId) || PRODUCT_BY_ID.get(String(key.productId));
            if (byId) return byId;
        }
        if (key.displayName) {
            const byDisplay = PRODUCT_BY_DISPLAY.get(key.displayName)
                || PRODUCT_BY_DISPLAY.get(String(key.displayName).toUpperCase());
            if (byDisplay) return byDisplay;
        }
        return null;
    }

    const str = String(key).trim();
    if (!str) return null;

    let product = PRODUCT_BY_NAME.get(str) || PRODUCT_BY_NAME.get(str.toUpperCase());
    if (product) return product;

    product = PRODUCT_BY_DISPLAY.get(str) || PRODUCT_BY_DISPLAY.get(str.toUpperCase());
    if (product) return product;

    product = PRODUCT_BY_ID.get(str);
    if (product) return product;

    return null;
}

function findCategoryByParam(param) {
    if (!param) return null;
    const stats = getCategoryStats();
    if (/^[A-Z]{3}\d{2}$/.test(param)) {
        return stats.find(c => c.ProductCategoryID === param) || null;
    }
    const asNum = parseInt(param, 10);
    if (!isNaN(asNum)) {
        return stats.find(c => c.ProductCategoryID === asNum) || null;
    }
    return stats.find(c =>
        c.CategoryName.toUpperCase() === param.toUpperCase() ||
        normalizeCategoryName(c.CategoryName).toUpperCase() === param.toUpperCase()
    ) || null;
}

function findSubcategoryByParam(param) {
    if (!param) return null;
    const stats = getSubcategoryStats();
    if (param.includes('-')) {
        return stats.find(s => s.ProductSubCategoryID === param) || null;
    }
    const asNum = parseInt(param, 10);
    if (!isNaN(asNum)) {
        return stats.find(s => s.ProductSubCategoryID === asNum) || null;
    }
    return stats.find(s =>
        s.SubCategoryName.toUpperCase() === param.toUpperCase() ||
        normalizeCategoryName(s.SubCategoryName).toUpperCase() === param.toUpperCase()
    ) || null;
}

