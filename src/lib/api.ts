// Thin wrapper around fetch for our own API (/api is proxied to the server in dev).

export class OfflineError extends Error {
  constructor() { super('offline') }
}

export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new OfflineError() // network failure: no connection, server down, etc.
  }
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}
