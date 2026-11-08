/**
 * The resumable session hook over the App Kit: the repo folder, the seed receipt, and
 * resume.
 *
 * Ported from the Auto Improvement cases of Kiro Crew's
 * `website/src/test/agentSessionFolderResolve.test.ts` and
 * `website/src/test/agentSessionSeedReceipt.test.ts`. The built-in dispatched the
 * dashboard's Redux thunks; this copy calls the same endpoints through
 * `src/host/chat.ts` (mocked here, so each call is visible) and opens the session
 * with the host's chat launcher.
 *
 * - The repo folder is reused wherever it exists in the tree, created by name on a
 *   miss; a rejected folder read surfaces as the hook's error UNTOUCHED (no slot is
 *   created); a create that answers without an id is an error rather than a slot
 *   filed under `undefined`.
 * - A seed that provably never ran leaves no recorded, empty session, and a seed that
 *   MAY be running is never torn down: `refused` deletes and records nothing (with the
 *   server's reason); `transport-error` / `response-late` ask the slot; `unknown`,
 *   `dispatched` and `queued` record.
 * - A recorded session whose slot still exists is resumed, not recreated; a recorded
 *   session whose slot is gone (404) gets a fresh one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import type { SendReceipt } from '../src/host/sendTurn'
import { i18nT } from '../src/i18n'
import { setStubSdkLevel, stubOpenChat } from './stubs/app-sdk'

const chat = vi.hoisted(() => ({
  listChatFolders: vi.fn(),
  createChatFolder: vi.fn(),
  createSlot: vi.fn(),
  deleteSlot: vi.fn(),
  probeSlotExists: vi.fn(),
  slotDetail: vi.fn(),
  sendSeed: vi.fn(),
}))

vi.mock('../src/host/chat', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/host/chat')>()
  return { ...real, ...chat }
})

import { sessionOpenTiming, useAgentSession } from '../src/lib/agentSession'

const FOLDER = 'Auto-Improve - acme/demo-repo'
const NOT_STARTED = i18nT('pages.chatPage.could_not_start_a_new_session')

const receipt = (status: SendReceipt['status'], reason?: string): SendReceipt =>
  ({ status, body: {}, ...(reason ? { reason } : {}) })

let saved: ReturnType<typeof vi.fn>
let record: Record<string, unknown> | null

function installRecords() {
  saved = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        saved(init.body)
        return new Response(JSON.stringify({ session: { slot_key: 'slot-1', status: 'open' } }), { status: 200 })
      }
      return new Response(JSON.stringify({ session: record }), { status: 200 })
    }),
  )
}

async function open() {
  const { result } = renderHook(() => useAgentSession())
  let opened: unknown = null
  await act(async () => {
    opened = await result.current.openSession({
      kind: 'pr',
      id: 42,
      repo: 'acme/demo-repo',
      title: 'PR #42 · seed',
      prompt: 'seed',
    })
  })
  return { opened: opened as Awaited<ReturnType<typeof result.current.openSession>>, result }
}

const createdFolderIds = () => chat.createSlot.mock.calls.map((c) => (c[0] as { folder_id?: string }).folder_id)

beforeEach(() => {
  vi.resetAllMocks()
  sessionOpenTiming.newSessionSettleMs = 0
  record = null
  installRecords()
  chat.listChatFolders.mockResolvedValue([{ id: 'f1', name: FOLDER, parent_id: '' }])
  chat.createChatFolder.mockImplementation(async (name: string) => ({ id: 'made', name, parent_id: '' }))
  chat.createSlot.mockImplementation(async (opts: { folder_id: string }) => ({ key: 'slot-1', folder_id: opts.folder_id }))
  chat.deleteSlot.mockResolvedValue(undefined)
  chat.sendSeed.mockResolvedValue(receipt('dispatched'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionOpenTiming.newSessionSettleMs = 1500
  setStubSdkLevel(1)
})

describe('resolveFolderId', () => {
  it('reuses the existing top-level repo folder', async () => {
    const { opened } = await open()
    expect(opened).not.toBeNull()
    expect(chat.createChatFolder).not.toHaveBeenCalled()
    expect(createdFolderIds()).toEqual(['f1'])
  })

  it('keeps finding the repo folder after the reader nests it under another one', async () => {
    chat.listChatFolders.mockResolvedValue([{ id: 'moved', name: FOLDER, parent_id: 'archive' }])
    const { opened } = await open()
    expect(opened).not.toBeNull()
    expect(chat.createChatFolder).not.toHaveBeenCalled()
    expect(createdFolderIds()).toEqual(['moved'])
  })

  it('creates the repo folder by name on a miss and files the slot into it', async () => {
    chat.listChatFolders.mockResolvedValue([{ id: 'other', name: 'Something else', parent_id: '' }])
    const { opened } = await open()
    expect(opened).not.toBeNull()
    expect(chat.createChatFolder).toHaveBeenCalledTimes(1)
    expect(chat.createChatFolder.mock.calls[0][0]).toBe(FOLDER)
    expect(createdFolderIds()).toEqual(['made'])
  })

  it('surfaces a rejected folder read as the hook error, untouched, and creates no slot', async () => {
    const boom = new Error('HTTP 503: folders unavailable')
    chat.listChatFolders.mockRejectedValue(boom)
    const { opened, result } = await open()
    expect(opened).toBeNull()
    await waitFor(() => expect(result.current.error).toBe(boom))
    expect(chat.createSlot).not.toHaveBeenCalled()
  })

  it('treats a create that answers without an id as a failure rather than filing under undefined', async () => {
    chat.listChatFolders.mockResolvedValue([])
    chat.createChatFolder.mockResolvedValue({})
    const { opened, result } = await open()
    expect(opened).toBeNull()
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect(chat.createSlot).not.toHaveBeenCalled()
  })
})

describe('the new session', () => {
  it('waits for the host to list a new slot before opening it on a host below level 2', async () => {
    sessionOpenTiming.newSessionSettleMs = 50
    const started = Date.now()
    await open()
    expect(Date.now() - started).toBeGreaterThanOrEqual(45)
    expect(stubOpenChat).toHaveBeenCalledWith({ slotKey: 'slot-1' })
  })

  it('opens a new slot at once on a level-2 host, whose launcher waits for it', async () => {
    setStubSdkLevel(2)
    sessionOpenTiming.newSessionSettleMs = 60_000
    await open()
    expect(stubOpenChat).toHaveBeenCalledWith({ slotKey: 'slot-1' })
  })

  it('is created filed, titled, persistent and without a session folder, then opened', async () => {
    await open()
    expect(chat.createSlot).toHaveBeenCalledWith({
      folder_id: 'f1',
      title: 'PR #42 · seed',
      memory_mode: 'persistent',
      no_session_folder: true,
    })
    expect(chat.sendSeed).toHaveBeenCalledWith('seed', 'slot-1')
    expect(saved).toHaveBeenCalledTimes(1)
    expect(stubOpenChat).toHaveBeenCalledWith({ slotKey: 'slot-1' })
  })
})

describe('the seed — the receipt decides', () => {
  it.each([
    ["with the server's reason", 'slot agent mismatch', /slot agent mismatch/],
    ["with the dashboard's own copy when the body carried none", undefined, NOT_STARTED],
  ] as const)('tears down and records nothing on `refused` %s', async (_label, reason, expected) => {
    chat.sendSeed.mockResolvedValue(receipt('refused', reason))
    const { opened, result } = await open()
    expect(opened).toBeNull()
    await waitFor(() => expect(result.current.error?.message).toMatch(expected))
    expect(chat.deleteSlot).toHaveBeenCalledWith('slot-1')
    expect(saved).not.toHaveBeenCalled()
    expect(stubOpenChat).not.toHaveBeenCalled()
  })

  it.each([
    ['transport-error', 'empty', { messages: [], total: 0 }, true],
    ['transport-error', 'seeded', { messages: [{ role: 'user' }], total: 1 }, false],
    ['response-late', 'empty', { messages: [], total: 0 }, true],
    ['response-late', 'seeded', { messages: [{ role: 'user' }], total: 1 }, false],
  ] as const)('on `%s` asks the slot: %s -> tears down %s', async (status, _label, detail, tornDown) => {
    chat.sendSeed.mockResolvedValue(receipt(status))
    chat.slotDetail.mockResolvedValue(detail)
    const { opened, result } = await open()
    if (tornDown) {
      expect(opened).toBeNull()
      await waitFor(() => expect(result.current.error).toBeTruthy())
      expect(saved).not.toHaveBeenCalled()
    } else {
      expect(opened).not.toBeNull()
      expect(result.current.error).toBeNull()
      expect(saved).toHaveBeenCalled()
    }
    expect(chat.slotDetail).toHaveBeenCalledWith('slot-1', 1)
    expect(chat.deleteSlot.mock.calls.length > 0).toBe(tornDown)
  }, 10_000)

  it('records and opens when the probe itself fails — never cancel or orphan what may be running', async () => {
    chat.sendSeed.mockResolvedValue(receipt('transport-error'))
    chat.slotDetail.mockRejectedValue(new Error('HTTP 503'))
    const { result } = await open()
    expect(result.current.error).toBeNull()
    expect(chat.deleteSlot).not.toHaveBeenCalled()
    expect(saved).toHaveBeenCalled()
  })

  it('reports at once when the slot is already gone — nothing can be running in it', async () => {
    chat.sendSeed.mockResolvedValue(receipt('response-late'))
    chat.slotDetail.mockRejectedValue({ status: 404, message: 'not found' })
    const { opened, result } = await open()
    expect(opened).toBeNull()
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(chat.slotDetail).toHaveBeenCalledTimes(1)
    expect(saved).not.toHaveBeenCalled()
  })

  it.each(['unknown', 'dispatched', 'queued'] as const)(
    'keeps the slot and records the session on `%s`',
    async (status) => {
      chat.sendSeed.mockResolvedValue(receipt(status))
      const { opened, result } = await open()
      expect(opened).not.toBeNull()
      expect(result.current.error).toBeNull()
      expect(chat.deleteSlot).not.toHaveBeenCalled()
      expect(saved).toHaveBeenCalled()
    },
  )
})

describe('resume', () => {
  it('reopens a recorded session whose slot still exists, without creating one', async () => {
    record = { key: 'k', slot_key: 'slot-old' }
    chat.probeSlotExists.mockResolvedValue(undefined)
    const { opened } = await open()
    expect(opened).toEqual(record)
    expect(chat.createSlot).not.toHaveBeenCalled()
    expect(stubOpenChat).toHaveBeenCalledWith({ slotKey: 'slot-old' })
  })

  it('opens a fresh session when the recorded slot is gone', async () => {
    record = { key: 'k', slot_key: 'slot-old' }
    chat.probeSlotExists.mockRejectedValue({ status: 404 })
    await open()
    expect(chat.createSlot).toHaveBeenCalledTimes(1)
    expect(stubOpenChat).toHaveBeenCalledWith({ slotKey: 'slot-1' })
  })

  it('surfaces any other probe failure instead of duplicating the session', async () => {
    record = { key: 'k', slot_key: 'slot-old' }
    chat.probeSlotExists.mockRejectedValue({ status: 503 })
    const { opened, result } = await open()
    expect(opened).toBeNull()
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(chat.createSlot).not.toHaveBeenCalled()
  })
})
