/**
 * Behavioural tests for the analysis layer.
 *
 * These assert the contract the UI and the host instruction both depend on:
 * which dimensions a draft is judged to cover, which phrases are called vague,
 * and that advice ordering is severity-first. The analyzer is pure, so no
 * harness is needed.
 */
import { describe, expect, it } from 'vitest'
import {
  analyzePrompt,
  describeGapsForModel,
  detectLanguage,
  outlineFor,
} from '../src/analyze.ts'

describe('detectLanguage', () => {
  it('reports pure Chinese and pure English', () => {
    expect(detectLanguage('帮我写个登录页面')).toBe('zh')
    expect(detectLanguage('write me a login page')).toBe('en')
  })

  it('reports mixed when both scripts carry weight', () => {
    expect(detectLanguage('用 React 写一个 login page，需要 token 校验')).toBe('mixed')
  })

  it('treats symbol-only input as English rather than guessing', () => {
    expect(detectLanguage('...???')).toBe('en')
  })
})

describe('analyzePrompt — dimension coverage', () => {
  it('finds no dimensions in a bare wish', () => {
    const result = analyzePrompt('帮我写个登录页面', 'structure')
    expect(result.dimensions.find((d) => d.id === 'goal')?.present).toBe(true)
    expect(result.dimensions.find((d) => d.id === 'acceptance')?.present).toBe(false)
    expect(result.dimensions.find((d) => d.id === 'output')?.present).toBe(false)
  })

  it('records the matching line as evidence', () => {
    const result = analyzePrompt('背景：现有项目使用 Vue 2\n目标：加一个登录页', 'structure')
    expect(result.dimensions.find((d) => d.id === 'goal')?.evidence).toContain('目标')
    expect(result.dimensions.find((d) => d.id === 'context')?.evidence).toContain('背景')
  })

  it('recognises a fully specified brief', () => {
    const draft = [
      '目标：实现登录接口',
      '背景：现有 Express 项目',
      '约束：必须兼容 Node 22，不允许引入新依赖',
      '输出格式：返回 JSON 示例',
      '验收标准：单元测试通过',
      '例如：POST /login { "user": "a" }',
    ].join('\n')
    const result = analyzePrompt(draft, 'structure')
    expect(result.coverage).toBe(1)
    expect(result.suggestions).toHaveLength(0)
  })
})

describe('analyzePrompt — vague wording and placeholders', () => {
  it('collects vague phrases in first-appearance order', () => {
    const result = analyzePrompt('尽量优化一下，适当加一些注释', 'refine')
    expect(result.vagueness).toContain('尽量')
    expect(result.vagueness).toContain('优化一下')
    expect(result.vagueness).toContain('适当')
    expect(result.vagueness.indexOf('尽量')).toBeLessThan(result.vagueness.indexOf('优化一下'))
  })

  it('does not match an English vague word inside a longer word', () => {
    const result = analyzePrompt('something handlers', 'refine')
    expect(result.vagueness).not.toContain('some')
  })

  it('collects placeholders and normalises latin markers to uppercase', () => {
    const result = analyzePrompt('端口：tbd\n路径：TODO\n名称：待定', 'structure')
    expect(result.placeholders).toContain('TBD')
    expect(result.placeholders).toContain('TODO')
    expect(result.placeholders).toContain('待定')
  })

  it('counts references and code blocks', () => {
    const result = analyzePrompt('参考 @src/index.ts 和 @README.md\n```js\nlet a = 1\n```', 'structure')
    expect(result.references).toBe(2)
    expect(result.codeBlocks).toBe(1)
  })
})

describe('analyzePrompt — scoring', () => {
  it('is zero for an empty draft and bounded for any draft', () => {
    expect(analyzePrompt('', 'refine').score).toBe(0)
    const dense = analyzePrompt('目标 背景 约束 输出 验收 例如 ' + '尽量 '.repeat(40), 'structure')
    expect(dense.score).toBeGreaterThanOrEqual(0)
    expect(dense.score).toBeLessThanOrEqual(100)
  })

  it('rates a specified brief above a vague one', () => {
    const vague = analyzePrompt('帮我弄一下那个东西', 'structure').score
    const specified = analyzePrompt(
      '目标：实现登录\n约束：必须用 Node 22\n输出格式：JSON\n验收标准：测试通过',
      'structure',
    ).score
    expect(specified).toBeGreaterThan(vague)
  })
})

describe('analyzePrompt — advice', () => {
  it('orders advice severity-first and flags a missing goal as high', () => {
    const result = analyzePrompt('随便弄一个', 'structure')
    expect(result.suggestions[0]?.severity).toBe('high')
    const severities = result.suggestions.map((s) => s.severity)
    const order = { high: 0, medium: 1, low: 2 }
    for (let i = 1; i < severities.length; i += 1) {
      expect(order[severities[i]]).toBeGreaterThanOrEqual(order[severities[i - 1]])
    }
  })

  it('offers an insertable snippet for structural gaps', () => {
    const result = analyzePrompt('做个页面', 'structure')
    const acceptance = result.suggestions.find((s) => s.id === 'add-acceptance')
    expect(acceptance?.snippet).toContain('验收标准')
  })

  it('advises nothing structural for a concise rewrite of a good draft', () => {
    const result = analyzePrompt(
      '目标：压缩日志\n约束：不得改变字段名\n输出格式：单行 JSON\n验收标准：解析测试通过',
      'concise',
    )
    expect(result.outline).toHaveLength(0)
    expect(result.suggestions.filter((s) => s.id.startsWith('add-'))).toHaveLength(0)
  })
})

describe('outlineFor', () => {
  it('ships a skeleton per structural mode and none for concise', () => {
    expect(outlineFor('structure').map((s) => s.heading)).toContain('验收标准')
    expect(outlineFor('constraints').map((s) => s.heading)).toContain('非目标')
    expect(outlineFor('refine').map((s) => s.heading)).toContain('交付物')
    expect(outlineFor('concise')).toHaveLength(0)
  })
})

describe('describeGapsForModel', () => {
  it('names the missing dimensions and the preferred skeleton', () => {
    const text = describeGapsForModel(analyzePrompt('写个页面', 'structure'))
    expect(text).toContain('Missing dimensions')
    expect(text).toContain('Preferred section skeleton')
  })

  it('still states the preferred skeleton when every dimension is covered', () => {
    const draft = [
      '目标：实现登录',
      '背景：Express 项目',
      '约束：必须 Node 22',
      '输出格式：JSON',
      '验收标准：测试通过',
      '例如：POST /login',
    ].join('\n')
    expect(describeGapsForModel(analyzePrompt(draft, 'structure'))).toContain('Preferred section skeleton')
  })
})
