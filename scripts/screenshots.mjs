// Capturas de tela do sistema em celular, tablet e computador (Playwright + Chromium).
// Uso: BASE_URL=http://localhost:3000 LOGIN_EMAIL=... LOGIN_PASSWORD=... node scripts/screenshots.mjs [rota ...]
// Saída: screenshots/<dispositivo>-<rota>.png
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const email = process.env.LOGIN_EMAIL ?? 'supervisor@astral.local';
const password = process.env.LOGIN_PASSWORD ?? '';
const out = path.resolve(process.env.OUT_DIR ?? 'screenshots');
const theme = process.env.THEME ?? 'light';
const only = (process.env.DEVICES ?? 'celular,tablet,computador').split(',');
const routes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['/', '/agenda', '/agenda?view=semana&date=2026-10-19', '/agenda?view=linha&date=2026-10-13', '/auditorias', '/acoes', '/relatorios', '/whatsapp', '/usuarios', '/configuracoes'];

const devices = [
  { name: 'celular', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  { name: 'computador', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
].filter((d) => only.includes(d.name));

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const d of devices) {
  const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: d.hasTouch, locale: 'pt-BR', timezoneId: 'America/Cuiaba', colorScheme: theme === 'dark' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${d.name}] erro na página:`, e.message));
  if (process.env.DEBUG) page.on('response', (r) => r.url().includes('/api/') && console.log('  api', r.status(), r.url().replace(base, '')));
  await page.goto(`${base}/`);
  // Espera a tela inicial decidir entre login e aplicativo (a sessão é verificada antes).
  await page.waitForSelector('input[type="email"], nav[aria-label="Principal"]', { state: 'attached', timeout: 15000 });
  if (await page.locator('input[type="email"]').count()) {
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/auth/login')), page.click('button[type="submit"]')]);
    if (!res.ok()) throw new Error(`Login falhou (HTTP ${res.status()}) — confira LOGIN_EMAIL e LOGIN_PASSWORD`);
    await page.waitForSelector('nav[aria-label="Principal"]', { timeout: 15000, state: 'attached' });
    await page.waitForLoadState('networkidle');
  }
  for (const r of routes) {
    await page.goto(`${base}${r}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(700);
    const name = `${d.name}-${r.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'inicio'}${theme === 'dark' ? '-escuro' : ''}.png`;
    await page.screenshot({ path: path.join(out, name), fullPage: process.env.FULL !== '0' });
    console.log('captura', name);
  }
  await ctx.close();
}
await browser.close();
