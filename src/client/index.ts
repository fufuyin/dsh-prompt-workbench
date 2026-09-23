/**
 * dsh-prompt-workbench, browser half.
 *
 * Thin assembly: inject the stylesheet once, then mount the two composer
 * surfaces into the slot registry. Behaviour lives in `panel.ts`.
 *
 * The module keeps a single `teardown` so an HMR reload cannot stack a second
 * copy of the poller or a duplicate slot registration — the pattern the
 * in-tree pet overlay established for client plugins.
 */

import { mountWorkbench, type SlotsLike } from './panel.ts'
import { WORKBENCH_CSS } from './styles.ts'

/** The module name the profile patch inserts. */
export const name = 'dsh-prompt-workbench'

/** `slots` is the only service the browser half needs. */
export const inject = ['slots'] as const

/** Tag id for the stylesheet, so a re-evaluation cannot stack copies. */
const STYLE_ID = 'dsh-prompt-workbench-css'

/** Teardown of the previous mount. */
let teardown: (() => void) | undefined

/** The slice of the client context this plugin uses. */
interface ClientContext {
  slots?: SlotsLike
  get(name: string): unknown
}

/** Inject the plugin's stylesheet once per document. */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = WORKBENCH_CSS
  document.head.appendChild(tag)
}

/** Mount the workbench surfaces. */
export function apply(ctx: ClientContext): void {
  teardown?.()
  teardown = undefined
  injectStyles()
  const slots = ctx.slots ?? (ctx.get('slots') as SlotsLike | undefined)
  if (slots === undefined || slots === null) return
  teardown = mountWorkbench(slots)
}
