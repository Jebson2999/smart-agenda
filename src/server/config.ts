// Configuração lida das variáveis de ambiente (arquivo .env opcional).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv(path.resolve(process.cwd(), '.env'));

const env = (k: string, d = ''): string => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env('PORT', '3000')) || 3000,
  appUrl: env('APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
  databasePath: env('DATABASE_PATH', './data/astral.db'),
  attachmentsDir: env('ATTACHMENTS_DIR', './data/anexos'),
  timezone: env('APP_TIMEZONE', 'America/Cuiaba'),
  production: env('NODE_ENV') === 'production',
  /** Atrás de um proxy reverso (Nginx, Render, Railway…): confiar em X-Forwarded-For/Host/Proto. */
  trustProxy: env('TRUST_PROXY') === '1',
  cronSecret: env('CRON_SECRET'),
  linkSigningSecret: env('LINK_SIGNING_SECRET') || crypto.createHash('sha256').update(`asa-link:${env('WHATSAPP_APP_SECRET')}:${env('DATABASE_PATH', 'db')}`).digest('hex'),
  schedulerIntervalMs: Number(env('SCHEDULER_INTERVAL_MS', '60000')) || 60000,
  disableScheduler: env('DISABLE_SCHEDULER') === '1',
  backupDir: env('BACKUP_DIR') || path.join(path.dirname(env('DATABASE_PATH', './data/astral.db')), 'backups'),
  backupKeep: Math.max(1, Number(env('BACKUP_KEEP', '14')) || 14),
  disableBackup: env('DISABLE_BACKUP') === '1',
  seed: {
    supervisorName: env('SUPERVISOR_NAME', 'Supervisor Técnico'),
    supervisorEmail: env('SUPERVISOR_EMAIL', 'supervisao.snp@grupoastral.com.br'),
    supervisorPassword: env('SUPERVISOR_INITIAL_PASSWORD'),
    coordinatorName: env('COORDINATOR_NAME', 'Coordenador de Operações'),
    coordinatorEmail: env('COORDINATOR_EMAIL', 'coordenador@astral.local'),
    coordinatorPassword: env('COORDINATOR_INITIAL_PASSWORD'),
  },
};

/** Credenciais do WhatsApp: lidas apenas do ambiente do servidor, nunca expostas na API. */
export function whatsappEnv() {
  return {
    accessToken: env('WHATSAPP_ACCESS_TOKEN'),
    appSecret: env('WHATSAPP_APP_SECRET'),
    verifyToken: env('WHATSAPP_VERIFY_TOKEN'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    businessAccountId: env('WHATSAPP_BUSINESS_ACCOUNT_ID'),
    graphVersion: env('WHATSAPP_GRAPH_VERSION', 'v23.0'),
  };
}
