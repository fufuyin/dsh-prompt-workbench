/**
 * The browser half's carrier: plain `fetch` against the plugin's own routes.
 *
 * `api()` resolves every path against `document.baseURI` rather than the site
 * root, so the plugin keeps working behind a reverse proxy that mounts the
 * harness under a path prefix. (Root-absolute URLs silently 404 there.)
 */

/** The plugin's route namespace, matching the host half. */
const API = '/dsh-prompt-workbench/api'

/**
 * Resolve a route against the document base.
 *
 * **The search string must survive.** Returning only `pathname` silently drops
 * `?id=…&cursor=…`, which turned every poll into a request without an id — the
 * host answered "missing id", the panel showed that verbatim, and no rewrite
 * ever produced output. The bug was invisible because the request itself was
 * perfectly well formed; only its query was gone.
 *
 * @param path - route path, optionally carrying a query string.
 * @returns a path-absolute URL, query intact.
 */
export function api(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

/** What `/meta` answers. */
export interface WorkbenchMeta {
  readonly ok: boolean
  readonly available: boolean
  readonly provider: string | null
  readonly model: string | null
  readonly maxInputChars: number
  readonly modes: readonly string[]
  /**
   * The host half's wire revision. Absent when the running host predates the
   * field, which is itself the signal that it is an older build.
   */
  readonly apiVersion?: number
}

/** One poll answer. */
export interface RunSnapshot {
  readonly ok: boolean
  readonly status?: 'running' | 'done' | 'error' | 'stopped'
  readonly delta?: string
  readonly cursor?: number
  readonly reset?: boolean
  readonly chars?: number
  readonly elapsedMs?: number
  readonly error?: string
  readonly message?: string
  readonly code?: string
}

/** A start answer. */
export interface StartAnswer {
  readonly ok: boolean
  readonly taskId?: string
  readonly provider?: string
  readonly model?: string
  readonly message?: string
  readonly code?: string
}

/** Read the host's meta payload. Never throws. */
export async function fetchMeta(): Promise<WorkbenchMeta | null> {
  try {
    const response = await fetch(api(`${API}/meta`))
    if (!response.ok) return null
    return (await response.json()) as WorkbenchMeta
  } catch {
    return null
  }
}

/** One self-diagnosis line from `/diag`. */
export interface DiagCheck {
  readonly id: string
  readonly ok: boolean
  readonly detail: string
}

/** What `/diag` answers. */
export interface DiagReport {
  readonly ok: boolean
  readonly package: string
  readonly apiVersion?: number
  readonly node: string
  readonly graphRev: string | null
  readonly moduleIds: readonly string[]
  readonly clientPath: string | null
  readonly clientBundleExists: boolean
  readonly checks: readonly DiagCheck[]
}

/**
 * The result of a diagnostics read.
 *
 * The failure kinds are kept apart on purpose. "The route answered 404" and
 * "the request never landed" have completely different causes — a stale host
 * build versus a dead carrier — and collapsing them into one "unreachable"
 * message is what sent the author chasing the wrong problem the first time.
 */
export type DiagOutcome =
  | { readonly kind: 'ok'; readonly report: DiagReport }
  | { readonly kind: 'missing'; readonly status: number }
  | { readonly kind: 'error'; readonly message: string }

/**
 * Ask the host how it sees this plugin's browser half.
 *
 * This exists because the browser half can fail invisibly: if its module never
 * reaches the boot graph, nothing renders and nothing reports. `/diag` is
 * reachable from the working host half, so it is the one surface that can still
 * answer when the UI cannot.
 */
export async function fetchDiag(): Promise<DiagOutcome> {
  try {
    const response = await fetch(api(`${API}/diag`))
    if (!response.ok) return { kind: 'missing', status: response.status }
    return { kind: 'ok', report: (await response.json()) as DiagReport }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'network error' }
  }
}

/** Begin one rewrite. */
export async function startRun(body: {
  readonly text: string
  readonly mode: string
  readonly lang: string
}): Promise<StartAnswer> {
  try {
    const response = await fetch(api(`${API}/start`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await response.json()) as StartAnswer
    return payload
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'network error' }
  }
}

/** Read the delta since `cursor`. */
export async function pollRun(taskId: string, cursor: number): Promise<RunSnapshot> {
  try {
    const query = `id=${encodeURIComponent(taskId)}&cursor=${String(cursor)}`
    const response = await fetch(api(`${API}/poll?${query}`))
    return (await response.json()) as RunSnapshot
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'network error' }
  }
}

/** Abort one live run. */
export async function cancelRun(taskId: string): Promise<void> {
  try {
    await fetch(api(`${API}/cancel`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: taskId }),
    })
  } catch {
    // Cancellation is best-effort; the run also ends on its own.
  }
}
