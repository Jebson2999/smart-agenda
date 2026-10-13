// Ponto de entrada do servidor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { openDatabase, closeDatabase } from './db.ts';
import { seedAll } from './seed.ts';
import { parseResetArgs, resetPassword } from './recovery.ts';
import { backupNow } from './backup.ts';
import { createApp } from './app.ts';
import { startScheduler, stopScheduler } from './notifications/scheduler.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
// No pacote compilado (dist/server.mjs) os arquivos públicos ficam em dist/public.
const publicDir = fs.existsSync(path.join(here, 'public')) ? path.join(here, 'public') : path.resolve(here, '../../dist/public');

async function main() {
  if (process.argv.includes('--reset-demo')) {
    for (const f of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
    console.log('[reset] banco removido; será recriado com a carga inicial.');
  }
  openDatabase(config.databasePath);
  const bi = process.argv.indexOf('--backup');
  if (bi >= 0) {
    // node dist/server.mjs --backup [arquivo.db] — pode rodar com o sistema no ar.
    const file = backupNow(process.argv[bi + 1]);
    console.log(`[backup] cópia gravada em ${file}`);
    closeDatabase();
    return;
  }
  await seedAll();
  const reset = parseResetArgs(process.argv);
  if (reset) {
    const r = await resetPassword(reset);
    console.log(`\nBanco de dados: ${path.resolve(config.databasePath)}`);
    if (!r.ok) {
      console.error(`✘ ${r.message}`);
      if (r.users?.length) console.error(`Usuários cadastrados:\n${r.users.map((u) => `  - ${u.email} (${u.role}${u.active ? '' : ', inativo'})`).join('\n')}`);
      closeDatabase();
      process.exitCode = 1;
      return;
    }
    console.log(`✔ Senha redefinida.\n  E-mail: ${r.email}\n  Senha:  ${r.password}`);
    console.log(r.temporary ? '  (senha temporária: o sistema pede uma nova no primeiro acesso)\n' : '');
    closeDatabase();
    return;
  }
  if (process.argv.includes('--seed-only')) {
    closeDatabase();
    return;
  }
  const server = createApp(publicDir);
  server.listen(config.port, () => {
    console.log(`ASTRAL Smart Agenda em ${config.appUrl} (porta ${config.port}) · fuso ${config.timezone}`);
  });
  startScheduler();
  const shutdown = () => {
    console.log('Encerrando…');
    stopScheduler();
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
