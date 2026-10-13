// Camada de banco de dados — SQLite embutido no Node.js (node:sqlite).
// Sem dependências externas; para migrar para PostgreSQL veja docs/ARQUITETURA.md.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations.ts';

export type SqlValue = string | number | bigint | null | Uint8Array;
type Param = SqlValue | boolean | undefined;

let db: DatabaseSync | null = null;
let dbFile = '';
let txDepth = 0;

/** Caminho do banco aberto (":memory:" nos testes). */
export function currentDatabaseFile(): string {
  return dbFile;
}

function norm(params: Param[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function openDatabase(file: string): DatabaseSync {
  if (db) db.close();
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  dbFile = file;
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate();
  return db;
}

export function closeDatabase(): void {
  if (db) db.close();
  db = null;
  txDepth = 0;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Banco de dados não inicializado');
  return db;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
  return getDb().prepare(sql).all(...norm(params)) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
  return getDb().prepare(sql).get(...norm(params)) as T | undefined;
}

export function run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
  const r = getDb().prepare(sql).run(...norm(params));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** Transação com BEGIN IMMEDIATE (bloqueio de escrita imediato — evita corrida entre processos). */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  if (txDepth > 0) {
    txDepth++;
    try {
      return fn();
    } finally {
      txDepth--;
    }
  }
  d.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* ignora */
    }
    throw err;
  } finally {
    txDepth = 0;
  }
}

function migrate(): void {
  const d = getDb();
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((d.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version));
  MIGRATIONS.forEach((sql, idx) => {
    const version = idx + 1;
    if (applied.has(version)) return;
    d.exec('BEGIN IMMEDIATE');
    try {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
