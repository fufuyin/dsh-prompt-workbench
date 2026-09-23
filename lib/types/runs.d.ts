/**
 * The host-side run table: one entry per in-flight rewrite.
 *
 * Behaviour is unchanged from the original implementation — a bounded table of
 * tasks, delta+cursor delivery so a long rewrite never re-sends the whole
 * buffer, and a cancellable stream. The only difference is that cancellation
 * now uses the real `AbortSignal` the llm service accepts, instead of the
 * sandbox's break-the-loop workaround.
 */
/** The slice of the Cordis context this module reads. */
export interface HostServices {
    get(name: string): unknown;
}
/** A resolved model route. */
export interface Route {
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort?: string;
}
/** One poll answer. */
export interface RunSnapshot {
    readonly ok: true;
    readonly status: 'running' | 'done' | 'error' | 'stopped';
    readonly delta: string;
    readonly cursor: number;
    readonly reset: boolean;
    readonly chars: number;
    readonly elapsedMs: number;
    readonly error?: string;
}
/** A failure the browser half should show verbatim. */
export interface StartFailure {
    readonly ok: false;
    readonly code: 'empty' | 'too-long' | 'no-llm' | 'no-model' | 'busy';
    readonly message: string;
}
/** A started run. */
export interface StartSuccess {
    readonly ok: true;
    readonly taskId: string;
    readonly provider: string;
    readonly model: string;
}
/** The live default model route, or null when nothing is selected. */
export declare function currentRoute(ctx: HostServices): Route | null;
/** The run table plus the one model call each run owns. */
export declare class RunRegistry {
    #private;
    constructor(ctx: HostServices);
    /** What the browser half needs to render its header. */
    meta(): Record<string, unknown>;
    /** Start one rewrite; the model call runs detached and is polled. */
    start(input: {
        text?: unknown;
        mode?: unknown;
        lang?: unknown;
    }): StartSuccess | StartFailure;
    /** The delta since `cursor`, plus the terminal status once the run settles. */
    poll(taskId: string, cursor: number): RunSnapshot | null;
    /** Abort one run. Idempotent. */
    cancel(taskId: string): boolean;
    /** Abort every live run; called when the plugin unloads. */
    dispose(): void;
}
