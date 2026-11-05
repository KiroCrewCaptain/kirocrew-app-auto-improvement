// The dashboard chat endpoints a resumable session uses, over the host's scoped client.
//
// The built-in reached these through the dashboard's own `api` client and Redux
// thunks (`createSlot`, `deleteSlot`, `switchSlot`, `sendTurn`), none of which an
// installed bundle can import. Each call here is the same HTTP request those made,
// sent through `../api` (and so through `useAppApi()`, scoped to `permissions.api`:
// `/api/chat`, `/api/chat/slots/*`, `/api/chat/folders`).

import { ApiError, getJson, request, sendJson } from '../api'
import { sendTurn, type SendReceipt, type SendWire } from './sendTurn'

/** The part of a created slot's row this app reads. */
export interface CreatedSlot {
  key: string
  folder_id?: string
}

export function listChatFolders(): Promise<unknown> {
  return getJson<unknown>('/api/chat/folders')
}

/** `POST /api/chat/folders` at the top level, as the dashboard's `createChatFolder(name)`. */
export function createChatFolder(name: string): Promise<unknown> {
  return sendJson<unknown>('POST', '/api/chat/folders', { name, parent_id: '' })
}

/**
 * `POST /api/chat/slots`, with the fields the dashboard's `createSlot` sent for this
 * app: filed into the folder, titled at birth (the server pins the name, locking the
 * background auto-titler out), the persistent memory contract, and no fresh session
 * folder.
 */
export async function createSlot(opts: {
  folder_id: string
  title: string
  memory_mode: 'persistent'
  no_session_folder: true
}): Promise<CreatedSlot> {
  const slot = await sendJson<CreatedSlot>('POST', '/api/chat/slots', opts)
  if (!slot || typeof slot.key !== 'string' || !slot.key) {
    throw new Error('Chat slot create returned no key')
  }
  return slot
}

export async function deleteSlot(key: string): Promise<void> {
  await request('/api/chat/slots/' + encodeURIComponent(key), { method: 'DELETE' })
}

/** One row of the slot's transcript; a deleted slot answers 404 (an `ApiError`). */
export function slotDetail(key: string, limit = 1): Promise<{ total?: unknown; messages?: unknown }> {
  const query = new URLSearchParams({ limit: String(limit) })
  return getJson('/api/chat/slots/' + encodeURIComponent(key) + '?' + query)
}

/** Resolves when the slot still exists; rejects (404 for a deleted one) otherwise. */
export async function probeSlotExists(key: string): Promise<void> {
  await slotDetail(key, 1)
}

/**
 * Whether a refusal means the slot is GONE, the rule of the dashboard's
 * `utils/thunkError.isMissingSlotError`: a numeric status decides (404, and only
 * 404); without one, the message is read for a 404 or "not found".
 */
export function isMissingSlotError(e: unknown): boolean {
  if (e && typeof e === 'object') {
    const { status } = e as { status?: unknown }
    // `NaN === 404` is false, so a degenerate numeric status refuses (the safe
    // direction) rather than falling through to the prose guess.
    if (typeof status === 'number') return status === 404
  }
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /\b404\b/.test(msg) || /not found/i.test(msg)
}

/**
 * The seed's wire: one `POST /api/chat?ws=1` with the message and slot, resolving on
 * every HTTP status so the receipt classifier reads a 4xx/5xx as a refusal, under the
 * transport's deadline signal. A rejected fetch is passed through (`transport-error`),
 * as the dashboard's own wire passes it; the seeder then asks the slot what happened.
 */
const seedWire: SendWire = async (payload, signal) => {
  try {
    return await request('/api/chat?ws=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: payload.message, slot: payload.slot }),
      signal,
    })
  } catch (e) {
    if (e instanceof ApiError) {
      const body = e.body
      return {
        ok: false,
        json: async () => JSON.parse(body),
      }
    }
    throw e
  }
}

export function sendSeed(message: string, slot: string): Promise<SendReceipt> {
  return sendTurn({ message, slot, wire: seedWire })
}
