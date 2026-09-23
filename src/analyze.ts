/**
 * Prompt parsing, analysis, and restructuring advice.
 *
 * This module is the plugin's brain and it is deliberately **pure**: no
 * services, no I/O, no model call. Both halves import it —
 *
 *   - the browser half runs it live on every keystroke (debounced), so the
 *     author sees gaps and advice instantly and for free;
 *   - the host half runs it once per rewrite to tell the model exactly which
 *     gaps to close, which is what makes the rewrite targeted instead of
 *     generic.
 *
 * Because it is pure, it is also directly unit-testable — see
 * `tests/analyze.spec.ts`.
 *
 * @module dsh-prompt-workbench/analyze
 */

/** One dimension a well-formed agent prompt should cover. */
export type DimensionId = 'goal' | 'context' | 'constraints' | 'output' | 'acceptance' | 'examples'

/** A dimension's verdict on the draft. */
export interface Dimension {
  readonly id: DimensionId
  /** Human-facing label (Chinese, matching the plugin's UI language). */
  readonly label: string
  /** Whether the draft shows evidence of this dimension. */
  readonly present: boolean
  /** The matched fragment, trimmed — shown as proof in the UI. */
  readonly evidence?: string
}

/** How loudly a suggestion should be presented. */
export type Severity = 'high' | 'medium' | 'low'

/** One actionable restructuring suggestion. */
export interface Suggestion {
  readonly id: string
  readonly severity: Severity
  readonly title: string
  readonly detail: string
  /**
   * A ready-to-insert snippet. The UI offers it as a one-click append, which
   * turns advice into action instead of prose the author has to retype.
   */
  readonly snippet?: string
}

/** One section of the recommended outline for the active mode. */
export interface OutlineSection {
  readonly id: string
  readonly heading: string
  readonly hint: string
}

/** The draft's dominant script. */
export type DetectedLanguage = 'zh' | 'en' | 'mixed'

/** The complete analysis of one draft. */
export interface PromptAnalysis {
  readonly chars: number
  readonly lines: number
  readonly language: DetectedLanguage
  readonly dimensions: readonly Dimension[]
  /** Fraction of dimensions the draft covers, 0..1. */
  readonly coverage: number
  /** Vague phrases found, in draft order, deduplicated. */
  readonly vagueness: readonly string[]
  /** Unresolved placeholders such as TODO / TBD / 待定. */
  readonly placeholders: readonly string[]
  /** Count of fenced code blocks. */
  readonly codeBlocks: number
  /** Count of `@reference` tokens. */
  readonly references: number
  /** Actionability score, 0..100. */
  readonly score: number
  /** Ordered advice, highest severity first. */
  readonly suggestions: readonly Suggestion[]
  /** The recommended section skeleton for this draft. */
  readonly outline: readonly OutlineSection[]
}

/** Evidence patterns per dimension. Bilingual on purpose. */
const DIMENSION_PATTERNS: Readonly<Record<DimensionId, readonly RegExp[]>> = {
  goal: [
    // Written goals ("目标：…") AND the far more common Chinese imperative
    // request ("帮我写个登录页面"), which states the deliverable without ever
    // using the word 目标. Missing the latter made the goal dimension useless
    // for exactly the drafts this plugin exists for.
    /目标|目的|想要|希望|需要|帮我|帮忙|实现|做一?[个款份]|写一?[个份]|搭建|开发|编写|生成|创建一个?|设计一个?|加一个?/,
    /\b(goal|objective|i want|i need|implement|build|create|develop|write|add)\b/i,
  ],
  context: [
    /背景|现状|前提|目前|已有|现有|当前|基于|技术栈|环境/,
    /\b(context|background|currently|existing|already|based on|stack|environment)\b/i,
  ],
  constraints: [
    /约束|限制|不要|不得|禁止|必须|务必|只能|不允许|兼容|性能|不能/,
    /\b(constraint|limit|must|must not|should not|only|forbid|compatib|performance|cannot)\b/i,
  ],
  output: [
    /输出|返回|格式|以.{0,6}形式|表格|列表|代码块|文件结构/,
    /\b(output|format|return|as (?:a|an|json|markdown)|table|bullet)\b/i,
  ],
  acceptance: [
    /验收|完成标准|完成定义|判定标准|测试通过|满足以下|自检/,
    /\b(acceptance|definition of done|criteria|test|verify|pass(?:es)?)\b/i,
  ],
  examples: [/例如|举例|示例|比如|参考(?:样例|示例)/, /\b(for example|for instance|e\.g\.|such as|sample|example)\b/i],
}

/** Dimension labels, in report order. */
const DIMENSION_LABELS: Readonly<Record<DimensionId, string>> = {
  goal: '目标',
  context: '背景',
  constraints: '约束',
  output: '输出格式',
  acceptance: '验收标准',
  examples: '示例',
}

/** Report order: the order an agent reads a brief in. */
const DIMENSION_ORDER: readonly DimensionId[] = ['goal', 'context', 'constraints', 'output', 'acceptance', 'examples']

/**
 * Phrases that push work back onto the reader. Kept separate per script so the
 * explanation in the UI can say which one fired.
 */
const VAGUE_ZH: readonly string[] = [
  '一些', '若干', '尽量', '最好', '适当', '等等', '之类', '相关的', '合理的',
  '优化一下', '差不多', '看情况', '随便', '更好', '稍微', '大概', '可能',
]
const VAGUE_EN: readonly string[] = [
  'some', 'a few', 'several', 'as appropriate', 'if possible', 'reasonable',
  'optimize', 'nicely', 'better', 'etc', 'and so on', 'maybe', 'roughly', 'somehow',
]

/** Placeholder markers that mean the brief is unfinished. */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\bTODO\b/gi, /\bTBD\b/gi, /\bFIXME\b/gi, /\bXXX\b/g, /\?\?\?/g, /待定/g, /待补/g, /占位/g,
]

/** Vague-phrase suggestion snippets, keyed by the phrase that triggered them. */
function vagueDetail(phrase: string): string {
  return `“${phrase}”把决定权留给了执行者。换成可判定的具体值或范围。`
}

/** Count fenced code blocks (``` pairs), tolerant of an unterminated trailing fence. */
function countCodeBlocks(text: string): number {
  const fences = text.match(/^[ \t]*```/gm)
  return fences === null ? 0 : Math.floor(fences.length / 2) + (fences.length % 2)
}

/** Count `@reference` tokens (file/session references the author pinned). */
function countReferences(text: string): number {
  const matches = text.match(/(^|\s)@[\w./\\-]+/g)
  return matches === null ? 0 : matches.length
}

/** Detect the draft's dominant script. */
export function detectLanguage(text: string): DetectedLanguage {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  if (cjk === 0 && latin === 0) return 'en'
  if (cjk === 0) return 'en'
  if (latin < cjk * 0.2) return 'zh'
  if (cjk < latin * 0.2) return 'en'
  return 'mixed'
}

/** Find the first matching fragment for a dimension, for display as evidence. */
function findEvidence(text: string, patterns: readonly RegExp[]): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        const trimmed = line.trim()
        return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed
      }
    }
  }
  return undefined
}

/** Collect the vague phrases present, in first-appearance order. */
function collectVagueness(text: string): string[] {
  const found: { phrase: string; at: number }[] = []
  const lower = text.toLowerCase()
  for (const phrase of VAGUE_ZH) {
    const at = text.indexOf(phrase)
    if (at !== -1) found.push({ phrase, at })
  }
  for (const phrase of VAGUE_EN) {
    // Word-boundary match for latin phrases, so "some" does not fire inside "something".
    const match = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).exec(lower)
    if (match !== null) found.push({ phrase, at: match.index })
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.phrase)
}

/** Collect unresolved placeholders, deduplicated, uppercased for latin markers. */
function collectPlaceholders(text: string): string[] {
  const seen = new Set<string>()
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = text.match(pattern)
    if (matches === null) continue
    for (const match of matches) {
      const normalized = /^[a-z]/i.test(match) ? match.toUpperCase() : match
      seen.add(normalized)
    }
  }
  return [...seen]
}

/**
 * The recommended section skeleton for a mode. `concise` has no skeleton on
 * purpose — compression must not add structure the author did not ask for.
 */
export function outlineFor(mode: string): OutlineSection[] {
  if (mode === 'concise') return []
  if (mode === 'constraints') {
    return [
      { id: 'scope', heading: '范围', hint: '这次要做什么，做到哪为止' },
      { id: 'non-goals', heading: '非目标', hint: '明确不做什么，防止范围蔓延' },
      { id: 'constraints', heading: '技术约束', hint: '平台、版本、依赖、风格、兼容性' },
      { id: 'acceptance', heading: '验收标准', hint: '怎样算做完，如何验证' },
    ]
  }
  if (mode === 'refine') {
    return [
      { id: 'goal', heading: '目标', hint: '一句话说清最终要达成什么' },
      { id: 'requirements', heading: '具体要求', hint: '拆成可逐条核对的要求' },
      { id: 'deliverable', heading: '交付物', hint: '要产出什么，放在哪里' },
    ]
  }
  return [
    { id: 'goal', heading: '目标', hint: '一句话说清最终要达成什么' },
    { id: 'context', heading: '背景', hint: '现状、已有条件、约束前提' },
    { id: 'requirements', heading: '具体要求', hint: '拆成可逐条核对的要求' },
    { id: 'output', heading: '输出格式', hint: '交付形态：文件、代码块、表格…' },
    { id: 'acceptance', heading: '验收标准', hint: '怎样算做完，如何验证' },
  ]
}

/**
 * Turn the analysis into ordered, actionable advice.
 *
 * Severity policy: a missing goal blocks everything (high); missing
 * constraints/acceptance cause rework (high/medium); vagueness and placeholders
 * cause guessing (medium); missing examples is a nice-to-have (low).
 */
function buildSuggestions(input: {
  dimensions: readonly Dimension[]
  vagueness: readonly string[]
  placeholders: readonly string[]
  chars: number
  mode: string
  outline: readonly OutlineSection[]
}): Suggestion[] {
  const suggestions: Suggestion[] = []
  const missing = new Set(input.dimensions.filter((dimension) => !dimension.present).map((dimension) => dimension.id))

  // Concise mode's job is to remove, not to add: recommending new sections
  // there contradicts the mode the user explicitly picked. The two
  // high-severity gaps survive, because a compressed prompt must still say what
  // is wanted and how it will be judged — everything optional is suppressed.
  const structural = input.mode !== 'concise'

  if (missing.has('goal')) {
    suggestions.push({
      id: 'add-goal',
      severity: 'high',
      title: '补一句明确的目标',
      detail: '没有目标时，执行者只能猜你想要什么，第一步就会偏。用一句话写清最终要达成什么。',
      snippet: '## 目标\n<!-- 一句话说清最终要达成什么 -->\n',
    })
  }
  if (missing.has('acceptance')) {
    suggestions.push({
      id: 'add-acceptance',
      severity: 'high',
      title: '补上验收标准',
      detail: '没有验收标准就无法判断"做完了"，返工往往发生在这里。列出可逐条核对的判定条件。',
      snippet: '## 验收标准\n- [ ] <!-- 条件一 -->\n- [ ] <!-- 条件二 -->\n',
    })
  }
  if (structural && missing.has('constraints')) {
    suggestions.push({
      id: 'add-constraints',
      severity: 'medium',
      title: '补上约束与非目标',
      detail: '约束决定方案边界。至少写明平台/版本/依赖限制，以及明确不做什么。',
      snippet: '## 约束\n- 技术栈：\n- 版本/平台：\n\n## 非目标\n- <!-- 明确不做的事 -->\n',
    })
  }
  if (structural && missing.has('output')) {
    suggestions.push({
      id: 'add-output',
      severity: 'medium',
      title: '指定输出格式',
      detail: '写清交付形态（文件路径、代码块、表格…），能显著减少来回确认。',
      snippet: '## 输出格式\n<!-- 例：单个 HTML 文件；或 Markdown 表格；或完整文件树 -->\n',
    })
  }
  if (structural && missing.has('context')) {
    suggestions.push({
      id: 'add-context',
      severity: 'low',
      title: '补一点背景',
      detail: '现状、已有代码、运行环境等前提，能让执行者少问一轮。',
      snippet: '## 背景\n<!-- 现状、已有条件、相关文件 @路径 -->\n',
    })
  }
  if (structural && missing.has('examples')) {
    suggestions.push({
      id: 'add-examples',
      severity: 'low',
      title: '可选：给一个示例',
      detail: '一个输入/输出示例能消除歧义，尤其是格式类要求。',
    })
  }
  for (const phrase of input.vagueness.slice(0, 5)) {
    suggestions.push({
      id: `vague-${phrase}`,
      severity: 'medium',
      title: `替换模糊词「${phrase}」`,
      detail: vagueDetail(phrase),
    })
  }
  if (input.placeholders.length > 0) {
    suggestions.push({
      id: 'resolve-placeholders',
      severity: 'medium',
      title: `解决未填占位符（${input.placeholders.join('、')}）`,
      detail: '占位符会被原样带进执行，等于把决定权交出去。要么填上，要么删掉。',
    })
  }
  if (input.chars > 0 && input.chars < 30) {
    suggestions.push({
      id: 'too-short',
      severity: 'high',
      title: '草稿过短',
      detail: '不到 30 字符通常不足以表达一个可执行任务。用下面的结构骨架把关键信息补齐。',
      ...input.outline.length === 0
        ? {}
        : { snippet: input.outline.map((section) => `## ${section.heading}\n<!-- ${section.hint} -->\n`).join('\n') },
    })
  }
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  return suggestions.sort((a, b) => order[a.severity] - order[b.severity])
}

/**
 * Analyze one draft.
 *
 * Deterministic and side-effect free: the same draft always yields the same
 * report, which is what lets the UI render it on every keystroke and the tests
 * assert on it.
 *
 * @param text - the raw draft.
 * @param mode - the active rewrite mode; selects the outline template.
 * @returns the full analysis.
 */
export function analyzePrompt(text: string, mode: string): PromptAnalysis {
  const dimensions: Dimension[] = DIMENSION_ORDER.map((id) => {
    const evidence = findEvidence(text, DIMENSION_PATTERNS[id])
    return evidence === undefined
      ? { id, label: DIMENSION_LABELS[id], present: false }
      : { id, label: DIMENSION_LABELS[id], present: true, evidence }
  })
  const present = dimensions.filter((dimension) => dimension.present).length
  const coverage = dimensions.length === 0 ? 0 : present / dimensions.length
  const vagueness = collectVagueness(text)
  const placeholders = collectPlaceholders(text)
  const outline = outlineFor(mode)
  const chars = text.length

  // Score: coverage dominates; vagueness, placeholders and a too-short draft
  // each subtract. Clamped to 0..100 so the UI can show a stable meter.
  let score = Math.round(coverage * 100)
  score -= Math.min(vagueness.length, 5) * 6
  score -= Math.min(placeholders.length, 3) * 8
  if (chars > 0 && chars < 30) score -= 20
  if (chars === 0) score = 0
  score = Math.max(0, Math.min(100, score))

  return {
    chars,
    lines: text === '' ? 0 : text.split(/\r?\n/).length,
    language: detectLanguage(text),
    dimensions,
    coverage,
    vagueness,
    placeholders,
    codeBlocks: countCodeBlocks(text),
    references: countReferences(text),
    score,
    suggestions: buildSuggestions({ dimensions, vagueness, placeholders, chars, mode, outline }),
    outline,
  }
}

/**
 * Render the analysis as a compact instruction block for the model.
 *
 * This is what makes a rewrite targeted: instead of "improve this", the model
 * is told exactly which dimensions are missing. Kept short so it never crowds
 * out the draft itself.
 *
 * @param analysis - the draft's analysis.
 * @returns a bullet list, or an empty string when the draft already covers everything.
 */
export function describeGapsForModel(analysis: PromptAnalysis): string {
  const lines: string[] = []
  const missing = analysis.dimensions.filter((dimension) => !dimension.present)
  if (missing.length > 0) {
    lines.push(`Missing dimensions you must add: ${missing.map((dimension) => dimension.label).join(', ')}.`)
  }
  if (analysis.vagueness.length > 0) {
    lines.push(`Vague wording to replace with concrete values: ${analysis.vagueness.join(', ')}.`)
  }
  if (analysis.placeholders.length > 0) {
    lines.push(`Unresolved placeholders to turn into explicit questions rather than guesses: ${analysis.placeholders.join(', ')}.`)
  }
  if (analysis.references > 0) {
    lines.push(`The draft pins ${String(analysis.references)} @reference(s); keep every one of them verbatim.`)
  }
  if (analysis.outline.length > 0) {
    lines.push(`Preferred section skeleton: ${analysis.outline.map((section) => section.heading).join(' / ')}.`)
  }
  return lines.join('\n')
}
