/**
 * Post-build assertions for the packaged artifact.
 *
 * These are the invariants no compiler checks and no test catches until a user
 * hits them: a patch layer that inserts a name Node cannot resolve, a client
 * bundle registered under the wrong module id, an `exports["./client"]` entry
 * pointing at a file that was never emitted, and a lockfile pinned to a mirror
 * that the consumer's install will refuse.
 *
 * Wired to `prepack`, so an unusable tarball cannot be published.
 */

import { readFile, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const name = manifest.name

/** 1. The patch layer must insert by the resolvable package name. */
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
if (!patch.includes(`name: ${name}`)) {
  failures.push(`cordis.patch.yml must insert by package name '${name}' (the Loader resolves it from the profile directory)`)
}

/** 2. `exports["./client"]` must resolve, and the bundle must register that id. */
const clientExport = manifest.exports?.['./client']
const clientRel = typeof clientExport === 'string' ? clientExport : clientExport?.default
if (typeof clientRel !== 'string') {
  failures.push('package.json must declare exports["./client"] as a string or { default: string } — dsh.client without it is never served')
} else {
  const clientPath = join(root, clientRel)
  try {
    await access(clientPath)
  } catch {
    failures.push(`exports["./client"] points at ${clientRel}, which does not exist — run \`npm run build\` first`)
  }
  try {
    const bundle = await readFile(clientPath, 'utf8')
    // The bundler is free to pretty-print the banner, so compare the loader
    // call and the module id whitespace-insensitively rather than byte-exactly.
    const head = bundle.slice(0, 256).replace(/\s+/g, '')
    const expected = `window.__ModuleLoader__.load({id:${JSON.stringify(name)},`
    if (!head.startsWith(expected)) {
      failures.push(`${clientRel} must register __ModuleLoader__ id ${JSON.stringify(name)}; it starts with ${JSON.stringify(bundle.slice(0, 120))}`)
    }
  } catch {
    // Already reported by the access() check above.
  }
}

/** 3. Every resolved lockfile entry must come from the canonical registry. */
for (const lock of ['package-lock.json', 'pnpm-lock.yaml']) {
  let text
  try {
    text = await readFile(join(root, lock), 'utf8')
  } catch {
    continue
  }
  const hosts = new Set()
  // Only `"resolved"` values are install sources. Funding and repository URLs
  // also live in a lockfile and must not trip this gate.
  for (const match of text.matchAll(/"resolved"\s*:\s*"https?:\/\/([^/"\s]+)/g)) hosts.add(match[1])
  const foreign = [...hosts].filter((host) => host !== 'registry.npmjs.org')
  if (foreign.length > 0) {
    failures.push(`${lock} resolves to ${foreign.join(', ')} — a mirror-resolved lockfile passes locally and fails in the consumer's install`)
  }
}

if (failures.length > 0) {
  console.error(`preflight failed for ${name}:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`preflight ok: ${name}`)
