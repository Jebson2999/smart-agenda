import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { LuCircleAlert, LuCircleCheck, LuInfo, LuLoaderCircle, LuRefreshCw, LuX } from 'react-icons/lu';
import { cn } from '../lib/util.ts';
import type { ApiError } from '../lib/api.ts';

// ------------------------------------------------------------------ botões

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'inverse';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald text-white hover:bg-emerald-2 shadow-sm shadow-emerald/20',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2',
  subtle: 'bg-soft-emerald text-forest dark:text-mint hover:brightness-95',
  danger: 'bg-alert text-white hover:brightness-95',
  inverse: 'bg-white/12 text-white hover:bg-white/20 border border-white/15',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-[background,filter,transform] active:scale-[0.98] disabled:opacity-55 select-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : size === 'lg' ? 'h-12 px-5 text-[15px]' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LuLoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cn('inline-flex size-9 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2 transition-colors', className)} {...rest}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ superfícies

export function Card({ className, children, as: As = 'section' }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' }) {
  return <As className={cn('min-w-0 rounded-card bg-surface border border-line shadow-card', className)}>{children}</As>;
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-emerald dark:text-[#4CC28F]">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

const TONES = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  info: 'bg-[#E6F0FB] text-[#1D4F91] border-[#CFE0F5] dark:bg-[#14263D] dark:text-[#9CC3F0] dark:border-[#1E3A5C]',
  ok: 'bg-soft-emerald text-[#0F6B47] border-[#BDE9D3] dark:text-[#7FDCB0] dark:border-[#1D5A44]',
  warn: 'bg-soft-amber text-[#8A5300] border-[#F7DDA0] dark:text-[#F5C46A] dark:border-[#5A4413]',
  danger: 'bg-soft-alert text-[#A12828] border-[#F6C9C9] dark:text-[#F19B9B] dark:border-[#5C2323]',
  done: 'bg-[#EEF1F0] text-[#3D5149] border-[#DCE3DF] dark:bg-[#18241F] dark:text-[#A8BBB2] dark:border-[#25352F]',
  muted: 'bg-surface-2 text-muted border-line',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ formulários

export function Field({ label, hint, error, children, className, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-[12px] text-alert">{error}</p> : hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

const control = 'rounded-xl border border-line-strong bg-surface px-3 text-[14px] text-ink placeholder:text-muted/70 transition-colors focus:border-emerald focus:outline-none focus:ring-3 focus:ring-emerald/15 disabled:opacity-60';

/** Largura total por padrão, a menos que a tela informe outra largura (ex.: "w-auto"). */
const fullWidth = (className?: string) => (/(^|\s)w-/.test(className ?? '') ? '' : 'w-full');

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, fullWidth(className), 'h-10', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, fullWidth(className), 'select-chevron h-10 appearance-none pr-9', className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, fullWidth(className), 'min-h-[88px] py-2.5 leading-relaxed', className)} {...rest} />;
}

export function Switch({ checked, onChange, label, disabled, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; description?: ReactNode }) {
  return (
    <label className={cn('flex items-start justify-between gap-4 py-2', disabled && 'opacity-60')}>
      <span className="min-w-0">
        <span className="block text-[14px] text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[12px] text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-emerald' : 'bg-line-strong')}
      >
        <span className={cn('absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
    </label>
  );
}

// ------------------------------------------------------------------ indicadores

export function Progress({ value, tone = 'emerald', className, label }: { value: number; tone?: 'emerald' | 'amber' | 'alert' | 'forest'; className?: string; label?: string }) {
  const color = tone === 'amber' ? 'bg-amber' : tone === 'alert' ? 'bg-alert' : tone === 'forest' ? 'bg-forest dark:bg-mint' : 'bg-emerald';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 7, children, color = '#198A5D', track }: { value: number; size?: number; stroke?: number; children?: ReactNode; color?: string; track?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track ?? 'var(--surface-3)'} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)} style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <LuLoaderCircle className={cn('size-5 animate-spin text-emerald', className)} aria-label="Carregando" />;
}

export function EmptyState({ icon, title, text, action, compact }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-12')}>
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-surface-2 text-muted">{icon}</div>}
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {text && <p className="mt-1 max-w-sm text-[13px] text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-soft-alert text-alert">
        <LuCircleAlert className="size-5" />
      </div>
      <p className="text-[14px] font-medium text-ink">Não foi possível carregar</p>
      <p className="mt-1 max-w-sm text-[13px] text-muted">{error?.message ?? 'Erro desconhecido.'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" icon={<LuRefreshCw className="size-3.5" />} onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ key: T; label: string; count?: number; icon?: ReactNode }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto scroll-thin', className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-medium transition-colors',
            value === t.key ? 'bg-forest text-white dark:bg-mint dark:text-forest' : 'text-ink-2 hover:bg-surface-2',
          )}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && <span className={cn('num rounded-full px-1.5 text-[11px]', value === t.key ? 'bg-white/20' : 'bg-surface-3')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({ open, onClose, title, children, footer, size = 'md', description }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'; description?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[#06120e]/45 backdrop-blur-[2px] animate-pop" onClick={onClose} />
      <div
        ref={ref}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-hero bg-surface shadow-pop animate-sheet sm:rounded-hero',
          size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <IconButton label="Fechar" onClick={onClose} className="-mr-2 -mt-1">
            <LuX className="size-4" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 safe-bottom">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ confirmação e avisos

interface ConfirmOpts {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
}

interface ToastItem {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

const FeedbackCtx = createContext<{
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  toast: (kind: ToastItem['kind'], text: string) => void;
}>({ confirm: async () => false, toast: () => {} });

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })), []);
  const toast = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };
  return (
    <FeedbackCtx.Provider value={{ confirm, toast }}>
      {children}
      <Modal
        open={!!dialog}
        onClose={() => close(false)}
        title={dialog?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Voltar
            </Button>
            <Button variant={dialog?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
              {dialog?.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="text-[14px] leading-relaxed text-ink-2">{dialog?.message}</div>
      </Modal>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl px-4 py-3 text-[14px] shadow-pop animate-sheet', t.kind === 'error' ? 'bg-[#3B1414] text-white' : 'bg-forest text-white')}>
            {t.kind === 'ok' ? <LuCircleCheck className="mt-0.5 size-4 shrink-0 text-mint" /> : t.kind === 'error' ? <LuCircleAlert className="mt-0.5 size-4 shrink-0 text-[#F7A6A6]" /> : <LuInfo className="mt-0.5 size-4 shrink-0 text-mint" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </FeedbackCtx.Provider>
  );
}

export function useFeedback() {
  return useContext(FeedbackCtx);
}
