window.__ModuleLoader__.load({
	id: "dsh-prompt-workbench",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/api.ts
		/**
		* The browser half's carrier: plain `fetch` against the plugin's own routes.
		*
		* `api()` resolves every path against `document.baseURI` rather than the site
		* root, so the plugin keeps working behind a reverse proxy that mounts the
		* harness under a path prefix. (Root-absolute URLs silently 404 there.)
		*/
		/** The plugin's route namespace, matching the host half. */
		const API = "/dsh-prompt-workbench/api";
		/** Resolve a route against the document base. */
		function api(path) {
			const relative = path.replace(/^\/+/, "");
			if (typeof document === "undefined") return `/${relative}`;
			return new URL(relative, document.baseURI).pathname;
		}
		/** Read the host's meta payload. Never throws. */
		async function fetchMeta() {
			try {
				const response = await fetch(api(`${API}/meta`));
				if (!response.ok) return null;
				return await response.json();
			} catch {
				return null;
			}
		}
		/** Begin one rewrite. */
		async function startRun(body) {
			try {
				return await (await fetch(api(`${API}/start`), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				})).json();
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : "network error"
				};
			}
		}
		/** Read the delta since `cursor`. */
		async function pollRun(taskId, cursor) {
			try {
				const query = `id=${encodeURIComponent(taskId)}&cursor=${String(cursor)}`;
				return await (await fetch(api(`${API}/poll?${query}`))).json();
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : "network error"
				};
			}
		}
		/** Abort one live run. */
		async function cancelRun(taskId) {
			try {
				await fetch(api(`${API}/cancel`), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ id: taskId })
				});
			} catch {}
		}
		/** Split text into word/character tokens: latin runs stay whole, CJK splits. */
		function tokenize(text) {
			const tokens = [];
			let buffer = "";
			for (const ch of text) {
				if (/[A-Za-z0-9_@#./\\:-]/.test(ch)) {
					buffer += ch;
					continue;
				}
				if (buffer !== "") {
					tokens.push(buffer);
					buffer = "";
				}
				tokens.push(ch);
			}
			if (buffer !== "") tokens.push(buffer);
			return tokens;
		}
		/**
		* Token-level LCS diff between the original and the rewrite.
		* @returns the merged run list, or `null` when either side exceeds {@link DIFF_TOKEN_LIMIT}.
		*/
		function computeDiff(before, after) {
			const a = tokenize(before);
			const b = tokenize(after);
			if (a.length > 700 || b.length > 700) return null;
			const n = a.length;
			const m = b.length;
			const width = m + 1;
			const table = new Uint16Array((n + 1) * width);
			for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + (j + 1)] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
			const parts = [];
			const push = (kind, text) => {
				const last = parts[parts.length - 1];
				if (last !== void 0 && last.kind === kind) last.text += text;
				else parts.push({
					kind,
					text
				});
			};
			let i = 0;
			let j = 0;
			while (i < n && j < m) {
				if (a[i] === b[j]) {
					push("same", a[i]);
					i += 1;
					j += 1;
					continue;
				}
				if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
					push("del", a[i]);
					i += 1;
				} else {
					push("add", b[j]);
					j += 1;
				}
			}
			while (i < n) {
				push("del", a[i]);
				i += 1;
			}
			while (j < m) {
				push("add", b[j]);
				j += 1;
			}
			return parts;
		}
		/**
		* Strip a code fence that wraps the WHOLE answer, a common model tic.
		* A fence that only wraps part of the answer is left alone.
		*/
		function stripOuterFence(text) {
			const trimmed = text.trim();
			if (trimmed.length < 8 || !trimmed.startsWith("```")) return text;
			const firstBreak = trimmed.indexOf("\n");
			if (firstBreak === -1) return text;
			const lastFence = trimmed.lastIndexOf("```");
			if (lastFence <= firstBreak) return text;
			if (trimmed.slice(lastFence).trim() !== "```") return text;
			return trimmed.slice(firstBreak + 1, lastFence).replace(/\s+$/, "");
		}
		//#endregion
		//#region src/client/store.ts
		/** Create a store over `initial`. */
		function createStore(initial) {
			let state = initial;
			const listeners = /* @__PURE__ */ new Set();
			return {
				get: () => state,
				set: (patch) => {
					let changed = false;
					for (const key of Object.keys(patch)) if (state[key] !== patch[key]) {
						changed = true;
						break;
					}
					if (!changed) return;
					state = {
						...state,
						...patch
					};
					for (const listener of Array.from(listeners)) try {
						listener();
					} catch (error) {
						console.error("[dsh-prompt-workbench] store listener failed", error);
					}
				},
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				}
			};
		}
		/** The plugin's initial state. */
		function initialState() {
			return {
				open: false,
				mode: "refine",
				lang: "auto",
				status: "idle",
				taskId: null,
				source: "",
				output: "",
				cursor: 0,
				error: "",
				note: "",
				provider: "",
				model: "",
				elapsedMs: 0
			};
		}
		//#endregion
		//#region src/client/panel.ts
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
		/** Rewrite modes shown as tabs. `key` is the exact wire value the host accepts. */
		const MODES = [
			{
				key: "refine",
				label: "细化需求",
				hint: "把模糊诉求拆成明确、可执行的具体要求"
			},
			{
				key: "constraints",
				label: "补充约束",
				hint: "补齐边界、非目标、技术约束与验收标准"
			},
			{
				key: "structure",
				label: "结构化重写",
				hint: "重排为 目标 / 要求 / 输出格式 的清晰层级"
			},
			{
				key: "concise",
				label: "精简表达",
				hint: "去除冗余与重复，关键信息零丢失"
			}
		];
		/** Language options for the output. `auto` follows the draft's script. */
		const LANGS = [
			{
				key: "auto",
				label: "自动"
			},
			{
				key: "zh",
				label: "中文"
			},
			{
				key: "en",
				label: "EN"
			}
		];
		/** Poll cadence while a run is live. */
		const POLL_MS = 200;
		/**
		* Mount both surfaces over one shared store and one shared poller.
		* @returns a disposer that removes every registration and stops the poller.
		*/
		function mountWorkbench(slots) {
			const store = createStore(initialState());
			let polling = false;
			let starting = false;
			let metaRequested = false;
			let disposed = false;
			/** Fetch the live model route once, for the read-only chip. */
			const loadMeta = () => {
				if (metaRequested) return;
				metaRequested = true;
				fetchMeta().then((meta) => {
					if (disposed || meta === null || meta.ok !== true) return;
					store.set({
						provider: typeof meta.provider === "string" ? meta.provider : "",
						model: typeof meta.model === "string" ? meta.model : "",
						...meta.available === true ? {} : { error: "llm 服务不可用，无法调用模型" }
					});
				});
			};
			/** One poll tick; a single in-flight request is enough at this cadence. */
			const tick = async () => {
				const snapshot = store.get();
				if (disposed || polling || snapshot.status !== "running" || snapshot.taskId === null) return;
				polling = true;
				const answer = await pollRun(snapshot.taskId, snapshot.cursor);
				polling = false;
				const current = store.get();
				if (disposed || current.taskId !== snapshot.taskId || current.status !== "running") return;
				if (answer.ok !== true) {
					store.set({
						status: "error",
						error: answer.message ?? "增强任务已失效，请重试"
					});
					return;
				}
				const nextOutput = (answer.reset === true ? "" : current.output) + (answer.delta ?? "");
				const elapsedMs = typeof answer.elapsedMs === "number" ? answer.elapsedMs : current.elapsedMs;
				if (answer.status === "running") {
					store.set({
						output: nextOutput,
						cursor: answer.cursor ?? 0,
						elapsedMs
					});
					return;
				}
				if (answer.status === "done") {
					store.set({
						output: stripOuterFence(nextOutput),
						cursor: 0,
						status: "done",
						elapsedMs
					});
					return;
				}
				if (answer.status === "stopped") {
					store.set({
						output: nextOutput,
						cursor: 0,
						status: "idle",
						note: "已停止本次增强",
						elapsedMs
					});
					return;
				}
				store.set({
					output: nextOutput,
					cursor: 0,
					status: "error",
					elapsedMs,
					error: typeof answer.error === "string" && answer.error !== "" ? answer.error : "增强失败，请重试"
				});
			};
			const timer = window.setInterval(() => {
				tick();
			}, POLL_MS);
			/** Kick off one enhancement run over the current draft buffer. */
			const run = async () => {
				const snapshot = store.get();
				if (starting || snapshot.status === "running") return;
				const text = snapshot.source;
				if (typeof text !== "string" || text.trim() === "") {
					store.set({
						error: "请先输入需要增强的提示词",
						note: ""
					});
					return;
				}
				starting = true;
				store.set({
					status: "running",
					output: "",
					cursor: 0,
					error: "",
					note: "",
					elapsedMs: 0,
					taskId: null
				});
				const answer = await startRun({
					text,
					mode: snapshot.mode,
					lang: snapshot.lang
				});
				starting = false;
				if (disposed) return;
				if (answer.ok !== true || typeof answer.taskId !== "string") {
					store.set({
						status: "error",
						error: answer.message ?? "无法启动增强"
					});
					return;
				}
				store.set({ taskId: answer.taskId });
			};
			/** Abandon the current run. */
			const stop = () => {
				const snapshot = store.get();
				if (snapshot.taskId === null) {
					store.set({ status: "idle" });
					return;
				}
				cancelRun(snapshot.taskId);
			};
			/** Subscribe one component to the shared store. Exactly two hooks, always. */
			function useStore() {
				const pair = (0, react.useState)(store.get);
				const snapshot = pair[0];
				const setSnapshot = pair[1];
				(0, react.useEffect)(() => store.subscribe(() => {
					setSnapshot(store.get());
				}), []);
				return snapshot;
			}
			/** The one-click composer pill. */
			function Trigger(props) {
				const state = useStore();
				const useInput = props.useInput;
				const draft = typeof useInput === "function" ? useInput((input) => input.draft) : "";
				const running = state.status === "running";
				const hasText = typeof draft === "string" && draft.trim() !== "";
				const children = [(0, react.createElement)("span", {
					key: "spark",
					className: "dsh-pw-spark"
				}, "✦"), (0, react.createElement)("span", { key: "label" }, running ? "增强中" : "提示词增强")];
				if (running) children.push((0, react.createElement)("span", {
					key: "ring",
					className: "dsh-pw-ring"
				}));
				else if (hasText) children.push((0, react.createElement)("span", {
					key: "dot",
					className: "dsh-pw-dot"
				}));
				return (0, react.createElement)("button", {
					type: "button",
					className: state.open ? "dsh-pw-trigger dsh-pw-trigger-on" : "dsh-pw-trigger",
					title: "提示词增强 · 一键优化与润色",
					"aria-label": "提示词增强",
					"aria-expanded": state.open ? "true" : "false",
					onMouseDown: (event) => {
						event.preventDefault();
					},
					onClick: () => {
						if (state.open) {
							store.set({ open: false });
							return;
						}
						loadMeta();
						store.set({
							open: true,
							error: "",
							note: "",
							source: hasText ? draft : state.source
						});
					}
				}, children);
			}
			/** The floating workbench panel. */
			function Panel(props) {
				const state = useStore();
				const useInput = props.useInput;
				const draft = typeof useInput === "function" ? useInput((input) => input.draft) : "";
				const diffPair = (0, react.useState)(false);
				const diffOn = diffPair[0];
				const setDiffOn = diffPair[1];
				if (!state.open) return null;
				const inputActions = props.inputActions;
				const running = state.status === "running";
				const done = state.status === "done";
				const sourceChars = state.source.length;
				const outputChars = state.output.length;
				const activeMode = MODES.filter((entry) => entry.key === state.mode)[0] ?? MODES[0];
				const headChildren = [(0, react.createElement)("span", {
					key: "title",
					className: "dsh-pw-title"
				}, (0, react.createElement)("span", { className: "dsh-pw-spark" }, "✦"), (0, react.createElement)("span", null, "提示词增强"))];
				if (state.model !== "") headChildren.push((0, react.createElement)("span", {
					key: "chip",
					className: "dsh-pw-chip",
					title: "本次增强使用的模型路由"
				}, `⚙ ${state.model}`));
				headChildren.push((0, react.createElement)("span", {
					key: "spacer",
					className: "dsh-pw-spacer"
				}));
				headChildren.push((0, react.createElement)("button", {
					key: "pull",
					type: "button",
					className: "dsh-pw-iconbtn",
					title: "从输入框重新读取草稿",
					disabled: typeof draft !== "string" || draft.trim() === "" || running,
					onClick: () => {
						store.set({
							source: typeof draft === "string" ? draft : "",
							error: "",
							note: "已读取输入框内容"
						});
					}
				}, "⭯"));
				headChildren.push((0, react.createElement)("button", {
					key: "close",
					type: "button",
					className: "dsh-pw-iconbtn",
					title: "关闭",
					"aria-label": "关闭提示词增强",
					onClick: () => {
						store.set({ open: false });
					}
				}, "✕"));
				const tabs = MODES.map((entry) => (0, react.createElement)("button", {
					key: entry.key,
					type: "button",
					className: entry.key === state.mode ? "dsh-pw-tab dsh-pw-tab-on" : "dsh-pw-tab",
					title: entry.hint,
					"aria-pressed": entry.key === state.mode ? "true" : "false",
					onClick: () => {
						store.set({ mode: entry.key });
					}
				}, entry.label));
				const langSegment = (0, react.createElement)("span", {
					className: "dsh-pw-seg",
					title: "输出语言"
				}, LANGS.map((entry) => (0, react.createElement)("button", {
					key: entry.key,
					type: "button",
					className: entry.key === state.lang ? "dsh-pw-seg-on" : void 0,
					onClick: () => {
						store.set({ lang: entry.key });
					}
				}, entry.label)));
				const bar = (0, react.createElement)("div", { className: "dsh-pw-bar" }, tabs.concat([(0, react.createElement)("span", {
					key: "spacer",
					className: "dsh-pw-spacer"
				}), langSegment]));
				const hint = (0, react.createElement)("div", { className: "dsh-pw-hint" }, activeMode.hint);
				const sourcePane = (0, react.createElement)("section", { className: "dsh-pw-pane" }, (0, react.createElement)("div", { className: "dsh-pw-pane-head" }, (0, react.createElement)("span", null, "原始提示词"), (0, react.createElement)("span", { className: "dsh-pw-count" }, `${String(sourceChars)} 字符`)), (0, react.createElement)("textarea", {
					className: "dsh-pw-input",
					value: state.source,
					placeholder: "粘贴或输入提示词，中英文均可……\n\n也可以点右上角 ⭯ 直接读取输入框里的草稿。",
					spellCheck: false,
					onChange: (event) => {
						store.set({
							source: event.target.value,
							error: "",
							note: ""
						});
					},
					onKeyDown: (event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
							event.preventDefault();
							run();
						}
					}
				}));
				const bodyChildren = [];
				if (state.output === "" && running) bodyChildren.push((0, react.createElement)("span", {
					key: "wait",
					className: "dsh-pw-muted"
				}, "正在思考…"));
				else if (state.output === "") bodyChildren.push((0, react.createElement)("span", {
					key: "idle",
					className: "dsh-pw-muted"
				}, "增强结果会在这里流式出现。"));
				else if (diffOn && done) {
					const parts = computeDiff(state.source, state.output);
					if (parts === null) {
						bodyChildren.push((0, react.createElement)("span", { key: "plain" }, state.output));
						bodyChildren.push((0, react.createElement)("div", {
							key: "cap",
							className: "dsh-pw-muted"
						}, "（文本较长，已跳过逐词差异高亮）"));
					} else for (const [index, part] of parts.entries()) {
						const className = part.kind === "add" ? "dsh-pw-add" : part.kind === "del" ? "dsh-pw-del" : "dsh-pw-same";
						bodyChildren.push((0, react.createElement)("span", {
							key: String(index),
							className
						}, part.text));
					}
				} else bodyChildren.push((0, react.createElement)("span", {
					key: "live",
					className: running ? "dsh-pw-caret" : void 0
				}, state.output));
				const outputPane = (0, react.createElement)("section", { className: "dsh-pw-pane" }, (0, react.createElement)("div", { className: "dsh-pw-pane-head" }, (0, react.createElement)("span", null, done && diffOn ? "差异对比（新增高亮 / 删除划线）" : "增强结果"), (0, react.createElement)("span", { className: "dsh-pw-count" }, `${String(outputChars)} 字符`)), (0, react.createElement)("div", { className: "dsh-pw-body" }, bodyChildren));
				const grid = (0, react.createElement)("div", { className: "dsh-pw-grid" }, [sourcePane, outputPane]);
				const canWrite = inputActions !== void 0 && typeof inputActions.setDraft === "function" && state.output !== "";
				const footChildren = [];
				if (running) footChildren.push((0, react.createElement)("button", {
					key: "stop",
					type: "button",
					className: "dsh-pw-btn",
					onClick: stop
				}, "停止"));
				else footChildren.push((0, react.createElement)("button", {
					key: "run",
					type: "button",
					className: "dsh-pw-btn dsh-pw-btn-primary",
					disabled: state.source.trim() === "",
					onClick: () => {
						run();
					}
				}, done ? "重新增强" : "开始增强"));
				footChildren.push((0, react.createElement)("button", {
					key: "replace",
					type: "button",
					className: "dsh-pw-btn",
					disabled: !canWrite || running,
					title: "用增强结果替换输入框内容",
					onClick: () => {
						inputActions?.setDraft(state.output);
						store.set({
							open: false,
							note: "已替换输入框内容"
						});
					}
				}, "替换输入框"));
				footChildren.push((0, react.createElement)("button", {
					key: "append",
					type: "button",
					className: "dsh-pw-btn",
					disabled: !canWrite || running,
					title: "保留原草稿并追加增强结果",
					onClick: () => {
						const base = typeof draft === "string" ? draft : "";
						inputActions?.setDraft(base.trim() === "" ? state.output : `${base}\n\n${state.output}`);
						store.set({
							open: false,
							note: "已追加到输入框"
						});
					}
				}, "追加"));
				footChildren.push((0, react.createElement)("button", {
					key: "copy",
					type: "button",
					className: "dsh-pw-btn",
					disabled: state.output === "",
					onClick: () => {
						navigator.clipboard.writeText(state.output).then(() => {
							store.set({ note: "已复制到剪贴板" });
						}, () => {
							store.set({ note: "复制失败，请手动选择文本复制" });
						});
					}
				}, "复制"));
				if (done) footChildren.push((0, react.createElement)("button", {
					key: "diff",
					type: "button",
					className: diffOn ? "dsh-pw-btn dsh-pw-btn-primary" : "dsh-pw-btn",
					title: "高亮显示新增与删除的片段",
					onClick: () => {
						setDiffOn(!diffOn);
					}
				}, "差异高亮"));
				const seconds = (state.elapsedMs / 1e3).toFixed(1);
				const statusText = running ? `生成中 · ${seconds}s · ${String(outputChars)} 字符` : done ? `完成 · ${seconds}s · ${String(sourceChars)} → ${String(outputChars)} 字符` : state.model === "" ? "待增强" : `就绪 · ${state.model}`;
				footChildren.push((0, react.createElement)("span", {
					key: "status",
					className: "dsh-pw-status"
				}, statusText));
				const messages = [];
				if (state.error !== "") messages.push((0, react.createElement)("div", {
					key: "err",
					className: "dsh-pw-msg dsh-pw-msg-err"
				}, `⚠ ${state.error}`));
				if (state.note !== "") messages.push((0, react.createElement)("div", {
					key: "note",
					className: "dsh-pw-msg dsh-pw-msg-ok"
				}, `✓ ${state.note}`));
				return (0, react.createElement)("div", {
					className: "dsh-pw-panel",
					"data-dsh-prompt-workbench": "overlay"
				}, [
					(0, react.createElement)("div", {
						key: "head",
						className: "dsh-pw-head"
					}, headChildren),
					(0, react.createElement)("div", { key: "barwrap" }, [bar, hint]),
					grid,
					messages.length === 0 ? null : (0, react.createElement)("div", { key: "msgs" }, messages),
					(0, react.createElement)("div", { key: "foot" }, footChildren)
				]);
			}
			/**
			* These gates carry no hooks, so an absent `useInput` never changes a hook
			* count: the real surface only mounts with a genuine session binding.
			*/
			function TriggerGate(props) {
				if (typeof props.useInput !== "function") return null;
				return (0, react.createElement)(Trigger, props);
			}
			function PanelGate(props) {
				if (typeof props.useInput !== "function") return null;
				return (0, react.createElement)(Panel, props);
			}
			const offLeft = slots.inject("conversation.input.left", () => slots.register({
				name: "conversation.input.left",
				id: "prompt-workbench-trigger",
				order: 20,
				label: "提示词增强"
			}, TriggerGate));
			const offOverlay = slots.inject("conversation.input.overlay", () => slots.register({
				name: "conversation.input.overlay",
				id: "prompt-workbench-panel",
				order: 30,
				label: "提示词增强"
			}, PanelGate));
			return () => {
				disposed = true;
				window.clearInterval(timer);
				if (typeof offOverlay === "function") offOverlay();
				if (typeof offLeft === "function") offLeft();
			};
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* All CSS the plugin owns, as one string.
		*
		* Every colour is a `--dsw-alias-*` theme variable so light and dark both work
		* from the same sheet. Class names are prefixed `dsh-pw-` because this sheet is
		* global once injected.
		*
		* The floating panel anchors against the composer card: the composer exposes a
		* zero-height overlay anchor at its top edge, so `bottom: calc(100% + 10px)`
		* places the panel directly above the composer without clipping it.
		*/
		const WORKBENCH_CSS = `
.dsh-pw-trigger {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 10px; margin: 0;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 1; cursor: pointer;
  transition: background-color .16s ease, color .16s ease, border-color .16s ease, transform .12s ease;
}
.dsh-pw-trigger:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.dsh-pw-trigger:active { transform: scale(.97); }
.dsh-pw-trigger-on {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}
.dsh-pw-spark { font-size: 12px; line-height: 1; }
.dsh-pw-ring {
  width: 10px; height: 10px; border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);
  border-top-color: var(--dsw-alias-brand-primary);
  animation: dsh-pw-spin .7s linear infinite;
}
.dsh-pw-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }

.dsh-pw-panel {
  position: absolute; left: 0; right: 0; bottom: calc(100% + 10px);
  margin: 0 auto; max-width: 880px; box-sizing: border-box;
  max-height: min(76vh, 620px); overflow: auto; z-index: 40;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  box-shadow: 0 22px 52px -14px rgba(0, 0, 0, .3), 0 2px 8px rgba(0, 0, 0, .08);
  color: var(--dsw-alias-label-primary); font-size: 13px; text-align: left;
  animation: dsh-pw-rise .18s cubic-bezier(.2, .8, .3, 1);
}
.dsh-pw-panel-card {
  position: static; inset: auto; margin: 8px 0 2px; max-width: none;
  max-height: 560px; animation: none;
}
.dsh-pw-head {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-pw-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
.dsh-pw-chip {
  font-size: 11px; padding: 2px 8px; border-radius: 6px; max-width: 240px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-pw-spacer { flex: 1 1 auto; }
.dsh-pw-iconbtn {
  width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer;
  transition: background-color .15s ease, color .15s ease;
}
.dsh-pw-iconbtn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-pw-iconbtn:disabled { opacity: .4; cursor: not-allowed; }

.dsh-pw-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 10px 14px 0; }
.dsh-pw-tab {
  height: 26px; padding: 0 11px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer;
  transition: color .15s ease, border-color .15s ease, background-color .15s ease;
}
.dsh-pw-tab:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dsh-pw-tab-on {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsh-pw-seg {
  display: inline-flex; align-items: center; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
}
.dsh-pw-seg > button {
  height: 24px; padding: 0 10px; border: 0; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px;
  transition: background-color .15s ease, color .15s ease;
}
.dsh-pw-seg > button:hover { color: var(--dsw-alias-label-primary); }
.dsh-pw-seg > button.dsh-pw-seg-on {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsh-pw-hint { padding: 7px 14px 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }

.dsh-pw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px 14px 0; }
.dsh-pw-pane {
  display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, transparent);
}
.dsh-pw-pane-head {
  display: flex; align-items: center; gap: 6px; padding: 7px 10px;
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-pw-count { margin-left: auto; font-variant-numeric: tabular-nums; }
.dsh-pw-body {
  height: 190px; min-height: 190px; box-sizing: border-box; overflow: auto;
  padding: 10px 12px; font-size: 12.5px; line-height: 1.62;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.dsh-pw-input {
  width: 100%; height: 190px; min-height: 190px; box-sizing: border-box;
  resize: none; border: 0; outline: 0; background: transparent; color: inherit;
  font: inherit; font-size: 12.5px; line-height: 1.62; padding: 10px 12px;
  overflow-wrap: anywhere;
}
.dsh-pw-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: .7; }
.dsh-pw-muted { color: var(--dsw-alias-label-secondary); }
.dsh-pw-caret::after {
  content: ''; display: inline-block; width: 2px; height: 1em; margin-left: 2px;
  vertical-align: -.12em; background: var(--dsw-alias-brand-primary);
  animation: dsh-pw-blink 1s steps(2, start) infinite;
}
.dsh-pw-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 24%, transparent); border-radius: 3px; }
.dsh-pw-del {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent);
  border-radius: 3px; text-decoration: line-through; opacity: .72;
}

.dsh-pw-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 14px; }
.dsh-pw-btn {
  height: 30px; padding: 0 13px; display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease, opacity .15s ease;
}
.dsh-pw-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.dsh-pw-btn:disabled { opacity: .45; cursor: not-allowed; }
.dsh-pw-btn-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.dsh-pw-btn-primary:hover:not(:disabled) { filter: brightness(1.07); background: var(--dsw-alias-brand-primary); }
.dsh-pw-status { margin-left: auto; font-size: 11.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsh-pw-msg { padding: 0 14px 10px; font-size: 12px; }
.dsh-pw-msg-err { color: var(--dsw-alias-state-error-primary); }
.dsh-pw-msg-ok { color: var(--dsw-alias-state-success-primary); }

@keyframes dsh-pw-spin { to { transform: rotate(360deg); } }
@keyframes dsh-pw-blink { 50% { opacity: 0; } }
@keyframes dsh-pw-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (max-width: 860px) {
  .dsh-pw-grid { grid-template-columns: 1fr; }
  .dsh-pw-body, .dsh-pw-input { height: 150px; min-height: 150px; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-pw-panel, .dsh-pw-ring, .dsh-pw-caret::after { animation: none; }
}
`;
		//#endregion
		//#region src/client/index.ts
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
		/** The module name the profile patch inserts. */
		const name = "dsh-prompt-workbench";
		/** `slots` is the only service the browser half needs. */
		const inject = ["slots"];
		/** Tag id for the stylesheet, so a re-evaluation cannot stack copies. */
		const STYLE_ID = "dsh-prompt-workbench-css";
		/** Teardown of the previous mount. */
		let teardown;
		/** Inject the plugin's stylesheet once per document. */
		function injectStyles() {
			if (document.getElementById(STYLE_ID) !== null) return;
			const tag = document.createElement("style");
			tag.id = STYLE_ID;
			tag.textContent = WORKBENCH_CSS;
			document.head.appendChild(tag);
		}
		/** Mount the workbench surfaces. */
		function apply(ctx) {
			teardown?.();
			teardown = void 0;
			injectStyles();
			const slots = ctx.slots ?? ctx.get("slots");
			if (slots === void 0 || slots === null) return;
			teardown = mountWorkbench(slots);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
