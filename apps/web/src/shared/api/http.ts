export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const SESSION_EXPIRED_EVENT = 'game-session-expired';
const SESSION_TOKEN_KEY = 'game-session-token';
export function getSessionToken() { return sessionStorage.getItem(SESSION_TOKEN_KEY); }
export function setSessionToken(token: string | null) {
  if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  else sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

export async function request<T>(path: string, options: { body?: unknown; signal?: AbortSignal; method?: 'GET' | 'POST' | 'DELETE' } = {}): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token && getSessionToken() === token) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const message = typeof result?.message === 'string' ? result.message : `Ошибка сервера (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return result as T;
}
