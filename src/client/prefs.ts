/**
 * User preferences, persisted in the browser.
 *
 * Scope note: these are *presentation* preferences for one browser profile —
 * default mode, default language, live-analysis cadence, which result view
 * opens first. They deliberately live in `localStorage` rather than the harness
 * settings service: they change nothing about how the plugin runs on the host,
 * and keeping them here means the plugin needs no settings schema, no extra
 * dependency, and no write access to the user's config.
 *
 * Every read is defensive. A corrupted, foreign, or quota-blocked store must
 * degrade to defaults rather than break the surface.
 */

/** The persisted shape. Bump {@link STORAGE_KEY} on any breaking change. */
export interface Preferences {
  /** Rewrite mode selected on first open. */
  readonly defaultMode: string
  /** Output language selected on first open. */
  readonly defaultLang: string
  /** Run the deterministic analysis while typing. */
  readonly liveAnalysis: boolean
  /** Which right-pane view opens by default. */
  readonly defaultView: ResultView
  /** Keep the streaming result scrolled to the newest text. */
  readonly autoScroll: boolean
  /** Show the advice list. */
  readonly showSuggestions: boolean
}

/** The right pane's view modes. */
export type ResultView = 'result' | 'diff' | 'outline'

/** Storage key, versioned so a future shape change cannot be misread. */
const STORAGE_KEY = 'dsh-prompt-workbench/prefs/v1'

/** Defaults, also the recovery target for any read failure. */
export const DEFAULT_PREFERENCES: Preferences = {
  defaultMode: 'refine',
  defaultLang: 'auto',
  liveAnalysis: true,
  defaultView: 'result',
  autoScroll: true,
  showSuggestions: true,
}

/** Coerce one unknown field onto the default's type, or fall back. */
function pickString(value: unknown, fallback: string, allowed?: readonly string[]): string {
  if (typeof value !== 'string') return fallback
  if (allowed !== undefined && !allowed.includes(value)) return fallback
  return value
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Read the stored preferences.
 * @returns the merged preferences; never throws, never returns a partial object.
 */
export function loadPreferences(): Preferences {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_PREFERENCES
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return DEFAULT_PREFERENCES
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return DEFAULT_PREFERENCES
    const record = parsed as Record<string, unknown>
    return {
      defaultMode: pickString(record.defaultMode, DEFAULT_PREFERENCES.defaultMode),
      defaultLang: pickString(record.defaultLang, DEFAULT_PREFERENCES.defaultLang, ['auto', 'zh', 'en']),
      liveAnalysis: pickBoolean(record.liveAnalysis, DEFAULT_PREFERENCES.liveAnalysis),
      defaultView: pickString(record.defaultView, DEFAULT_PREFERENCES.defaultView, ['result', 'diff', 'outline']) as ResultView,
      autoScroll: pickBoolean(record.autoScroll, DEFAULT_PREFERENCES.autoScroll),
      showSuggestions: pickBoolean(record.showSuggestions, DEFAULT_PREFERENCES.showSuggestions),
    }
  } catch {
    // Private-mode storage, a quota error, or a foreign value: defaults are correct.
    return DEFAULT_PREFERENCES
  }
}

/**
 * Persist the preferences.
 * @returns true when the write landed; false when storage refused it (which is
 *   not an error the user needs to see — the session keeps working in memory).
 */
export function savePreferences(preferences: Preferences): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    return true
  } catch {
    return false
  }
}
