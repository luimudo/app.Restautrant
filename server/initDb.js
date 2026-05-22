const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'restaurant.db');

function initDb() {
    console.log('Initializing SQLite database...');

    const db = new Database(DB_PATH);

    try {
        const sqlPath = path.join(__dirname, '../database.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log(`Executing SQL from ${sqlPath}...`);
        db.exec(sql);

        console.log('Database initialized successfully!');
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

initDb();
