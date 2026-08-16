'use strict';

const CustomerAPI = {
    TOKEN_KEY: 'gms_customer_token_v1',
    USER_KEY: 'gms_customer_user_v1',

    get baseUrl() {
        if (window.location.protocol === 'file:') return '';
        return window.location.origin;
    },

    url(path) {
        return `${this.baseUrl}${path}`;
    },

    _read(key) {
        try {
            const fromLocal = localStorage.getItem(key);
            if (fromLocal) return fromLocal;
        } catch (_) {}
        // Migrate older per-tab sessions so refresh/new tabs keep the login
        try {
            const fromSession = sessionStorage.getItem(key);
            if (fromSession) {
                try { localStorage.setItem(key, fromSession); } catch (_) {}
                try { sessionStorage.removeItem(key); } catch (_) {}
                return fromSession;
            }
        } catch (_) {}
        return null;
    },

    _write(key, value) {
        try { localStorage.setItem(key, value); } catch (_) {}
        try { sessionStorage.removeItem(key); } catch (_) {}
    },

    _remove(key) {
        try { localStorage.removeItem(key); } catch (_) {}
        try { sessionStorage.removeItem(key); } catch (_) {}
    },

    getToken() {
        return this._read(this.TOKEN_KEY);
    },

    setSession(token, user) {
        this._write(this.TOKEN_KEY, token);
        this._write(this.USER_KEY, JSON.stringify(user));
    },

    clearSession() {
        this._remove(this.TOKEN_KEY);
        this._remove(this.USER_KEY);
    },

    getUser() {
        try {
            const raw = this._read(this.USER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    },

    isLoggedIn() {
        return Boolean(this.getToken() && this.getUser());
    },

    async request(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        }
        const token = this.getToken();
        if (token) headers.Authorization = `Bearer ${token}`;

        const maxAttempts = options._retries ?? 4;
        let lastError = null;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                const fetchOpts = { ...options, headers };
                if (!fetchOpts.cache && (options.method && options.method.toUpperCase() !== 'GET')) {
                    fetchOpts.cache = 'no-store';
                }
                const res = await fetch(this.url(path), fetchOpts);
                let data = null;
                const text = await res.text();
                if (text) {
                    try {
                        data = JSON.parse(text);
                    } catch (_) {
                        data = text;
                    }
                }
                if (res.status === 503 || res.status === 502) {
                    lastError = new Error(
                        (data && data.detail)
                            ? (typeof data.detail === 'string' ? data.detail : 'Store is still starting up.')
                            : 'Store is still starting up. Please try again in a moment.'
                    );
                    lastError.status = res.status;
                    continue;
                }
                if (!res.ok) {
                    const msg = data && data.detail
                        ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
                        : res.statusText;
                    const err = new Error(msg || 'Request failed');
                    err.status = res.status;
                    throw err;
                }
                return data;
            } catch (err) {
                if (err && err.status && err.status !== 503 && err.status !== 502) throw err;
                lastError = err;
            }
        }
        throw lastError || new Error('Request failed');
    },

    register(payload) {
        return this.request('/api/v1/auth/register', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    login(login, password) {
        return this.request('/api/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ login, password }),
        });
    },

    logout() {
        const token = this.getToken();
        if (token) {
            return this.request('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
        }
        return Promise.resolve();
    },

    me() {
        return this.request('/api/v1/auth/me');
    },

    updateProfile(payload) {
        return this.request('/api/v1/auth/me/profile', {
            method: 'PATCH',
            body: JSON.stringify(payload),
        });
    },

    getCart() {
        return this.request('/api/v1/cart');
    },

    saveCart(items) {
        return this.request('/api/v1/cart', {
            method: 'PUT',
            body: JSON.stringify({ items: items || [] }),
        });
    },
};
