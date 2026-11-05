/**
 * What this bundle does in place of the dashboard internals the built-in page imported.
 *
 * - The chat endpoints (`src/host/chat.ts`) send the same requests the dashboard's
 *   client sent, through the host's scoped transport, and a refusal comes back as an
 *   `ApiError` carrying the status and the backend's own sentence.
 * - A slot is "gone" only on a 404 status.
 * - The seed's wire resolves a refused send as a refusal the receipt reads.
 * - Every catalog key the page uses exists in English, every locale carries the same
 *   keys, and a locale falls back to English.
 * - The host's `Select` is used when present, a native `<select>` otherwise.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'

import { ApiError, getJson, setTransport } from '../src/api'
import {
  createChatFolder,
  createSlot,
  deleteSlot,
  isMissingSlotError,
  listChatFolders,
  probeSlotExists,
  sendSeed,
} from '../src/host/chat'
import { CATALOGS, fmtDateFields, t } from '../src/i18n'
import { stubLocale } from './stubs/app-sdk'

interface Seen { path: string; init?: RequestInit }

function recordTransport(answer: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const seen: Seen[] = []
  setTransport({
    async raw(path, init) {
      seen.push({ path, init })
      const r = await answer(path, init)
      if (!r.ok) {
        const body = await r.text()
        throw Object.assign(new Error(`API ${r.status}: ${body}`), { status: r.status, body })
      }
      return r
    },
  })
  return seen
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the chat endpoints go through the scoped transport', () => {
  it('lists and creates folders the way the dashboard client did', async () => {
    const seen = recordTransport((path) => json(path.endsWith('/folders') ? [{ id: 'a' }] : {}))
    expect(await listChatFolders()).toEqual([{ id: 'a' }])
    await createChatFolder('Auto-Improve - acme/x')
    expect(seen.map((s) => [s.path, s.init?.method ?? 'GET'])).toEqual([
      ['/api/chat/folders', 'GET'],
      ['/api/chat/folders', 'POST'],
    ])
    expect(JSON.parse(String(seen[1].init?.body))).toEqual({ name: 'Auto-Improve - acme/x', parent_id: '' })
  })

  it('creates a slot with the session fields and refuses an answer without a key', async () => {
    const seen = recordTransport(() => json({ key: 'slot-9', folder_id: 'f' }))
    const opts = { folder_id: 'f', title: 'T', memory_mode: 'persistent', no_session_folder: true } as const
    expect(await createSlot(opts)).toEqual({ key: 'slot-9', folder_id: 'f' })
    expect(seen[0].path).toBe('/api/chat/slots')
    expect(JSON.parse(String(seen[0].init?.body))).toEqual(opts)
    recordTransport(() => json({}))
    await expect(createSlot(opts)).rejects.toThrow(/no key/)
  })

  it('deletes and probes a slot by its encoded key', async () => {
    const seen = recordTransport((_path, init) => (init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ total: 0 })))
    await deleteSlot('a/b')
    await probeSlotExists('a/b')
    expect(seen.map((s) => s.path)).toEqual(['/api/chat/slots/a%2Fb', '/api/chat/slots/a%2Fb?limit=1'])
  })

  it('surfaces a refusal as an ApiError with the status and the backend sentence', async () => {
    recordTransport(() => json({ error: 'slot not found' }, 404))
    const err = await probeSlotExists('gone').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).message).toBe('slot not found')
    expect(isMissingSlotError(err)).toBe(true)
  })

  it('reads a slot as gone only on a 404 status', () => {
    expect(isMissingSlotError({ status: 404 })).toBe(true)
    expect(isMissingSlotError({ status: 503, message: 'not found' })).toBe(false)
    expect(isMissingSlotError({ status: Number.NaN })).toBe(false)
    expect(isMissingSlotError(new Error('HTTP 404'))).toBe(true)
  })

  it('posts the seed to /api/chat and reads a refused send as `refused` with its reason', async () => {
    const seen = recordTransport(() => json({ error: 'slot is stopping' }, 409))
    const receipt = await sendSeed('hello', 'slot-1')
    expect(seen[0].path).toBe('/api/chat?ws=1')
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ message: 'hello', slot: 'slot-1' })
    expect(receipt).toMatchObject({ status: 'refused', reason: 'slot is stopping' })
  })

  it('reads an accepted seed as dispatched', async () => {
    recordTransport(() => json({ ok: true }))
    expect((await sendSeed('hello', 'slot-1')).status).toBe('dispatched')
  })

  it('passes a rejected fetch through as a transport error', async () => {
    setTransport({ raw: () => Promise.reject(new TypeError('network down')) })
    expect((await sendSeed('hello', 'slot-1')).status).toBe('transport-error')
  })

  it('falls back to a same-origin fetch before the root binds the host client', async () => {
    setTransport(null)
    const fetchMock = vi.fn(async () => json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getJson('/api/apps/auto-improvement/health')).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/auto-improvement/health', expect.objectContaining({ credentials: 'same-origin' }))
  })
})

const SRC = join(__dirname, '..', 'src')
const KEY = /i18nT\(\s*'([A-Za-z0-9_.]+)'/g

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  )
}

function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
}

describe('the bundled catalogs', () => {
  const used = new Set<string>()
  for (const file of sources(SRC)) {
    for (const m of readFileSync(file, 'utf-8').matchAll(KEY)) used.add(m[1])
  }

  it('finds the keys the page uses, so the scan is not empty', () => {
    expect(used.size).toBeGreaterThan(40)
  })

  it('has every key the page uses in English', () => {
    const english = new Set(leaves(CATALOGS.en))
    const plural = (k: string) => english.has(`${k}_one`) || english.has(`${k}_other`)
    expect([...used].filter((k) => !english.has(k) && !plural(k))).toEqual([])
  })

  it('carries the same keys in every locale', () => {
    const english = leaves(CATALOGS.en).sort()
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      expect({ locale, keys: leaves(catalog).sort() }).toEqual({ locale, keys: english })
    }
  })

  it('reads the host locale and falls back to English', () => {
    stubLocale('de')
    expect(t('autoImprovement.runBtn')).toBe(CATALOGS.de && (CATALOGS.de as { autoImprovement: Record<string, string> }).autoImprovement.runBtn)
    stubLocale('xx-YY')
    expect(t('autoImprovement.runBtn')).toBe((CATALOGS.en as { autoImprovement: Record<string, string> }).autoImprovement.runBtn)
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('formats the activity clock in the app language', () => {
    stubLocale('en')
    expect(fmtDateFields(Date.UTC(2026, 0, 1, 13, 5, 9), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })).toMatch(/1:05/)
    expect(fmtDateFields('not a date', { hour: 'numeric' })).toBe('')
  })

  it('ships the twelve dashboard locales', () => {
    const files = readdirSync(join(__dirname, '..', 'i18n')).map((f) => f.replace(/\.json$/, '')).sort()
    expect(files).toEqual(['bn', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'ru', 'zh-CN'])
  })
})

describe('the branch picker', () => {
  it("uses the host's Select when the host has one", async () => {
    const { Select } = await import('../src/hostSdk')
    render(<Select options={['main']} value="main" onChange={() => {}} aria-label="Branch" />)
    expect(screen.getByLabelText('Branch').hasAttribute('data-host-select')).toBe(true)
  })
})
