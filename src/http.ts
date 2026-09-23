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
 * True when the request's Origin matches its Host.
 *
 * Only meaningful for mutating verbs: browsers omit `Origin` on same-origin
 * GET, so applying this to a polling route would reject the plugin's own
 * traffic.
 */
export function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
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
