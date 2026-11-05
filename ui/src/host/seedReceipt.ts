/**
 * Receipt policy for a NON-INTERACTIVE SEED -- the first message this app sends into a
 * slot it just created, with no composer to restore into. Restated from the
 * dashboard's `utils/seedReceipt.ts` (not part of the App Kit), unchanged but for its
 * transport, which is this bundle's scoped client:
 *
 * - `refused`: the server said no, so nothing is running -- the seed never ran.
 * - `transport-error` / `response-late`: no receipt at all (the fetch rejected, or the
 *   deadline passed first). Delivery is indeterminate, so instead of guessing the
 *   seeder ASKS the slot. The seed is stored as the slot's first message before its
 *   turn runs, so a one-row slot read settles it: a message means the seed is (or may
 *   be) running; an empty slot, re-read a bounded number of times to let a late
 *   arrival land, means it did not. A probe the server cannot answer reads as "may be
 *   running" -- deleting on a guess would cancel real work. A slot the server reports
 *   GONE is not running the seed.
 * - `unknown`: a 2xx whose body could not be read -- accepted; the seed ran.
 * - `dispatched` / `queued`: the seed ran.
 */
import { i18nT } from '../i18n'
import { isMissingSlotError, slotDetail } from './chat'
import type { SendReceipt } from './sendTurn'

/** How many times an empty slot is re-read before a no-receipt send is ruled
 *  never-landed, and the gap between reads. A judgement call sizing the late-landing
 *  window described above, not a measured figure. */
export const SEED_PROBE_ATTEMPTS = 3
export const SEED_PROBE_GAP_MS = 1000

export type SeedVerdict =
  | { ran: true }
  /** The seed provably never ran; `reason` is the user-facing text. */
  | { ran: false; reason: string }

/** The user-facing text of a seed that did not start: the dashboard's own "could not
 *  start" copy, with the server's reason appended when it gave one. */
function seedFailureText(reason?: string): string {
  const base = i18nT('pages.chatPage.could_not_start_a_new_session')
  return reason ? `${base} (${reason})` : base
}

/** What the slot says about the seed: it is there, the slot is still empty, the slot
 *  is gone, or the server could not answer. */
async function probeSlot(slotKey: string): Promise<'landed' | 'empty' | 'gone' | 'unknown'> {
  try {
    const detail = await slotDetail(slotKey, 1)
    const count = typeof detail.total === 'number'
      ? detail.total
      : Array.isArray(detail.messages) ? detail.messages.length : 0
    return count > 0 ? 'landed' : 'empty'
  } catch (e) {
    return isMissingSlotError(e) ? 'gone' : 'unknown'
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Settle a seed's receipt into "ran" or "never ran". Only `never ran` may tear the
 * slot down; see the module comment for why each status lands where it does.
 */
export async function settleSeedReceipt(receipt: SendReceipt, slotKey: string): Promise<SeedVerdict> {
  if (receipt.status === 'refused') return { ran: false, reason: seedFailureText(receipt.reason) }
  if (receipt.status !== 'transport-error' && receipt.status !== 'response-late') return { ran: true }
  for (let attempt = 1; ; attempt++) {
    const probe = await probeSlot(slotKey)
    if (probe === 'landed' || probe === 'unknown') return { ran: true }
    if (probe === 'gone' || attempt >= SEED_PROBE_ATTEMPTS) return { ran: false, reason: seedFailureText() }
    await sleep(SEED_PROBE_GAP_MS)
  }
}
