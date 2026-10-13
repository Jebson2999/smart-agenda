// Modelos (templates) de mensagem do WhatsApp e montagem dos parâmetros.
// Os textos seguem as regras da Meta para templates de categoria UTILITY:
// variáveis {{n}} não ficam no início nem no fim, parâmetros sem quebras de linha.
import crypto from 'node:crypto';
import { config } from '../config.ts';
import { CATEGORIES, PRIORITIES, ACTION_ORIGINS, NOTIFICATION_TYPES } from '../../shared/constants.ts';
import type { NotificationType } from '../../shared/constants.ts';
import { formatDateBR, formatPeriod } from '../../shared/dates.ts';
import type { ActionItem, AgendaEvent } from '../../shared/types.ts';

export interface TemplateDef {
  type: NotificationType;
  name: string;
  language: string;
  category: 'UTILITY';
  body: string;
  variables: string[];
  buttons: Array<{ type: 'URL'; text: string; url: string } | { type: 'QUICK_REPLY'; text: string }>;
}

const H = '🟢 ASTRAL SMART AGENDA';
const viewButton = (): TemplateDef['buttons'][number] => ({ type: 'URL', text: 'Visualizar agenda', url: `${config.appUrl}/e/{{1}}` });

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    type: 'aviso_antecipado',
    name: 'astral_compromisso_programado',
    language: 'pt_BR',
    category: 'UTILITY',
    body: `${H}\n\n📅 COMPROMISSO PROGRAMADO\n\nAtividade: {{1}}\nUnidade: {{2}}\nPeríodo: {{3}}\nResponsável: {{4}}\n\n⚠️ {{5}}\n\nAcesse o sistema para consultar o checklist completo.`,
    variables: ['atividade', 'unidade', 'periodo', 'responsavel', 'orientacao'],
    buttons: [viewButton()],
  },
  {
    type: 'lembrete_vespera',
    name: 'astral_lembrete_vespera',
    language: 'pt_BR',
    category: 'UTILITY',
    body: `${H}\n\n⏰ LEMBRETE: É AMANHÃ\n\nAtividade: {{1}}\nUnidade: {{2}}\nPeríodo: {{3}}\nResponsável: {{4}}\n\nPendências no checklist: {{5}}\n\nConfira os detalhes no sistema antes do deslocamento.`,
    variables: ['atividade', 'unidade', 'periodo', 'responsavel', 'pendencias'],
    buttons: [viewButton()],
  },
  {
    type: 'lembrete_dia',
    name: 'astral_lembrete_hoje',
    language: 'pt_BR',
    category: 'UTILITY',
    body: `${H}\n\n📍 COMPROMISSO HOJE\n\nAtividade: {{1}}\nUnidade: {{2}}\nPeríodo: {{3}}\nResponsável: {{4}}\n\nPendências no checklist: {{5}}\n\nRegistre o andamento no sistema ao longo do dia.`,
    variables: ['atividade', 'unidade', 'periodo', 'responsavel', 'pendencias'],
    buttons: [viewButton()],
  },
  {
    type: 'alteracao',
    name: 'astral_compromisso_alterado',
    language: 'pt_BR',
    category: 'UTILITY',
    body: `${H}\n\n🔄 COMPROMISSO {{1}}\n\nAtividade: {{2}}\nUnidade: {{3}}\nPeríodo atual: {{4}}\nO que mudou: {{5}}\n\nAlteração registrada por {{6}}. Consulte o histórico no sistema.`,
    variables: ['situacao', 'atividade', 'unidade', 'periodo', 'mudancas', 'autor'],
    buttons: [viewButton()],
  },
  {
    type: 'reuniao_nao_confirmada',
    name: 'astral_reuniao_nao_confirmada',
    language: 'pt_BR',
    category: 'UTILITY',
    body: `${H}\n\n⚠️ REUNIÃO AINDA NÃO CONFIRMADA\n\nCompromisso: {{1}}\nData prevista: {{2}}\nLocal: {{3}}\nPendência: {{4}}\n\nConfirme a agenda e atualize o status no sistema.`,
    variables: ['compromisso', 'data', 'local', 'pendencia'],
    buttons: [viewButton()],
  },
  {
    type: 'pendencia_vencimento',
    name: 'astral_pendencia_vencimento',
    language: 'pt_BR',
    category: 'UTILITY',
    body: `${H}\n\n📌 PENDÊNCIA PRÓXIMA DO VENCIMENTO\n\nAção: {{1}}\nPrazo: {{2}}\nResponsável: {{3}}\nProgresso: {{4}}\nOrigem: {{5}}\n\nAtualize o andamento no painel de ações.`,
    variables: ['acao', 'prazo', 'responsavel', 'progresso', 'origem'],
    buttons: [],
  },
  {
    type: 'resumo_semanal',
    name: 'astral_resumo_semanal',
    language: 'pt_BR',
    category: 'UTILITY',
    body: `${H}\n\n🗓️ RESUMO DA SEMANA {{1}}\n\nCompromissos: {{2}}\nAgenda: {{3}}\nAtenção: {{4}}\n\nAcesse o sistema para ver a agenda completa.`,
    variables: ['semana', 'total', 'lista', 'alertas'],
    buttons: [],
  },
  {
    type: 'confirmacao_presenca',
    name: 'astral_confirmacao_presenca',
    language: 'pt_BR',
    category: 'UTILITY',
    body: `${H}\n\n✅ CONFIRMAÇÃO DE PRESENÇA\n\nOlá, {{1}}. Sua presença é solicitada em:\nAtividade: {{2}}\nUnidade: {{3}}\nPeríodo: {{4}}\n\nResponda pelos botões abaixo para confirmar.`,
    variables: ['nome', 'atividade', 'unidade', 'periodo'],
    buttons: [
      { type: 'QUICK_REPLY', text: 'Confirmar presença' },
      { type: 'QUICK_REPLY', text: 'Não poderei ir' },
    ],
  },
  {
    type: 'teste',
    name: 'astral_mensagem_teste',
    language: 'pt_BR',
    category: 'UTILITY',
    body: `${H}\n\nMensagem de teste para {{1}}. Se você recebeu, as notificações do WhatsApp estão funcionando.\n\nEnviada em {{2}} pelo sistema.`,
    variables: ['nome', 'data_hora'],
    buttons: [],
  },
];

/** Parâmetro de template: sem quebras de linha, tabulações ou espaços repetidos (regra da Meta). */
export function cleanParam(v: unknown, max = 220): string {
  const s = String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  const out = s.length > max ? s.slice(0, max - 1) + '…' : s;
  return out || '—';
}

export function renderBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}

export function eventPeriod(e: Pick<AgendaEvent, 'start_date' | 'end_date' | 'start_time' | 'end_time'>): string {
  const base = formatPeriod(e.start_date, e.end_date);
  if (!e.start_time) return base; // nunca presumimos horário
  return `${base}, ${e.start_time}${e.end_time ? `–${e.end_time}` : ''}`;
}

export function eventPlace(e: Pick<AgendaEvent, 'unit_name' | 'municipality'>): string {
  return e.unit_name || e.municipality || 'A definir';
}

export function guidanceFor(e: Pick<AgendaEvent, 'category'>): string {
  switch (CATEGORIES[e.category]?.group) {
    case 'auditoria':
      return 'Prepare a documentação, revise as pendências e confirme as condições da unidade.';
    case 'visita':
      return 'Revise o objetivo, as atividades planejadas e o checklist da visita.';
    case 'reuniao':
      return 'Revise a pauta e confirme a presença dos participantes.';
    default:
      return 'Confirme a agenda com os envolvidos e atualize o status no sistema.';
  }
}

export function signPayload(parts: string[]): string {
  return crypto.createHmac('sha256', config.linkSigningSecret).update(parts.join('|')).digest('base64url').slice(0, 16);
}

export function attendancePayload(participantId: number, answer: 'S' | 'N'): string {
  return `PRES|${participantId}|${answer}|${signPayload(['PRES', String(participantId), answer])}`;
}

export function verifyAttendancePayload(payload: string): { participantId: number; answer: 'S' | 'N' } | null {
  const [tag, id, answer, sig] = payload.split('|');
  if (tag !== 'PRES' || !id || (answer !== 'S' && answer !== 'N') || !sig) return null;
  const expected = signPayload(['PRES', id, answer]);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { participantId: Number(id), answer };
}

export interface RenderedMessage {
  params: string[];
  preview: string;
  buttons: Array<{ type: 'url'; index: number; url_suffix: string } | { type: 'quick_reply'; index: number; payload: string }>;
}

export interface RenderInput {
  event?: AgendaEvent | null;
  action?: ActionItem | null;
  recipientName: string;
  pendingCount?: number;
  changeKind?: 'alterado' | 'cancelado';
  changes?: string;
  changedBy?: string;
  pendingReason?: string;
  participantId?: number;
  week?: { label: string; total: string; list: string; alerts: string };
  sentAt?: string;
}

export function renderMessage(t: Pick<TemplateDef, 'type' | 'body'>, input: RenderInput): RenderedMessage {
  const e = input.event;
  let params: unknown[] = [];
  const buttons: RenderedMessage['buttons'] = [];
  const pending = input.pendingCount === undefined ? '—' : input.pendingCount === 0 ? 'nenhuma ✅' : `${input.pendingCount} item(ns) em aberto`;
  switch (t.type) {
    case 'aviso_antecipado':
      params = [e!.title, eventPlace(e!), eventPeriod(e!), e!.responsible_name ?? 'A definir', guidanceFor(e!)];
      break;
    case 'lembrete_vespera':
    case 'lembrete_dia':
      params = [e!.title, eventPlace(e!), eventPeriod(e!), e!.responsible_name ?? 'A definir', pending];
      break;
    case 'alteracao':
      params = [input.changeKind === 'cancelado' ? 'CANCELADO' : 'ALTERADO', e!.title, eventPlace(e!), eventPeriod(e!), input.changes ?? 'dados do compromisso', input.changedBy ?? 'Sistema'];
      break;
    case 'reuniao_nao_confirmada':
      params = [e!.title, eventPeriod(e!), eventPlace(e!), input.pendingReason ?? 'agenda aguardando confirmação'];
      break;
    case 'pendencia_vencimento': {
      const a = input.action!;
      params = [a.title, a.due_date ? formatDateBR(a.due_date) : 'sem prazo', a.responsible_name ?? 'A definir', `${a.progress}% · prioridade ${PRIORITIES[a.severity].label.toLowerCase()}`, a.event_title ? `${ACTION_ORIGINS[a.origin]} — ${a.event_title}` : ACTION_ORIGINS[a.origin]];
      break;
    }
    case 'resumo_semanal':
      params = [input.week!.label, input.week!.total, input.week!.list, input.week!.alerts];
      break;
    case 'confirmacao_presenca':
      params = [input.recipientName.split(' ')[0], e!.title, eventPlace(e!), eventPeriod(e!)];
      break;
    case 'teste':
      params = [input.recipientName, input.sentAt ?? new Date().toISOString()];
      break;
  }
  const clean = params.map((p, i) => cleanParam(p, t.type === 'resumo_semanal' && i === 2 ? 600 : 220));
  if (e && ['aviso_antecipado', 'lembrete_vespera', 'lembrete_dia', 'alteracao', 'reuniao_nao_confirmada'].includes(t.type)) {
    buttons.push({ type: 'url', index: 0, url_suffix: String(e.id) });
  }
  if (t.type === 'confirmacao_presenca' && input.participantId) {
    buttons.push({ type: 'quick_reply', index: 0, payload: attendancePayload(input.participantId, 'S') });
    buttons.push({ type: 'quick_reply', index: 1, payload: attendancePayload(input.participantId, 'N') });
  }
  return { params: clean, preview: renderBody(t.body, clean), buttons };
}

export function templateLabel(type: NotificationType): string {
  return NOTIFICATION_TYPES[type]?.label ?? type;
}
