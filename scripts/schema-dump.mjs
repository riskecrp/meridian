#!/usr/bin/env node
// Regenerate schema.sql from a database (tables, indexes, views, in creation
// order), the way `sqlite3 db .schema` does but without the sqlite3 binary and
// without the dump-only sqlite_sequence line that made the file non-executable.
//   DATABASE_PATH=data/meridian.db node scripts/schema-dump.mjs > schema.sql
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data', 'meridian.db');
const db = new Database(dbPath, { readonly: true });
const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
const out = [];
for (const r of rows) {
  if (r.name === '_migrations') continue;              // created by migrate.mjs / bootstrap.mjs
  let sql = r.sql.trim();
  if (r.type === 'view') {
    const cols = db.prepare(`PRAGMA table_info("${r.name}")`).all().map(c => c.name).join(',');
    sql += `\n/* ${r.name}(${cols}) */`;
  }
  out.push(sql + ';');
}
process.stdout.write(out.join('\n') + '\n');
