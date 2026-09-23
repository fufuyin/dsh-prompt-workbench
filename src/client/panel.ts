/**
 * The composer surfaces.
 *
 *   conversation.input.left    -> the one-click trigger pill
 *   conversation.input.overlay -> the floating workbench panel
 *
 * Both mount into `session`-scope list slots, so the framework hands them
 * `useInput` and `inputActions` as standard props — that is how the plugin
 * reads the composer draft and writes a rewrite back into it.
 *
 * One pipeline runs the whole surface:
 *
 *   draft → analyze (local, instant) → advice + outline → targeted rewrite → formatted result
 *
 * The analysis comes from the same pure module the host half uses, so advice
 * appears as you type with no round trip and no token cost. Only the rewrite
 * itself reaches the model.
 *
 * ## Why there is no Run-card panel
 *
 * `tool.view.cordis` only exists for *dynamic* Cordis packages: its owner
 * dispatches the key `${pluginId}.${packageId}` taken from a dynamic
 * `cordis_run` result, and the dynamic guard is the only thing that maps
 * `key: 'self'` onto such a pair. An installed bundle has neither, so a
 * registration there would never render.
 */

import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { analyzePrompt, detectLanguage, type PromptAnalysis, type Suggestion } from '../analyze.ts'
import { cancelRun, fetchDiag, fetchMeta, pollRun, startRun } from './api.ts'
import { computeDiff, stripOuterFence } from './diff.ts'
import { loadPreferences, savePreferences, type Preferences, type ResultView } from './prefs.ts'
import { createStore, initialState, type WorkbenchState } from './store.ts'

/** Rewrite modes shown as tabs. `key` is the exact wire value the host accepts. */
const MODES = [
  { key: 'refine', label: '细化需求', hint: '把模糊诉求拆成明确、可执行的具体要求' },
  { key: 'constraints', label: '补充约束', hint: '补齐边界、非目标、技术约束与验收标准' },
  { key: 'structure', label: '结构化重写', hint: '重排为 目标 / 要求 / 输出格式 的清晰层级' },
  { key: 'concise', label: '精简表达', hint: '去除冗余与重复，关键信息零丢失' },
] as const

/** Language options for the output. `auto` follows the draft's script. */
const LANGS = [
  { key: 'auto', label: '自动' },
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'EN' },
] as const

/** Poll cadence while a run is live. */
const POLL_MS = 200

/** Debounce for the live analysis while typing. */
const ANALYZE_MS = 180

/** The right pane's view keys, in presentation order. */
const VIEWS = [
  ['result', '结果'],
  ['diff', '差异'],
  ['outline', '结构'],
] as const

/** The slice of `InputState` the plugin reads. */
export interface InputStateLike {
  readonly draft: string
}

/** The slice of `InputActions` the plugin calls. */
export interface InputActionsLike {
  setDraft(text: string): void
}

/** Standard props a `session`-scope slot hands its occupant. */
export interface SessionSlotProps {
  readonly useInput?: <S>(selector: (state: InputStateLike) => S) => S
  readonly inputActions?: InputActionsLike
}

/** The slice of the slot registry the plugin uses. */
export interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(meta: Record<string, unknown>, component: (props: never) => unknown): unknown
}

/** Human-readable failure text. */
export function messageOf(error: unknown): string {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return String(error)
}

/** One formatted block of a rewrite. */
export interface ResultBlock {
  readonly kind: 'heading' | 'list' | 'code' | 'text'
  readonly text: string
}

/**
 * Split a rewrite into presentable blocks.
 *
 * This is the "formatted output" half of the feature: the model returns plain
 * text — which is what keeps it pasteable into the composer — and the panel
 * renders that text's structure instead of dumping a wall of monospace.
 */
export function splitBlocks(text: string): ResultBlock[] {
  const blocks: ResultBlock[] = []
  let code: string[] | null = null
  let list: string[] | null = null
  const flushList = (): void => {
    if (list !== null) {
      blocks.push({ kind: 'list', text: list.join('\n') })
      list = null
    }
  }
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      flushList()
      if (code === null) code = []
      else {
        blocks.push({ kind: 'code', text: code.join('\n') })
        code = null
      }
      continue
    }
    if (code !== null) {
      code.push(line)
      continue
    }
    if (/^#{1,6}\s+/.test(line)) {
      flushList()
      blocks.push({ kind: 'heading', text: line.replace(/^#{1,6}\s+/, '').trim() })
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      if (list === null) list = []
      list.push(line.trim())
      continue
    }
    flushList()
    if (line.trim() !== '') blocks.push({ kind: 'text', text: line })
  }
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n') })
  flushList()
  return blocks
}

/** Render the analysis strip: score, dimension coverage, and signal counts. */
function analysisStrip(analysis: PromptAnalysis, isZh: boolean): ReactNode {
  const label = (zh: string, en: string): string => (isZh ? zh : en)
  const dims = analysis.dimensions.map((dimension) => createElement('span', {
    key: dimension.id,
    className: dimension.present ? 'dsh-pw-dim dsh-pw-dim-on' : 'dsh-pw-dim',
    title: dimension.evidence ?? label('草稿中没有这一维度的迹象', 'the draft shows no sign of this dimension'),
  }, dimension.present ? `✓ ${dimension.label}` : `○ ${dimension.label}`))
  const signals: string[] = []
  if (analysis.vagueness.length > 0) {
    signals.push(label(`模糊词 ${String(analysis.vagueness.length)}`, `${String(analysis.vagueness.length)} vague`))
  }
  if (analysis.placeholders.length > 0) {
    signals.push(label(`占位符 ${String(analysis.placeholders.length)}`, `${String(analysis.placeholders.length)} placeholder`))
  }
  if (analysis.references > 0) signals.push(`@${String(analysis.references)}`)
  if (analysis.codeBlocks > 0) {
    signals.push(label(`代码块 ${String(analysis.codeBlocks)}`, `${String(analysis.codeBlocks)} code`))
  }
  return createElement('div', { className: 'dsh-pw-strip' }, [
    createElement('span', { key: 'score', className: 'dsh-pw-score' },
      label('可执行度', 'Actionability'),
      createElement('b', null, ` ${String(analysis.score)}`)),
    createElement('span', { key: 'meter', className: 'dsh-pw-meter' },
      createElement('span', { className: 'dsh-pw-meter-fill', style: { width: `${String(analysis.score)}%` } })),
    createElement('span', { key: 'dims', className: 'dsh-pw-dims' }, dims),
    signals.length === 0 ? null : createElement('span', { key: 'sig', className: 'dsh-pw-signals' }, signals.join(' · ')),
  ])
}

/** The advice list, with one-click insertion of each snippet. */
function suggestionList(
  suggestions: readonly Suggestion[],
  onInsert: (snippet: string) => void,
): ReactNode {
  if (suggestions.length === 0) {
    return createElement('div', { className: 'dsh-pw-sugg' },
      createElement('div', { className: 'dsh-pw-sugg-empty' }, '✓ 六个维度都有覆盖，没有发现需要补齐的项。'))
  }
  const rows = suggestions.map((suggestion) => createElement('div', {
    key: suggestion.id,
    className: 'dsh-pw-sugg-row',
  }, [
    createElement('span', {
      key: 'sev',
      className: `dsh-pw-sev dsh-pw-sev-${suggestion.severity}`,
      title: suggestion.severity,
    }),
    createElement('span', { key: 'body', className: 'dsh-pw-sugg-body' }, [
      createElement('span', { key: 't', className: 'dsh-pw-sugg-title' }, suggestion.title),
      createElement('span', { key: 'd', className: 'dsh-pw-sugg-detail' }, suggestion.detail),
    ]),
    suggestion.snippet === undefined
      ? null
      : createElement('button', {
        key: 'ins',
        type: 'button',
        className: 'dsh-pw-sugg-insert',
        title: '把这节骨架插入到草稿末尾',
        onClick: () => {
          onInsert(suggestion.snippet as string)
        },
      }, '插入'),
  ]))
  return createElement('div', { className: 'dsh-pw-sugg' }, rows)
}

/**
 * Mount both surfaces over one shared store and one shared poller.
 * @returns a disposer that removes every registration and stops the poller.
 */
export function mountWorkbench(slots: SlotsLike): () => void {
  const store = createStore<WorkbenchState>(initialState())
  let polling = false
  let starting = false
  let metaRequested = false
  let disposed = false

  /** Fetch the live model route once, for the read-only chip. */
  const loadMeta = (): void => {
    if (metaRequested) return
    metaRequested = true
    void fetchMeta().then((meta) => {
      if (disposed || meta === null || meta.ok !== true) return
      store.set({
        provider: typeof meta.provider === 'string' ? meta.provider : '',
        model: typeof meta.model === 'string' ? meta.model : '',
        ...meta.available === true ? {} : { error: 'llm 服务不可用，无法调用模型' },
      })
    })
  }

  /** One poll tick; a single in-flight request is enough at this cadence. */
  const tick = async (): Promise<void> => {
    const snapshot = store.get()
    if (disposed || polling || snapshot.status !== 'running' || snapshot.taskId === null) return
    polling = true
    const answer = await pollRun(snapshot.taskId, snapshot.cursor)
    polling = false
    const current = store.get()
    if (disposed || current.taskId !== snapshot.taskId || current.status !== 'running') return
    if (answer.ok !== true) {
      store.set({ status: 'error', error: answer.message ?? '增强任务已失效，请重试' })
      return
    }
    const base = answer.reset === true ? '' : current.output
    const nextOutput = base + (answer.delta ?? '')
    const elapsedMs = typeof answer.elapsedMs === 'number' ? answer.elapsedMs : current.elapsedMs
    if (answer.status === 'running') {
      store.set({ output: nextOutput, cursor: answer.cursor ?? 0, elapsedMs })
      return
    }
    if (answer.status === 'done') {
      store.set({ output: stripOuterFence(nextOutput), cursor: 0, status: 'done', elapsedMs })
      return
    }
    if (answer.status === 'stopped') {
      store.set({ output: nextOutput, cursor: 0, status: 'idle', note: '已停止本次增强', elapsedMs })
      return
    }
    store.set({
      output: nextOutput,
      cursor: 0,
      status: 'error',
      elapsedMs,
      error: typeof answer.error === 'string' && answer.error !== '' ? answer.error : '增强失败，请重试',
    })
  }

  const timer = window.setInterval(() => {
    void tick()
  }, POLL_MS)

  /** Kick off one rewrite over the current draft buffer. */
  const run = async (): Promise<void> => {
    const snapshot = store.get()
    if (starting || snapshot.status === 'running') return
    const text = snapshot.source
    if (typeof text !== 'string' || text.trim() === '') {
      store.set({ error: '请先输入需要增强的提示词', note: '' })
      return
    }
    starting = true
    store.set({ status: 'running', output: '', cursor: 0, error: '', note: '', elapsedMs: 0, taskId: null })
    const answer = await startRun({ text, mode: snapshot.mode, lang: snapshot.lang })
    starting = false
    if (disposed) return
    if (answer.ok !== true || typeof answer.taskId !== 'string') {
      store.set({ status: 'error', error: answer.message ?? '无法启动增强' })
      return
    }
    store.set({ taskId: answer.taskId })
  }

  /** Abandon the current run. */
  const stop = (): void => {
    const snapshot = store.get()
    if (snapshot.taskId === null) {
      store.set({ status: 'idle' })
      return
    }
    void cancelRun(snapshot.taskId)
  }

  /** Run the host's self-diagnosis and show it inline. */
  const diagnose = (): void => {
    store.set({ diagLoading: true, diagOpen: true })
    void fetchDiag().then((report) => {
      if (disposed) return
      store.set({ diagLoading: false, diag: report })
    })
  }

  /** Subscribe one component to the shared store. Exactly two hooks, always. */
  function useStore(): WorkbenchState {
    const pair = useState<WorkbenchState>(store.get)
    const snapshot = pair[0]
    const setSnapshot = pair[1]
    useEffect(() => store.subscribe(() => {
      setSnapshot(store.get())
    }), [])
    return snapshot
  }

  /** Live, debounced analysis of the draft. */
  function useAnalysis(text: string, mode: string, enabled: boolean): PromptAnalysis | null {
    const [analysis, setAnalysis] = useState<PromptAnalysis | null>(null)
    useEffect(() => {
      if (!enabled) return
      const handle = window.setTimeout(() => {
        setAnalysis(analyzePrompt(text, mode))
      }, ANALYZE_MS)
      return () => {
        window.clearTimeout(handle)
      }
    }, [text, mode, enabled])
    return analysis
  }

  /** The one-click composer pill. */
  function Trigger(props: SessionSlotProps): ReactNode {
    const state = useStore()
    const useInput = props.useInput
    const draft = typeof useInput === 'function' ? useInput((input) => input.draft) : ''
    const running = state.status === 'running'
    const hasText = typeof draft === 'string' && draft.trim() !== ''
    const children: ReactNode[] = [
      createElement('span', { key: 'spark', className: 'dsh-pw-spark' }, '✦'),
      createElement('span', { key: 'label' }, running ? '增强中' : '提示词增强'),
    ]
    if (running) children.push(createElement('span', { key: 'ring', className: 'dsh-pw-ring' }))
    else if (hasText) children.push(createElement('span', { key: 'dot', className: 'dsh-pw-dot' }))
    return createElement('button', {
      type: 'button',
      className: state.open ? 'dsh-pw-trigger dsh-pw-trigger-on' : 'dsh-pw-trigger',
      title: '提示词增强 · 分析、重构建议与一键重写',
      'aria-label': '提示词增强',
      'aria-expanded': state.open ? 'true' : 'false',
      onMouseDown: (event: { preventDefault(): void }) => {
        event.preventDefault()
      },
      onClick: () => {
        if (state.open) {
          store.set({ open: false })
          return
        }
        loadMeta()
        store.set({ open: true, error: '', note: '', source: hasText ? draft : state.source })
      },
    }, children)
  }

  /** The floating workbench panel. */
  function Panel(props: SessionSlotProps): ReactNode {
    const state = useStore()
    const useInput = props.useInput
    const draft = typeof useInput === 'function' ? useInput((input) => input.draft) : ''
    const inputActions = props.inputActions
    const resultRef = useRef<HTMLDivElement | null>(null)

    const analysis = useAnalysis(state.source, state.mode, state.prefs.liveAnalysis)
    const isZh = analysis !== null
      ? analysis.language !== 'en'
      : detectLanguage(state.source) !== 'en'

    // Keep the newest streamed text in view without fighting a manual scroll.
    useEffect(() => {
      if (!state.prefs.autoScroll || state.status !== 'running') return
      const node = resultRef.current
      if (node !== null) node.scrollTop = node.scrollHeight
    }, [state.output, state.status, state.prefs.autoScroll])

    const insertSnippet = useCallback((snippet: string) => {
      const current = store.get().source
      const separator = current.trim() === '' ? '' : '\n\n'
      store.set({ source: `${current}${separator}${snippet}`, note: '已插入结构骨架', error: '' })
    }, [])

    const setPrefs = useCallback((patch: Partial<Preferences>) => {
      const next = { ...store.get().prefs, ...patch }
      if (!savePreferences(next)) {
        store.set({ prefs: next, note: '偏好已在本会话内生效，但浏览器拒绝持久化' })
        return
      }
      store.set({ prefs: next })
    }, [])

    if (!state.open) return null

    const running = state.status === 'running'
    const done = state.status === 'done'
    const sourceChars = state.source.length
    const outputChars = state.output.length
    const activeMode = MODES.filter((entry) => entry.key === state.mode)[0] ?? MODES[0]

    // ---- header -------------------------------------------------------------
    const headChildren: ReactNode[] = [
      createElement('span', { key: 'title', className: 'dsh-pw-title' },
        createElement('span', { className: 'dsh-pw-spark' }, '✦'),
        createElement('span', null, '提示词增强')),
    ]
    if (state.model !== '') {
      headChildren.push(createElement('span', {
        key: 'chip', className: 'dsh-pw-chip', title: '本次增强使用的模型路由',
      }, `⚙ ${state.model}`))
    }
    headChildren.push(createElement('span', { key: 'spacer', className: 'dsh-pw-spacer' }))
    headChildren.push(createElement('button', {
      key: 'diag',
      type: 'button',
      className: 'dsh-pw-iconbtn',
      title: '自检：查看插件在宿主侧的状态',
      disabled: state.diagLoading,
      onClick: diagnose,
    }, '◎'))
    headChildren.push(createElement('button', {
      key: 'cfg',
      type: 'button',
      className: state.configOpen ? 'dsh-pw-iconbtn dsh-pw-iconbtn-on' : 'dsh-pw-iconbtn',
      title: '设置',
      onClick: () => {
        store.set({ configOpen: !state.configOpen })
      },
    }, '⚙'))
    headChildren.push(createElement('button', {
      key: 'pull',
      type: 'button',
      className: 'dsh-pw-iconbtn',
      title: '从输入框重新读取草稿',
      disabled: typeof draft !== 'string' || draft.trim() === '' || running,
      onClick: () => {
        store.set({ source: typeof draft === 'string' ? draft : '', error: '', note: '已读取输入框内容' })
      },
    }, '⭯'))
    headChildren.push(createElement('button', {
      key: 'close',
      type: 'button',
      className: 'dsh-pw-iconbtn',
      title: '关闭',
      'aria-label': '关闭提示词增强',
      onClick: () => {
        store.set({ open: false })
      },
    }, '✕'))

    // ---- mode bar -----------------------------------------------------------
    const tabs: ReactNode[] = MODES.map((entry) => createElement('button', {
      key: entry.key,
      type: 'button',
      className: entry.key === state.mode ? 'dsh-pw-tab dsh-pw-tab-on' : 'dsh-pw-tab',
      title: entry.hint,
      'aria-pressed': entry.key === state.mode ? 'true' : 'false',
      onClick: () => {
        store.set({ mode: entry.key })
      },
    }, entry.label))

    const langSegment = createElement('span', { className: 'dsh-pw-seg', title: '输出语言' },
      LANGS.map((entry) => createElement('button', {
        key: entry.key,
        type: 'button',
        className: entry.key === state.lang ? 'dsh-pw-seg-on' : undefined,
        onClick: () => {
          store.set({ lang: entry.key })
        },
      }, entry.label)))

    const bar = createElement('div', { className: 'dsh-pw-bar' }, tabs.concat([
      createElement('span', { key: 'spacer', className: 'dsh-pw-spacer' }),
      langSegment,
    ]))
    const hint = createElement('div', { className: 'dsh-pw-hint' }, activeMode.hint)

    // ---- config panel -------------------------------------------------------
    const configPanel = state.configOpen
      ? createElement('div', { className: 'dsh-pw-cfg' }, [
        createElement('label', { key: 'live', className: 'dsh-pw-cfg-row' }, [
          createElement('input', {
            key: 'i',
            type: 'checkbox',
            checked: state.prefs.liveAnalysis,
            onChange: (event: { target: { checked: boolean } }) => {
              setPrefs({ liveAnalysis: event.target.checked })
            },
          }),
          createElement('span', { key: 't' }, '实时分析（本地、免费、随输入更新）'),
        ]),
        createElement('label', { key: 'sugg', className: 'dsh-pw-cfg-row' }, [
          createElement('input', {
            key: 'i',
            type: 'checkbox',
            checked: state.prefs.showSuggestions,
            onChange: (event: { target: { checked: boolean } }) => {
              setPrefs({ showSuggestions: event.target.checked })
            },
          }),
          createElement('span', { key: 't' }, '显示重构建议'),
        ]),
        createElement('label', { key: 'scroll', className: 'dsh-pw-cfg-row' }, [
          createElement('input', {
            key: 'i',
            type: 'checkbox',
            checked: state.prefs.autoScroll,
            onChange: (event: { target: { checked: boolean } }) => {
              setPrefs({ autoScroll: event.target.checked })
            },
          }),
          createElement('span', { key: 't' }, '生成时自动滚动到最新内容'),
        ]),
        createElement('label', { key: 'mode', className: 'dsh-pw-cfg-row' }, [
          createElement('span', { key: 't', className: 'dsh-pw-cfg-label' }, '默认模式'),
          createElement('select', {
            key: 's',
            className: 'dsh-pw-select',
            value: state.prefs.defaultMode,
            onChange: (event: { target: { value: string } }) => {
              setPrefs({ defaultMode: event.target.value })
            },
          }, MODES.map((entry) => createElement('option', { key: entry.key, value: entry.key }, entry.label))),
        ]),
        createElement('label', { key: 'view', className: 'dsh-pw-cfg-row' }, [
          createElement('span', { key: 't', className: 'dsh-pw-cfg-label' }, '默认结果视图'),
          createElement('select', {
            key: 's',
            className: 'dsh-pw-select',
            value: state.prefs.defaultView,
            onChange: (event: { target: { value: string } }) => {
              setPrefs({ defaultView: event.target.value as ResultView })
            },
          }, [
            createElement('option', { key: 'result', value: 'result' }, '增强结果'),
            createElement('option', { key: 'diff', value: 'diff' }, '差异对比'),
            createElement('option', { key: 'outline', value: 'outline' }, '结构覆盖'),
          ]),
        ]),
      ])
      : null

    // ---- diagnostics panel --------------------------------------------------
    const diagPanel = state.diagOpen
      ? createElement('div', { className: 'dsh-pw-diag' }, [
        createElement('div', { key: 'h', className: 'dsh-pw-diag-head' }, [
          createElement('span', { key: 't' }, '宿主侧自检'),
          createElement('button', {
            key: 'x',
            type: 'button',
            className: 'dsh-pw-iconbtn',
            onClick: () => {
              store.set({ diagOpen: false })
            },
          }, '✕'),
        ]),
        state.diagLoading
          ? createElement('div', { key: 'l', className: 'dsh-pw-muted' }, '检测中…')
          : state.diag === null
            ? createElement('div', { key: 'n', className: 'dsh-pw-msg-err' }, '自检接口不可达（宿主半未响应）')
            : createElement('div', { key: 'b' }, [
              ...state.diag.checks.map((check) => createElement('div', {
                key: check.id,
                className: check.ok ? 'dsh-pw-diag-row dsh-pw-ok' : 'dsh-pw-diag-row dsh-pw-bad',
              }, `${check.ok ? '✓' : '✗'} ${check.detail}`)),
              createElement('div', { key: 'meta', className: 'dsh-pw-diag-meta' },
                `node ${state.diag.node} · 启动图 ${state.diag.graphRev ?? '?'} · 模块 ${String(state.diag.moduleIds.length)} 个`),
            ]),
      ])
      : null

    // ---- left pane: the editable draft --------------------------------------
    const sourcePane = createElement('section', { className: 'dsh-pw-pane' },
      createElement('div', { className: 'dsh-pw-pane-head' },
        createElement('span', null, '原始提示词'),
        createElement('span', { className: 'dsh-pw-count' }, `${String(sourceChars)} 字符`)),
      createElement('textarea', {
        className: 'dsh-pw-input',
        value: state.source,
        placeholder: '粘贴或输入提示词，中英文均可……\n\n也可以点右上角 ⭯ 直接读取输入框里的草稿。\n左侧输入会即时分析，下方给出重构建议。',
        spellCheck: false,
        onChange: (event: { target: { value: string } }) => {
          store.set({ source: event.target.value, error: '', note: '' })
        },
        onKeyDown: (event: {
          metaKey: boolean
          ctrlKey: boolean
          key: string
          preventDefault(): void
        }) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void run()
          }
        },
      }))

    // ---- right pane: one of three views -------------------------------------
    const view = state.view
    const viewSegment = createElement('span', { className: 'dsh-pw-seg' },
      VIEWS.map(([key, label]) => createElement('button', {
        key,
        type: 'button',
        className: view === key ? 'dsh-pw-seg-on' : undefined,
        onClick: () => {
          store.set({ view: key })
        },
      }, label)))

    const bodyChildren: ReactNode[] = []
    if (view === 'diff') {
      if (state.output === '' || !done) {
        bodyChildren.push(createElement('span', { key: 'd', className: 'dsh-pw-muted' }, '完成一次增强后可查看逐词差异。'))
      } else {
        const parts = computeDiff(state.source, state.output)
        if (parts === null) {
          bodyChildren.push(createElement('span', { key: 'plain' }, state.output))
          bodyChildren.push(createElement('div', { key: 'cap', className: 'dsh-pw-muted' }, '（文本较长，已跳过逐词差异高亮）'))
        } else {
          for (const [index, part] of parts.entries()) {
            const className = part.kind === 'add' ? 'dsh-pw-add' : part.kind === 'del' ? 'dsh-pw-del' : 'dsh-pw-same'
            bodyChildren.push(createElement('span', { key: String(index), className }, part.text))
          }
        }
      }
    } else if (view === 'outline') {
      const target = state.output === '' ? state.source : state.output
      const outlineAnalysis = analyzePrompt(target, state.mode)
      if (outlineAnalysis.outline.length === 0) {
        bodyChildren.push(createElement('span', { key: 'none', className: 'dsh-pw-muted' },
          '当前模式不追加结构骨架（精简表达只做删减）。'))
      } else {
        for (const section of outlineAnalysis.outline) {
          const covered = target.includes(section.heading)
          bodyChildren.push(createElement('div', {
            key: section.id,
            className: covered ? 'dsh-pw-outline-row dsh-pw-ok' : 'dsh-pw-outline-row dsh-pw-bad',
          }, `${covered ? '✓' : '○'} ${section.heading} — ${section.hint}`))
        }
      }
    } else if (state.output === '' && running) {
      bodyChildren.push(createElement('span', { key: 'wait', className: 'dsh-pw-muted' }, '正在思考…'))
    } else if (state.output === '') {
      bodyChildren.push(createElement('span', { key: 'idle', className: 'dsh-pw-muted' }, '增强结果会在这里流式出现。'))
    } else {
      const blocks = splitBlocks(state.output)
      for (const [index, block] of blocks.entries()) {
        const className = block.kind === 'heading'
          ? 'dsh-pw-block dsh-pw-block-h'
          : block.kind === 'code'
            ? 'dsh-pw-block dsh-pw-block-code'
            : block.kind === 'list'
              ? 'dsh-pw-block dsh-pw-block-list'
              : 'dsh-pw-block'
        const tail = running && index === blocks.length - 1 ? ' dsh-pw-caret' : ''
        bodyChildren.push(createElement('div', { key: String(index), className: `${className}${tail}` }, block.text))
      }
    }

    const outputPane = createElement('section', { className: 'dsh-pw-pane' },
      createElement('div', { className: 'dsh-pw-pane-head' },
        createElement('span', null, view === 'diff' ? '差异对比' : view === 'outline' ? '结构覆盖' : '增强结果'),
        createElement('span', { className: 'dsh-pw-spacer' }),
        viewSegment,
        createElement('span', { className: 'dsh-pw-count' }, `${String(outputChars)} 字符`)),
      createElement('div', { className: 'dsh-pw-body', ref: resultRef }, bodyChildren))

    const grid = createElement('div', { className: 'dsh-pw-grid' }, [sourcePane, outputPane])

    // ---- advice -------------------------------------------------------------
    const advice = state.prefs.showSuggestions && analysis !== null
      ? suggestionList(analysis.suggestions, insertSnippet)
      : null

    // ---- footer -------------------------------------------------------------
    const canWrite = inputActions !== undefined && typeof inputActions.setDraft === 'function' && state.output !== ''
    const footChildren: ReactNode[] = []
    if (running) {
      footChildren.push(createElement('button', {
        key: 'stop', type: 'button', className: 'dsh-pw-btn', onClick: stop,
      }, '停止'))
    } else {
      footChildren.push(createElement('button', {
        key: 'run',
        type: 'button',
        className: 'dsh-pw-btn dsh-pw-btn-primary',
        disabled: state.source.trim() === '',
        onClick: () => {
          void run()
        },
      }, done ? '重新增强' : '开始增强'))
    }
    footChildren.push(createElement('button', {
      key: 'replace',
      type: 'button',
      className: 'dsh-pw-btn',
      disabled: !canWrite || running,
      title: '用增强结果替换输入框内容',
      onClick: () => {
        inputActions?.setDraft(state.output)
        store.set({ open: false, note: '已替换输入框内容' })
      },
    }, '替换输入框'))
    footChildren.push(createElement('button', {
      key: 'append',
      type: 'button',
      className: 'dsh-pw-btn',
      disabled: !canWrite || running,
      title: '保留原草稿并追加增强结果',
      onClick: () => {
        const base = typeof draft === 'string' ? draft : ''
        inputActions?.setDraft(base.trim() === '' ? state.output : `${base}\n\n${state.output}`)
        store.set({ open: false, note: '已追加到输入框' })
      },
    }, '追加'))
    footChildren.push(createElement('button', {
      key: 'copy',
      type: 'button',
      className: 'dsh-pw-btn',
      disabled: state.output === '',
      onClick: () => {
        void navigator.clipboard.writeText(state.output).then(
          () => {
            store.set({ note: '已复制到剪贴板' })
          },
          () => {
            store.set({ note: '复制失败，请手动选择文本复制' })
          },
        )
      },
    }, '复制'))
    const seconds = (state.elapsedMs / 1000).toFixed(1)
    const statusText = running
      ? `生成中 · ${seconds}s · ${String(outputChars)} 字符`
      : done
        ? `完成 · ${seconds}s · ${String(sourceChars)} → ${String(outputChars)} 字符`
        : state.model === '' ? '待增强' : `就绪 · ${state.model}`
    footChildren.push(createElement('span', { key: 'status', className: 'dsh-pw-status' }, statusText))

    const messages: ReactNode[] = []
    if (state.error !== '') {
      messages.push(createElement('div', { key: 'err', className: 'dsh-pw-msg dsh-pw-msg-err' }, [
        createElement('span', { key: 't' }, `⚠ ${state.error}`),
        createElement('button', {
          key: 'retry',
          type: 'button',
          className: 'dsh-pw-btn dsh-pw-btn-tiny',
          disabled: running,
          onClick: () => {
            void run()
          },
        }, '重试'),
        createElement('button', {
          key: 'diag',
          type: 'button',
          className: 'dsh-pw-btn dsh-pw-btn-tiny',
          onClick: diagnose,
        }, '自检'),
      ]))
    }
    if (state.note !== '') {
      messages.push(createElement('div', { key: 'note', className: 'dsh-pw-msg dsh-pw-msg-ok' }, `✓ ${state.note}`))
    }

    return createElement('div', {
      className: 'dsh-pw-panel',
      'data-dsh-prompt-workbench': 'overlay',
    }, [
      createElement('div', { key: 'head', className: 'dsh-pw-head' }, headChildren),
      createElement('div', { key: 'barwrap' }, [bar, hint]),
      configPanel === null ? null : createElement('div', { key: 'cfg' }, configPanel),
      diagPanel === null ? null : createElement('div', { key: 'diag' }, diagPanel),
      analysis === null ? null : createElement('div', { key: 'strip' }, analysisStrip(analysis, isZh)),
      createElement('div', { key: 'gridwrap' }, grid),
      advice === null ? null : createElement('div', { key: 'advice' }, advice),
      messages.length === 0 ? null : createElement('div', { key: 'msgs' }, messages),
      createElement('div', { key: 'foot' }, footChildren),
    ])
  }

  /**
   * These gates carry no hooks, so an absent `useInput` never changes a hook
   * count: the real surface only mounts with a genuine session binding.
   */
  function TriggerGate(props: SessionSlotProps): ReactNode {
    if (typeof props.useInput !== 'function') return null
    return createElement(Trigger, props)
  }

  function PanelGate(props: SessionSlotProps): ReactNode {
    if (typeof props.useInput !== 'function') return null
    return createElement(Panel, props)
  }

  // Seed session state from the persisted preferences once, at mount.
  const prefs = loadPreferences()
  store.set({ mode: prefs.defaultMode, lang: prefs.defaultLang, view: prefs.defaultView, prefs })

  const offLeft = slots.inject('conversation.input.left', () => slots.register(
    { name: 'conversation.input.left', id: 'prompt-workbench-trigger', order: 20, label: '提示词增强' },
    TriggerGate as never,
  ))

  const offOverlay = slots.inject('conversation.input.overlay', () => slots.register(
    { name: 'conversation.input.overlay', id: 'prompt-workbench-panel', order: 30, label: '提示词增强' },
    PanelGate as never,
  ))

  return () => {
    disposed = true
    window.clearInterval(timer)
    if (typeof offOverlay === 'function') (offOverlay as () => void)()
    if (typeof offLeft === 'function') (offLeft as () => void)()
  }
}
