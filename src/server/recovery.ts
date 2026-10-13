// Recuperação de acesso pelo terminal (para quem tem acesso ao servidor/computador onde o sistema roda).
//   node dist/server.mjs --redefinir-senha [e-mail] [nova-senha]
// Sem e-mail: usa o primeiro administrador. Sem senha: gera uma temporária (troca obrigatória no login).
import { all, get, nowIso, run } from './db.ts';
import { audit, generatePassword, hashPassword, passwordProblems, revokeUserSessions } from './auth.ts';

export interface ResetResult {
  ok: boolean;
  message: string;
  email?: string;
  password?: string;
  temporary?: boolean;
  users?: Array<{ email: string; role: string; active: number }>;
}

export async function resetPassword(opts: { email?: string; password?: string }): Promise<ResetResult> {
  const users = all<{ email: string; role: string; active: number }>('SELECT email, role, active FROM users ORDER BY role, email');
  const email = opts.email?.trim().toLowerCase();
  const user = email
    ? get<{ id: number; email: string }>('SELECT id, email FROM users WHERE email = ? COLLATE NOCASE', email)
    : get<{ id: number; email: string }>("SELECT id, email FROM users WHERE role = 'admin' ORDER BY active DESC, id LIMIT 1");
  if (!user) return { ok: false, message: email ? `Nenhum usuário com o e-mail ${email}.` : 'Nenhum administrador cadastrado.', users };

  const chosen = opts.password?.trim();
  if (chosen) {
    const problem = passwordProblems(chosen);
    if (problem) return { ok: false, message: problem };
  }
  const password = chosen || generatePassword();
  run(
    'UPDATE users SET password_hash = ?, must_change_password = ?, active = 1, updated_at = ? WHERE id = ?',
    await hashPassword(password),
    chosen ? 0 : 1,
    nowIso(),
    user.id,
  );
  // Libera bloqueios por tentativas erradas e encerra sessões antigas desse usuário.
  run("DELETE FROM login_attempts WHERE key LIKE ? ESCAPE '\\'", `${user.email.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}|%`);
  revokeUserSessions(user.id);
  audit(null, 'senha_redefinida_terminal', 'user', user.id, { temporaria: !chosen });
  return { ok: true, message: 'Senha redefinida.', email: user.email, password, temporary: !chosen };
}

/** Lê "--redefinir-senha [e-mail] [senha]" (em qualquer ordem) da linha de comando. */
export function parseResetArgs(argv: string[]): { email?: string; password?: string } | null {
  const i = argv.findIndex((a) => a === '--redefinir-senha' || a === '--reset-password');
  if (i < 0) return null;
  const rest: string[] = [];
  for (const a of argv.slice(i + 1)) {
    if (a.startsWith('--')) break;
    rest.push(a);
  }
  return { email: rest.find((a) => a.includes('@')), password: rest.find((a) => !a.includes('@')) };
}
