/**
 * Browser client bundle.
 *
 * The artifact is a closure factory that calls
 * `window.__ModuleLoader__.load({ id, factory })` and resolves its externals
 * through the injected `require` (the loader's module table) — the same shape
 * the harness's own client preset produces, and the same shape the third-party
 * `dsh-market` plugin uses for an out-of-tree package.
 *
 * `react` / `react-dom` are the only externals: they are seeded platform
 * modules. Everything else must inline, because a `require()` the module table
 * cannot answer is a guaranteed runtime throw.
 *
 * No CSS pipeline is needed here: the plugin ships its stylesheet as a string
 * and injects one tagged `<style>` itself (see `src/client/styles.ts`).
 */
import { defineConfig } from 'tsdown'

/** Must equal `package.json#name` — `scripts/preflight.mjs` asserts this. */
const id = 'dsh-prompt-workbench'

/** Externals resolved from the loader module table at runtime. */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom']

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  // `exports["./client"]` points at client/client.js, so the bundle lands there
  // directly. The filename must be `client.js`; the served route and the HMR
  // path are both derived from it.
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // Host types ship from lib/types (tsc); a dts pass here would wrap the
  // banner/footer into .d.cts and break parsing.
  dts: false,
  sourcemap: false,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  // tsdown auto-externalizes package dependencies; anything NOT in the loader
  // module table must inline instead.
  noExternal: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
