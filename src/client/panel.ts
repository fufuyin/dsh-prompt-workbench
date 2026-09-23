/**
 * The two composer surfaces, ported from the working implementation.
 *
 *   conversation.input.left    -> the one-click trigger pill
 *   conversation.input.overlay -> the floating workbench panel
 *
 * Both mount into `session`-scope list slots, so the framework hands them
 * `useInput` and `inputActions` as standard props — that is how the plugin
 * reads the composer draft and writes a rewrite back into it.
 *
 * ## Why there is no Run-card panel any more
 *
 * The original build also rendered a panel inside the `cordis_run` card via
 * `tool.view.cordis`. That slot only exists for *dynamic* Cordis packages: its
 * owner dispatches the key `${pluginId}.${packageId}` taken from a dynamic
 * `cordis_run` result, and the dynamic guard is the only thing that maps
 * `key: 'self'` onto such a pair. An installed bundle has neither, so a
 * registration there would never render. The surface was dropped rather than
 * shipped dead.
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'
import { cancelRun, fetchMeta, pollRun, startRun } from './api.ts'
import { computeDiff, stripOuterFence } from './diff.ts'
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
function messageOf(error: unknown): string {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return String(error)
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

  /** Kick off one enhancement run over the current draft buffer. */
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
      title: '提示词增强 · 一键优化与润色',
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
    const diffPair = useState(false)
    const diffOn = diffPair[0]
    const setDiffOn = diffPair[1]
    if (!state.open) return null

    const inputActions = props.inputActions
    const running = state.status === 'running'
    const done = state.status === 'done'
    const sourceChars = state.source.length
    const outputChars = state.output.length
    const activeMode = MODES.filter((entry) => entry.key === state.mode)[0] ?? MODES[0]

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

    const sourcePane = createElement('section', { className: 'dsh-pw-pane' },
      createElement('div', { className: 'dsh-pw-pane-head' },
        createElement('span', null, '原始提示词'),
        createElement('span', { className: 'dsh-pw-count' }, `${String(sourceChars)} 字符`)),
      createElement('textarea', {
        className: 'dsh-pw-input',
        value: state.source,
        placeholder: '粘贴或输入提示词，中英文均可……\n\n也可以点右上角 ⭯ 直接读取输入框里的草稿。',
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

    const bodyChildren: ReactNode[] = []
    if (state.output === '' && running) {
      bodyChildren.push(createElement('span', { key: 'wait', className: 'dsh-pw-muted' }, '正在思考…'))
    } else if (state.output === '') {
      bodyChildren.push(createElement('span', { key: 'idle', className: 'dsh-pw-muted' }, '增强结果会在这里流式出现。'))
    } else if (diffOn && done) {
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
    } else {
      bodyChildren.push(createElement('span', {
        key: 'live',
        className: running ? 'dsh-pw-caret' : undefined,
      }, state.output))
    }

    const outputPane = createElement('section', { className: 'dsh-pw-pane' },
      createElement('div', { className: 'dsh-pw-pane-head' },
        createElement('span', null, done && diffOn ? '差异对比（新增高亮 / 删除划线）' : '增强结果'),
        createElement('span', { className: 'dsh-pw-count' }, `${String(outputChars)} 字符`)),
      createElement('div', { className: 'dsh-pw-body' }, bodyChildren))

    const grid = createElement('div', { className: 'dsh-pw-grid' }, [sourcePane, outputPane])

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
    if (done) {
      footChildren.push(createElement('button', {
        key: 'diff',
        type: 'button',
        className: diffOn ? 'dsh-pw-btn dsh-pw-btn-primary' : 'dsh-pw-btn',
        title: '高亮显示新增与删除的片段',
        onClick: () => {
          setDiffOn(!diffOn)
        },
      }, '差异高亮'))
    }
    const seconds = (state.elapsedMs / 1000).toFixed(1)
    const statusText = running
      ? `生成中 · ${seconds}s · ${String(outputChars)} 字符`
      : done
        ? `完成 · ${seconds}s · ${String(sourceChars)} → ${String(outputChars)} 字符`
        : state.model === '' ? '待增强' : `就绪 · ${state.model}`
    footChildren.push(createElement('span', { key: 'status', className: 'dsh-pw-status' }, statusText))

    const messages: ReactNode[] = []
    if (state.error !== '') {
      messages.push(createElement('div', { key: 'err', className: 'dsh-pw-msg dsh-pw-msg-err' }, `⚠ ${state.error}`))
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
      grid,
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
