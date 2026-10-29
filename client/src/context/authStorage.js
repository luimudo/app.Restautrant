export const AUTH_TOKEN_KEY = 'restaurant_auth_token';
export const ACTIVE_SEDE_ID_KEY = 'restaurant_active_sede_id';

// Fired by the fetch interceptor when the API rejects the session (401).
export const AUTH_EXPIRED_EVENT = 'restaurant:auth-expired';

const safeGet = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
};
const safeSet = (key, value) => {
    try {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, String(value));
    } catch { /* storage unavailable */ }
};

export const getStoredToken = () => safeGet(AUTH_TOKEN_KEY);
export const setStoredToken = (token) => safeSet(AUTH_TOKEN_KEY, token);
export const getStoredSedeId = () => {
    const raw = safeGet(ACTIVE_SEDE_ID_KEY);
    const id = raw !== null ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
};
export const setStoredSedeId = (sedeId) => safeSet(ACTIVE_SEDE_ID_KEY, sedeId);
