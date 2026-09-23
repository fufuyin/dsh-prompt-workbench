window.__ModuleLoader__.load({
	id: "dsh-prompt-workbench",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/analyze.ts
		/** Evidence patterns per dimension. Bilingual on purpose. */
		const DIMENSION_PATTERNS = {
			goal: [/目标|目的|想要|希望|需要|帮我|帮忙|实现|做一?[个款份]|写一?[个份]|搭建|开发|编写|生成|创建一个?|设计一个?|加一个?/, /\b(goal|objective|i want|i need|implement|build|create|develop|write|add)\b/i],
			context: [/背景|现状|前提|目前|已有|现有|当前|基于|技术栈|环境/, /\b(context|background|currently|existing|already|based on|stack|environment)\b/i],
			constraints: [/约束|限制|不要|不得|禁止|必须|务必|只能|不允许|兼容|性能|不能/, /\b(constraint|limit|must|must not|should not|only|forbid|compatib|performance|cannot)\b/i],
			output: [/输出|返回|格式|以.{0,6}形式|表格|列表|代码块|文件结构/, /\b(output|format|return|as (?:a|an|json|markdown)|table|bullet)\b/i],
			acceptance: [/验收|完成标准|完成定义|判定标准|测试通过|满足以下|自检/, /\b(acceptance|definition of done|criteria|test|verify|pass(?:es)?)\b/i],
			examples: [/例如|举例|示例|比如|参考(?:样例|示例)/, /\b(for example|for instance|e\.g\.|such as|sample|example)\b/i]
		};
		/** Dimension labels, in report order. */
		const DIMENSION_LABELS = {
			goal: "目标",
			context: "背景",
			constraints: "约束",
			output: "输出格式",
			acceptance: "验收标准",
			examples: "示例"
		};
		/** Report order: the order an agent reads a brief in. */
		const DIMENSION_ORDER = [
			"goal",
			"context",
			"constraints",
			"output",
			"acceptance",
			"examples"
		];
		/**
		* Phrases that push work back onto the reader. Kept separate per script so the
		* explanation in the UI can say which one fired.
		*/
		const VAGUE_ZH = [
			"一些",
			"若干",
			"尽量",
			"最好",
			"适当",
			"等等",
			"之类",
			"相关的",
			"合理的",
			"优化一下",
			"差不多",
			"看情况",
			"随便",
			"更好",
			"稍微",
			"大概",
			"可能"
		];
		const VAGUE_EN = [
			"some",
			"a few",
			"several",
			"as appropriate",
			"if possible",
			"reasonable",
			"optimize",
			"nicely",
			"better",
			"etc",
			"and so on",
			"maybe",
			"roughly",
			"somehow"
		];
		/** Placeholder markers that mean the brief is unfinished. */
		const PLACEHOLDER_PATTERNS = [
			/\bTODO\b/gi,
			/\bTBD\b/gi,
			/\bFIXME\b/gi,
			/\bXXX\b/g,
			/\?\?\?/g,
			/待定/g,
			/待补/g,
			/占位/g
		];
		/** Vague-phrase suggestion snippets, keyed by the phrase that triggered them. */
		function vagueDetail(phrase) {
			return `“${phrase}”把决定权留给了执行者。换成可判定的具体值或范围。`;
		}
		/** Count fenced code blocks (``` pairs), tolerant of an unterminated trailing fence. */
		function countCodeBlocks(text) {
			const fences = text.match(/^[ \t]*```/gm);
			return fences === null ? 0 : Math.floor(fences.length / 2) + fences.length % 2;
		}
		/** Count `@reference` tokens (file/session references the author pinned). */
		function countReferences(text) {
			const matches = text.match(/(^|\s)@[\w./\\-]+/g);
			return matches === null ? 0 : matches.length;
		}
		/** Detect the draft's dominant script. */
		function detectLanguage(text) {
			const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
			const latin = (text.match(/[A-Za-z]/g) ?? []).length;
			if (cjk === 0 && latin === 0) return "en";
			if (cjk === 0) return "en";
			if (latin < cjk * .2) return "zh";
			if (cjk < latin * .2) return "en";
			return "mixed";
		}
		/** Find the first matching fragment for a dimension, for display as evidence. */
		function findEvidence(text, patterns) {
			for (const line of text.split(/\r?\n/)) for (const pattern of patterns) if (pattern.test(line)) {
				const trimmed = line.trim();
				return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
			}
		}
		/** Collect the vague phrases present, in first-appearance order. */
		function collectVagueness(text) {
			const found = [];
			const lower = text.toLowerCase();
			for (const phrase of VAGUE_ZH) {
				const at = text.indexOf(phrase);
				if (at !== -1) found.push({
					phrase,
					at
				});
			}
			for (const phrase of VAGUE_EN) {
				const match = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).exec(lower);
				if (match !== null) found.push({
					phrase,
					at: match.index
				});
			}
			return found.sort((a, b) => a.at - b.at).map((entry) => entry.phrase);
		}
		/** Collect unresolved placeholders, deduplicated, uppercased for latin markers. */
		function collectPlaceholders(text) {
			const seen = /* @__PURE__ */ new Set();
			for (const pattern of PLACEHOLDER_PATTERNS) {
				const matches = text.match(pattern);
				if (matches === null) continue;
				for (const match of matches) {
					const normalized = /^[a-z]/i.test(match) ? match.toUpperCase() : match;
					seen.add(normalized);
				}
			}
			return [...seen];
		}
		/**
		* The recommended section skeleton for a mode. `concise` has no skeleton on
		* purpose — compression must not add structure the author did not ask for.
		*/
		function outlineFor(mode) {
			if (mode === "concise") return [];
			if (mode === "constraints") return [
				{
					id: "scope",
					heading: "范围",
					hint: "这次要做什么，做到哪为止"
				},
				{
					id: "non-goals",
					heading: "非目标",
					hint: "明确不做什么，防止范围蔓延"
				},
				{
					id: "constraints",
					heading: "技术约束",
					hint: "平台、版本、依赖、风格、兼容性"
				},
				{
					id: "acceptance",
					heading: "验收标准",
					hint: "怎样算做完，如何验证"
				}
			];
			if (mode === "refine") return [
				{
					id: "goal",
					heading: "目标",
					hint: "一句话说清最终要达成什么"
				},
				{
					id: "requirements",
					heading: "具体要求",
					hint: "拆成可逐条核对的要求"
				},
				{
					id: "deliverable",
					heading: "交付物",
					hint: "要产出什么，放在哪里"
				}
			];
			return [
				{
					id: "goal",
					heading: "目标",
					hint: "一句话说清最终要达成什么"
				},
				{
					id: "context",
					heading: "背景",
					hint: "现状、已有条件、约束前提"
				},
				{
					id: "requirements",
					heading: "具体要求",
					hint: "拆成可逐条核对的要求"
				},
				{
					id: "output",
					heading: "输出格式",
					hint: "交付形态：文件、代码块、表格…"
				},
				{
					id: "acceptance",
					heading: "验收标准",
					hint: "怎样算做完，如何验证"
				}
			];
		}
		/**
		* Turn the analysis into ordered, actionable advice.
		*
		* Severity policy: a missing goal blocks everything (high); missing
		* constraints/acceptance cause rework (high/medium); vagueness and placeholders
		* cause guessing (medium); missing examples is a nice-to-have (low).
		*/
		function buildSuggestions(input) {
			const suggestions = [];
			const missing = new Set(input.dimensions.filter((dimension) => !dimension.present).map((dimension) => dimension.id));
			const structural = input.mode !== "concise";
			if (missing.has("goal")) suggestions.push({
				id: "add-goal",
				severity: "high",
				title: "补一句明确的目标",
				detail: "没有目标时，执行者只能猜你想要什么，第一步就会偏。用一句话写清最终要达成什么。",
				snippet: "## 目标\n<!-- 一句话说清最终要达成什么 -->\n"
			});
			if (missing.has("acceptance")) suggestions.push({
				id: "add-acceptance",
				severity: "high",
				title: "补上验收标准",
				detail: "没有验收标准就无法判断\"做完了\"，返工往往发生在这里。列出可逐条核对的判定条件。",
				snippet: "## 验收标准\n- [ ] <!-- 条件一 -->\n- [ ] <!-- 条件二 -->\n"
			});
			if (structural && missing.has("constraints")) suggestions.push({
				id: "add-constraints",
				severity: "medium",
				title: "补上约束与非目标",
				detail: "约束决定方案边界。至少写明平台/版本/依赖限制，以及明确不做什么。",
				snippet: "## 约束\n- 技术栈：\n- 版本/平台：\n\n## 非目标\n- <!-- 明确不做的事 -->\n"
			});
			if (structural && missing.has("output")) suggestions.push({
				id: "add-output",
				severity: "medium",
				title: "指定输出格式",
				detail: "写清交付形态（文件路径、代码块、表格…），能显著减少来回确认。",
				snippet: "## 输出格式\n<!-- 例：单个 HTML 文件；或 Markdown 表格；或完整文件树 -->\n"
			});
			if (structural && missing.has("context")) suggestions.push({
				id: "add-context",
				severity: "low",
				title: "补一点背景",
				detail: "现状、已有代码、运行环境等前提，能让执行者少问一轮。",
				snippet: "## 背景\n<!-- 现状、已有条件、相关文件 @路径 -->\n"
			});
			if (structural && missing.has("examples")) suggestions.push({
				id: "add-examples",
				severity: "low",
				title: "可选：给一个示例",
				detail: "一个输入/输出示例能消除歧义，尤其是格式类要求。"
			});
			for (const phrase of input.vagueness.slice(0, 5)) suggestions.push({
				id: `vague-${phrase}`,
				severity: "medium",
				title: `替换模糊词「${phrase}」`,
				detail: vagueDetail(phrase)
			});
			if (input.placeholders.length > 0) suggestions.push({
				id: "resolve-placeholders",
				severity: "medium",
				title: `解决未填占位符（${input.placeholders.join("、")}）`,
				detail: "占位符会被原样带进执行，等于把决定权交出去。要么填上，要么删掉。"
			});
			if (input.chars > 0 && input.chars < 30) suggestions.push({
				id: "too-short",
				severity: "high",
				title: "草稿过短",
				detail: "不到 30 字符通常不足以表达一个可执行任务。用下面的结构骨架把关键信息补齐。",
				...input.outline.length === 0 ? {} : { snippet: input.outline.map((section) => `## ${section.heading}\n<!-- ${section.hint} -->\n`).join("\n") }
			});
			const order = {
				high: 0,
				medium: 1,
				low: 2
			};
			return suggestions.sort((a, b) => order[a.severity] - order[b.severity]);
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
		function analyzePrompt(text, mode) {
			const dimensions = DIMENSION_ORDER.map((id) => {
				const evidence = findEvidence(text, DIMENSION_PATTERNS[id]);
				return evidence === void 0 ? {
					id,
					label: DIMENSION_LABELS[id],
					present: false
				} : {
					id,
					label: DIMENSION_LABELS[id],
					present: true,
					evidence
				};
			});
			const present = dimensions.filter((dimension) => dimension.present).length;
			const coverage = dimensions.length === 0 ? 0 : present / dimensions.length;
			const vagueness = collectVagueness(text);
			const placeholders = collectPlaceholders(text);
			const outline = outlineFor(mode);
			const chars = text.length;
			let score = Math.round(coverage * 100);
			score -= Math.min(vagueness.length, 5) * 6;
			score -= Math.min(placeholders.length, 3) * 8;
			if (chars > 0 && chars < 30) score -= 20;
			if (chars === 0) score = 0;
			score = Math.max(0, Math.min(100, score));
			return {
				chars,
				lines: text === "" ? 0 : text.split(/\r?\n/).length,
				language: detectLanguage(text),
				dimensions,
				coverage,
				vagueness,
				placeholders,
				codeBlocks: countCodeBlocks(text),
				references: countReferences(text),
				score,
				suggestions: buildSuggestions({
					dimensions,
					vagueness,
					placeholders,
					chars,
					mode,
					outline
				}),
				outline
			};
		}
		//#endregion
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
		/**
		* Ask the host how it sees this plugin's browser half.
		*
		* This exists because the browser half can fail invisibly: if its module never
		* reaches the boot graph, nothing renders and nothing reports. `/diag` is
		* reachable from the working host half, so it is the one surface that can still
		* answer when the UI cannot.
		*/
		async function fetchDiag() {
			try {
				const response = await fetch(api(`${API}/diag`));
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
		//#region src/client/prefs.ts
		/** Storage key, versioned so a future shape change cannot be misread. */
		const STORAGE_KEY = "dsh-prompt-workbench/prefs/v1";
		/** Defaults, also the recovery target for any read failure. */
		const DEFAULT_PREFERENCES = {
			defaultMode: "refine",
			defaultLang: "auto",
			liveAnalysis: true,
			defaultView: "result",
			autoScroll: true,
			showSuggestions: true
		};
		/** Coerce one unknown field onto the default's type, or fall back. */
		function pickString(value, fallback, allowed) {
			if (typeof value !== "string") return fallback;
			if (allowed !== void 0 && !allowed.includes(value)) return fallback;
			return value;
		}
		function pickBoolean(value, fallback) {
			return typeof value === "boolean" ? value : fallback;
		}
		/**
		* Read the stored preferences.
		* @returns the merged preferences; never throws, never returns a partial object.
		*/
		function loadPreferences() {
			try {
				if (typeof localStorage === "undefined") return DEFAULT_PREFERENCES;
				const raw = localStorage.getItem(STORAGE_KEY);
				if (raw === null || raw === "") return DEFAULT_PREFERENCES;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return DEFAULT_PREFERENCES;
				const record = parsed;
				return {
					defaultMode: pickString(record.defaultMode, DEFAULT_PREFERENCES.defaultMode),
					defaultLang: pickString(record.defaultLang, DEFAULT_PREFERENCES.defaultLang, [
						"auto",
						"zh",
						"en"
					]),
					liveAnalysis: pickBoolean(record.liveAnalysis, DEFAULT_PREFERENCES.liveAnalysis),
					defaultView: pickString(record.defaultView, DEFAULT_PREFERENCES.defaultView, [
						"result",
						"diff",
						"outline"
					]),
					autoScroll: pickBoolean(record.autoScroll, DEFAULT_PREFERENCES.autoScroll),
					showSuggestions: pickBoolean(record.showSuggestions, DEFAULT_PREFERENCES.showSuggestions)
				};
			} catch {
				return DEFAULT_PREFERENCES;
			}
		}
		/**
		* Persist the preferences.
		* @returns true when the write landed; false when storage refused it (which is
		*   not an error the user needs to see — the session keeps working in memory).
		*/
		function savePreferences(preferences) {
			try {
				if (typeof localStorage === "undefined") return false;
				localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
				return true;
			} catch {
				return false;
			}
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
				mode: DEFAULT_PREFERENCES.defaultMode,
				lang: DEFAULT_PREFERENCES.defaultLang,
				view: DEFAULT_PREFERENCES.defaultView,
				status: "idle",
				taskId: null,
				source: "",
				output: "",
				cursor: 0,
				error: "",
				note: "",
				provider: "",
				model: "",
				elapsedMs: 0,
				prefs: DEFAULT_PREFERENCES,
				configOpen: false,
				diagOpen: false,
				diagLoading: false,
				diag: null
			};
		}
		//#endregion
		//#region src/client/panel.ts
		/**
		* The composer surfaces.
		*
		*   conversation.input.left    -> the one-click trigger pill
		*   conversation.input.overlay -> the floating workbench panel
		*
		* Both mount into `session`-scope list slots, so the framework hands them
		* `useInput` and `inputActions` as standard props — that is how the plugin
		* reads the composer draft and writes a rewrite back into it.
		*
		* One pipeline runs the whole surface:
		*
		*   draft → analyze (local, instant) → advice + outline → targeted rewrite → formatted result
		*
		* The analysis comes from the same pure module the host half uses, so advice
		* appears as you type with no round trip and no token cost. Only the rewrite
		* itself reaches the model.
		*
		* ## Why there is no Run-card panel
		*
		* `tool.view.cordis` only exists for *dynamic* Cordis packages: its owner
		* dispatches the key `${pluginId}.${packageId}` taken from a dynamic
		* `cordis_run` result, and the dynamic guard is the only thing that maps
		* `key: 'self'` onto such a pair. An installed bundle has neither, so a
		* registration there would never render.
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
		/** Debounce for the live analysis while typing. */
		const ANALYZE_MS = 180;
		/** The right pane's view keys, in presentation order. */
		const VIEWS = [
			["result", "结果"],
			["diff", "差异"],
			["outline", "结构"]
		];
		/**
		* Split a rewrite into presentable blocks.
		*
		* This is the "formatted output" half of the feature: the model returns plain
		* text — which is what keeps it pasteable into the composer — and the panel
		* renders that text's structure instead of dumping a wall of monospace.
		*/
		function splitBlocks(text) {
			const blocks = [];
			let code = null;
			let list = null;
			const flushList = () => {
				if (list !== null) {
					blocks.push({
						kind: "list",
						text: list.join("\n")
					});
					list = null;
				}
			};
			for (const line of text.split("\n")) {
				if (/^\s*```/.test(line)) {
					flushList();
					if (code === null) code = [];
					else {
						blocks.push({
							kind: "code",
							text: code.join("\n")
						});
						code = null;
					}
					continue;
				}
				if (code !== null) {
					code.push(line);
					continue;
				}
				if (/^#{1,6}\s+/.test(line)) {
					flushList();
					blocks.push({
						kind: "heading",
						text: line.replace(/^#{1,6}\s+/, "").trim()
					});
					continue;
				}
				if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
					if (list === null) list = [];
					list.push(line.trim());
					continue;
				}
				flushList();
				if (line.trim() !== "") blocks.push({
					kind: "text",
					text: line
				});
			}
			if (code !== null) blocks.push({
				kind: "code",
				text: code.join("\n")
			});
			flushList();
			return blocks;
		}
		/** Render the analysis strip: score, dimension coverage, and signal counts. */
		function analysisStrip(analysis, isZh) {
			const label = (zh, en) => isZh ? zh : en;
			const dims = analysis.dimensions.map((dimension) => (0, react.createElement)("span", {
				key: dimension.id,
				className: dimension.present ? "dsh-pw-dim dsh-pw-dim-on" : "dsh-pw-dim",
				title: dimension.evidence ?? label("草稿中没有这一维度的迹象", "the draft shows no sign of this dimension")
			}, dimension.present ? `✓ ${dimension.label}` : `○ ${dimension.label}`));
			const signals = [];
			if (analysis.vagueness.length > 0) signals.push(label(`模糊词 ${String(analysis.vagueness.length)}`, `${String(analysis.vagueness.length)} vague`));
			if (analysis.placeholders.length > 0) signals.push(label(`占位符 ${String(analysis.placeholders.length)}`, `${String(analysis.placeholders.length)} placeholder`));
			if (analysis.references > 0) signals.push(`@${String(analysis.references)}`);
			if (analysis.codeBlocks > 0) signals.push(label(`代码块 ${String(analysis.codeBlocks)}`, `${String(analysis.codeBlocks)} code`));
			return (0, react.createElement)("div", { className: "dsh-pw-strip" }, [
				(0, react.createElement)("span", {
					key: "score",
					className: "dsh-pw-score"
				}, label("可执行度", "Actionability"), (0, react.createElement)("b", null, ` ${String(analysis.score)}`)),
				(0, react.createElement)("span", {
					key: "meter",
					className: "dsh-pw-meter"
				}, (0, react.createElement)("span", {
					className: "dsh-pw-meter-fill",
					style: { width: `${String(analysis.score)}%` }
				})),
				(0, react.createElement)("span", {
					key: "dims",
					className: "dsh-pw-dims"
				}, dims),
				signals.length === 0 ? null : (0, react.createElement)("span", {
					key: "sig",
					className: "dsh-pw-signals"
				}, signals.join(" · "))
			]);
		}
		/** The advice list, with one-click insertion of each snippet. */
		function suggestionList(suggestions, onInsert) {
			if (suggestions.length === 0) return (0, react.createElement)("div", { className: "dsh-pw-sugg" }, (0, react.createElement)("div", { className: "dsh-pw-sugg-empty" }, "✓ 六个维度都有覆盖，没有发现需要补齐的项。"));
			const rows = suggestions.map((suggestion) => (0, react.createElement)("div", {
				key: suggestion.id,
				className: "dsh-pw-sugg-row"
			}, [
				(0, react.createElement)("span", {
					key: "sev",
					className: `dsh-pw-sev dsh-pw-sev-${suggestion.severity}`,
					title: suggestion.severity
				}),
				(0, react.createElement)("span", {
					key: "body",
					className: "dsh-pw-sugg-body"
				}, [(0, react.createElement)("span", {
					key: "t",
					className: "dsh-pw-sugg-title"
				}, suggestion.title), (0, react.createElement)("span", {
					key: "d",
					className: "dsh-pw-sugg-detail"
				}, suggestion.detail)]),
				suggestion.snippet === void 0 ? null : (0, react.createElement)("button", {
					key: "ins",
					type: "button",
					className: "dsh-pw-sugg-insert",
					title: "把这节骨架插入到草稿末尾",
					onClick: () => {
						onInsert(suggestion.snippet);
					}
				}, "插入")
			]));
			return (0, react.createElement)("div", { className: "dsh-pw-sugg" }, rows);
		}
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
			/** Kick off one rewrite over the current draft buffer. */
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
			/** Run the host's self-diagnosis and show it inline. */
			const diagnose = () => {
				store.set({
					diagLoading: true,
					diagOpen: true
				});
				fetchDiag().then((report) => {
					if (disposed) return;
					store.set({
						diagLoading: false,
						diag: report
					});
				});
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
			/** Live, debounced analysis of the draft. */
			function useAnalysis(text, mode, enabled) {
				const [analysis, setAnalysis] = (0, react.useState)(null);
				(0, react.useEffect)(() => {
					if (!enabled) return;
					const handle = window.setTimeout(() => {
						setAnalysis(analyzePrompt(text, mode));
					}, ANALYZE_MS);
					return () => {
						window.clearTimeout(handle);
					};
				}, [
					text,
					mode,
					enabled
				]);
				return analysis;
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
					title: "提示词增强 · 分析、重构建议与一键重写",
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
				const inputActions = props.inputActions;
				const resultRef = (0, react.useRef)(null);
				const analysis = useAnalysis(state.source, state.mode, state.prefs.liveAnalysis);
				const isZh = analysis !== null ? analysis.language !== "en" : detectLanguage(state.source) !== "en";
				(0, react.useEffect)(() => {
					if (!state.prefs.autoScroll || state.status !== "running") return;
					const node = resultRef.current;
					if (node !== null) node.scrollTop = node.scrollHeight;
				}, [
					state.output,
					state.status,
					state.prefs.autoScroll
				]);
				const insertSnippet = (0, react.useCallback)((snippet) => {
					const current = store.get().source;
					const separator = current.trim() === "" ? "" : "\n\n";
					store.set({
						source: `${current}${separator}${snippet}`,
						note: "已插入结构骨架",
						error: ""
					});
				}, []);
				const setPrefs = (0, react.useCallback)((patch) => {
					const next = {
						...store.get().prefs,
						...patch
					};
					if (!savePreferences(next)) {
						store.set({
							prefs: next,
							note: "偏好已在本会话内生效，但浏览器拒绝持久化"
						});
						return;
					}
					store.set({ prefs: next });
				}, []);
				if (!state.open) return null;
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
					key: "diag",
					type: "button",
					className: "dsh-pw-iconbtn",
					title: "自检：查看插件在宿主侧的状态",
					disabled: state.diagLoading,
					onClick: diagnose
				}, "◎"));
				headChildren.push((0, react.createElement)("button", {
					key: "cfg",
					type: "button",
					className: state.configOpen ? "dsh-pw-iconbtn dsh-pw-iconbtn-on" : "dsh-pw-iconbtn",
					title: "设置",
					onClick: () => {
						store.set({ configOpen: !state.configOpen });
					}
				}, "⚙"));
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
				const configPanel = state.configOpen ? (0, react.createElement)("div", { className: "dsh-pw-cfg" }, [
					(0, react.createElement)("label", {
						key: "live",
						className: "dsh-pw-cfg-row"
					}, [(0, react.createElement)("input", {
						key: "i",
						type: "checkbox",
						checked: state.prefs.liveAnalysis,
						onChange: (event) => {
							setPrefs({ liveAnalysis: event.target.checked });
						}
					}), (0, react.createElement)("span", { key: "t" }, "实时分析（本地、免费、随输入更新）")]),
					(0, react.createElement)("label", {
						key: "sugg",
						className: "dsh-pw-cfg-row"
					}, [(0, react.createElement)("input", {
						key: "i",
						type: "checkbox",
						checked: state.prefs.showSuggestions,
						onChange: (event) => {
							setPrefs({ showSuggestions: event.target.checked });
						}
					}), (0, react.createElement)("span", { key: "t" }, "显示重构建议")]),
					(0, react.createElement)("label", {
						key: "scroll",
						className: "dsh-pw-cfg-row"
					}, [(0, react.createElement)("input", {
						key: "i",
						type: "checkbox",
						checked: state.prefs.autoScroll,
						onChange: (event) => {
							setPrefs({ autoScroll: event.target.checked });
						}
					}), (0, react.createElement)("span", { key: "t" }, "生成时自动滚动到最新内容")]),
					(0, react.createElement)("label", {
						key: "mode",
						className: "dsh-pw-cfg-row"
					}, [(0, react.createElement)("span", {
						key: "t",
						className: "dsh-pw-cfg-label"
					}, "默认模式"), (0, react.createElement)("select", {
						key: "s",
						className: "dsh-pw-select",
						value: state.prefs.defaultMode,
						onChange: (event) => {
							setPrefs({ defaultMode: event.target.value });
						}
					}, MODES.map((entry) => (0, react.createElement)("option", {
						key: entry.key,
						value: entry.key
					}, entry.label)))]),
					(0, react.createElement)("label", {
						key: "view",
						className: "dsh-pw-cfg-row"
					}, [(0, react.createElement)("span", {
						key: "t",
						className: "dsh-pw-cfg-label"
					}, "默认结果视图"), (0, react.createElement)("select", {
						key: "s",
						className: "dsh-pw-select",
						value: state.prefs.defaultView,
						onChange: (event) => {
							setPrefs({ defaultView: event.target.value });
						}
					}, [
						(0, react.createElement)("option", {
							key: "result",
							value: "result"
						}, "增强结果"),
						(0, react.createElement)("option", {
							key: "diff",
							value: "diff"
						}, "差异对比"),
						(0, react.createElement)("option", {
							key: "outline",
							value: "outline"
						}, "结构覆盖")
					])])
				]) : null;
				const diagPanel = state.diagOpen ? (0, react.createElement)("div", { className: "dsh-pw-diag" }, [(0, react.createElement)("div", {
					key: "h",
					className: "dsh-pw-diag-head"
				}, [(0, react.createElement)("span", { key: "t" }, "宿主侧自检"), (0, react.createElement)("button", {
					key: "x",
					type: "button",
					className: "dsh-pw-iconbtn",
					onClick: () => {
						store.set({ diagOpen: false });
					}
				}, "✕")]), state.diagLoading ? (0, react.createElement)("div", {
					key: "l",
					className: "dsh-pw-muted"
				}, "检测中…") : state.diag === null ? (0, react.createElement)("div", {
					key: "n",
					className: "dsh-pw-msg-err"
				}, "自检接口不可达（宿主半未响应）") : (0, react.createElement)("div", { key: "b" }, [...state.diag.checks.map((check) => (0, react.createElement)("div", {
					key: check.id,
					className: check.ok ? "dsh-pw-diag-row dsh-pw-ok" : "dsh-pw-diag-row dsh-pw-bad"
				}, `${check.ok ? "✓" : "✗"} ${check.detail}`)), (0, react.createElement)("div", {
					key: "meta",
					className: "dsh-pw-diag-meta"
				}, `node ${state.diag.node} · 启动图 ${state.diag.graphRev ?? "?"} · 模块 ${String(state.diag.moduleIds.length)} 个`)])]) : null;
				const sourcePane = (0, react.createElement)("section", { className: "dsh-pw-pane" }, (0, react.createElement)("div", { className: "dsh-pw-pane-head" }, (0, react.createElement)("span", null, "原始提示词"), (0, react.createElement)("span", { className: "dsh-pw-count" }, `${String(sourceChars)} 字符`)), (0, react.createElement)("textarea", {
					className: "dsh-pw-input",
					value: state.source,
					placeholder: "粘贴或输入提示词，中英文均可……\n\n也可以点右上角 ⭯ 直接读取输入框里的草稿。\n左侧输入会即时分析，下方给出重构建议。",
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
				const view = state.view;
				const viewSegment = (0, react.createElement)("span", { className: "dsh-pw-seg" }, VIEWS.map(([key, label]) => (0, react.createElement)("button", {
					key,
					type: "button",
					className: view === key ? "dsh-pw-seg-on" : void 0,
					onClick: () => {
						store.set({ view: key });
					}
				}, label)));
				const bodyChildren = [];
				if (view === "diff") {
					if (state.output === "" || !done) bodyChildren.push((0, react.createElement)("span", {
						key: "d",
						className: "dsh-pw-muted"
					}, "完成一次增强后可查看逐词差异。"));
					else {
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
					}
				} else if (view === "outline") {
					const target = state.output === "" ? state.source : state.output;
					const outlineAnalysis = analyzePrompt(target, state.mode);
					if (outlineAnalysis.outline.length === 0) bodyChildren.push((0, react.createElement)("span", {
						key: "none",
						className: "dsh-pw-muted"
					}, "当前模式不追加结构骨架（精简表达只做删减）。"));
					else for (const section of outlineAnalysis.outline) {
						const covered = target.includes(section.heading);
						bodyChildren.push((0, react.createElement)("div", {
							key: section.id,
							className: covered ? "dsh-pw-outline-row dsh-pw-ok" : "dsh-pw-outline-row dsh-pw-bad"
						}, `${covered ? "✓" : "○"} ${section.heading} — ${section.hint}`));
					}
				} else if (state.output === "" && running) bodyChildren.push((0, react.createElement)("span", {
					key: "wait",
					className: "dsh-pw-muted"
				}, "正在思考…"));
				else if (state.output === "") bodyChildren.push((0, react.createElement)("span", {
					key: "idle",
					className: "dsh-pw-muted"
				}, "增强结果会在这里流式出现。"));
				else {
					const blocks = splitBlocks(state.output);
					for (const [index, block] of blocks.entries()) {
						const className = block.kind === "heading" ? "dsh-pw-block dsh-pw-block-h" : block.kind === "code" ? "dsh-pw-block dsh-pw-block-code" : block.kind === "list" ? "dsh-pw-block dsh-pw-block-list" : "dsh-pw-block";
						const tail = running && index === blocks.length - 1 ? " dsh-pw-caret" : "";
						bodyChildren.push((0, react.createElement)("div", {
							key: String(index),
							className: `${className}${tail}`
						}, block.text));
					}
				}
				const outputPane = (0, react.createElement)("section", { className: "dsh-pw-pane" }, (0, react.createElement)("div", { className: "dsh-pw-pane-head" }, (0, react.createElement)("span", null, view === "diff" ? "差异对比" : view === "outline" ? "结构覆盖" : "增强结果"), (0, react.createElement)("span", { className: "dsh-pw-spacer" }), viewSegment, (0, react.createElement)("span", { className: "dsh-pw-count" }, `${String(outputChars)} 字符`)), (0, react.createElement)("div", {
					className: "dsh-pw-body",
					ref: resultRef
				}, bodyChildren));
				const grid = (0, react.createElement)("div", { className: "dsh-pw-grid" }, [sourcePane, outputPane]);
				const advice = state.prefs.showSuggestions && analysis !== null ? suggestionList(analysis.suggestions, insertSnippet) : null;
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
				}, [
					(0, react.createElement)("span", { key: "t" }, `⚠ ${state.error}`),
					(0, react.createElement)("button", {
						key: "retry",
						type: "button",
						className: "dsh-pw-btn dsh-pw-btn-tiny",
						disabled: running,
						onClick: () => {
							run();
						}
					}, "重试"),
					(0, react.createElement)("button", {
						key: "diag",
						type: "button",
						className: "dsh-pw-btn dsh-pw-btn-tiny",
						onClick: diagnose
					}, "自检")
				]));
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
					configPanel === null ? null : (0, react.createElement)("div", { key: "cfg" }, configPanel),
					diagPanel === null ? null : (0, react.createElement)("div", { key: "diag" }, diagPanel),
					analysis === null ? null : (0, react.createElement)("div", { key: "strip" }, analysisStrip(analysis, isZh)),
					(0, react.createElement)("div", { key: "gridwrap" }, grid),
					advice === null ? null : (0, react.createElement)("div", { key: "advice" }, advice),
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
			const prefs = loadPreferences();
			store.set({
				mode: prefs.defaultMode,
				lang: prefs.defaultLang,
				view: prefs.defaultView,
				prefs
			});
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

.dsh-pw-iconbtn-on {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.dsh-pw-btn-tiny { height: 24px; padding: 0 8px; font-size: 11px; }
.dsh-pw-msg { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* Analysis strip: actionability score, dimension coverage, signal counts. */
.dsh-pw-strip {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 9px 14px 0; font-size: 11px; color: var(--dsw-alias-label-secondary);
}
.dsh-pw-score b { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dsh-pw-meter {
  display: inline-block; width: 90px; height: 5px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); overflow: hidden; flex: 0 0 auto;
}
.dsh-pw-meter-fill {
  display: block; height: 100%; border-radius: 999px;
  background: var(--dsw-alias-brand-primary); transition: width .25s ease;
}
.dsh-pw-dims { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.dsh-pw-dim {
  padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); opacity: .55;
}
.dsh-pw-dim-on {
  opacity: 1; color: var(--dsw-alias-state-success-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
}
.dsh-pw-signals { font-variant-numeric: tabular-nums; }

/* Restructuring advice. */
.dsh-pw-sugg { padding: 10px 14px 0; display: flex; flex-direction: column; gap: 6px; }
.dsh-pw-sugg-empty {
  font-size: 12px; color: var(--dsw-alias-state-success-primary);
  padding: 8px 10px; border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent);
}
.dsh-pw-sugg-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px; background: var(--dsw-alias-bg-layer-2, transparent);
}
.dsh-pw-sev { flex: 0 0 auto; width: 6px; height: 6px; margin-top: 5px; border-radius: 50%; }
.dsh-pw-sev-high { background: var(--dsw-alias-state-error-primary); }
.dsh-pw-sev-medium { background: var(--dsw-alias-state-warn-primary); }
.dsh-pw-sev-low { background: var(--dsw-alias-label-secondary); }
.dsh-pw-sugg-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.dsh-pw-sugg-title { font-size: 12px; color: var(--dsw-alias-label-primary); }
.dsh-pw-sugg-detail { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dsh-pw-sugg-insert {
  flex: 0 0 auto; height: 24px; padding: 0 10px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px; cursor: pointer;
}
.dsh-pw-sugg-insert:hover { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }

/* Formatted result blocks. */
.dsh-pw-block { margin: 0 0 6px; }
.dsh-pw-block:last-child { margin-bottom: 0; }
.dsh-pw-block-h {
  font-weight: 600; color: var(--dsw-alias-label-primary);
  margin: 10px 0 4px; padding-bottom: 3px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-pw-block-h:first-child { margin-top: 0; }
.dsh-pw-block-list { color: var(--dsw-alias-label-primary); }
.dsh-pw-block-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px; padding: 8px 10px; white-space: pre; overflow-x: auto;
}

/* Outline coverage. */
.dsh-pw-outline-row { padding: 5px 0; font-size: 12px; border-bottom: 1px dashed var(--dsw-alias-border-l1); }
.dsh-pw-outline-row:last-child { border-bottom: 0; }
.dsh-pw-ok { color: var(--dsw-alias-state-success-primary); }
.dsh-pw-bad { color: var(--dsw-alias-label-secondary); }

/* Settings. */
.dsh-pw-cfg {
  margin: 10px 14px 0; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, transparent);
}
.dsh-pw-cfg-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-primary); }
.dsh-pw-cfg-label { min-width: 84px; color: var(--dsw-alias-label-secondary); }
.dsh-pw-select {
  height: 26px; padding: 0 6px; border-radius: 8px; font: inherit; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay, transparent);
  color: var(--dsw-alias-label-primary);
}

/* Host-side self-diagnosis. */
.dsh-pw-diag {
  margin: 10px 14px 0; padding: 10px 12px; display: flex; flex-direction: column; gap: 5px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, transparent);
}
.dsh-pw-diag-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; }
.dsh-pw-diag-head > span { flex: 1 1 auto; }
.dsh-pw-diag-row { font-size: 11.5px; line-height: 1.5; }
.dsh-pw-diag-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }

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
