// Cópias de segurança do banco (SQLite "VACUUM INTO": cópia consistente com o sistema em uso).
// Automática: uma por dia, a partir das 03:00 no fuso do sistema, guardando as últimas N.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { currentDatabaseFile, getDb } from './db.ts';
import { nowInTz } from '../shared/dates.ts';

export function backupDir(): string {
  return path.resolve(config.backupDir);
}

/** Gera uma cópia completa do banco no caminho informado (ou na pasta de backups). */
export function backupNow(target?: string): string {
  const file = path.resolve(target ?? path.join(backupDir(), `astral-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.rmSync(file);
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

export function listBackups(): Array<{ name: string; size: number; at: string }> {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^astral-.*\.db$/.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Mantém só os N backups diários mais recentes (cópias manuais nunca são apagadas). */
function prune(keep: number) {
  const daily = listBackups().filter((b) => b.name.startsWith('astral-diario-'));
  for (const b of daily.slice(keep)) fs.rmSync(path.join(backupDir(), b.name), { force: true });
}

/** Chamado pelo agendador a cada minuto; faz no máximo um backup por dia. */
export function dailyBackupIfDue(now = new Date()): string | null {
  if (config.disableBackup || !currentDatabaseFile() || currentDatabaseFile() === ':memory:') return null;
  const { date, time } = nowInTz(config.timezone, now);
  if (time < '03:00') return null;
  const today = date.replace(/-/g, '');
  if (listBackups().some((b) => b.name.startsWith(`astral-diario-${today}`))) return null;
  const file = backupNow(path.join(backupDir(), `astral-diario-${today}.db`));
  prune(config.backupKeep);
  return file;
}
