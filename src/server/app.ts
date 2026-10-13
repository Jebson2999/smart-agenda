// Montagem do servidor HTTP: API, arquivos estáticos do aplicativo (PWA) e tratamento de erros.
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { Router, HttpError, sendJson, securityHeaders, readBody, parseCookies, clientIp } from './http.ts';
import type { Ctx } from './http.ts';
import { requirePerm, sessionUser, SESSION_COOKIE } from './auth.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerEventRoutes } from './routes/events.ts';
import { registerInsightRoutes } from './routes/insights.ts';
import { registerActionRoutes } from './routes/actions.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { registerWhatsAppRoutes } from './routes/whatsapp.ts';
import { registerReportRoutes } from './routes/reports.ts';
import { config } from './config.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);

export function buildRouter(): Router {
  const r = new Router();
  r.get('/api/health', () => ({ ok: true, app: 'ASTRAL Smart Agenda', time: new Date().toISOString() }), { auth: false });
  registerAuthRoutes(r);
  registerEventRoutes(r);
  registerInsightRoutes(r);
  registerActionRoutes(r);
  registerAdminRoutes(r);
  registerWhatsAppRoutes(r);
  registerReportRoutes(r);
  return r;
}

function sameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = String((config.trustProxy ? req.headers['x-forwarded-host'] : undefined) ?? req.headers.host ?? '');
    return o.host === host;
  } catch {
    return false;
  }
}

export function createApp(publicDir: string) {
  const router = buildRouter();
  const root = path.resolve(publicDir);
  const indexFile = path.join(root, 'index.html');

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const method = req.method ?? 'GET';
    const m = router.match(method, url.pathname);
    if (!m) throw new HttpError(404, 'Rota não encontrada');
    const { route, params } = m;
    const opts = route.opts;
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const ctx: Ctx = { req, res, url, params, ip: clientIp(req, config.trustProxy), user: null };
    // Proteção CSRF: cabeçalho próprio + mesma origem nas rotas que alteram dados.
    if (mutating && opts.csrf !== false) {
      if (req.headers['x-asa-request'] !== '1' || !sameOrigin(req)) throw new HttpError(403, 'Requisição bloqueada (origem não confirmada).');
    }
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    ctx.user = sessionUser(token);
    if (opts.auth !== false) {
      if (!ctx.user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
      const pwChange = url.pathname === '/api/auth/change-password' || url.pathname === '/api/auth/me' || url.pathname === '/api/auth/logout';
      if (ctx.user.mustChangePassword && !pwChange) throw new HttpError(428, 'Troque sua senha temporária para continuar.');
      if (opts.perm) requirePerm(ctx.user, opts.perm);
    }
    if (mutating || opts.raw === 'buffer') {
      const max = opts.maxBytes ?? 1024 * 1024;
      const raw = await readBody(req, max);
      ctx.rawBody = raw;
      if (opts.raw !== 'buffer' && raw.length) {
        try {
          ctx.body = JSON.parse(raw.toString('utf8'));
        } catch {
          throw new HttpError(400, 'JSON inválido');
        }
      } else if (opts.raw !== 'buffer') ctx.body = {};
    }
    const result = await route.handler(ctx);
    if (!res.writableEnded) sendJson(res, 200, result ?? { ok: true });
  }

  function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.includes('\0')) throw new HttpError(400, 'Caminho inválido');
    let file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) throw new HttpError(403, 'Acesso negado');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Rotas do aplicativo (SPA) caem no index.html
      if (path.extname(rel)) throw new HttpError(404, 'Arquivo não encontrado');
      file = indexFile;
      rel = '/index.html';
    }
    const ext = path.extname(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    if (rel.startsWith('/assets/') || rel.startsWith('/fonts/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else res.setHeader('Cache-Control', 'no-cache');
    if (rel === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
    if (req.method === 'HEAD') return res.end();
    // Compressão gzip para HTML, JS, CSS e manifest (bem mais rápido no celular).
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      const pre = `${file}.gz`;
      if (fs.existsSync(pre)) return void fs.createReadStream(pre).pipe(res);
      return void fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    }
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    securityHeaders(res);
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
      else throw new HttpError(405, 'Método não permitido');
    } catch (err) {
      const e = err instanceof HttpError ? err : null;
      if (!e) console.error('[erro]', req.method, url.pathname, err);
      if (res.headersSent) return res.end();
      sendJson(res, e?.status ?? 500, { error: e?.message ?? 'Erro interno. Tente novamente.', details: e?.details });
    }
  });
}
