// Assistente da agenda: perguntas em linguagem natural respondidas só com os dados autorizados do sistema.
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LuBot, LuCopy, LuSend, LuShare2, LuSparkles, LuUser, LuDatabase } from 'react-icons/lu';
import { api } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import { cn } from '../lib/util.ts';
import { PageHeader } from '../components/Layout.tsx';
import { Button, Card, IconButton, Spinner, useFeedback } from '../components/ui.tsx';

interface Answer {
  intent: string;
  title: string;
  text: string;
  sources: Array<{ id: number; title: string }>;
}

interface Turn {
  id: number;
  q: string;
  a: Answer | null;
  error?: string;
}

const SUGGESTIONS = ['Qual minha agenda da próxima semana?', 'O que preciso preparar para a auditoria GMP+?', 'Quais reuniões ainda preciso confirmar?', 'Faça um resumo de novembro para meu coordenador.'];

function AnswerText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 text-[14px] leading-relaxed text-ink-2">
      {lines.map((l, i) =>
        l.startsWith('• ') ? (
          <div key={i} className="flex gap-2 pl-1">
            <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-emerald" />
            <span>{l.slice(2)}</span>
          </div>
        ) : l.startsWith('Atenção:') || l.startsWith('Pendente:') ? (
          <p key={i} className="rounded-lg bg-soft-amber px-2.5 py-1.5 text-[13.5px] text-[#8A5300] dark:text-amber">
            {l}
          </p>
        ) : i === 0 && l.startsWith('Resumo') ? (
          <p key={i} className="font-semibold text-ink">
            {l}
          </p>
        ) : (
          <p key={i}>{l}</p>
        ),
      )}
    </div>
  );
}

export function AssistantPage() {
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const { toast } = useFeedback();
  const end = useRef<HTMLDivElement>(null);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const id = Date.now();
    setTurns((t) => [...t, { id, q: text, a: null }]);
    setQ('');
    setBusy(true);
    setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 30);
    try {
      const a = await api.get<Answer>(`/api/assistant?q=${encodeURIComponent(text)}`);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, a } : x)));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 30);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(q);
  };

  const copy = async (a: Answer) => {
    try {
      await navigator.clipboard.writeText(`${a.title}\n\n${a.text}`);
      toast('ok', 'Texto copiado');
    } catch {
      toast('error', 'Não foi possível copiar neste navegador.');
    }
  };

  // Compartilhamento pelo próprio WhatsApp do usuário (link oficial wa.me — nada é enviado pelo sistema).
  const share = (a: Answer) => window.open(`https://wa.me/?text=${encodeURIComponent(`${a.title}\n\n${a.text}`)}`, '_blank', 'noopener');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Assistente da agenda" subtitle="Pergunte sobre compromissos, auditorias, confirmações e resumos. As respostas usam apenas os dados cadastrados que você pode ver." />

      {turns.length === 0 && (
        <Card className="mb-5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-soft-emerald text-emerald">
              <LuSparkles className="size-5" />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-ink">Comece por uma destas perguntas</p>
              <p className="mt-0.5 text-[13px] text-muted">Nada é inventado: se a informação não estiver no sistema, o assistente diz que não sabe.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => void ask(s)} className="rounded-2xl border border-line bg-surface px-4 py-3 text-left text-[14px] text-ink transition-colors hover:border-emerald hover:bg-soft-emerald/50">
                {s}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {turns.map((t) => (
          <div key={t.id} className="space-y-3 animate-rise">
            <div className="flex justify-end gap-2.5">
              <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-forest px-4 py-2.5 text-[14px] text-white dark:bg-emerald">{t.q}</div>
              <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                <LuUser className="size-3.5" />
              </span>
            </div>
            <div className="flex gap-2.5">
              <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-soft-emerald text-emerald">
                <LuBot className="size-4" />
              </span>
              <Card className="min-w-0 flex-1 p-4 sm:p-5">
                {!t.a && !t.error && (
                  <div className="flex items-center gap-2 text-[13.5px] text-muted">
                    <Spinner className="size-4" /> Consultando a agenda…
                  </div>
                )}
                {t.error && <p className="text-[14px] text-alert">{t.error}</p>}
                {t.a && (
                  <>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h2 className="text-[15px] font-semibold text-ink">{t.a.title}</h2>
                      {t.a.intent !== 'desconhecido' && (
                        <div className="-mt-1 -mr-1 flex shrink-0">
                          <IconButton label="Copiar resposta" onClick={() => void copy(t.a!)}>
                            <LuCopy className="size-4" />
                          </IconButton>
                          <IconButton label="Compartilhar pelo meu WhatsApp" onClick={() => share(t.a!)}>
                            <LuShare2 className="size-4" />
                          </IconButton>
                        </div>
                      )}
                    </div>
                    <AnswerText text={t.a.text} />
                    {t.a.sources.length > 0 && (
                      <div className="mt-4 border-t border-line pt-3">
                        <div className="mb-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted">
                          <LuDatabase className="size-3.5" /> Baseado em
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {t.a.sources.slice(0, 12).map((s) => (
                            <Link key={s.id} to={`/eventos/${s.id}`} className="rounded-lg border border-line px-2 py-1 text-[12px] text-ink-2 hover:border-emerald hover:text-ink">
                              {s.title}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {t.a.intent === 'desconhecido' && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {SUGGESTIONS.map((s) => (
                          <button key={s} onClick={() => void ask(s)} className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-emerald">
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Card>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      <form onSubmit={submit} className={cn('sticky bottom-20 z-10 mt-5 flex gap-2 rounded-2xl border border-line bg-surface/95 p-2 shadow-pop backdrop-blur lg:bottom-4')}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ex.: Faça um resumo de dezembro"
          aria-label="Pergunta para o assistente"
          maxLength={300}
          className="h-11 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-[15px] text-ink placeholder:text-muted focus:outline-none"
        />
        <Button type="submit" size="lg" loading={busy} disabled={!q.trim()} icon={<LuSend className="size-4" />}>
          <span className="hidden sm:inline">Perguntar</span>
        </Button>
      </form>
    </div>
  );
}
