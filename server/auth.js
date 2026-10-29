const crypto = require('crypto');
require('dotenv').config();

const TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_HOURS || 12) * 3600;

let secret = process.env.AUTH_SECRET;
if (!secret) {
    // Without a configured secret every restart invalidates the open sessions.
    secret = crypto.randomBytes(48).toString('hex');
    console.warn('AUTH_SECRET no esta definido en .env: se usa una clave temporal (las sesiones se pierden al reiniciar).');
}

const HASH_PREFIX = 'scrypt';

/** Returns "scrypt$<salt>$<hash>" (hex). */
const hashPassword = (plain) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
    return `${HASH_PREFIX}$${salt}$${hash}`;
};

const isHashed = (stored) => typeof stored === 'string' && stored.startsWith(`${HASH_PREFIX}$`);

/** Accepts scrypt hashes and, for legacy rows, plain-text passwords. */
const verifyPassword = (plain, stored) => {
    if (typeof stored !== 'string' || typeof plain !== 'string') return false;

    if (!isHashed(stored)) {
        const a = Buffer.from(plain);
        const b = Buffer.from(stored);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    const [, salt, hash] = stored.split('$');
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(plain, salt, expected.length);
    return crypto.timingSafeEqual(expected, actual);
};

const base64url = (value) => Buffer.from(value).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

/** Token format: base64url(JSON payload) + "." + HMAC-SHA256 signature. */
const signToken = (payload) => {
    const body = base64url(JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    }));
    return `${body}.${sign(body)}`;
};

const verifyToken = (token) => {
    if (typeof token !== 'string') return null;
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;

    const expected = Buffer.from(sign(body));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;

    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (_) {
        return null;
    }
};

module.exports = { hashPassword, isHashed, verifyPassword, signToken, verifyToken };
