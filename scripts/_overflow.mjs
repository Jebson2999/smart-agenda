import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto('http://localhost:3100/');
await p.fill('input[type="email"]', 'supervisor@astral.local');
await p.fill('input[type="password"]', 'NovaSenha2026x');
await Promise.all([p.waitForResponse(r => r.url().includes('/api/auth/login')), p.click('button[type="submit"]')]);
await p.waitForSelector('main');
for (const r of process.argv.slice(2)) {
  await p.goto('http://localhost:3100' + r); await p.waitForLoadState('networkidle'); await p.waitForTimeout(500);
  const res = await p.evaluate(() => {
    const W = document.documentElement.clientWidth; const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const rc = el.getBoundingClientRect();
      if (rc.right > W + 1 && rc.width > 0) {
        // only report elements whose parent does not overflow (outermost culprit)
        const pr = el.parentElement?.getBoundingClientRect();
        if (!pr || pr.right <= W + 1) out.push(`${el.tagName}.${(el.className?.baseVal ?? el.className).toString().slice(0,90)} right=${Math.round(rc.right)} w=${Math.round(rc.width)} text=${(el.textContent||'').slice(0,40)}`);
      }
    }
    return { W, sw: document.documentElement.scrollWidth, out: out.slice(0, 12) };
  });
  console.log(r, res.W, res.sw); res.out.forEach(x => console.log('  ', x));
}
await b.close();
