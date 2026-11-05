/**
 * The send-receipt contract this app needs from the dashboard's chat-core
 * transport (`chat-core/transport/sendTurn.ts`), restated for a bundle: the
 * dashboard module is not part of the App Kit, so the bundle cannot import it.
 *
 * One `POST /api/chat?ws=1` through a wire, bounded by `SEND_ABORT_MS`, and the
 * answer read as a receipt. Never rejects; the caller branches on `status`:
 *
 * - `dispatched` / `queued`: the server took the message (`ok`, or `queued`).
 * - `refused`: a non-2xx, a readable body with neither `ok` nor `queued`, or a
 *   2xx an intermediary answered (a redirect that left `/api/chat` with a body
 *   that is not JSON). Nothing was sent. `reason` is the server's explanation.
 * - `unknown`: a 2xx whose body could not be read. The turn may well be running.
 * - `response-late`: the deadline fired, or the wire said `indeterminate()`.
 * - `transport-error`: the wire rejected with anything else.
 */

export const SEND_ABORT_MS = 10_000

export type SendReceiptStatus =
  | 'dispatched'
  | 'queued'
  | 'refused'
  | 'unknown'
  | 'response-late'
  | 'transport-error'

export interface SendReceiptBody {
  ok?: boolean
  queued?: boolean
  error?: unknown
  [key: string]: unknown
}

export interface SendReceipt {
  status: SendReceiptStatus
  body: SendReceiptBody
  reason?: string
}

export interface SendResponseLike {
  ok: boolean
  json(): Promise<unknown>
  redirected?: boolean
  url?: string
}

export interface SendWirePayload {
  message: string
  slot?: string
}

export type SendWire = (payload: SendWirePayload, signal: AbortSignal) => Promise<SendResponseLike>

/** A wire's "delivery is indeterminate" rejection: read as `response-late`. */
export function indeterminate(): DOMException {
  return new DOMException('aborted', 'AbortError')
}

const CHAT_ENDPOINT_PATH = '/api/chat'

function answeredByIntermediary(response: SendResponseLike): boolean {
  if (!response.redirected) return false
  try {
    return new URL(response.url ?? '', 'http://localhost').pathname !== CHAT_ENDPOINT_PATH
  } catch {
    return true
  }
}

async function readSendReceipt(response: SendResponseLike): Promise<{ body: SendReceiptBody; outcome: 'accepted' | 'refused' | 'unknown' }> {
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    parsed = undefined
  }
  const readable = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  const body = readable ? (parsed as SendReceiptBody) : {}
  if (!response.ok) return { body, outcome: 'refused' }
  if (!readable) return { body, outcome: answeredByIntermediary(response) ? 'refused' : 'unknown' }
  if (body.ok || body.queued) return { body, outcome: 'accepted' }
  return { body, outcome: 'refused' }
}

export async function sendTurn(opts: { message: string; slot?: string; wire: SendWire }): Promise<SendReceipt> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SEND_ABORT_MS)
  try {
    const r = await opts.wire({ message: opts.message, slot: opts.slot }, controller.signal)
    const { body, outcome } = await readSendReceipt(r)
    if (outcome === 'refused') return { status: 'refused', body, reason: typeof body.error === 'string' ? body.error : undefined }
    if (outcome === 'unknown') return { status: controller.signal.aborted ? 'response-late' : 'unknown', body }
    return { status: body.ok && !body.queued ? 'dispatched' : 'queued', body }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') return { status: 'response-late', body: {} }
    return { status: 'transport-error', body: {} }
  } finally {
    clearTimeout(timeout)
  }
}
