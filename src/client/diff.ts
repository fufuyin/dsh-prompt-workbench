/**
 * Token-level diff for the before/after comparison view.
 *
 * The LCS table is quadratic, so the whole computation is capped: past the cap
 * the caller falls back to plain text rather than freezing the UI on a long
 * draft. That degradation is deliberate — do not remove it.
 */

/** Maximum token count per side before the diff gives up. */
export const DIFF_TOKEN_LIMIT = 700

/** One run of tokens sharing a fate. */
export interface DiffPart {
  readonly kind: 'same' | 'add' | 'del'
  text: string
}

/** Split text into word/character tokens: latin runs stay whole, CJK splits. */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let buffer = ''
  for (const ch of text) {
    if (/[A-Za-z0-9_@#./\\:-]/.test(ch)) {
      buffer += ch
      continue
    }
    if (buffer !== '') {
      tokens.push(buffer)
      buffer = ''
    }
    tokens.push(ch)
  }
  if (buffer !== '') tokens.push(buffer)
  return tokens
}

/**
 * Token-level LCS diff between the original and the rewrite.
 * @returns the merged run list, or `null` when either side exceeds {@link DIFF_TOKEN_LIMIT}.
 */
export function computeDiff(before: string, after: string): DiffPart[] | null {
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length > DIFF_TOKEN_LIMIT || b.length > DIFF_TOKEN_LIMIT) return null

  const n = a.length
  const m = b.length
  const width = m + 1
  const table = new Uint16Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + (j + 1)] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)])
    }
  }

  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string): void => {
    const last = parts[parts.length - 1]
    if (last !== undefined && last.kind === kind) last.text += text
    else parts.push({ kind, text })
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i += 1
      j += 1
      continue
    }
    if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      push('del', a[i])
      i += 1
    } else {
      push('add', b[j])
      j += 1
    }
  }
  while (i < n) {
    push('del', a[i])
    i += 1
  }
  while (j < m) {
    push('add', b[j])
    j += 1
  }
  return parts
}

/**
 * Strip a code fence that wraps the WHOLE answer, a common model tic.
 * A fence that only wraps part of the answer is left alone.
 */
export function stripOuterFence(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length < 8 || !trimmed.startsWith('```')) return text
  const firstBreak = trimmed.indexOf('\n')
  if (firstBreak === -1) return text
  const lastFence = trimmed.lastIndexOf('```')
  if (lastFence <= firstBreak) return text
  if (trimmed.slice(lastFence).trim() !== '```') return text
  return trimmed.slice(firstBreak + 1, lastFence).replace(/\s+$/, '')
}
