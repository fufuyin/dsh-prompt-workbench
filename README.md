# dsh-prompt-workbench

English | [中文](README.zh.md)

> A prompt rewrite workbench for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — four rewrite modes, streaming output you can stop, and a real before/after diff.

Writing a good prompt is the highest-leverage thing you do in an agent harness, and it is also the thing everyone skips. You type a vague sentence, the agent guesses, and three turns later you are explaining what you actually meant.

`dsh-prompt-workbench` sits above the composer and turns that vague sentence into a prompt an agent can act on — without leaving the box you are already typing in.

It is deliberately **not** just an "enhance" button. Three things make it a workbench rather than a one-shot rewriter:

- **You can see what changed.** The result is diffed against your draft at token level — additions highlighted, deletions struck through. You approve a rewrite you can read, not a rewrite you have to re-read from scratch.
- **It streams, and you can stop it.** Output arrives progressively and the run is cancellable mid-flight, so a long draft never leaves you staring at a frozen composer.
- **It lives where you type**, as a compact pill in the composer tool row plus a floating panel above the composer — not in a separate window you have to go find.

> [!WARNING]
> Installing a plugin runs third-party code inside your harness, with your own permissions. This plugin sends the draft you put in its panel to the model route your session already uses, and only that draft — the analysis itself runs locally in the browser and makes no request. A public repository is not a security review: read the source before you install.

## Contents

- [Install](#install)
- [Features](#features)
- [Usage](#usage)
  - [Modes](#modes)
- [Configuration](#configuration)
  - [Limits](#limits)
- [Architecture](#architecture)
- [Status](#status)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

## Install

```sh
dsh plugin --profile web add github:fufuyin/dsh-prompt-workbench
```

Then restart the profile and reload the web GUI. Most plugins go live after a page refresh; if the pill does not appear in the composer tool row, restart the profile.

Install from a local checkout while developing:

```sh
git clone https://github.com/fufuyin/dsh-prompt-workbench.git
cd dsh-prompt-workbench
npm install
npm run build
dsh plugin --profile web add .
```

## Features

- **Prompt analysis** — six dimensions (goal / context / constraints / output / acceptance / examples) scored locally, with an actionability meter and per-dimension evidence.
- **Restructuring advice** — ordered, severity-ranked suggestions that name the gap *and* hand you a ready-to-insert section skeleton.
- **Formatted output** — the rewrite is rendered by structure (headings, lists, code), plus a **structure coverage** view showing which skeleton sections the result actually filled.
- **Four rewrite modes** — 细化需求 (refine), 补充约束 (constraints), 结构化重写 (structure), 精简表达 (concise).
- **Targeted, not generic** — the analysis is fed to the model as an explicit gap list, so the rewrite closes *this* draft's holes instead of applying one boilerplate treatment to everything.
- **Bilingual by design** — Chinese and English drafts both work, and `自动` mode detects the draft's script and answers in kind.
- **Token-level diff** — LCS diff with additions highlighted and deletions struck through; degrades to plain text past its token cap instead of freezing.
- **Streaming + cancel + timeout** — incremental delivery with a live character counter; stop a run at any point, and a hung stream is aborted after 180 s with a distinguishable error.
- **Two surfaces, one state** — a composer tool-row pill and a floating panel above the composer, both reading one store, so they never disagree.
- **Theme-native** — every colour is a `--dsw-alias-*` variable; light and dark both work, and `prefers-reduced-motion` is respected.
- **Prompt hygiene** — preserves `@path` references, `{variables}`, `<slots>`, TODOs, URLs and fenced code blocks verbatim, and never answers the prompt it is rewriting.
- **Self-diagnosis** — a `◎` button (and `GET /api/diag`) reports how the host sees the plugin's browser half, which is the one question a broken UI cannot answer about itself.

## Usage

1. Type or paste a draft into the composer. Anything from one sentence to a multi-paragraph brief works.
2. Click **✦ 提示词增强** in the composer tool row. A panel opens above the composer with your draft already in the left pane. You can also paste straight into the left pane, or hit `⭯` to pull the current composer draft in.
3. Read the analysis strip while you type. It scores actionability, shows which of the six dimensions the draft covers (with evidence on hover), and counts the vague phrases and unresolved placeholders it found. This is local and instant: it costs nothing and never leaves your machine.
4. Work the advice list. Each suggestion names a gap and, where it makes sense, offers **插入** to drop a matching section skeleton straight into the draft.
5. Pick a mode and, if you want to force it, an output language.
6. Hit **开始增强** (or `Ctrl/Cmd + Enter`). The right pane streams the rewrite, rendered by structure. The analysis above is handed to the model as an explicit gap list, so the rewrite targets this draft rather than a generic template.
7. Switch the right pane between **结果** (formatted rewrite), **差异** (token-level diff: additions highlighted, deletions struck through) and **结构** (which skeleton sections the result actually covers).
8. **替换输入框** writes the rewrite back into the composer, **追加** keeps both, and **复制** puts it on the clipboard.

If anything looks wrong, press **◎** in the panel header for a host-side self-diagnosis, or open `/dsh-prompt-workbench/api/diag` directly.

### Modes

- **细化需求** refine — turns a vague wish into concrete, checkable requirements: the real goal, the expected outcome, the deliverables.
- **补充约束** constraints — makes the implicit boundaries explicit: in scope, out of scope, platform limits, style rules, non-goals, acceptance criteria.
- **结构化重写** structure — reorganizes the whole prompt into a scannable hierarchy (目标 / 背景 / 输入 / 具体要求 / 输出格式 / 验收标准) without changing content.
- **精简表达** concise — removes filler, hedging and repetition, merging overlaps while keeping every distinct fact.

## Configuration

Open **⚙** in the panel header. These are the plugin's own preferences. They are stored per browser profile in `localStorage` under a versioned key, so a corrupted or blocked store degrades to defaults instead of breaking the panel.

- **实时分析** — default on. Run the local analysis while typing (debounced, free, offline).
- **显示重构建议** — default on. Show the advice list.
- **生成时自动滚动到最新内容** — default on. Follow the stream without fighting a manual scroll.
- **默认模式** — default 细化需求. Which mode the panel opens on.
- **默认结果视图** — default 增强结果. One of 结果 / 差异 / 结构.

The plugin deliberately has **no durable server-side settings**: it changes nothing about how the host runs, so it needs no settings schema and no write access to your config. It follows your session's default model route — change the model in the composer's model selector, and the next rewrite uses it. The active route is shown as a read-only chip in the panel header.

### Limits

Deliberate limits, all enforced host-side:

- **Draft length** — 24,000 characters. Past it: refused with an explicit message, never silently truncated.
- **Live diff size** — 700 tokens per side. Past it: the diff view degrades to plain text with a note.
- **Concurrent runs** — 8 tracked tasks. Finished tasks are reaped first.
- **Single model call** — 180 s wall clock. Past it: aborted with a "timed out" error, distinct from a user stop.

## Architecture

An `everything-is-a-plugin` harness means this is two halves and a patch layer:

```
cordis.patch.yml        the profile patch that installs the plugin
src/analyze.ts          SHARED — parsing, dimensions, advice, outline (pure)
src/index.ts            HOST   — plugin entry; registers the plugin's HTTP routes
src/runs.ts             HOST   — the run table and the one model call per run
src/prompt.ts           HOST   — modes + system instruction (pure)
src/http.ts             HOST   — JSON / same-origin / body helpers
src/client/index.ts     CLIENT — inject declaration, style injection, mounting
src/client/panel.ts     CLIENT — the two composer surfaces
src/client/api.ts       CLIENT — the fetch carrier
src/client/prefs.ts     CLIENT — versioned localStorage preferences
src/client/store.ts     CLIENT — the one store they share
src/client/diff.ts      CLIENT — token-level LCS diff
src/client/styles.ts    CLIENT — the whole stylesheet, as one string
scripts/preflight.mjs   the post-build assertions `prepack` runs
tests/                  unit tests for every pure module
```

`src/analyze.ts` is the interesting one: it is pure, and both halves import it. The browser runs it on every keystroke (debounced) so advice is instant, free and offline; the host runs it once per rewrite and hands the resulting gap list to the model. One implementation, two consumers, and a test suite that asserts on it directly.

The host half owns the model call and the run table; the browser half polls it on a fixed cadence and only ever receives the delta since its last cursor, so a long rewrite costs a bounded amount of traffic rather than re-sending the whole buffer.

<details>
<summary><b>How the two halves talk</b></summary>

Through the plugin's own HTTP routes on `ctx.webServer.register()`, not through `@Remote` / `ctx.remote`. That is not a stylistic choice: the host gateway does discover `@Remote` markers from a third-party package, but the client's `$mount` path rejects any descriptor that is not a *generated strict codec*, and the assembly that mounts remote namespaces is a closed in-tree list. Shipping generated codecs would require the harness's own codegen toolchain.

Because plugin-owned routes are **not** covered by the connection's Host/Origin checks, the two mutating routes gate themselves with a same-origin check. The polling route deliberately does not: browsers omit `Origin` on same-origin GET, so enforcing it there would reject the plugin's own traffic.

`GET /api/diag` reports how the host sees this plugin's browser half, plus a bounded ring of the most recent requests (method, path, status, duration, raw origin headers, and the verdict drawn from them). Plugin routes are invisible in the session log, so this is the only surface that can report a browser-side failure.

</details>

## Status

Targets the DeepSeek Harness **developer preview**. The harness itself ships compatibility-breaking changes, so pin the version you build against.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the development setup, the project layout, the ground rules, and how to report a bug.

## License

[MIT](LICENSE) © 2026 fufuyin

## Disclaimer

This is a community plugin and is not affiliated with DeepSeek. It is provided as-is, with no warranty. Installing it runs third-party code inside your harness with your own permissions, so review the source first and install at your own risk.
