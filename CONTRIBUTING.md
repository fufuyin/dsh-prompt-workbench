# Contributing

Thanks for taking the time to look at this. Issues and pull requests are both
welcome.

## Reporting a bug

A useful report contains:

- what you did, step by step
- what you expected to happen
- what actually happened, with the exact error text
- your DSH version and the model route you had selected

Please do not paste API keys or full request logs. Redact credentials.

## Development setup

```sh
git clone https://github.com/<owner>/dsh-prompt-workbench.git
cd dsh-prompt-workbench
npm install
npm run build      # tsc for the host half, tsdown for the client bundle
npm run typecheck
npm test           # vitest over every pure module
```

To try your build in a live harness, install the local checkout into a DSH
profile instead of the published package:

```sh
dsh plugin --profile web add .
```

Then restart the profile and reload the web GUI.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/analyze.ts` | **Shared (pure)**: parsing, dimension detection, advice, outline templates. Imported by both halves. |
| `src/index.ts` | Host entry: declares `inject` and registers the plugin's HTTP routes (including `/diag`). |
| `src/runs.ts` | Host: the bounded run table, the one `llm.stream` call per run, and the wall-clock guard. |
| `src/prompt.ts` | Host: rewrite modes and the system instruction builder. Pure functions, no I/O. |
| `src/http.ts` | Host: JSON / same-origin / body-size helpers for the routes. |
| `src/client/index.ts` | Client entry: inject declaration, style injection, mounting. |
| `src/client/panel.ts` | Client: the two composer surfaces, the analysis strip, the advice list, and the shared poller. |
| `src/client/api.ts` | Client: the `fetch` carrier against the host routes. |
| `src/client/prefs.ts` | Client: versioned `localStorage` preferences with defensive reads. |
| `src/client/store.ts` | Client: the tiny observable store both surfaces share. |
| `src/client/diff.ts` | Client: token-level diff used by the comparison view. |
| `src/client/styles.ts` | Client: the whole stylesheet, injected as one tagged `<style>`. |
| `cordis.patch.yml` | The profile patch layer that installs this plugin. |
| `scripts/preflight.mjs` | Post-build assertions, wired to `prepack`. |
| `tests/` | Vitest suites for every pure module. |

## Ground rules

- **Do not change the rewrite modes' observable behaviour without saying so in
  the pull request.** The mode set and the "output only the improved prompt"
  contract are the point of the plugin.
- **Keep the two surfaces in sync.** They read one store; do not give either of
  them private state.
- **Long input must stay safe.** Any change to the streaming path has to keep
  working on a 20k-character draft without blocking the UI. The diff view
  degrades past its token cap on purpose — do not remove that guard.
- **Use theme CSS variables**, never literal colours, or the plugin breaks in
  the other colour scheme.
- **No new runtime dependency without a reason.** The plugin should stay
  installable from GitHub source with no build step on the user's machine.

## Commit messages

Conventional-commit-ish is welcome but not enforced. A one-line summary in the
imperative mood plus a short body explaining *why* is plenty.

## Licence

By contributing you agree your contribution is licensed under the MIT licence
in [LICENSE](LICENSE).
