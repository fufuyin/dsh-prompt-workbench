/**
 * The host-side run table: one entry per in-flight rewrite.
 *
 * Behaviour is unchanged from the original implementation — a bounded table of
 * tasks, delta+cursor delivery so a long rewrite never re-sends the whole
 * buffer, and a cancellable stream. The only difference is that cancellation
 * now uses the real `AbortSignal` the llm service accepts, instead of the
 * sandbox's break-the-loop workaround.
 */

import {
  buildSystemInstruction,
  errorMessage,
  MAX_INPUT_CHARS,
  MODE_KEYS,
  normalizeLanguage,
  normalizeMode,
  outputLanguage,
} from './prompt.ts'
import { analyzePrompt, describeGapsForModel } from './analyze.ts'

/** Bounded task table: finished runs are reaped before live ones. */
const MAX_TASKS = 8

/**
 * Wall-clock ceiling for one model call. A stream that never settles must not
 * pin a task slot forever; the run is aborted with a distinguishable error so
 * the UI can say "timed out" rather than "stopped".
 */
const RUN_TIMEOUT_MS = 180_000

/** One stream chunk, read structurally so the port carries no internal types. */
interface StreamChunkLike {
  readonly type?: string
  readonly text?: string
  readonly reason?: {
    readonly kind?: string
    readonly failure?: { readonly message?: string }
  }
}

/** The slice of the `llm` service this plugin uses. */
interface LlmLike {
  stream(options: {
    provider: string
    model: string
    reasoningEffort?: string
    system?: string
    messages: readonly unknown[]
    signal?: AbortSignal
  }): AsyncIterable<StreamChunkLike>
}

/** The slice of `agentDefaultModel` this plugin uses. */
interface DefaultModelLike {
  currentSelection?(): { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
}

/** The slice of the Cordis context this module reads. */
export interface HostServices {
  get(name: string): unknown
}

/** A resolved model route. */
export interface Route {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** One poll answer. */
export interface RunSnapshot {
  readonly ok: true
  readonly status: 'running' | 'done' | 'error' | 'stopped'
  readonly delta: string
  readonly cursor: number
  readonly reset: boolean
  readonly chars: number
  readonly elapsedMs: number
  readonly error?: string
}

/** A failure the browser half should show verbatim. */
export interface StartFailure {
  readonly ok: false
  readonly code: 'empty' | 'too-long' | 'no-llm' | 'no-model' | 'busy'
  readonly message: string
}

/** A started run. */
export interface StartSuccess {
  readonly ok: true
  readonly taskId: string
  readonly provider: string
  readonly model: string
}

interface Run {
  readonly source: string
  text: string
  status: RunSnapshot['status']
  error: string | undefined
  readonly controller: AbortController
  readonly startedAt: number
  /** Set by the wall-clock guard so a timeout reads differently from a cancel. */
  timedOut: boolean
}

/** The live default model route, or null when nothing is selected. */
export function currentRoute(ctx: HostServices): Route | null {
  const service = ctx.get('agentDefaultModel') as DefaultModelLike | undefined
  if (service === undefined || typeof service.currentSelection !== 'function') return null
  try {
    const selection = service.currentSelection()
    if (selection === null || typeof selection !== 'object') return null
    const provider = selection.provider
    const model = selection.model
    if (typeof provider !== 'string' || provider === '') return null
    if (typeof model !== 'string' || model === '') return null
    const reasoningEffort = typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : undefined
    return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort }
  } catch {
    return null
  }
}

/** The run table plus the one model call each run owns. */
export class RunRegistry {
  readonly #ctx: HostServices
  readonly #runs = new Map<string, Run>()
  #seq = 0
  #disposed = false

  constructor(ctx: HostServices) {
    this.#ctx = ctx
  }

  /** What the browser half needs to render its header. */
  meta(): Record<string, unknown> {
    const route = currentRoute(this.#ctx)
    const llm = this.#ctx.get('llm')
    return {
      ok: true,
      available: llm !== undefined && llm !== null,
      provider: route === null ? null : route.provider,
      model: route === null ? null : route.model,
      maxInputChars: MAX_INPUT_CHARS,
      modes: [...MODE_KEYS],
    }
  }

  /** Start one rewrite; the model call runs detached and is polled. */
  start(input: { text?: unknown; mode?: unknown; lang?: unknown }): StartSuccess | StartFailure {
    const text = typeof input.text === 'string' ? input.text : ''
    if (text.trim() === '') {
      return { ok: false, code: 'empty', message: '请先输入需要增强的提示词' }
    }
    if (text.length > MAX_INPUT_CHARS) {
      return {
        ok: false,
        code: 'too-long',
        message: `提示词过长：${String(text.length)} 字符，上限 ${String(MAX_INPUT_CHARS)} 字符。请分段增强。`,
      }
    }
    const llm = this.#ctx.get('llm') as LlmLike | undefined
    if (llm === undefined || llm === null || typeof llm.stream !== 'function') {
      return { ok: false, code: 'no-llm', message: 'llm 服务不可用，无法调用模型' }
    }
    const route = currentRoute(this.#ctx)
    if (route === null) {
      return { ok: false, code: 'no-model', message: '当前没有可用的默认模型路由' }
    }

    this.#seq += 1
    const id = `pw-${String(this.#seq)}-${String(Date.now())}`
    const run: Run = {
      source: text,
      text: '',
      status: 'running',
      error: undefined,
      controller: new AbortController(),
      startedAt: Date.now(),
      timedOut: false,
    }
    this.#runs.set(id, run)
    this.#reap()
    void this.#drive(llm, id, run, normalizeMode(input.mode), normalizeLanguage(input.lang))

    return { ok: true, taskId: id, provider: route.provider, model: route.model }
  }

  /** The delta since `cursor`, plus the terminal status once the run settles. */
  poll(taskId: string, cursor: number): RunSnapshot | null {
    const run = this.#runs.get(taskId)
    if (run === undefined) return null
    const reset = !Number.isFinite(cursor) || cursor < 0 || cursor > run.text.length
    const from = reset ? 0 : Math.floor(cursor)
    const snapshot: RunSnapshot = {
      ok: true,
      status: run.status,
      delta: run.text.slice(from),
      cursor: run.text.length,
      reset,
      chars: run.text.length,
      elapsedMs: Date.now() - run.startedAt,
      ...run.error === undefined ? {} : { error: run.error },
    }
    return snapshot
  }

  /** Abort one run. Idempotent. */
  cancel(taskId: string): boolean {
    const run = this.#runs.get(taskId)
    if (run === undefined) return false
    run.controller.abort()
    return true
  }

  /** Abort every live run; called when the plugin unloads. */
  dispose(): void {
    this.#disposed = true
    for (const run of this.#runs.values()) run.controller.abort()
    this.#runs.clear()
  }

  /** Keep the table bounded, dropping finished runs first. */
  #reap(): void {
    if (this.#runs.size <= MAX_TASKS) return
    for (const [id, run] of this.#runs) {
      if (this.#runs.size <= MAX_TASKS) break
      if (run.status !== 'running') this.#runs.delete(id)
    }
    while (this.#runs.size > MAX_TASKS) {
      const first = this.#runs.keys().next()
      if (first.done === true) return
      this.#runs.delete(first.value)
    }
  }

  /** One model call. Mirrors the original accumulation loop exactly. */
  async #drive(
    llm: LlmLike,
    id: string,
    run: Run,
    mode: ReturnType<typeof normalizeMode>,
    lang: ReturnType<typeof normalizeLanguage>,
  ): Promise<void> {
    const route = currentRoute(this.#ctx)
    if (route === null) {
      run.status = 'error'
      run.error = '当前没有可用的默认模型路由'
      return
    }
    // Deterministic gap report: this is what turns a generic "improve it" into a
    // rewrite that closes the dimensions this particular draft is missing.
    const analysis = analyzePrompt(run.source, mode)
    const guard = setTimeout(() => {
      run.timedOut = true
      run.controller.abort()
    }, RUN_TIMEOUT_MS)
    try {
      const stream = llm.stream({
        provider: route.provider,
        model: route.model,
        ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
        system: buildSystemInstruction(
          mode,
          outputLanguage(lang, run.source),
          describeGapsForModel(analysis),
        ),
        // Built inline rather than through the llm package's `createUserMessage`
        // helper: the shape is identical to what the original implementation
        // sent, and it keeps this plugin free of runtime dependencies.
        messages: [{
          id: `dsh-prompt-workbench-${id}`,
          role: 'user' as const,
          content: [{ type: 'text' as const, text: run.source }],
          source: { kind: 'plugin' as const, plugin: 'dsh-prompt-workbench' },
        }],
        signal: run.controller.signal,
      })
      for await (const chunk of stream) {
        if (chunk === null || typeof chunk !== 'object') continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          run.text += chunk.text
          continue
        }
        if (chunk.type === 'finish' && chunk.reason !== undefined && chunk.reason !== null) {
          const kind = chunk.reason.kind
          if (kind === 'error' || kind === 'aborted') {
            const failure = chunk.reason.failure
            run.error = typeof failure?.message === 'string'
              ? failure.message
              : (kind === 'aborted' ? 'the model call was aborted' : 'the model call failed')
          }
        }
      }
    } catch (error) {
      if (run.controller.signal.aborted) {
        run.error = undefined
      } else {
        run.error = errorMessage(error)
      }
    } finally {
      clearTimeout(guard)
    }
    if (this.#disposed) return
    if (run.controller.signal.aborted) {
      if (run.timedOut) {
        run.status = 'error'
        run.error = `模型调用超时（${String(RUN_TIMEOUT_MS / 1000)} 秒未返回），已中止。`
        return
      }
      run.status = 'stopped'
      return
    }
    if (run.error === undefined && run.text.trim() === '') {
      run.error = 'the model returned an empty result'
    }
    run.status = run.error === undefined ? 'done' : 'error'
  }
}
