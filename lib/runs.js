/**
 * The host-side run table: one entry per in-flight rewrite.
 *
 * Behaviour is unchanged from the original implementation — a bounded table of
 * tasks, delta+cursor delivery so a long rewrite never re-sends the whole
 * buffer, and a cancellable stream. The only difference is that cancellation
 * now uses the real `AbortSignal` the llm service accepts, instead of the
 * sandbox's break-the-loop workaround.
 */
import { buildSystemInstruction, errorMessage, MAX_INPUT_CHARS, MODE_KEYS, normalizeLanguage, normalizeMode, outputLanguage, } from "./prompt.js";
import { analyzePrompt, describeGapsForModel } from "./analyze.js";
/** Bounded task table: finished runs are reaped before live ones. */
const MAX_TASKS = 8;
/**
 * Wall-clock ceiling for one model call. A stream that never settles must not
 * pin a task slot forever; the run is aborted with a distinguishable error so
 * the UI can say "timed out" rather than "stopped".
 */
const RUN_TIMEOUT_MS = 180_000;
/** The live default model route, or null when nothing is selected. */
export function currentRoute(ctx) {
    const service = ctx.get('agentDefaultModel');
    if (service === undefined || typeof service.currentSelection !== 'function')
        return null;
    try {
        const selection = service.currentSelection();
        if (selection === null || typeof selection !== 'object')
            return null;
        const provider = selection.provider;
        const model = selection.model;
        if (typeof provider !== 'string' || provider === '')
            return null;
        if (typeof model !== 'string' || model === '')
            return null;
        const reasoningEffort = typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : undefined;
        return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort };
    }
    catch {
        return null;
    }
}
/** The run table plus the one model call each run owns. */
export class RunRegistry {
    #ctx;
    #runs = new Map();
    #seq = 0;
    #disposed = false;
    constructor(ctx) {
        this.#ctx = ctx;
    }
    /** What the browser half needs to render its header. */
    meta() {
        const route = currentRoute(this.#ctx);
        const llm = this.#ctx.get('llm');
        return {
            ok: true,
            available: llm !== undefined && llm !== null,
            provider: route === null ? null : route.provider,
            model: route === null ? null : route.model,
            maxInputChars: MAX_INPUT_CHARS,
            modes: [...MODE_KEYS],
        };
    }
    /** Start one rewrite; the model call runs detached and is polled. */
    start(input) {
        const text = typeof input.text === 'string' ? input.text : '';
        if (text.trim() === '') {
            return { ok: false, code: 'empty', message: '请先输入需要增强的提示词' };
        }
        if (text.length > MAX_INPUT_CHARS) {
            return {
                ok: false,
                code: 'too-long',
                message: `提示词过长：${String(text.length)} 字符，上限 ${String(MAX_INPUT_CHARS)} 字符。请分段增强。`,
            };
        }
        const llm = this.#ctx.get('llm');
        if (llm === undefined || llm === null || typeof llm.stream !== 'function') {
            return { ok: false, code: 'no-llm', message: 'llm 服务不可用，无法调用模型' };
        }
        const route = currentRoute(this.#ctx);
        if (route === null) {
            return { ok: false, code: 'no-model', message: '当前没有可用的默认模型路由' };
        }
        this.#seq += 1;
        const id = `pw-${String(this.#seq)}-${String(Date.now())}`;
        const run = {
            source: text,
            text: '',
            status: 'running',
            error: undefined,
            controller: new AbortController(),
            startedAt: Date.now(),
            timedOut: false,
        };
        this.#runs.set(id, run);
        this.#reap();
        void this.#drive(llm, id, run, normalizeMode(input.mode), normalizeLanguage(input.lang));
        return { ok: true, taskId: id, provider: route.provider, model: route.model };
    }
    /** The delta since `cursor`, plus the terminal status once the run settles. */
    poll(taskId, cursor) {
        const run = this.#runs.get(taskId);
        if (run === undefined)
            return null;
        const reset = !Number.isFinite(cursor) || cursor < 0 || cursor > run.text.length;
        const from = reset ? 0 : Math.floor(cursor);
        const snapshot = {
            ok: true,
            status: run.status,
            delta: run.text.slice(from),
            cursor: run.text.length,
            reset,
            chars: run.text.length,
            elapsedMs: Date.now() - run.startedAt,
            ...run.error === undefined ? {} : { error: run.error },
        };
        return snapshot;
    }
    /** Abort one run. Idempotent. */
    cancel(taskId) {
        const run = this.#runs.get(taskId);
        if (run === undefined)
            return false;
        run.controller.abort();
        return true;
    }
    /** Abort every live run; called when the plugin unloads. */
    dispose() {
        this.#disposed = true;
        for (const run of this.#runs.values())
            run.controller.abort();
        this.#runs.clear();
    }
    /** Keep the table bounded, dropping finished runs first. */
    #reap() {
        if (this.#runs.size <= MAX_TASKS)
            return;
        for (const [id, run] of this.#runs) {
            if (this.#runs.size <= MAX_TASKS)
                break;
            if (run.status !== 'running')
                this.#runs.delete(id);
        }
        while (this.#runs.size > MAX_TASKS) {
            const first = this.#runs.keys().next();
            if (first.done === true)
                return;
            this.#runs.delete(first.value);
        }
    }
    /** One model call. Mirrors the original accumulation loop exactly. */
    async #drive(llm, id, run, mode, lang) {
        const route = currentRoute(this.#ctx);
        if (route === null) {
            run.status = 'error';
            run.error = '当前没有可用的默认模型路由';
            return;
        }
        // Deterministic gap report: this is what turns a generic "improve it" into a
        // rewrite that closes the dimensions this particular draft is missing.
        const analysis = analyzePrompt(run.source, mode);
        const guard = setTimeout(() => {
            run.timedOut = true;
            run.controller.abort();
        }, RUN_TIMEOUT_MS);
        try {
            const stream = llm.stream({
                provider: route.provider,
                model: route.model,
                ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
                system: buildSystemInstruction(mode, outputLanguage(lang, run.source), describeGapsForModel(analysis)),
                // Built inline rather than through the llm package's `createUserMessage`
                // helper: the shape is identical to what the original implementation
                // sent, and it keeps this plugin free of runtime dependencies.
                messages: [{
                        id: `dsh-prompt-workbench-${id}`,
                        role: 'user',
                        content: [{ type: 'text', text: run.source }],
                        source: { kind: 'plugin', plugin: 'dsh-prompt-workbench' },
                    }],
                signal: run.controller.signal,
            });
            for await (const chunk of stream) {
                if (chunk === null || typeof chunk !== 'object')
                    continue;
                if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
                    run.text += chunk.text;
                    continue;
                }
                if (chunk.type === 'finish' && chunk.reason !== undefined && chunk.reason !== null) {
                    const kind = chunk.reason.kind;
                    if (kind === 'error' || kind === 'aborted') {
                        const failure = chunk.reason.failure;
                        run.error = typeof failure?.message === 'string'
                            ? failure.message
                            : (kind === 'aborted' ? 'the model call was aborted' : 'the model call failed');
                    }
                }
            }
        }
        catch (error) {
            if (run.controller.signal.aborted) {
                run.error = undefined;
            }
            else {
                run.error = errorMessage(error);
            }
        }
        finally {
            clearTimeout(guard);
        }
        if (this.#disposed)
            return;
        if (run.controller.signal.aborted) {
            if (run.timedOut) {
                run.status = 'error';
                run.error = `模型调用超时（${String(RUN_TIMEOUT_MS / 1000)} 秒未返回），已中止。`;
                return;
            }
            run.status = 'stopped';
            return;
        }
        if (run.error === undefined && run.text.trim() === '') {
            run.error = 'the model returned an empty result';
        }
        run.status = run.error === undefined ? 'done' : 'error';
    }
}
