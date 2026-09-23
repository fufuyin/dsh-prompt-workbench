# dsh-prompt-workbench

**A prompt rewrite workbench for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — four rewrite modes, streaming output you can stop, and a real before/after diff.**

一个给 DeepSeek Harness（dsh）用的提示词重写工作台：四种增强模式、可中断的流式输出、以及真正的增强前后逐词差异对比。

---

## Why this exists / 为什么需要它

Writing a good prompt is the highest-leverage thing you do in an agent harness, and
it is also the thing everyone skips. You type a vague sentence, the agent guesses,
and three turns later you are explaining what you actually meant.

`dsh-prompt-workbench` sits above the composer and turns that vague sentence into a
prompt an agent can act on — without leaving the box you are already typing in.

It is deliberately **not** just an "enhance" button. Three things make it a
workbench rather than a one-shot rewriter:

1. **You can see what changed.** The result is diffed against your draft at token
   level — additions highlighted, deletions struck through. You approve a rewrite
   you can read, not a rewrite you have to re-read from scratch.
2. **It streams, and you can stop it.** Output arrives progressively and the run is
   cancellable mid-flight, so a long draft never leaves you staring at a frozen
   composer.
3. **It lives where you type**, as a compact pill in the composer tool row plus a
   floating panel above the composer — not in a separate window you have to go find.

## Features

| | |
| --- | --- |
| **Prompt analysis** | Six dimensions (goal / context / constraints / output / acceptance / examples) scored locally, with an actionability meter and per-dimension evidence |
| **Restructuring advice** | Ordered, severity-ranked suggestions that name the gap *and* hand you a ready-to-insert section skeleton |
| **Formatted output** | The rewrite is rendered by structure — headings, lists, code — plus a **structure coverage** view showing which skeleton sections the result actually filled |
| **Four rewrite modes** | 细化需求 (refine) · 补充约束 (constraints) · 结构化重写 (structure) · 精简表达 (concise) |
| **Targeted, not generic** | The analysis is fed to the model as an explicit gap list, so the rewrite closes *this* draft's holes instead of applying one boilerplate treatment to everything |
| **Bilingual by design** | Chinese and English drafts both work; `自动` mode detects the draft's script and answers in kind |
| **Token-level diff** | LCS diff with additions highlighted and deletions struck through; degrades to plain text past its token cap instead of freezing |
| **Streaming + cancel + timeout** | Incremental delivery with a live character counter; stop a run at any point, and a hung stream is aborted after 180 s with a distinguishable error |
| **Two surfaces, one state** | Composer tool-row pill and a floating panel above the composer — both reading one store, so they never disagree |
| **Theme-native** | Every colour is a `--dsw-alias-*` variable; light and dark both work, and `prefers-reduced-motion` is respected |
| **Prompt hygiene** | Preserves `@path` references, `{variables}`, `<slots>`, TODOs, URLs and fenced code blocks verbatim; never answers the prompt it is rewriting |
| **Self-diagnosis** | A `◎` button (and `GET /api/diag`) reports how the host sees the plugin's browser half — the one question a broken UI cannot answer about itself |

## Install

```sh
dsh plugin --profile web add github:fufuyin/dsh-prompt-workbench
```

Then restart the profile and reload the web GUI. Most plugins go live after a page
refresh; if the pill does not appear in the composer tool row, restart the profile.

Install from a local checkout while developing:

```sh
git clone https://github.com/fufuyin/dsh-prompt-workbench.git
cd dsh-prompt-workbench
npm install
npm run build
dsh plugin --profile web add .
```

## Usage

1. Type or paste a draft into the composer. Anything from one sentence to a
   multi-paragraph brief works.
2. Click **✦ 提示词增强** in the composer tool row. A panel opens above the composer
   with your draft already in the left pane. (You can also paste straight into the
   left pane, or hit `⭯` to pull the current composer draft in.)
3. **Read the analysis strip while you type.** It scores actionability, shows which
   of the six dimensions the draft covers (with evidence on hover), and counts the
   vague phrases and unresolved placeholders it found. This is local and instant —
   it costs nothing and never leaves your machine.
4. **Work the advice list.** Each suggestion names a gap and, where it makes sense,
   offers **插入** to drop a matching section skeleton straight into the draft.
5. Pick a mode and, if you want to force it, an output language.
6. Hit **开始增强** (or `Ctrl/Cmd + Enter`). The right pane streams the rewrite,
   rendered by structure. The analysis above is handed to the model as an explicit
   gap list, so the rewrite targets this draft rather than a generic template.
7. Switch the right pane between **结果** (formatted rewrite), **差异** (token-level
   diff: additions highlighted, deletions struck through) and **结构** (which
   skeleton sections the result actually covers).
8. **替换输入框** to write the rewrite back into the composer, or **追加** to keep both.
   **复制** puts it on the clipboard.

If anything looks wrong, press **◎** in the panel header for a host-side
self-diagnosis, or open `/dsh-prompt-workbench/api/diag` directly.

### Modes

| Mode | What it does |
| --- | --- |
| **细化需求** refine | Turns a vague wish into concrete, checkable requirements: the real goal, the expected outcome, the deliverables. |
| **补充约束** constraints | Makes the implicit boundaries explicit — in scope / out of scope, platform limits, style rules, non-goals, acceptance criteria. |
| **结构化重写** structure | Reorganizes the whole prompt into a scannable hierarchy (目标 / 背景 / 输入 / 具体要求 / 输出格式 / 验收标准) without changing content. |
| **精简表达** concise | Removes filler, hedging and repetition, merging overlaps while keeping every distinct fact. |

## Configuration

Open **⚙** in the panel header. These are the plugin's own preferences; they are
stored per browser profile in `localStorage` under a versioned key, so a corrupted
or blocked store degrades to defaults instead of breaking the panel.

| Preference | Default | Effect |
| --- | --- | --- |
| 实时分析 | on | Run the local analysis while typing (debounced, free, offline) |
| 显示重构建议 | on | Show the advice list |
| 生成时自动滚动到最新内容 | on | Follow the stream without fighting a manual scroll |
| 默认模式 | 细化需求 | Which mode the panel opens on |
| 默认结果视图 | 增强结果 | 结果 / 差异 / 结构 |

The plugin deliberately has **no durable server-side settings**: it changes nothing
about how the host runs, so it needs no settings schema and no write access to your
config. It follows your session's default model route — change the model in the
composer's model selector and the next rewrite uses it. The active route is shown
as a read-only chip in the panel header.

Deliberate limits, all enforced host-side:

| Limit | Value | Behaviour past it |
| --- | --- | --- |
| Draft length | 24,000 characters | Refused with an explicit message; no silent truncation |
| Live diff size | 700 tokens per side | Diff view degrades to plain text with a note |
| Concurrent runs | 8 tracked tasks | Finished tasks are reaped first |
| Single model call | 180 s wall clock | Aborted with a "timed out" error, distinct from a user stop |

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

`src/analyze.ts` is the interesting one: it is **pure**, and *both* halves import
it. The browser runs it on every keystroke (debounced) so advice is instant, free
and offline; the host runs it once per rewrite and hands the resulting gap list to
the model. One implementation, two consumers, and a test suite that asserts on it
directly.

The host half owns the model call and the run table; the browser half polls it on
a fixed cadence and only ever receives the delta since its last cursor, so a long
rewrite costs a bounded amount of traffic rather than re-sending the whole buffer.

### How the two halves talk

Through the plugin's own HTTP routes on `ctx.webServer.register()`, not through
`@Remote` / `ctx.remote`. That is not a stylistic choice: the host gateway does
discover `@Remote` markers from a third-party package, but the client's `$mount`
path rejects any descriptor that is not a *generated strict codec*, and the
assembly that mounts remote namespaces is a closed in-tree list. Shipping
generated codecs would require the harness's own codegen toolchain.

Because plugin-owned routes are **not** covered by the connection's Host/Origin
checks, the two mutating routes gate themselves with a same-origin check. The
polling route deliberately does not — browsers omit `Origin` on same-origin GET,
so enforcing it there would reject the plugin's own traffic.

## Status

Targets the DeepSeek Harness **developer preview**. The harness itself ships
compatibility-breaking changes, so pin the version you build against.

## License

[MIT](LICENSE) © 2026 fufuyin

---

## 中文说明

**这是一个给 DeepSeek Harness 用的提示词重写工作台。**

### 它解决什么

在 agent harness 里，写好提示词是收益最高、也最容易被跳过的一步。你打一句模糊的话，
agent 只能猜，三轮之后你才开始解释自己到底想要什么。

这个插件就停在输入框上方，把那句模糊的话变成 agent 能准确执行的任务说明——不用离开你
正在打字的那个框。

它**刻意不只是一个「增强」按钮**，有三点让它更像个工作台：

1. **你看得见改了什么。** 结果会与你的草稿做**逐词差异对比**：新增高亮、删除划线。
   你审的是一份读得懂的改写，而不是一份得从头再读一遍的改写。
2. **流式输出，且能中途停。** 长草稿不会让你对着卡死的输入框干等。
3. **它就待在你打字的地方**——输入框工具行里的胶囊按钮，加上浮在输入框上方的面板，
   而不是另开一个窗口让你去找。

### 四种模式

| 模式 | 作用 |
| --- | --- |
| **细化需求** | 把模糊诉求拆成明确、可执行、可验收的具体要求 |
| **补充约束** | 补齐边界、非目标、技术/风格约束与验收标准 |
| **结构化重写** | 重排为 目标 / 背景 / 输入 / 具体要求 / 输出格式 / 验收标准 的清晰层级 |
| **精简表达** | 去冗余与重复，合并重叠表述，关键信息零丢失 |

### 安装

```sh
dsh plugin --profile web add github:fufuyin/dsh-prompt-workbench
```

装完重启 profile 并刷新 Web GUI。若输入框工具行没出现胶囊按钮，重启 profile。

### 使用

在输入框打好草稿 → 点工具行的 **✦ 提示词增强** → 选模式 → `开始增强`（或 `Ctrl/Cmd + ↵`）
→ 右栏流式出结果 → 点 `差异高亮` 看逐词改动 → `替换输入框` 写回。

### 配置

没有设置页，也没有配置文件。插件跟随你当前会话的**默认模型路由**——在输入框的模型选择器
里换模型，下一次增强就用新模型。面板标题栏会显示当前路由。

### 三条硬限制（全部在 Host 侧强制）

| 限制 | 阈值 | 超限行为 |
| --- | --- | --- |
| 草稿长度 | 24,000 字符 | 明确报错，**不静默截断** |
| 差异对比规模 | 每侧 700 token | 降级为纯文本并注明原因，避免卡住界面 |
| 并发任务 | 8 条 | 优先回收已完成任务 |

### 许可证

[MIT](LICENSE) © 2026 fufuyin
