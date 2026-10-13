// Constantes de domínio compartilhadas entre servidor e interface.

export const APP_NAME = 'ASTRAL Smart Agenda';
export const DEFAULT_TIMEZONE = 'America/Cuiaba';

export type CategoryKey =
  | 'preparacao_auditoria'
  | 'auditoria'
  | 'visita_tecnica'
  | 'visita_reuniao'
  | 'reuniao'
  | 'confirmacao'
  | 'administrativo'
  | 'outro';

export interface CategoryInfo {
  label: string;
  short: string;
  color: string;
  /** Bloqueia a agenda do responsável (entra na detecção de conflitos). */
  blocking: boolean;
  group: 'auditoria' | 'visita' | 'reuniao' | 'confirmacao' | 'administrativo' | 'outro';
}

export const CATEGORIES: Record<CategoryKey, CategoryInfo> = {
  preparacao_auditoria: { label: 'Preparação para auditoria', short: 'Preparação', color: '#D97706', blocking: true, group: 'auditoria' },
  auditoria: { label: 'Auditoria GMP+', short: 'Auditoria', color: '#7C3AED', blocking: true, group: 'auditoria' },
  visita_tecnica: { label: 'Visita técnica', short: 'Visita técnica', color: '#198A5D', blocking: true, group: 'visita' },
  visita_reuniao: { label: 'Visita técnica e reunião mensal', short: 'Visita + reunião', color: '#0E7490', blocking: true, group: 'visita' },
  reuniao: { label: 'Reunião mensal', short: 'Reunião', color: '#2563EB', blocking: true, group: 'reuniao' },
  confirmacao: { label: 'Confirmação de reunião', short: 'Confirmação', color: '#64748B', blocking: false, group: 'confirmacao' },
  administrativo: { label: 'Pendência administrativa', short: 'Administrativo', color: '#DB2777', blocking: false, group: 'administrativo' },
  outro: { label: 'Outro', short: 'Outro', color: '#475569', blocking: true, group: 'outro' },
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

export type StatusKey = 'programado' | 'a_confirmar' | 'confirmado' | 'em_andamento' | 'concluido' | 'adiado' | 'cancelado';
export const STATUSES: Record<StatusKey, { label: string; tone: 'neutral' | 'warn' | 'ok' | 'info' | 'done' | 'muted' | 'danger' }> = {
  programado: { label: 'Programado', tone: 'info' },
  a_confirmar: { label: 'A confirmar', tone: 'warn' },
  confirmado: { label: 'Confirmado', tone: 'ok' },
  em_andamento: { label: 'Em andamento', tone: 'info' },
  concluido: { label: 'Concluído', tone: 'done' },
  adiado: { label: 'Adiado', tone: 'muted' },
  cancelado: { label: 'Cancelado', tone: 'danger' },
};
export const STATUS_KEYS = Object.keys(STATUSES) as StatusKey[];
export const CLOSED_STATUSES: StatusKey[] = ['concluido', 'cancelado'];

export type PriorityKey = 'baixa' | 'media' | 'alta' | 'critica';
export const PRIORITIES: Record<PriorityKey, { label: string; weight: number; color: string }> = {
  baixa: { label: 'Baixa', weight: 10, color: '#64748B' },
  media: { label: 'Média', weight: 20, color: '#2563EB' },
  alta: { label: 'Alta', weight: 30, color: '#F59E0B' },
  critica: { label: 'Crítica', weight: 40, color: '#DC4444' },
};
export const PRIORITY_KEYS = Object.keys(PRIORITIES) as PriorityKey[];

export type AttendanceKey = 'nao_solicitada' | 'pendente' | 'confirmada' | 'recusada';
export const ATTENDANCE: Record<AttendanceKey, string> = {
  nao_solicitada: 'Não solicitada',
  pendente: 'Aguardando confirmação',
  confirmada: 'Presença confirmada',
  recusada: 'Não comparecerá',
};

export type ActionStatusKey = 'aberta' | 'em_andamento' | 'concluida' | 'cancelada';
export const ACTION_STATUSES: Record<ActionStatusKey, string> = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

export type ActionOriginKey = 'auditoria_pre' | 'auditoria_durante' | 'auditoria_pos' | 'visita' | 'reuniao' | 'manual';
export const ACTION_ORIGINS: Record<ActionOriginKey, string> = {
  auditoria_pre: 'Pré-auditoria',
  auditoria_durante: 'Durante a auditoria',
  auditoria_pos: 'Pós-auditoria',
  visita: 'Visita técnica',
  reuniao: 'Reunião',
  manual: 'Manual',
};

export type ChecklistStage = 'geral' | 'pre' | 'durante' | 'pos';
export const CHECKLIST_STAGES: Record<ChecklistStage, string> = {
  geral: 'Checklist',
  pre: 'Pré-auditoria',
  durante: 'Durante a auditoria',
  pos: 'Pós-auditoria',
};

export type VisibilityKey = 'compartilhado' | 'privado';

// ---------------------------------------------------------------- Perfis e permissões
export type RoleKey = 'admin' | 'coordenador' | 'tecnico' | 'gestor';
export const ROLES: Record<RoleKey, { label: string; description: string }> = {
  admin: { label: 'Administrador / Supervisor Técnico', description: 'Gerenciamento completo da agenda, usuários, WhatsApp e relatórios.' },
  coordenador: { label: 'Coordenador de Operações', description: 'Visualiza compromissos autorizados, confirma participação, inclui observações e recebe notificações.' },
  tecnico: { label: 'Técnico', description: 'Perfil para expansão: acompanha e executa checklists dos compromissos em que participa.' },
  gestor: { label: 'Gestor', description: 'Perfil para expansão: visão consolidada e relatórios.' },
};

export const PERMISSIONS = {
  'dashboard.view': 'Ver painel',
  'events.view_all': 'Ver todos os compromissos (inclusive privados)',
  'events.view_shared': 'Ver compromissos compartilhados',
  'events.create': 'Criar compromissos',
  'events.edit': 'Editar, reagendar e concluir compromissos',
  'events.delete': 'Excluir compromissos',
  'events.confirm_attendance': 'Confirmar participação',
  'events.comment': 'Incluir observações',
  'checklist.edit': 'Marcar e editar checklists',
  'attachments.upload': 'Enviar anexos',
  'audits.manage': 'Gerenciar auditorias e apontamentos',
  'actions.manage': 'Gerenciar ações (responsáveis, prazos, progresso)',
  'reports.view': 'Exportar relatórios',
  'whatsapp.manage': 'Configurar WhatsApp e notificações',
  'users.manage': 'Gerenciar usuários e permissões',
  'settings.manage': 'Gerenciar unidades, modelos de checklist e feriados',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_DEFAULTS: Record<RoleKey, Permission[]> = {
  admin: ALL_PERMISSIONS,
  coordenador: ['dashboard.view', 'events.view_shared', 'events.confirm_attendance', 'events.comment', 'reports.view'],
  tecnico: ['dashboard.view', 'events.view_shared', 'events.confirm_attendance', 'events.comment', 'checklist.edit', 'attachments.upload'],
  gestor: ['dashboard.view', 'events.view_shared', 'events.comment', 'reports.view'],
};

/** Permissões extras que o administrador pode liberar individualmente. */
export const CONFIGURABLE_PERMISSIONS: Permission[] = [
  'events.create',
  'events.edit',
  'checklist.edit',
  'attachments.upload',
  'audits.manage',
  'actions.manage',
  'reports.view',
];

// ---------------------------------------------------------------- Notificações
export type NotificationType =
  | 'aviso_antecipado'
  | 'lembrete_vespera'
  | 'lembrete_dia'
  | 'alteracao'
  | 'reuniao_nao_confirmada'
  | 'pendencia_vencimento'
  | 'resumo_semanal'
  | 'confirmacao_presenca'
  | 'teste';

export const NOTIFICATION_TYPES: Record<NotificationType, { label: string; description: string }> = {
  aviso_antecipado: { label: 'Aviso antecipado de compromisso', description: 'Enviado alguns dias antes (padrão: 3 dias, às 08:00).' },
  lembrete_vespera: { label: 'Lembrete na véspera', description: 'Véspera do compromisso (padrão: 18:00).' },
  lembrete_dia: { label: 'Lembrete no dia', description: 'Manhã do primeiro dia (padrão: 07:00).' },
  alteracao: { label: 'Compromisso alterado ou cancelado', description: 'Assim que datas, horários, unidade ou status mudarem.' },
  reuniao_nao_confirmada: { label: 'Reunião ainda não confirmada', description: 'Diariamente às 09:00 enquanto a reunião estiver "a confirmar" nos próximos 7 dias.' },
  pendencia_vencimento: { label: 'Pendência próxima do vencimento', description: 'Ações com prazo em até 2 dias (08:00).' },
  resumo_semanal: { label: 'Resumo semanal da agenda', description: 'Segunda-feira às 07:30.' },
  confirmacao_presenca: { label: 'Solicitação de confirmação de presença', description: 'Para participantes com presença pendente, com botões de resposta.' },
  teste: { label: 'Mensagem de teste', description: 'Enviada manualmente pelo administrador.' },
};
export const CONFIGURABLE_NOTIFICATION_TYPES = (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).filter((t) => t !== 'teste');

export type NotificationStatus =
  | 'pendente'
  | 'processando'
  | 'enviado'
  | 'entregue'
  | 'lido'
  | 'falhou'
  | 'incerto'
  | 'cancelado'
  | 'demonstracao';

export const NOTIFICATION_STATUSES: Record<NotificationStatus, { label: string; tone: 'neutral' | 'warn' | 'ok' | 'info' | 'done' | 'muted' | 'danger' }> = {
  pendente: { label: 'Na fila', tone: 'neutral' },
  processando: { label: 'Enviando', tone: 'info' },
  enviado: { label: 'Aceito pela Meta', tone: 'info' },
  entregue: { label: 'Entregue', tone: 'ok' },
  lido: { label: 'Lido', tone: 'done' },
  falhou: { label: 'Falhou', tone: 'danger' },
  incerto: { label: 'Resultado incerto', tone: 'warn' },
  cancelado: { label: 'Cancelado', tone: 'muted' },
  demonstracao: { label: 'Demonstração — NÃO enviado', tone: 'warn' },
};

export type ConsentStatus = 'pendente' | 'concedido' | 'revogado';
export const CONSENT_STATUSES: Record<ConsentStatus, string> = {
  pendente: 'Aguardando consentimento',
  concedido: 'Consentimento registrado',
  revogado: 'Consentimento revogado',
};

export const CONSENT_TEXT_VERSION = '2026-10';
export const CONSENT_TEXT =
  'Autorizo o envio de notificações operacionais da ASTRAL Smart Agenda (lembretes, alterações, confirmações e resumos de agenda) para este número de WhatsApp. Posso revogar a qualquer momento respondendo PARAR ou pelo próprio sistema.';
