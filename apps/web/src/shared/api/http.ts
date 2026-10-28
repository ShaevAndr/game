export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function request<T>(path: string, options: { body?: unknown; signal?: AbortSignal; method?: 'GET' | 'POST' | 'DELETE' } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.message === 'string' ? result.message : `Ошибка сервера (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return result as T;
}
