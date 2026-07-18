import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const DB_PATH = process.env.DATABASE_PATH || '/opt/meridian/data/meridian.db';

let _db = null;

export function getDb() {
    if (!_db) {
        _db = new Database(DB_PATH, { });
        _db.pragma('journal_mode = WAL');
        _db.pragma('foreign_keys = ON');
        _db.pragma('busy_timeout = 5000');
    }
    return _db;
}

// Convenience: run a query and return all rows
export function query(sql, params = []) {
    return getDb().prepare(sql).all(...(Array.isArray(params) ? params : [params]));
}

// Convenience: run a query and return the first row
export function queryOne(sql, params = []) {
    return getDb().prepare(sql).get(...(Array.isArray(params) ? params : [params]));
}

// Convenience: run an INSERT/UPDATE/DELETE and return { changes, lastInsertRowid }
export function run(sql, params = []) {
    return getDb().prepare(sql).run(...(Array.isArray(params) ? params : [params]));
}

// Transaction helper
export function transaction(fn) {
    return getDb().transaction(fn)();
}
