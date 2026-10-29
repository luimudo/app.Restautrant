const mysql = require('mysql2/promise');
require('dotenv').config();

// Hora de Peru (UTC-5, sin horario de verano) para Node y para MySQL, sin depender del equipo donde corra.
process.env.TZ = process.env.APP_TIMEZONE || 'America/Lima';
const MYSQL_TIME_ZONE = process.env.DB_TIME_ZONE || '-05:00';

/**
 * MySQL connection pool (mysql2).
 *   pool.query(sql, params) → [rows, fields] for SELECT
 *                           → [{ insertId, affectedRows }, fields] for INSERT/UPDATE/DELETE
 *   pool.getConnection()    → connection with beginTransaction/commit/rollback/release
 */
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'restaurant_tinpu_db',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    charset: 'utf8mb4',
    // DECIMAL columns come back as JS numbers (the frontend does arithmetic on them).
    decimalNumbers: true,
    // DATETIME se interpreta y envia en hora de Peru.
    timezone: MYSQL_TIME_ZONE
});

// NOW(), CURDATE() y CURRENT_TIMESTAMP de cada conexion usan la hora de Peru.
pool.pool.on('connection', (connection) => {
    connection.query(`SET time_zone = '${MYSQL_TIME_ZONE}'`);
});

module.exports = pool;
