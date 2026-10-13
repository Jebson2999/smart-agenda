// Cliente HTTP da API: JSON, cabeçalho anti-CSRF, mensagens de erro em português.
export class ApiError extends Error {
  status: number;
  details?: Array<{ campo: string; mensagem: string }>;
  constructor(status: number, message: string, details?: Array<{ campo: string; mensagem: string }>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type Listener = (status: number) => void;
const listeners = new Set<Listener>();
export function onAuthProblem(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: Blob | ArrayBuffer; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-asa-request': '1', ...(opts.headers ?? {}) };
  let payload: BodyInit | undefined;
  if (opts.raw) payload = opts.raw as BodyInit;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, navigator.onLine ? 'Não foi possível falar com o servidor. Tente novamente.' : 'Você está sem conexão. Verifique a internet e tente novamente.');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 || res.status === 428) listeners.forEach((l) => l(res.status));
    const details = (data as { details?: Array<{ campo: string; mensagem: string }> })?.details;
    let msg = (data as { error?: string })?.error ?? `Erro ${res.status}`;
    if (Array.isArray(details) && details.length) msg = `${msg}: ${details.map((d) => d.mensagem).join('; ')}`;
    throw new ApiError(res.status, msg, Array.isArray(details) ? details : undefined);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, file: File) =>
    request<T>('POST', p, undefined, { raw: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) } }),
};

/** Baixa um arquivo autenticado (PDF, Excel, ICS). */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, (data as { error?: string })?.error ?? `Erro ${res.status}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd) ?? /filename="([^"]+)"/.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
