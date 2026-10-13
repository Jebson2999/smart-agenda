// Agendador interno: roda no servidor (independe do navegador estar aberto).
import { config } from '../config.ts';
import { run, nowIso } from '../db.ts';
import { planNotifications } from './planner.ts';
import type { PlanResult } from './planner.ts';
import { dispatchDue, recoverStaleLocks } from './dispatcher.ts';
import { dailyBackupIfDue } from '../backup.ts';
import type { DispatchStats } from './dispatcher.ts';

let running = false;
let timer: NodeJS.Timeout | null = null;
export let lastTick: { at: string; plan?: PlanResult; dispatch?: DispatchStats; error?: string; backup?: string } | null = null;

export async function tick(now: Date = new Date()) {
  if (running) return { skipped: true };
  running = true;
  try {
    recoverStaleLocks(now);
    const plan = planNotifications(now);
    const dispatch = await dispatchDue(now);
    // limpeza: sessões expiradas e tentativas antigas de login
    run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
    run('DELETE FROM login_attempts WHERE first_failure_at < ? AND (locked_until IS NULL OR locked_until < ?)', new Date(Date.now() - 86_400_000).toISOString(), nowIso());
    // Backup diário (falha aqui não interrompe os avisos).
    let backup: string | undefined;
    try {
      backup = dailyBackupIfDue(now) ?? undefined;
      if (backup) console.log(`[backup] cópia diária gravada em ${backup}`);
    } catch (e) {
      console.error('[backup] falhou:', (e as Error).message);
    }
    lastTick = { at: now.toISOString(), plan, dispatch, ...(backup ? { backup } : {}) };
    return { skipped: false, plan, dispatch };
  } catch (err) {
    lastTick = { at: now.toISOString(), error: (err as Error).message };
    console.error('[agendador] erro:', err);
    return { skipped: false, error: (err as Error).message };
  } finally {
    running = false;
  }
}

export function startScheduler() {
  if (config.disableScheduler || timer) return;
  timer = setInterval(() => void tick(), config.schedulerIntervalMs);
  timer.unref();
  setTimeout(() => void tick(), 3000).unref();
  console.log(`[agendador] ativo — verificação a cada ${Math.round(config.schedulerIntervalMs / 1000)} s`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
