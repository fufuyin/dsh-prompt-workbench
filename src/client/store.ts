/**
 * The shared observable store behind every surface of the plugin.
 *
 * The trigger pill and the floating composer panel are two separate React trees
 * that must never disagree, so they both read this one store. `set` compares
 * before assigning, which keeps the 200 ms poll from re-rendering when nothing
 * actually changed.
 */

import type { DiagOutcome } from './api.ts'
import { DEFAULT_PREFERENCES, type Preferences, type ResultView } from './prefs.ts'

/** One rewrite run's lifecycle. */
export type RunStatus = 'idle' | 'running' | 'done' | 'error'

/** Everything the surfaces render from. */
export interface WorkbenchState {
  /** Whether the floating composer panel is expanded. */
  readonly open: boolean
  /** Active rewrite mode key. */
  readonly mode: string
  /** Requested output language. */
  readonly lang: string
  /** Which right-pane view is showing. */
  readonly view: ResultView
  /** Run lifecycle. */
  readonly status: RunStatus
  /** Host-side task id while a run is live. */
  readonly taskId: string | null
  /** The draft buffer being rewritten. */
  readonly source: string
  /** The rewrite as it streams in. */
  readonly output: string
  /** How much of `output` the host has already delivered. */
  readonly cursor: number
  /** Failure text, empty when healthy. */
  readonly error: string
  /** Transient confirmation text ("已复制到剪贴板"). */
  readonly note: string
  /** Provider route in force, for the read-only chip. */
  readonly provider: string
  /** Model id in force. */
  readonly model: string
  /** Milliseconds since the current run started. */
  readonly elapsedMs: number
  /** Persisted presentation preferences. */
  readonly prefs: Preferences
  /** Whether the settings block is expanded. */
  readonly configOpen: boolean
  /** Whether the diagnostics block is expanded. */
  readonly diagOpen: boolean
  /** A diagnostics read is in flight. */
  readonly diagLoading: boolean
  /** The last diagnostics outcome, or null before the first read. */
  readonly diag: DiagOutcome | null
  /**
   * The host half's reported wire revision, or null when it reported none —
   * which means the running host predates the field and is an older build.
   */
  readonly hostApiVersion: number | null
}

/** A store over one state shape. */
export interface Store<T> {
  get(): T
  /** Merge a partial patch; notifies only when a value actually differs. */
  set(patch: Partial<T>): void
  subscribe(listener: () => void): () => void
}

/** Create a store over `initial`. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (patch) => {
      let changed = false
      for (const key of Object.keys(patch) as (keyof T)[]) {
        if (state[key] !== patch[key]) {
          changed = true
          break
        }
      }
      if (!changed) return
      state = { ...state, ...patch }
      for (const listener of Array.from(listeners)) {
        try {
          listener()
        } catch (error) {
          console.error('[dsh-prompt-workbench] store listener failed', error)
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The plugin's initial state. */
export function initialState(): WorkbenchState {
  return {
    open: false,
    mode: DEFAULT_PREFERENCES.defaultMode,
    lang: DEFAULT_PREFERENCES.defaultLang,
    view: DEFAULT_PREFERENCES.defaultView,
    status: 'idle',
    taskId: null,
    source: '',
    output: '',
    cursor: 0,
    error: '',
    note: '',
    provider: '',
    model: '',
    elapsedMs: 0,
    prefs: DEFAULT_PREFERENCES,
    configOpen: false,
    diagOpen: false,
    diagLoading: false,
    diag: null,
    hostApiVersion: null,
  }
}
