/**
 * Tests for the browser half's HTTP carrier.
 *
 * The first two cases guard a real defect: `api()` originally returned only
 * `URL.pathname`, which silently dropped the query string. Every poll therefore
 * went out without an `id`, the host answered `missing id`, and the panel showed
 * that verbatim — the plugin looked broken while the request itself was
 * perfectly well formed.
 *
 * The `pollRun` case is the one that actually catches it end to end: it asserts
 * the URL handed to `fetch`, not the helper's return value.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { api, pollRun } from '../src/client/api.ts'

const realDocument = (globalThis as { document?: unknown }).document
const realFetch = (globalThis as { fetch?: unknown }).fetch

function withBase(baseURI: string): void {
  ;(globalThis as { document?: unknown }).document = { baseURI }
}

afterEach(() => {
  ;(globalThis as { document?: unknown }).document = realDocument
  ;(globalThis as { fetch?: unknown }).fetch = realFetch
})

describe('api', () => {
  it('preserves the query string', () => {
    withBase('http://127.0.0.1:3080/')
    expect(api('/dsh-prompt-workbench/api/poll?id=abc&cursor=12'))
      .toBe('/dsh-prompt-workbench/api/poll?id=abc&cursor=12')
  })

  it('keeps a query when a reverse proxy mounts the harness under a prefix', () => {
    withBase('http://host/dsh/')
    expect(api('/dsh-prompt-workbench/api/poll?id=a'))
      .toBe('/dsh/dsh-prompt-workbench/api/poll?id=a')
  })

  it('resolves a query-less route against the base', () => {
    withBase('http://127.0.0.1:3080/')
    expect(api('/dsh-prompt-workbench/api/meta')).toBe('/dsh-prompt-workbench/api/meta')
  })

  it('falls back to a root path without a document', () => {
    ;(globalThis as { document?: unknown }).document = undefined
    expect(api('/x/y?id=1')).toBe('/x/y?id=1')
  })
})

describe('pollRun', () => {
  it('sends the task id and cursor in the query', async () => {
    withBase('http://127.0.0.1:3080/')
    const seen: string[] = []
    ;(globalThis as { fetch?: unknown }).fetch = async (url: string) => {
      seen.push(url)
      return { ok: true, json: async () => ({ ok: true, status: 'running' }) }
    }
    await pollRun('pw-1-2', 5)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('id=pw-1-2')
    expect(seen[0]).toContain('cursor=5')
  })

  it('url-encodes an id that needs it', async () => {
    withBase('http://127.0.0.1:3080/')
    const seen: string[] = []
    ;(globalThis as { fetch?: unknown }).fetch = async (url: string) => {
      seen.push(url)
      return { ok: true, json: async () => ({ ok: true }) }
    }
    await pollRun('a b&c', 0)
    expect(seen[0]).toContain('id=a%20b%26c')
    expect(seen[0]).not.toContain('id=a b&c&')
  })
})
