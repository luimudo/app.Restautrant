const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'restaurant.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Executes a SQL statement and returns results in mysql2-compatible format:
 *   SELECT → [rows, null]
 *   INSERT/UPDATE/DELETE → [{ insertId, affectedRows }, null]
 */
function executeQuery(sql, params = []) {
    const args = Array.isArray(params) ? params : [params];
    const verb = sql.trimStart().slice(0, 6).toUpperCase();

    if (verb === 'SELECT' || verb === 'WITH   ' || verb === 'PRAGMA') {
        const rows = db.prepare(sql).all(...args);
        return [rows, null];
    } else {
        const result = db.prepare(sql).run(...args);
        return [
            { insertId: result.lastInsertRowid, affectedRows: result.changes },
            null
        ];
    }
}

/**
 * Compatibility pool that mimics the mysql2 async pool API.
 * All SQLite operations are synchronous under the hood, so
 * transactions in index.js work safely in Node's single thread.
 */
const pool = {
    query: async (sql, params = []) => executeQuery(sql, params),
    execute: async (sql, params = []) => executeQuery(sql, params),

    getConnection: async () => ({
        query: async (sql, params = []) => executeQuery(sql, params),
        execute: async (sql, params = []) => executeQuery(sql, params),
        beginTransaction: async () => db.prepare('BEGIN').run(),
        commit: async () => db.prepare('COMMIT').run(),
        rollback: async () => {
            try { db.prepare('ROLLBACK').run(); } catch (_) { /* ignore if no tx */ }
        },
        release: () => {} // no-op: SQLite has no connection pool
    })
};

module.exports = pool;
module.exports.db = db; // exposed for initDb.js direct usage
