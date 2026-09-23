/**
 * Minimal HTTP helpers for the plugin's own routes.
 *
 * The pattern mirrors the one the third-party `dsh-market` plugin established
 * for out-of-tree plugins: JSON with no-store caching, a same-origin gate for
 * mutating verbs, and a size-capped body reader.
 *
 * `sameOrigin` matters because plugin routes are NOT covered by the shipped
 * web connection's Host/Origin checks — those only protect the harness's own
 * `/api` surface. Every POST route this plugin owns must gate itself.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Write a JSON payload with no-store caching. */
export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/**
 * The same-origin verdict plus the evidence behind it.
 *
 * Kept as a pair so the diagnostics ring can record *why* a mutating request
 * was refused — a bare boolean leaves the author guessing, which is exactly
 * how a silent 403 became invisible here.
 */
export interface OriginVerdict {
  readonly ok: boolean
  readonly reason: 'origin-match' | 'sec-fetch-same-origin' | 'origin-mismatch' | 'no-evidence'
  readonly origin: string
  readonly host: string
  readonly secFetchSite: string
}

/**
 * Decide whether a mutating request came from this same origin.
 *
 * Two independent signals are accepted, because browsers are not uniform about
 * which they send:
 *
 *  1. `Origin` matching `Host` — the classic check, and the one a same-origin
 *     `POST` normally satisfies;
 *  2. `Origin` absent but `Sec-Fetch-Site: same-origin` — Fetch Metadata is sent
 *     by Chromium and Firefox on every request and cannot be forged by a page,
 *     so it is at least as strong as signal 1 and covers the case where a
 *     browser omits `Origin`.
 *
 * Refusing on "no evidence at all" stays fail-closed: a request with neither
 * header is not a browser navigation this plugin initiated.
 *
 * Only meaningful for mutating verbs: a same-origin GET legitimately carries
 * neither header, so the polling route must not consult this.
 *
 * @param request - the incoming request.
 * @returns the verdict plus the raw header values for the diagnostics ring.
 */
export function inspectOrigin(request: IncomingMessage): OriginVerdict {
  const origin = request.headers.origin ?? ''
  const host = request.headers.host ?? ''
  const secFetchSite = request.headers['sec-fetch-site'] ?? ''
  const base = { origin, host, secFetchSite }
  if (origin === '' && host === '') return { ok: false, reason: 'no-evidence', ...base }
  if (origin !== '' && host !== '') {
    try {
      if (new URL(origin).host === host) return { ok: true, reason: 'origin-match', ...base }
    } catch {
      // A malformed Origin falls through to the secondary signal.
    }
  }
  if (origin === '' && secFetchSite === 'same-origin') {
    return { ok: true, reason: 'sec-fetch-same-origin', ...base }
  }
  if (origin === '' && secFetchSite === '') return { ok: false, reason: 'no-evidence', ...base }
  return { ok: false, reason: 'origin-mismatch', ...base }
}

/** Convenience boolean over {@link inspectOrigin}. */
export function sameOrigin(request: IncomingMessage): boolean {
  return inspectOrigin(request).ok
}

/** Read and parse a JSON request body, rejecting anything over `maxBytes`. */
export async function readJsonBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Read one query parameter off the request URL, or `undefined`. */
export function queryParam(request: IncomingMessage, name: string): string | undefined {
  const url = request.url
  if (url === undefined) return undefined
  const value = new URL(url, 'http://localhost').searchParams.get(name)
  return value === null ? undefined : value
}
