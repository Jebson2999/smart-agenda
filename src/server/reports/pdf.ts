// Geração de PDFs (pdf-lib, fontes padrão Helvetica — acentuação do português suportada).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import { CATEGORIES, PRIORITIES, STATUSES, ACTION_STATUSES, ACTION_ORIGINS, CHECKLIST_STAGES, ATTENDANCE } from '../../shared/constants.ts';
import type { ChecklistStage } from '../../shared/constants.ts';
import { addDays, diffDays, formatDateBR, formatPeriod, monthLabel, monthRange, WEEKDAYS_SHORT_PT, weekday } from '../../shared/dates.ts';
import type { ActionItem, AgendaEvent, ChecklistItem, Participant } from '../../shared/types.ts';
import type { Conflict, HolidayAlert, Readiness, Summary } from '../../shared/intelligence.ts';
import type { Holiday } from '../../shared/holidays.ts';

const BRAND = rgb(0x0b / 255, 0x43 / 255, 0x36 / 255);
const BRAND2 = rgb(0x19 / 255, 0x8a / 255, 0x5d / 255);
const SOFT = rgb(0xd6 / 255, 0xf4 / 255, 0xe7 / 255);
const INK = rgb(0.1, 0.14, 0.13);
const MUTED = rgb(0.4, 0.45, 0.43);
const LINE = rgb(0.85, 0.89, 0.87);
const WARN = rgb(0.96, 0.62, 0.04);
const DANGER = rgb(0.86, 0.27, 0.27);

function hex(c: string): RGB {
  const n = parseInt(c.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const WIN_EXTRA = new Set('–—…•‘’“”€'.split(''));
/** Remove caracteres fora do WinAnsi (emojis etc.), que as fontes padrão do PDF não têm. */
export function pdfSafe(s: string): string {
  let out = '';
  for (const ch of s.replace(/\t/g, ' ')) {
    const code = ch.codePointAt(0)!;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_EXTRA.has(ch)) out += ch;
    else if (ch === '\n') out += ch;
    else if (ch === '✓' || ch === '✅') out += 'OK';
  }
  return out;
}

class Doc {
  pdf!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  w = 595.28;
  h = 841.89;
  margin = 40;
  title = '';
  generatedAt = '';

  static async create(title: string, landscape = false) {
    const d = new Doc();
    d.pdf = await PDFDocument.create();
    d.pdf.setTitle(title);
    d.pdf.setAuthor('ASTRAL Smart Agenda');
    d.pdf.setCreator('ASTRAL Smart Agenda');
    d.font = await d.pdf.embedFont(StandardFonts.Helvetica);
    d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    if (landscape) [d.w, d.h] = [d.h, d.w];
    d.title = title;
    d.generatedAt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
    d.newPage();
    return d;
  }

  newPage() {
    this.page = this.pdf.addPage([this.w, this.h]);
    this.page.drawRectangle({ x: 0, y: this.h - 6, width: this.w, height: 6, color: BRAND2 });
    this.text('ASTRAL SMART AGENDA', this.margin, this.h - 26, { size: 8, font: this.bold, color: BRAND2 });
    this.text(this.title, this.w - this.margin - this.width(this.title, 8), this.h - 26, { size: 8, color: MUTED });
    this.y = this.h - 50;
  }

  width(s: string, size: number, font = this.font) {
    return font.widthOfTextAtSize(pdfSafe(s), size);
  }

  text(s: string, x: number, y: number, o: { size?: number; font?: PDFFont; color?: RGB } = {}) {
    this.page.drawText(pdfSafe(s), { x, y, size: o.size ?? 10, font: o.font ?? this.font, color: o.color ?? INK });
  }

  wrap(s: string, maxWidth: number, size: number, font = this.font): string[] {
    const lines: string[] = [];
    for (const para of pdfSafe(s).split('\n')) {
      const words = para.split(/\s+/);
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(test, size) <= maxWidth) cur = test;
        else {
          if (cur) lines.push(cur);
          // palavra maior que a linha: corta
          let word = w;
          while (font.widthOfTextAtSize(word, size) > maxWidth && word.length > 1) {
            let cut = word.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxWidth) cut--;
            lines.push(word.slice(0, cut));
            word = word.slice(cut);
          }
          cur = word;
        }
      }
      lines.push(cur);
    }
    return lines;
  }

  ensure(space: number) {
    if (this.y - space < this.margin + 20) this.newPage();
  }

  h1(s: string, sub?: string) {
    this.ensure(60);
    this.text(s, this.margin, this.y - 18, { size: 20, font: this.bold, color: BRAND });
    this.y -= 26;
    if (sub) {
      this.text(sub, this.margin, this.y - 12, { size: 10, color: MUTED });
      this.y -= 18;
    }
    this.y -= 8;
  }

  h2(s: string) {
    this.ensure(40);
    this.y -= 8;
    this.text(s, this.margin, this.y - 12, { size: 12.5, font: this.bold, color: BRAND });
    this.page.drawLine({ start: { x: this.margin, y: this.y - 17 }, end: { x: this.w - this.margin, y: this.y - 17 }, thickness: 0.7, color: LINE });
    this.y -= 26;
  }

  para(s: string, o: { size?: number; color?: RGB; indent?: number; font?: PDFFont } = {}) {
    const size = o.size ?? 10;
    const lh = size * 1.38;
    const x = this.margin + (o.indent ?? 0);
    for (const line of this.wrap(s, this.w - this.margin - x, size, o.font)) {
      this.ensure(lh);
      this.text(line, x, this.y - size, { size, color: o.color, font: o.font });
      this.y -= lh;
    }
  }

  bullet(s: string, color: RGB = BRAND2) {
    const size = 10;
    const lines = this.wrap(s, this.w - this.margin * 2 - 14, size);
    this.ensure(lines.length * 14);
    this.page.drawCircle({ x: this.margin + 4, y: this.y - 6.5, size: 2.2, color });
    lines.forEach((l, i) => {
      this.text(l, this.margin + 14, this.y - size - i * 14, { size });
    });
    this.y -= lines.length * 14 + 2;
  }

  checkbox(s: string, done: boolean, extra?: string) {
    const size = 10;
    const lines = this.wrap(s + (extra ? `  (${extra})` : ''), this.w - this.margin * 2 - 20, size);
    this.ensure(lines.length * 14 + 2);
    const bx = this.margin + 2;
    const by = this.y - 10.5;
    this.page.drawRectangle({ x: bx, y: by, width: 9, height: 9, borderColor: done ? BRAND2 : MUTED, borderWidth: 0.9, color: done ? SOFT : undefined });
    if (done) {
      this.page.drawLine({ start: { x: bx + 1.8, y: by + 4.5 }, end: { x: bx + 3.8, y: by + 2.2 }, thickness: 1.3, color: BRAND2 });
      this.page.drawLine({ start: { x: bx + 3.8, y: by + 2.2 }, end: { x: bx + 7.6, y: by + 7.2 }, thickness: 1.3, color: BRAND2 });
    }
    lines.forEach((l, i) => this.text(l, this.margin + 18, this.y - size - i * 14, { size, color: done ? MUTED : INK }));
    this.y -= lines.length * 14 + 3;
  }

  kpis(items: Array<{ label: string; value: string; tone?: 'warn' | 'danger' | 'ok' }>) {
    const gap = 8;
    const cols = Math.min(items.length, 4);
    const bw = (this.w - this.margin * 2 - gap * (cols - 1)) / cols;
    const bh = 52;
    for (let i = 0; i < items.length; i += cols) {
      this.ensure(bh + 8);
      items.slice(i, i + cols).forEach((it, j) => {
        const x = this.margin + j * (bw + gap);
        const y = this.y - bh;
        this.page.drawRectangle({ x, y, width: bw, height: bh, color: rgb(0.965, 0.98, 0.972), borderColor: LINE, borderWidth: 0.7 });
        const c = it.tone === 'danger' ? DANGER : it.tone === 'warn' ? WARN : BRAND;
        this.text(it.value, x + 10, y + 22, { size: 18, font: this.bold, color: c });
        this.text(it.label, x + 10, y + 9, { size: 8, color: MUTED });
      });
      this.y -= bh + gap;
    }
    this.y -= 4;
  }

  table(cols: Array<{ header: string; width: number }>, rows: string[][], o: { size?: number; zebra?: boolean } = {}) {
    const size = o.size ?? 8.5;
    const total = cols.reduce((s, c) => s + c.width, 0);
    const scale = (this.w - this.margin * 2) / total;
    const widths = cols.map((c) => c.width * scale);
    const drawHeader = () => {
      this.ensure(22);
      this.page.drawRectangle({ x: this.margin, y: this.y - 16, width: this.w - this.margin * 2, height: 16, color: BRAND });
      let x = this.margin;
      cols.forEach((c, i) => {
        this.text(c.header, x + 4, this.y - 11.5, { size: size, font: this.bold, color: rgb(1, 1, 1) });
        x += widths[i];
      });
      this.y -= 16;
    };
    drawHeader();
    rows.forEach((row, ri) => {
      const cellLines = row.map((v, i) => this.wrap(v ?? '', widths[i] - 8, size));
      const lh = size * 1.3;
      const hgt = Math.max(...cellLines.map((l) => l.length)) * lh + 6;
      if (this.y - hgt < this.margin + 20) {
        this.newPage();
        drawHeader();
      }
      if (ri % 2 === 1) this.page.drawRectangle({ x: this.margin, y: this.y - hgt, width: this.w - this.margin * 2, height: hgt, color: rgb(0.972, 0.982, 0.977) });
      let x = this.margin;
      cellLines.forEach((lines, i) => {
        lines.forEach((l, k) => this.text(l, x + 4, this.y - 3 - size - k * lh, { size }));
        x += widths[i];
      });
      this.page.drawLine({ start: { x: this.margin, y: this.y - hgt }, end: { x: this.w - this.margin, y: this.y - hgt }, thickness: 0.4, color: LINE });
      this.y -= hgt;
    });
    this.y -= 10;
  }

  async finish(): Promise<Uint8Array> {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => {
      const footer = pdfSafe(`Gerado em ${this.generatedAt} (America/Cuiaba) · página ${i + 1} de ${pages.length}`);
      p.drawText(footer, { x: this.margin, y: 20, size: 7.5, font: this.font, color: MUTED });
      p.drawText(pdfSafe('Dados extraídos do ASTRAL Smart Agenda'), { x: this.w - this.margin - this.font.widthOfTextAtSize('Dados extraídos do ASTRAL Smart Agenda', 7.5), y: 20, size: 7.5, font: this.font, color: MUTED });
    });
    return this.pdf.save();
  }
}

const place = (e: AgendaEvent) => e.unit_name || e.municipality || 'A definir';
const timeOf = (e: AgendaEvent) => (e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ''}` : 'sem horário');

// ------------------------------------------------------------------ agenda mensal

export async function monthlyAgendaPdf(month: string, events: AgendaEvent[], holidays: Holiday[], conflicts: Conflict[]): Promise<Uint8Array> {
  const label = monthLabel(month);
  const doc = await Doc.create(`Agenda mensal — ${label}`, true);
  doc.h1(`Agenda — ${label[0].toUpperCase()}${label.slice(1)}`, `${events.filter((e) => e.status !== 'cancelado').length} compromisso(s) · horários exibidos somente quando informados`);
  const { start, end } = monthRange(month);
  const gridStart = addDays(start, -weekday(start));
  const weeks = Math.ceil((diffDays(gridStart, end) + 1) / 7);
  const x0 = doc.margin;
  const cw = (doc.w - doc.margin * 2) / 7;
  const top = doc.y;
  const headerH = 16;
  const ch = Math.min(70, (top - doc.margin - 40 - headerH) / weeks);
  WEEKDAYS_SHORT_PT.forEach((wd, i) => {
    doc.page.drawRectangle({ x: x0 + i * cw, y: top - headerH, width: cw, height: headerH, color: BRAND });
    doc.text(wd.toUpperCase(), x0 + i * cw + 6, top - 11.5, { size: 8, font: doc.bold, color: rgb(1, 1, 1) });
  });
  const hset = new Map(holidays.map((h) => [h.date, h.name]));
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < 7; i++) {
      const date = addDays(gridStart, w * 7 + i);
      const x = x0 + i * cw;
      const y = top - headerH - (w + 1) * ch;
      const inMonth = date >= start && date <= end;
      doc.page.drawRectangle({ x, y, width: cw, height: ch, borderColor: LINE, borderWidth: 0.6, color: !inMonth ? rgb(0.975, 0.978, 0.977) : i === 0 || i === 6 ? rgb(0.985, 0.99, 0.988) : undefined });
      if (!inMonth) continue;
      doc.text(String(Number(date.slice(8))), x + 5, y + ch - 11, { size: 9, font: doc.bold, color: hset.has(date) ? DANGER : INK });
      if (hset.has(date)) {
        const hn = doc.wrap(hset.get(date)!, cw - 26, 6)[0];
        doc.text(hn, x + 20, y + ch - 10.5, { size: 6, color: DANGER });
      }
      const dayEvents = events.filter((e) => e.status !== 'cancelado' && e.start_date <= date && e.end_date >= date);
      dayEvents.slice(0, 3).forEach((e, k) => {
        const by = y + ch - 26 - k * 14;
        const color = hex(CATEGORIES[e.category].color);
        doc.page.drawRectangle({ x: x + 3, y: by, width: cw - 6, height: 12, color, opacity: 0.14 });
        doc.page.drawRectangle({ x: x + 3, y: by, width: 2.5, height: 12, color });
        const t = doc.wrap(`${CATEGORIES[e.category].short} · ${place(e)}`, cw - 14, 6.5)[0];
        doc.text(t, x + 8, by + 3.5, { size: 6.5, color: INK });
      });
      if (dayEvents.length > 3) doc.text(`+${dayEvents.length - 3}`, x + cw - 16, y + 4, { size: 7, font: doc.bold, color: MUTED });
      if (conflicts.some((c) => c.dates.includes(date))) doc.page.drawRectangle({ x: x + cw - 9, y: y + ch - 10, width: 5, height: 5, color: WARN });
    }
  }
  doc.y = top - headerH - weeks * ch - 14;
  doc.text('Legenda:', doc.margin, doc.y, { size: 7.5, font: doc.bold, color: MUTED });
  let lx = doc.margin + 40;
  for (const [, c] of Object.entries(CATEGORIES)) {
    if (c.short === 'Outro') continue;
    doc.page.drawRectangle({ x: lx, y: doc.y - 1, width: 7, height: 7, color: hex(c.color) });
    doc.text(c.short, lx + 10, doc.y, { size: 7.5, color: MUTED });
    lx += doc.width(c.short, 7.5) + 24;
  }
  doc.page.drawRectangle({ x: lx, y: doc.y - 1, width: 5, height: 5, color: WARN });
  doc.text('possível conflito', lx + 8, doc.y, { size: 7.5, color: MUTED });

  doc.newPage();
  doc.h2('Compromissos do mês');
  doc.table(
    [
      { header: 'Período', width: 90 },
      { header: 'Horário', width: 55 },
      { header: 'Compromisso', width: 200 },
      { header: 'Unidade', width: 100 },
      { header: 'Categoria', width: 110 },
      { header: 'Prioridade', width: 60 },
      { header: 'Status', width: 70 },
    ],
    events.map((e) => [formatPeriod(e.start_date, e.end_date), timeOf(e), e.title, place(e), CATEGORIES[e.category].label, PRIORITIES[e.priority].label, STATUSES[e.status].label]),
  );
  const monthConf = conflicts.filter((c) => c.dates.some((d) => d >= start && d <= end));
  const monthHol = holidays.filter((h) => events.some((e) => e.status !== 'cancelado' && e.start_date <= h.date && e.end_date >= h.date));
  if (monthConf.length || monthHol.length) {
    doc.h2('Pontos de atenção');
    monthConf.forEach((c) => doc.bullet(c.message, WARN));
    monthHol.forEach((h) => doc.bullet(`${formatDateBR(h.date)} — ${h.name}: há compromisso agendado neste feriado.`, DANGER));
  }
  return doc.finish();
}

// ------------------------------------------------------------------ resumo executivo

export async function executiveSummaryPdf(summary: Summary, readiness: Array<Readiness & { title: string; period: string }>, overdue: Array<{ title: string; message: string }>): Promise<Uint8Array> {
  const doc = await Doc.create(`Resumo executivo — ${summary.label}`);
  doc.h1('Resumo executivo', `${summary.label} · ${formatPeriod(summary.start, summary.end)}`);
  doc.kpis([
    { label: 'Compromissos', value: String(summary.total) },
    { label: 'Dias de agenda em campo', value: String(summary.agendaDays) },
    { label: 'Concluídos', value: String(summary.concluded), tone: 'ok' },
    { label: 'Em aberto', value: String(summary.open) },
    { label: 'Atrasados', value: String(summary.overdue), tone: summary.overdue ? 'danger' : undefined },
    { label: 'Possíveis conflitos', value: String(summary.conflicts.length), tone: summary.conflicts.length ? 'warn' : undefined },
    { label: 'Aguardando confirmação', value: String(summary.pending.length), tone: summary.pending.length ? 'warn' : undefined },
    { label: 'Feriados com agenda', value: String(summary.holidays.length), tone: summary.holidays.length ? 'warn' : undefined },
  ]);
  doc.h2('Visão geral');
  summary.lines.filter((l) => !l.startsWith('•') && !l.startsWith('Atenção') && !l.startsWith('Pendente')).forEach((l) => doc.para(l));
  if (summary.byCategory.length) {
    doc.h2('Por categoria');
    doc.table([{ header: 'Categoria', width: 300 }, { header: 'Compromissos', width: 100 }], summary.byCategory.map((c) => [c.label, String(c.count)]));
  }
  if (summary.byPlace.length) {
    doc.h2('Dias por unidade');
    doc.table([{ header: 'Unidade / município', width: 300 }, { header: 'Dias', width: 100 }], summary.byPlace.map((p) => [p.place, String(p.days)]));
  }
  doc.h2('Agenda do período');
  const items = summary.lines.filter((l) => l.startsWith('•'));
  if (items.length) items.forEach((l) => doc.bullet(l.slice(2)));
  else doc.para('Nenhum compromisso no período.', { color: MUTED });
  if (readiness.length) {
    doc.h2('Auditorias — preparação');
    doc.table(
      [{ header: 'Auditoria', width: 220 }, { header: 'Período', width: 90 }, { header: 'Preparação', width: 70 }, { header: 'Pend. críticas', width: 70 }, { header: 'Prazo', width: 70 }],
      readiness.map((r) => [r.title, r.period, `${r.percent}% (${r.done}/${r.total})`, String(r.criticalPending), r.phase === 'pre' ? `${r.daysRemaining} dia(s)` : r.phase === 'durante' ? 'em andamento' : 'realizada']),
    );
  }
  const attention = [...summary.conflicts.map((c) => c.message), ...summary.holidays.map((h) => h.message), ...summary.pending.map((p) => `${p.title} (${p.period}): ${p.reason}.`), ...overdue.map((o) => `${o.title}: ${o.message}`)];
  if (attention.length) {
    doc.h2('Pontos de atenção');
    attention.forEach((a) => doc.bullet(a, WARN));
  }
  return doc.finish();
}

// ------------------------------------------------------------------ relatório de auditoria

export async function auditReportPdf(d: {
  event: AgendaEvent;
  readiness: Readiness;
  prep: AgendaEvent | null;
  checklist: ChecklistItem[];
  actions: ActionItem[];
  participants: Participant[];
  conflicts: Conflict[];
  holidays: HolidayAlert[];
  history: Array<{ created_at: string; summary: string; user_name?: string | null }>;
  comments: Array<{ created_at: string; text: string; user_name?: string | null }>;
}): Promise<Uint8Array> {
  const e = d.event;
  const doc = await Doc.create(`Relatório de auditoria — ${e.title}`);
  doc.h1('Relatório de auditoria', `${e.title} · ${formatPeriod(e.start_date, e.end_date)}`);
  doc.kpis([
    { label: 'Preparação registrada', value: `${d.readiness.percent}%`, tone: d.readiness.level === 'insuficiente' ? 'danger' : d.readiness.percent >= 90 ? 'ok' : 'warn' },
    { label: 'Pendências críticas', value: String(d.readiness.criticalPending), tone: d.readiness.criticalPending ? 'danger' : 'ok' },
    { label: d.readiness.phase === 'pre' ? 'Dias até a auditoria' : 'Situação', value: d.readiness.phase === 'pre' ? String(d.readiness.daysRemaining) : d.readiness.phase === 'durante' ? 'Em curso' : 'Realizada' },
    { label: 'Apontamentos abertos', value: String(d.actions.filter((a) => a.status === 'aberta' || a.status === 'em_andamento').length) },
  ]);
  doc.h2('Dados do compromisso');
  [
    `Unidade: ${place(e)}${e.client ? ` · Cliente: ${e.client}` : ''}`,
    `Período: ${formatPeriod(e.start_date, e.end_date)} (${timeOf(e)})`,
    `Responsável: ${e.responsible_name ?? 'A definir'} · Prioridade: ${PRIORITIES[e.priority].label} · Status: ${STATUSES[e.status].label}`,
    d.prep ? `Preparação vinculada: ${d.prep.title} (${formatPeriod(d.prep.start_date, d.prep.end_date)})` : 'Sem compromisso de preparação vinculado.',
    e.description ? `Descrição: ${e.description}` : '',
    e.notes ? `Observações: ${e.notes}` : '',
  ]
    .filter(Boolean)
    .forEach((l) => doc.para(l));
  if (d.readiness.reasons.length) {
    doc.h2('Alertas de preparação');
    d.readiness.reasons.forEach((r) => doc.bullet(r, DANGER));
  }
  if (d.conflicts.length || d.holidays.length) {
    doc.h2('Agenda');
    d.conflicts.forEach((c) => doc.bullet(c.message, WARN));
    d.holidays.forEach((h) => doc.bullet(h.message, DANGER));
  }
  if (d.prep) {
    doc.h2(`Preparação da planta (${formatPeriod(d.prep.start_date, d.prep.end_date)})`);
    const items = d.checklist.filter((c) => c.event_id === d.prep!.id);
    if (!items.length) doc.para('Nenhum item cadastrado.', { color: MUTED });
    items.forEach((c) => doc.checkbox(c.text, c.done, [c.critical ? 'crítico' : '', c.done && c.done_at ? `feito em ${formatDateBR(c.done_at.slice(0, 10))}` : ''].filter(Boolean).join(' · ')));
  }
  for (const stage of ['pre', 'durante', 'pos'] as ChecklistStage[]) {
    const items = d.checklist.filter((c) => c.event_id === e.id && c.stage === stage);
    doc.h2(CHECKLIST_STAGES[stage]);
    if (!items.length) doc.para('Nenhum item cadastrado nesta etapa.', { color: MUTED });
    items.forEach((c) => doc.checkbox(c.text, c.done, [c.critical ? 'crítico' : '', c.notes ? `obs.: ${c.notes}` : '', c.done && c.done_at ? `feito em ${formatDateBR(c.done_at.slice(0, 10))}` : ''].filter(Boolean).join(' · ')));
  }
  doc.h2('Apontamentos e ações');
  if (!d.actions.length) doc.para('Nenhum apontamento registrado.', { color: MUTED });
  else
    doc.table(
      [{ header: 'Apontamento / ação', width: 200 }, { header: 'Etapa', width: 80 }, { header: 'Responsável', width: 90 }, { header: 'Prazo', width: 60 }, { header: 'Status', width: 70 }, { header: '%', width: 35 }],
      d.actions.map((a) => [a.title + (a.description ? ` — ${a.description}` : ''), ACTION_ORIGINS[a.origin], a.responsible_name ?? '—', a.due_date ? formatDateBR(a.due_date) : '—', ACTION_STATUSES[a.status], `${a.progress}%`]),
    );
  if (d.participants.length) {
    doc.h2('Participantes');
    d.participants.forEach((p) => doc.bullet(`${p.name}${p.role_label ? ` (${p.role_label})` : ''} — ${ATTENDANCE[p.attendance]}`));
  }
  if (d.comments.length) {
    doc.h2('Observações registradas');
    d.comments.forEach((c) => doc.bullet(`${formatDateBR(c.created_at.slice(0, 10))} · ${c.user_name ?? 'Sistema'}: ${c.text}`));
  }
  doc.h2('Histórico recente');
  d.history.slice(0, 15).forEach((h) => doc.bullet(`${formatDateBR(h.created_at.slice(0, 10))} · ${h.user_name ?? 'Sistema'}: ${h.summary}`, LINE));
  doc.para('Os checklists são modelos editáveis cadastrados no sistema. Requisitos específicos da certificação GMP+ devem ser validados com a norma vigente.', { size: 8, color: MUTED });
  return doc.finish();
}

// ------------------------------------------------------------------ visitas e reuniões

export async function visitsMeetingsPdf(
  label: string,
  items: Array<{ event: AgendaEvent; checklist: ChecklistItem[]; participants: Participant[]; actions: ActionItem[]; comments: Array<{ text: string; user_name?: string | null; created_at: string }> }>,
): Promise<Uint8Array> {
  const doc = await Doc.create(`Visitas técnicas e reuniões — ${label}`);
  doc.h1('Relatório de visitas técnicas e reuniões', label);
  doc.kpis([
    { label: 'Visitas técnicas', value: String(items.filter((i) => CATEGORIES[i.event.category].group === 'visita').length) },
    { label: 'Reuniões', value: String(items.filter((i) => i.event.category === 'reuniao' || i.event.category === 'visita_reuniao').length) },
    { label: 'Concluídas', value: String(items.filter((i) => i.event.status === 'concluido').length), tone: 'ok' },
    { label: 'Ações derivadas', value: String(items.reduce((s, i) => s + i.actions.length, 0)) },
  ]);
  if (!items.length) doc.para('Nenhuma visita técnica ou reunião no período.', { color: MUTED });
  for (const it of items) {
    const e = it.event;
    const det = (e.details ?? {}) as Record<string, string>;
    doc.h2(`${formatPeriod(e.start_date, e.end_date)} — ${e.title}`);
    doc.para(`${CATEGORIES[e.category].label} · ${place(e)} · ${STATUSES[e.status].label} · Responsável: ${e.responsible_name ?? 'A definir'}`, { color: MUTED, size: 9 });
    const fields: Array<[string, string | undefined]> = [
      ['Objetivo', det.objective],
      ['Atividades planejadas', det.plannedActivities],
      ['Resultado da visita', det.result],
      ['Pendências identificadas', det.findings],
      ['Encaminhamentos', det.referrals],
      ['Pauta', det.agenda],
      ['Ata', det.minutes],
      ['Decisões', det.decisions],
    ];
    const filled = fields.filter(([, v]) => v && String(v).trim());
    if (!filled.length) doc.para('Detalhes ainda não registrados.', { color: MUTED, size: 9 });
    filled.forEach(([k, v]) => doc.para(`${k}: ${v}`, { size: 9.5 }));
    const done = it.checklist.filter((c) => c.done).length;
    doc.para(`Checklist: ${done} de ${it.checklist.length} itens concluídos.`, { size: 9, color: MUTED });
    if (it.participants.length) doc.para(`Participantes: ${it.participants.map((p) => `${p.name} (${ATTENDANCE[p.attendance].toLowerCase()})`).join(', ')}`, { size: 9 });
    if (it.actions.length) {
      doc.table(
        [{ header: 'Tarefa / encaminhamento', width: 230 }, { header: 'Responsável', width: 100 }, { header: 'Prazo', width: 60 }, { header: 'Status', width: 70 }, { header: '%', width: 35 }],
        it.actions.map((a) => [a.title, a.responsible_name ?? '—', a.due_date ? formatDateBR(a.due_date) : '—', ACTION_STATUSES[a.status], `${a.progress}%`]),
      );
    }
    it.comments.slice(0, 5).forEach((c) => doc.bullet(`${formatDateBR(c.created_at.slice(0, 10))} · ${c.user_name ?? '—'}: ${c.text}`, LINE));
  }
  return doc.finish();
}
