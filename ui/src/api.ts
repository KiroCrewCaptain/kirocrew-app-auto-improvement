// Thin client for the Auto-Improvement backend and the dashboard chat endpoints.
//
// The app's routes are served by the gateway's route registry under
// /api/apps/auto-improvement (backend/routes.py); the chat endpoints the
// resumable sessions use are /api/chat, /api/chat/slots/* and /api/chat/folders.
// Each is declared in app.json `permissions.api`. Every request goes through the
// host's permission-scoped client (`useAppApi()`), which the page root hands to
// `setTransport`: a same-origin fetch carrying the dashboard's session, refused in
// the browser for any path outside the manifest's grant. A non-2xx surfaces from
// that client as an error carrying the status and the raw body; it is read back
// here into an `ApiError` whose message is the backend's own `error` sentence.

/** The part of the scoped client this module uses. */
export interface Transport {
  raw(path: string, init?: RequestInit): Promise<Response>
}

export const API = '/api/apps/auto-improvement'

/** Before the root mounts (a module evaluated early): a plain same-origin fetch. */
const sameOriginFetch: Transport = {
  async raw(path, init) {
    const r = await fetch(path, { credentials: 'same-origin', ...init })
    if (!r.ok) {
      const text = await r.text().catch(() => r.statusText)
      throw Object.assign(new Error(`API ${r.status}: ${text}`), { status: r.status, body: text })
    }
    return r
  },
}

let transport: Transport = sameOriginFetch

/** Route every call through *next* (the page root passes `useAppApi()`). */
export function setTransport(next: Transport | null): void {
  transport = next ?? sameOriginFetch
}

/** A refused call: the HTTP status, the backend's `error` sentence and its raw body. */
export class ApiError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, message: string, body: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function backendMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      const error = (parsed as { error?: unknown }).error
      if (typeof error === 'string' && error) return error
    }
  } catch {
    /* not JSON: the text itself is the reason */
  }
  return body.trim() || `HTTP ${status}`
}

/** The scoped client's refusal as an `ApiError`; anything else passes through. */
export function toApiError(err: unknown): unknown {
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
    const status = (err as { status: number }).status
    const raw = (err as { body?: unknown }).body
    const body = typeof raw === 'string' ? raw : ''
    return new ApiError(status, backendMessage(status, body), body)
  }
  return err
}

/** One request through the scoped client; a refusal is rethrown as an `ApiError`. */
export async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await transport.raw(path, { credentials: 'same-origin', ...init })
  } catch (err) {
    throw toApiError(err)
  }
}

/** A JSON body, or `{}` for a 204 (a body-less success, such as a DELETE). */
async function readJson<T>(r: Response): Promise<T> {
  if (r.status === 204) return {} as T
  return (await r.json()) as T
}

export async function getJson<T>(path: string): Promise<T> {
  return readJson<T>(await request(path))
}

export async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return readJson<T>(await request(path, init))
}

/**
 * The body of a refused call, parsed, when it is a JSON object; `{}` otherwise.
 *
 * The built-in page read `{code, error}` off a non-2xx response itself (a 409 from
 * a run already in progress, a 400 from a refused clone). Through the scoped client
 * a non-2xx is an `ApiError`, whose raw body this reads back.
 */
export function refusalBody(err: unknown): Record<string, unknown> {
  const body = err instanceof ApiError ? err.body : ''
  try {
    const parsed: unknown = JSON.parse(body)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
