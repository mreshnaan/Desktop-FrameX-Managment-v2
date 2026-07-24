const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit & { accessToken?: string | null } = {},
): Promise<T> {
  const { accessToken, headers, ...rest } = opts;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });
  if (!res.ok) {
    const message = await res
      .json()
      .then((body: unknown) => {
        if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
          return body.error;
        }
        return undefined;
      })
      .catch(() => undefined);
    throw new Error(message ?? `API ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
