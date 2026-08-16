/* ============================================================
   GMS BASKET STORE — per-user basket
   Guest: localStorage key gms_basket_v1:guest
   Signed-in: gms_basket_v1:u:<userId> + synced to /api/v1/cart
   Cross-device: last-write-wins via local ts vs server updated_at
   ============================================================ */

const SHOPPING_STORE_BASE = 'gms_basket_v1';
const SHOPPING_STORE_GUEST = `${SHOPPING_STORE_BASE}:guest`;
const LEGACY_STORE_KEY   = 'gms_shopping_v2';
const LEGACY_BUCKET_KEY  = 'gms_bucket_v1';
const SHARED_LEGACY_KEY  = SHOPPING_STORE_BASE;

const GmsShoppingStore = (function () {

    /** @type {Map<string, number>} productName → quantity */
    const basketByName = new Map();
    let _ready = false;
    let _syncTimer = null;
    let _boundUserId = null;
    let _syncing = false;
    let _syncQueued = false;
    /** @type {number} local cart revision (unix ms) */
    let _localTs = 0;
    let _visibilityBound = false;

    function currentUserId() {
        try {
            if (typeof CustomerAPI === 'undefined') return null;
            if (!CustomerAPI.getToken()) return null;
            const user = CustomerAPI.getUser();
            return user?.id ? String(user.id) : null;
        } catch (_) {
            return null;
        }
    }

    function storageKeyFor(userId) {
        return userId ? `${SHOPPING_STORE_BASE}:u:${userId}` : SHOPPING_STORE_GUEST;
    }

    function activeStorageKey() {
        return storageKeyFor(currentUserId());
    }

    function resolveProduct(key) {
        return typeof resolveStoredProductKey === 'function'
            ? resolveStoredProductKey(key)
            : null;
    }

    function readRaw(key) {
        let raw = null;
        try { raw = localStorage.getItem(key); } catch (_) {}
        if (!raw) {
            try { raw = sessionStorage.getItem(key); } catch (_) {}
        }
        return raw;
    }

    function writeRaw(key, json) {
        try { localStorage.setItem(key, json); } catch (_) {}
        try { sessionStorage.setItem(key, json); } catch (_) {}
    }

    function removeRaw(key) {
        try { localStorage.removeItem(key); } catch (_) {}
        try { sessionStorage.removeItem(key); } catch (_) {}
    }

    function parseCartPayload(raw) {
        const map = new Map();
        let ts = 0;
        if (!raw) return { map, ts };
        try {
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') return { map, ts };
            ts = parseInt(data.ts, 10) || 0;
            const cart = data.cart || data.basket;
            if (cart && typeof cart === 'object') {
                Object.entries(cart).forEach(([name, qty]) => {
                    const amount = parseInt(qty, 10) || 0;
                    if (name && amount > 0) map.set(name, amount);
                });
            }
        } catch (_) {}
        return { map, ts };
    }

    function persist(bumpTs) {
        const key = activeStorageKey();
        if (bumpTs !== false) {
            _localTs = Date.now();
        }
        const payload = {
            v: 1,
            ts: _localTs || Date.now(),
            cart: Object.fromEntries(basketByName),
        };
        writeRaw(key, JSON.stringify(payload));
        scheduleServerSync();
    }

    function migrateLegacyStorageInto(targetMap) {
        const keys = [LEGACY_STORE_KEY, LEGACY_BUCKET_KEY, SHARED_LEGACY_KEY];
        for (const key of keys) {
            const raw = readRaw(key);
            if (!raw) continue;
            try {
                const parsed = parseCartPayload(raw);
                parsed.map.forEach((qty, name) => {
                    targetMap.set(name, Math.max(targetMap.get(name) || 0, qty));
                });
            } catch (_) {}
            if (key === SHARED_LEGACY_KEY) {
                const guestRaw = readRaw(SHOPPING_STORE_GUEST);
                if (!guestRaw) writeRaw(SHOPPING_STORE_GUEST, raw);
                removeRaw(SHARED_LEGACY_KEY);
            } else {
                removeRaw(key);
            }
        }
    }

    function loadFromStorage() {
        basketByName.clear();
        const uid = currentUserId();
        _boundUserId = uid;

        if (!uid) {
            const guestParsed = parseCartPayload(readRaw(SHOPPING_STORE_GUEST));
            migrateLegacyStorageInto(guestParsed.map);
            guestParsed.map.forEach((qty, name) => basketByName.set(name, qty));
            _localTs = guestParsed.ts || 0;
            if (guestParsed.map.size) {
                writeRaw(
                    SHOPPING_STORE_GUEST,
                    JSON.stringify({
                        v: 1,
                        ts: _localTs || Date.now(),
                        cart: Object.fromEntries(guestParsed.map),
                    })
                );
            }
            return;
        }

        const userParsed = parseCartPayload(readRaw(storageKeyFor(uid)));
        userParsed.map.forEach((qty, name) => basketByName.set(name, qty));
        _localTs = userParsed.ts || 0;
    }

    function cleanOldKeys() {
        ['gms_cart_v1', 'gms_favs_v1', 'gms_migrated_v2', 'gms_shopping_v3', 'gms_bucket_v1'].forEach((k) => {
            removeRaw(k);
        });
    }

    function ensureReady() {
        if (_ready) return;
        _ready = true;
        cleanOldKeys();
        loadFromStorage();
        bindVisibilitySync();
    }

    function emitBasket() {
        document.dispatchEvent(new CustomEvent('gms:basket-updated'));
        document.dispatchEvent(new CustomEvent('gms:cart-updated'));
    }

    function refreshBadges() {
        if (typeof updateHeaderBadges === 'function') updateHeaderBadges();
    }

    function applyMap(map) {
        basketByName.clear();
        (map || new Map()).forEach((qty, name) => {
            const amount = parseInt(qty, 10) || 0;
            if (name && amount > 0) basketByName.set(name, amount);
        });
    }

    function scheduleServerSync() {
        const uid = currentUserId();
        if (!uid || typeof CustomerAPI === 'undefined' || !CustomerAPI.getToken()) return;
        if (_syncTimer) clearTimeout(_syncTimer);
        _syncTimer = setTimeout(() => {
            _syncTimer = null;
            pushToServer().catch(() => {});
        }, 350);
    }

    async function pushToServer() {
        const uid = currentUserId();
        if (!uid || typeof CustomerAPI === 'undefined' || !CustomerAPI.getToken()) return;
        if (_syncing) {
            _syncQueued = true;
            return;
        }
        _syncing = true;
        try {
            do {
                _syncQueued = false;
                const items = [...basketByName.entries()].map(([product_name, quantity]) => ({
                    product_name,
                    quantity,
                }));
                const saved = await CustomerAPI.saveCart(items);
                if (saved && saved.updated_at) {
                    // Align local clock with server so other devices can LWW correctly
                    _localTs = Math.max(_localTs, Math.round(Number(saved.updated_at) * 1000));
                    writeRaw(
                        storageKeyFor(uid),
                        JSON.stringify({
                            v: 1,
                            ts: _localTs,
                            cart: Object.fromEntries(basketByName),
                        })
                    );
                }
            } while (_syncQueued);
        } finally {
            _syncing = false;
        }
    }

    async function pullFromServer() {
        if (typeof CustomerAPI === 'undefined' || !CustomerAPI.getToken()) {
            return { map: new Map(), updatedAtMs: 0 };
        }
        const data = await CustomerAPI.getCart();
        const map = new Map();
        (data?.items || []).forEach((item) => {
            const name = String(item.product_name || '').trim();
            const qty = parseInt(item.quantity, 10) || 0;
            if (name && qty > 0) map.set(name, qty);
        });
        const updatedAtMs = data?.updated_at
            ? Math.round(Number(data.updated_at) * 1000)
            : 0;
        return { map, updatedAtMs };
    }

    function mapsEqual(a, b) {
        if (a.size !== b.size) return false;
        for (const [k, v] of a) {
            if (b.get(k) !== v) return false;
        }
        return true;
    }

    /**
     * After login/register: load this user's DB cart, merge guest items once,
     * save, and switch local storage to the user key.
     */
    async function onLogin() {
        ensureReady();
        const uid = currentUserId();
        if (!uid) return;

        const guestParsed = parseCartPayload(readRaw(SHOPPING_STORE_GUEST));
        let serverMap = new Map();
        let serverTs = 0;
        try {
            const pulled = await pullFromServer();
            serverMap = pulled.map;
            serverTs = pulled.updatedAtMs;
        } catch (_) {
            const cached = parseCartPayload(readRaw(storageKeyFor(uid)));
            serverMap = cached.map;
            serverTs = cached.ts;
        }

        const merged = new Map(serverMap);
        guestParsed.map.forEach((qty, name) => {
            merged.set(name, Math.max(merged.get(name) || 0, qty));
        });

        applyMap(merged);
        _boundUserId = uid;
        _localTs = Math.max(Date.now(), serverTs, guestParsed.ts || 0);
        persist(false);
        if (_syncTimer) {
            clearTimeout(_syncTimer);
            _syncTimer = null;
        }
        try {
            await pushToServer();
        } catch (_) {}

        removeRaw(SHOPPING_STORE_GUEST);
        removeRaw(SHARED_LEGACY_KEY);

        emitBasket();
        refreshBadges();
    }

    /** After logout: flush user cart to server, then show empty guest basket. */
    async function onLogout() {
        if (_syncTimer) {
            clearTimeout(_syncTimer);
            _syncTimer = null;
        }
        try {
            await pushToServer();
        } catch (_) {}
        _boundUserId = null;
        basketByName.clear();
        _localTs = Date.now();
        writeRaw(SHOPPING_STORE_GUEST, JSON.stringify({ v: 1, ts: _localTs, cart: {} }));
        removeRaw(SHARED_LEGACY_KEY);
        _ready = true;
        emitBasket();
        refreshBadges();
    }

    /**
     * Cross-device sync (last-write-wins):
     * - If server cart is newer → adopt server
     * - If local cart is newer → keep local and push
     * - If equal age → keep local (already matches after previous push)
     */
    let _lastSyncMs = 0;
    const SYNC_COOLDOWN_MS = 10000;

    async function syncFromServer(force = false) {
        ensureReady();
        const uid = currentUserId();
        if (!uid) return;

        const now = Date.now();
        if (!force && (now - _lastSyncMs < SYNC_COOLDOWN_MS)) {
            return;
        }
        _lastSyncMs = now;

        let serverMap = new Map();
        let serverTs = 0;
        try {
            const pulled = await pullFromServer();
            serverMap = pulled.map;
            serverTs = pulled.updatedAtMs;
        } catch (_) {
            return;
        }

        const localMap = new Map(basketByName);
        const localTs = _localTs || 0;

        let nextMap;
        let nextTs;
        let shouldPush = false;

        if (!localTs && serverMap.size) {
            // Fresh device / empty local cache → take server
            nextMap = serverMap;
            nextTs = serverTs || Date.now();
            shouldPush = false;
        } else if (serverTs > localTs) {
            // Other device wrote more recently
            nextMap = serverMap;
            nextTs = serverTs;
            shouldPush = false;
        } else if (localTs > serverTs) {
            // This device has newer edits
            nextMap = localMap;
            nextTs = localTs;
            shouldPush = true;
        } else if (!mapsEqual(localMap, serverMap)) {
            // Same timestamp but drift — prefer non-empty server, else local
            if (serverMap.size && !localMap.size) {
                nextMap = serverMap;
                nextTs = serverTs || Date.now();
                shouldPush = false;
            } else {
                nextMap = localMap;
                nextTs = localTs || Date.now();
                shouldPush = true;
            }
        } else {
            nextMap = localMap;
            nextTs = Math.max(localTs, serverTs);
            shouldPush = false;
        }

        applyMap(nextMap);
        _boundUserId = uid;
        _localTs = nextTs || Date.now();
        writeRaw(
            storageKeyFor(uid),
            JSON.stringify({
                v: 1,
                ts: _localTs,
                cart: Object.fromEntries(basketByName),
            })
        );

        if (shouldPush) {
            try {
                await pushToServer();
            } catch (_) {}
        }

        emitBasket();
        refreshBadges();
    }

    function bindVisibilitySync() {
        if (_visibilityBound) return;
        _visibilityBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && currentUserId()) {
                syncFromServer().catch(() => {});
            }
        });
    }

    function getCartMapObject() {
        ensureReady();
        return Object.fromEntries(basketByName);
    }

    function getCartCount() {
        ensureReady();
        let total = 0;
        basketByName.forEach((qty) => { total += qty; });
        return total;
    }

    function getCartItemCount() {
        ensureReady();
        return basketByName.size;
    }

    function isInCart(productName) {
        ensureReady();
        const p = resolveProduct(productName);
        return p ? basketByName.has(p.productName) : false;
    }

    function getCartQty(productName) {
        ensureReady();
        const p = resolveProduct(productName);
        if (!p) return 0;
        return basketByName.get(p.productName) || 0;
    }

    function addToCartStore(productName, quantity) {
        ensureReady();
        const qty = Math.max(1, parseInt(quantity, 10) || 1);
        const p = resolveProduct(productName);
        const name = p ? p.productName : String(productName).trim();
        if (!name) return null;
        basketByName.set(name, (basketByName.get(name) || 0) + qty);
        persist();
        return p;
    }

    function setCartQuantityStore(productName, quantity) {
        ensureReady();
        const p = resolveProduct(productName);
        const name = p ? p.productName : String(productName).trim();
        if (!name) return;
        const qty = parseInt(quantity, 10) || 0;
        if (qty <= 0) basketByName.delete(name);
        else basketByName.set(name, qty);
        persist();
    }

    function removeFromCartStore(productName) {
        ensureReady();
        const p = resolveProduct(productName);
        const name = p ? p.productName : String(productName).trim();
        if (name) basketByName.delete(name);
        persist();
    }

    function clearCartStore() {
        ensureReady();
        basketByName.clear();
        persist();
    }

    function reloadFromStorage() {
        _ready = false;
        ensureReady();
        emitBasket();
        refreshBadges();
    }

    window.addEventListener('storage', (e) => {
        if (!e.key) return;
        if (e.key === activeStorageKey() || e.key === LEGACY_BUCKET_KEY || e.key === SHARED_LEGACY_KEY) {
            reloadFromStorage();
        }
    });

    return {
        hydrate: ensureReady,
        reloadFromStorage,
        getCartMapObject,
        getCartCount,
        getCartItemCount,
        isInCart,
        getCartQty,
        addToCartStore,
        setCartQuantityStore,
        removeFromCartStore,
        clearCartStore,
        emitBasket,
        emitBucket: emitBasket,
        refreshBadges,
        onLogin,
        onLogout,
        syncFromServer,
        pushToServer,
    };
})();
