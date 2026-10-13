// Roteador HTTP mínimo, sem dependências, com cabeçalhos de segurança.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZodType } from 'zod';
import type { Permission } from '../shared/constants.ts';
import type { SessionUser } from '../shared/types.ts';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  ip: string;
  user: SessionUser | null;
  rawBody?: Buffer;
  body?: unknown;
}

export interface RouteOptions {
  auth?: boolean; // padrão: true
  perm?: Permission | Permission[];
  raw?: 'json' | 'buffer' | 'none';
  maxBytes?: number;
  csrf?: boolean; // padrão: true para métodos que alteram dados
}

type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  opts: RouteOptions;
}

export class Router {
  routes: Route[] = [];
  add(method: string, path: string, handler: Handler, opts: RouteOptions = {}) {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/\/:([a-zA-Z_]+)/g, (_m, k) => {
          keys.push(k);
          return '/([^/]+)';
        }) +
        '$',
    );
    this.routes.push({ method, pattern, keys, handler, opts });
  }
  get(p: string, h: Handler, o?: RouteOptions) {
    this.add('GET', p, h, o);
  }
  post(p: string, h: Handler, o?: RouteOptions) {
    this.add('POST', p, h, o);
  }
  patch(p: string, h: Handler, o?: RouteOptions) {
    this.add('PATCH', p, h, o);
  }
  put(p: string, h: Handler, o?: RouteOptions) {
    this.add('PUT', p, h, o);
  }
  delete(p: string, h: Handler, o?: RouteOptions) {
    this.add('DELETE', p, h, o);
  }
  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    let methodMismatch = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      if (r.method !== method) {
        methodMismatch = true;
        continue;
      }
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    if (methodMismatch) throw new HttpError(405, 'Método não permitido');
    return null;
  }
}

export function securityHeaders(res: ServerResponse) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}

export function sendJson(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function sendFile(res: ServerResponse, data: Buffer | Uint8Array | string, contentType: string, filename?: string, inline = false) {
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  if (filename) {
    const safe = filename.replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  }
  res.end(data);
}

export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'Conteúdo muito grande');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** IP do cliente. X-Forwarded-For só é considerado com TRUST_PROXY=1 (evita falsificar o IP no bloqueio de login). */
export function clientIp(req: IncomingMessage, trustProxy = false): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
    if (first?.trim()) return first.trim();
  }
  return (req.socket.remoteAddress || '').trim();
}

/** Valida o corpo com zod e devolve 422 com os campos inválidos. */
export function validate<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(
      422,
      'Dados inválidos',
      r.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
    );
  }
  return r.data;
}

export function intParam(v: string | undefined, name = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parâmetro ${name} inválido`);
  return n;
}
