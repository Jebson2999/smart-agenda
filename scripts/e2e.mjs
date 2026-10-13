// Teste de ponta a ponta pela interface (Playwright + Chromium), com um banco recém-criado.
// Percorre: primeiro acesso com troca de senha, painel, arrastar para reagendar, criar compromisso,
// checklist, WhatsApp (cadastro, consentimento e teste em modo demonstração) e acesso do coordenador.
// Uso: node scripts/e2e.mjs   (precisa de "npm run build" antes)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-e2e-'));
const port = 3300 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
const shots = path.join(root, 'screenshots', 'e2e');
fs.mkdirSync(shots, { recursive: true });

const env = {
  ...process.env,
  PORT: String(port),
  APP_URL: base,
  DATABASE_PATH: path.join(tmp, 'astral.db'),
  ATTACHMENTS_DIR: path.join(tmp, 'anexos'),
  SUPERVISOR_NAME: 'Supervisor Técnico',
  SUPERVISOR_EMAIL: 'supervisao.snp@grupoastral.com.br',
  SUPERVISOR_INITIAL_PASSWORD: 'Temporaria-2026a',
  COORDINATOR_NAME: 'Coordenador de Operações',
  COORDINATOR_EMAIL: 'coordenador@astral.local',
  COORDINATOR_INITIAL_PASSWORD: 'Temporaria-2026b',
  DISABLE_SCHEDULER: '1',
  WHATSAPP_ACCESS_TOKEN: '',
  WHATSAPP_APP_SECRET: '',
};
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'dist/server.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

const step = (msg) => console.log(`✔ ${msg}`);
let failures = 0;
function check(cond, msg) {
  if (cond) step(msg);
  else {
    failures++;
    console.error(`✘ ${msg}`);
  }
}

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`servidor não iniciou:\n${log}`);
}

async function firstLogin(page, email, temp, next) {
  await page.goto(`${base}/`);
  await page.fill('#email', email);
  await page.fill('#password', temp);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#new');
  await page.fill('#cur', temp);
  await page.fill('#new', next);
  await page.fill('#conf', next);
  await page.click('button[type="submit"]');
  await page.waitForSelector('nav[aria-label="Principal"]', { state: 'attached' });
}

const api = (page, p) => page.evaluate(async (u) => (await fetch(u)).json(), p);

try {
  await waitServer();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Cuiaba' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Primeiro acesso
  await firstLogin(page, 'supervisao.snp@grupoastral.com.br', 'Temporaria-2026a', 'Supervisor-Seguro-2026');
  await page.waitForSelector('[aria-label="Minha próxima missão"]');
  check(await page.isVisible('text=Minha próxima missão'), 'primeiro acesso com troca obrigatória de senha e painel com "Minha próxima missão"');
  check(await page.isVisible('text=Possível conflito de agenda'), 'painel alerta o possível conflito de 21/10');
  await page.screenshot({ path: path.join(shots, '01-painel.png') });

  // 2. Arrastar para reagendar (novembro: visita de 12–13/11 → 17–18/11)
  await page.goto(`${base}/agenda?view=mes&date=2026-11-01`);
  await page.waitForSelector('text=Visita técnica — Lucas do Rio Verde');
  const chip = page.locator('a[title^="Visita técnica — Lucas do Rio Verde"]').first();
  const target = page.locator('button[aria-label="Ver 17/11/2026"]').locator('xpath=../..');
  await chip.dragTo(target);
  await page.waitForSelector('text=Reagendar compromisso?');
  await page.screenshot({ path: path.join(shots, '02-confirmar-reagendamento.png') });
  await page.click('button:has-text("Reagendar")');
  await page.waitForSelector('text=Compromisso reagendado');
  const ev = (await api(page, '/api/events?from=2026-11-01&to=2026-11-30')).events.find((e) => e.title === 'Visita técnica — Lucas do Rio Verde');
  check(ev?.start_date === '2026-11-17' && ev?.end_date === '2026-11-18', 'arrastar e confirmar reagenda a visita para 17–18/11');
  const detail = await api(page, `/api/events/${ev.id}`);
  check(detail.history.some((h) => h.action === 'reagendado' && /12\/11\/2026 → 17\/11\/2026/.test(h.summary)), 'reagendamento registrado no histórico com a data original');

  // 3. Criar compromisso pelo formulário (sem horário)
  await page.goto(`${base}/eventos/novo?date=2026-11-25`);
  await page.waitForSelector('text=Novo compromisso');
  await page.fill('input[placeholder^="Ex.: Visita técnica"]', 'Reunião de alinhamento — Sorriso');
  await page.selectOption('select >> nth=0', 'reuniao');
  await page.click('button:has-text("Criar compromisso")');
  await page.waitForURL(/\/eventos\/\d+$/);
  await page.waitForSelector('h1:has-text("Reunião de alinhamento — Sorriso")');
  check(await page.isVisible('text=Horário não informado'), 'compromisso criado só com data — horário não é presumido');

  // 4. Checklist persistido
  const first = page.locator('button[aria-label="Concluir item"]').first();
  await first.click();
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('button[aria-label="Reabrir item"]');
  check((await page.locator('button[aria-label="Reabrir item"]').count()) === 1, 'item do checklist concluído continua marcado após recarregar');
  await page.screenshot({ path: path.join(shots, '03-compromisso.png'), fullPage: true });

  // 5. WhatsApp em modo demonstração
  await page.goto(`${base}/whatsapp?aba=destinatarios`);
  await page.waitForSelector('text=MODO DEMONSTRAÇÃO');
  await page.click('button:has-text("Cadastrar número") >> nth=0');
  await page.selectOption('.fixed select', { label: 'Coordenador de Operações' });
  await page.fill('input[type="tel"]', '(66) 99999-0002');
  await page.click('.fixed button:has-text("Cadastrar")');
  await page.waitForSelector('text=Aguardando consentimento');
  await page.click('button:has-text("Registrar consentimento")');
  await page.fill('.fixed textarea', 'Aceite enviado por e-mail em 13/10/2026');
  await page.click('.fixed button:has-text("Registrar consentimento")');
  await page.waitForSelector('text=Consentimento registrado');
  await page.click('button:has-text("Enviar teste")');
  await page.waitForSelector('text=NÃO foi enviada');
  check(true, 'cadastro de número, consentimento e envio de teste identificado como demonstração');
  const notifs = await api(page, '/api/whatsapp/notifications');
  check(notifs.notifications.every((n) => n.status !== 'enviado'), 'nenhum aviso marcado como enviado em modo demonstração');
  await page.screenshot({ path: path.join(shots, '04-whatsapp.png') });

  // 6. Coordenador: visão compartilhada, sem criar compromissos
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Cuiaba' });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await firstLogin(p2, 'coordenador@astral.local', 'Temporaria-2026b', 'Coordenador-Seguro-2026');
  await p2.waitForSelector('[aria-label="Minha próxima missão"]');
  check((await p2.locator('button[aria-label="Novo compromisso"]').count()) === 0, 'coordenador não vê o botão de novo compromisso');
  await p2.goto(`${base}/usuarios`);
  check(await p2.isVisible('text=Sem acesso a esta área'), 'coordenador não acessa a gestão de usuários');
  await p2.goto(`${base}/agenda?view=lista&date=2026-10-01`);
  await p2.waitForSelector('text=Auditoria GMP+ — Sorriso');
  check(true, 'coordenador vê a agenda compartilhada no celular');
  await p2.screenshot({ path: path.join(shots, '05-coordenador-celular.png') });

  check(errors.length === 0, `nenhum erro de JavaScript nas páginas${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
} catch (err) {
  failures++;
  console.error('✘ falha no teste de ponta a ponta:', err.message);
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTodos os fluxos de ponta a ponta passaram.');
process.exit(failures ? 1 : 0);
