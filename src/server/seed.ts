// Carga inicial: usuários, unidades, modelos de checklist, templates do WhatsApp
// e os 10 compromissos reais da agenda 2026.
import fs from 'node:fs';
import path from 'node:path';
import { get, nowIso, run, tx } from './db.ts';
import { config } from './config.ts';
import { audit, generatePassword, hashPassword } from './auth.ts';
import { createEvent } from './repo/events.ts';
import { DEFAULT_TEMPLATES } from './notifications/messages.ts';
import crypto from 'node:crypto';
import { getSetting, setSetting } from './repo/settings.ts';

export const CHECKLIST_TEMPLATES: Array<{ key: string; name: string; category: string; stage: string; items: Array<{ text: string; critical?: boolean }> }> = [
  {
    key: 'preparacao_auditoria',
    name: 'Preparação da planta para auditoria',
    category: 'preparacao_auditoria',
    stage: 'geral',
    items: [{ text: 'Inspecionar setores' }, { text: 'Identificar pendências' }, { text: 'Verificar dispositivos' }, { text: 'Preparar evidências' }],
  },
  {
    key: 'auditoria_pre',
    name: 'Auditoria — pré-auditoria',
    category: 'auditoria',
    stage: 'pre',
    items: [
      { text: 'Inspeção da unidade' },
      { text: 'Levantamento de não conformidades' },
      { text: 'Plano de ação' },
      { text: 'Verificação de dispositivos' },
      { text: 'Revisão dos registros e relatórios' },
      { text: 'Conferência de documentação' },
      { text: 'Registro de evidências' },
      { text: 'Validação das pendências' },
    ],
  },
  {
    key: 'auditoria_durante',
    name: 'Auditoria — durante a auditoria',
    category: 'auditoria',
    stage: 'durante',
    items: [
      { text: 'Registro de presença' },
      { text: 'Acompanhamento das solicitações' },
      { text: 'Evidências apresentadas' },
      { text: 'Pendências identificadas' },
      { text: 'Observações do auditor' },
      { text: 'Ações imediatas' },
    ],
  },
  {
    key: 'auditoria_pos',
    name: 'Auditoria — pós-auditoria',
    category: 'auditoria',
    stage: 'pos',
    items: [
      { text: 'Relatório de acompanhamento' },
      { text: 'Registro de apontamentos' },
      { text: 'Responsáveis pelas correções' },
      { text: 'Prazos' },
      { text: 'Conclusão das ações' },
    ],
  },
  {
    key: 'visita_tecnica',
    name: 'Visita técnica',
    category: 'visita_tecnica',
    stage: 'geral',
    items: [
      { text: 'Definir objetivo da visita' },
      { text: 'Planejar as atividades' },
      { text: 'Executar o checklist de campo' },
      { text: 'Registrar evidências fotográficas' },
      { text: 'Registrar pendências identificadas' },
      { text: 'Definir encaminhamentos' },
      { text: 'Registrar o resultado da visita' },
    ],
  },
  {
    key: 'reuniao_mensal',
    name: 'Reunião mensal',
    category: 'reuniao',
    stage: 'geral',
    items: [
      { text: 'Definir participantes' },
      { text: 'Preparar a pauta' },
      { text: 'Confirmar presença' },
      { text: 'Registrar a ata' },
      { text: 'Registrar decisões e responsáveis' },
      { text: 'Definir prazos e tarefas derivadas' },
    ],
  },
];

function upsertTemplates() {
  const now = nowIso();
  for (const t of CHECKLIST_TEMPLATES) {
    run('INSERT OR IGNORE INTO checklist_templates (key, name, category, stage, items, updated_at) VALUES (?, ?, ?, ?, ?, ?)', t.key, t.name, t.category, t.stage, JSON.stringify(t.items), now);
  }
  for (const t of DEFAULT_TEMPLATES) {
    run(
      'INSERT OR IGNORE INTO wa_templates (notif_type, name, language, category, body, variables, buttons, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      t.type,
      t.name,
      t.language,
      t.category,
      t.body,
      JSON.stringify(t.variables),
      JSON.stringify(t.buttons),
      'nao_submetido',
      now,
    );
  }
}

/** E-mail padrão do administrador nas primeiras versões. */
export const LEGACY_SUPERVISOR_EMAIL = 'supervisor@astral.local';

/**
 * Instalações criadas antes da troca do e-mail padrão: se o administrador ainda usa o e-mail antigo
 * de fábrica e ninguém usa o novo, passa a conta para o e-mail configurado (dados e senha mantidos).
 */
export function migrateLegacySupervisorEmail(target: string) {
  const to = target.trim().toLowerCase();
  if (!to || to === LEGACY_SUPERVISOR_EMAIL) return false;
  const legacy = get<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND email = ? COLLATE NOCASE", LEGACY_SUPERVISOR_EMAIL);
  if (!legacy || get('SELECT id FROM users WHERE email = ? COLLATE NOCASE', to)) return false;
  run('UPDATE users SET email = ?, updated_at = ? WHERE id = ?', to, nowIso(), legacy.id);
  audit(null, 'usuario.email_atualizado', 'user', legacy.id, { de: LEGACY_SUPERVISOR_EMAIL, para: to, motivo: 'novo e-mail padrão do administrador' });
  return true;
}

async function ensureUsers(): Promise<{ created: Array<{ name: string; email: string; password: string; role: string; generated: boolean }> }> {
  const created: Array<{ name: string; email: string; password: string; role: string; generated: boolean }> = [];
  const now = nowIso();
  const s = config.seed;
  const accounts = [
    { name: s.supervisorName, email: s.supervisorEmail, password: s.supervisorPassword, role: 'admin' },
    { name: s.coordinatorName, email: s.coordinatorEmail, password: s.coordinatorPassword, role: 'coordenador' },
  ];
  migrateLegacySupervisorEmail(s.supervisorEmail);
  for (const a of accounts) {
    if (get('SELECT id FROM users WHERE email = ? COLLATE NOCASE', a.email)) continue;
    // Já existe uma conta desse perfil (ex.: o e-mail padrão mudou depois): não cria outra.
    if (get('SELECT id FROM users WHERE role = ? LIMIT 1', a.role)) continue;
    const password = a.password || generatePassword();
    run(
      'INSERT INTO users (name, email, password_hash, role, extra_permissions, timezone, active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)',
      a.name,
      a.email,
      await hashPassword(password),
      a.role,
      '[]',
      config.timezone,
      now,
      now,
    );
    created.push({ name: a.name, email: a.email, password, role: a.role, generated: !a.password });
  }
  return { created };
}

function unit(name: string): number {
  const found = get<{ id: number }>('SELECT id FROM units WHERE name = ?', name);
  if (found) return found.id;
  return run('INSERT INTO units (name, municipality, client, active, created_at) VALUES (?, ?, NULL, 1, ?)', name, name, nowIso()).lastInsertRowid;
}

/** Os 10 compromissos reais informados (seção 8 da especificação). */
export function seedAgenda2026() {
  if (get('SELECT 1 FROM settings WHERE key = ?', 'seed.agenda2026')) return 0;
  const supervisor = get<{ id: number }>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const responsible = supervisor?.id ?? null;
  const lrv = unit('Lucas do Rio Verde');
  const sorriso = unit('Sorriso');
  const nu = unit('Nova Ubiratã');
  const andre = [{ name: 'André', role_label: 'Reunião mensal', attendance: 'nao_solicitada' as const }];
  const hist = 'Cadastro inicial — agenda obrigatória 2026';
  return tx(() => {
    const [prep] = createEvent(null, {
      title: 'Preparação para auditoria GMP+ — Lucas do Rio Verde',
      description: 'Deixar a planta preparada para auditoria GMP+.',
      category: 'preparacao_auditoria', start_date: '2026-10-14', end_date: '2026-10-16', unit_id: lrv, responsible_id: responsible, priority: 'alta', status: 'programado',
    }, { checklist: [{ text: 'Inspecionar setores' }, { text: 'Identificar pendências' }, { text: 'Verificar dispositivos' }, { text: 'Preparar evidências' }], historySummary: hist });
    createEvent(null, {
      title: 'Auditoria GMP+ — Lucas do Rio Verde',
      description: 'Acompanhar presencialmente a auditoria.',
      category: 'auditoria', start_date: '2026-10-19', end_date: '2026-10-21', unit_id: lrv, responsible_id: responsible, priority: 'alta', status: 'programado', related_event_id: prep,
    }, { applyTemplates: true, historySummary: hist });
    createEvent(null, {
      title: 'Auditoria GMP+ — Sorriso',
      description: 'Acompanhar presencialmente a auditoria.',
      category: 'auditoria', start_date: '2026-10-21', end_date: '2026-10-22', unit_id: sorriso, responsible_id: responsible, priority: 'alta', status: 'programado',
      notes: 'Possível conflito em 21/10 com a auditoria de Lucas do Rio Verde. Não reagendar sem confirmação.',
    }, { applyTemplates: true, historySummary: hist });
    createEvent(null, {
      title: 'Confirmar agenda da reunião mensal com André',
      description: 'Confirmar agenda da reunião mensal com André.',
      category: 'administrativo', start_date: '2026-10-27', end_date: '2026-10-27', unit_id: null, responsible_id: responsible, priority: 'media', status: 'a_confirmar',
      notes: 'Unidade a definir. Reunião ainda não confirmada.',
    }, { participants: andre, historySummary: hist });
    createEvent(null, {
      title: 'Reunião mensal com André — Nova Ubiratã',
      description: 'Reunião mensal com André.',
      category: 'reuniao', start_date: '2026-11-11', end_date: '2026-11-11', unit_id: nu, responsible_id: responsible, priority: 'media', status: 'programado',
    }, { applyTemplates: true, participants: andre, historySummary: hist });
    createEvent(null, {
      title: 'Visita técnica — Lucas do Rio Verde',
      description: 'Realizar visita técnica à unidade.',
      category: 'visita_tecnica', start_date: '2026-11-12', end_date: '2026-11-13', unit_id: lrv, responsible_id: responsible, priority: 'media', status: 'programado',
    }, { applyTemplates: true, historySummary: hist });
    createEvent(null, {
      title: 'Visita técnica e reunião mensal — Lucas do Rio Verde',
      description: 'Realizar visita técnica e participar da reunião mensal.',
      category: 'visita_reuniao', start_date: '2026-11-19', end_date: '2026-11-20', unit_id: lrv, responsible_id: responsible, priority: 'media', status: 'programado',
    }, { applyTemplates: true, historySummary: hist });
    createEvent(null, {
      title: 'Visita técnica — Lucas do Rio Verde',
      description: 'Realizar visita técnica à unidade.',
      category: 'visita_tecnica', start_date: '2026-12-03', end_date: '2026-12-04', unit_id: lrv, responsible_id: responsible, priority: 'media', status: 'programado',
    }, { applyTemplates: true, historySummary: hist });
    createEvent(null, {
      title: 'Confirmar agenda da reunião mensal com André — Nova Ubiratã',
      description: 'Confirmar agenda da reunião mensal com André.',
      category: 'confirmacao', start_date: '2026-12-09', end_date: '2026-12-09', unit_id: nu, responsible_id: responsible, priority: 'media', status: 'a_confirmar',
    }, { participants: andre, historySummary: hist });
    createEvent(null, {
      title: 'Visita técnica e reunião mensal — Lucas do Rio Verde',
      description: 'Realizar visita técnica e reunião mensal.',
      category: 'visita_reuniao', start_date: '2026-12-17', end_date: '2026-12-18', unit_id: lrv, responsible_id: responsible, priority: 'media', status: 'programado',
    }, { applyTemplates: true, historySummary: hist });
    setSetting('seed.agenda2026', { at: nowIso(), count: 10 });
    return 10;
  });
}

/** Sem LINK_SIGNING_SECRET definido, usa um segredo aleatório gerado uma vez e guardado no banco. */
function ensureLinkSecret() {
  if (process.env.LINK_SIGNING_SECRET?.trim()) return;
  let secret = getSetting<string>('security.linkSigningSecret', '');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('security.linkSigningSecret', secret);
  }
  config.linkSigningSecret = secret;
}

export async function seedAll(): Promise<void> {
  ensureLinkSecret();
  upsertTemplates();
  const { created } = await ensureUsers();
  const n = seedAgenda2026();
  if (n) console.log(`[seed] ${n} compromissos da agenda 2026 cadastrados.`);
  const generated = created.filter((c) => c.generated);
  if (created.length && !generated.length) console.log(`[seed] Contas criadas com as senhas iniciais definidas nas variáveis de ambiente (troca obrigatória no 1º acesso).`);
  if (generated.length) {
    const file = path.resolve(path.dirname(path.resolve(config.databasePath)), 'credenciais-iniciais.txt');
    const lines = [
      'ASTRAL Smart Agenda — credenciais iniciais',
      'A troca de senha é obrigatória no primeiro acesso. APAGUE este arquivo depois de usar.',
      '',
      ...generated.map((c) => `${c.name} (${c.role}) — e-mail: ${c.email} — senha: ${c.password}`),
      '',
    ];
    fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
    console.log(`[seed] Contas criadas. Credenciais iniciais gravadas em ${file}`);
  }
}
