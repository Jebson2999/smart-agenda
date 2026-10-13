// Utilitários dos testes: banco em memória com a carga inicial e servidor HTTP de verdade.
import './env.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDatabase, closeDatabase, run } from '../src/server/db.ts';
import { seedAll } from '../src/server/seed.ts';
import { createApp } from '../src/server/app.ts';

export const SUPERVISOR = { email: 'supervisor@teste.local', password: 'Inicial-Super-2026' };
export const COORDINATOR = { email: 'coordenador@teste.local', password: 'Inicial-Coord-2026' };

/** Banco novo em memória com usuários, modelos e os 10 compromissos de 2026. */
export async function freshDb(opts: { passwordsChanged?: boolean } = {}) {
  closeDatabase();
  openDatabase(':memory:');
  await seedAll();
  if (opts.passwordsChanged) run('UPDATE users SET must_change_password = 0');
}

export async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-public-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ASTRAL</title>');
  const server = createApp(dir);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Cliente HTTP com cookie de sessão e os cabeçalhos que o aplicativo envia. */
export class Client {
  cookie = '';
  base: string;
  constructor(base: string) {
    this.base = base;
  }
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; data: any; headers: Headers; text: string }> {
    const headers: Record<string, string> = { 'x-asa-request': '1', origin: this.base, ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    let payload: string | undefined;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.base + p, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: res.status, data, headers: res.headers, text };
  }
  get(p: string) {
    return this.req('GET', p);
  }
  post(p: string, b: unknown = {}) {
    return this.req('POST', p, b);
  }
  patch(p: string, b: unknown = {}) {
    return this.req('PATCH', p, b);
  }
  del(p: string) {
    return this.req('DELETE', p);
  }
  async login(who: { email: string; password: string }) {
    const r = await this.post('/api/auth/login', who);
    if (r.status !== 200) throw new Error(`login falhou: ${r.status} ${r.text}`);
    return r.data;
  }
}
