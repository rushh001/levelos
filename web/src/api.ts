const BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function token(): string | null {
  try {
    return localStorage.getItem('levelos.token')
  } catch {
    return null
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const t = token()
  if (t) headers.set('Authorization', `Bearer ${t}`)

  const res = await fetch(`${BASE}/api${path}`, { ...init, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}
