/**
 * dsh-prompt-workbench, host half.
 *
 * ## Why HTTP routes instead of `@Remote`
 *
 * A third-party package cannot use the `@Remote` / `ctx.remote` path: the host
 * gateway discovers `@Remote` markers at runtime and builds `src-json`
 * descriptors, but the client's `$mount` hard-rejects anything that is not a
 * generated *strict* codec, and the assembly that mounts namespaces is a closed
 * in-tree list. Shipping generated codecs would require the in-tree Typert
 * build tooling.
 *
 * `ctx.webServer.register()` is therefore the idiomatic carrier for an
 * out-of-tree plugin — the same choice `dsh-market` makes for its ~40 routes.
 * The four routes below are package-private: the browser half is their only
 * caller.
 *
 * ## Security
 *
 * Plugin-owned routes are NOT covered by the web connection's own Host/Origin
 * checks. Every mutating route gates itself with `sameOrigin`. The polling
 * route deliberately does not, because browsers omit `Origin` on same-origin
 * GET and the check would reject the plugin's own traffic.
 */
import type { Context } from '@deepseek-ai/cordis';
/** The module name the profile patch inserts. */
export declare const name = "dsh-prompt-workbench";
/**
 * `webServer` is a hard dependency: without it there is no carrier at all.
 * `llm` is read lazily through `ctx.get`, so a profile that has not mounted a
 * model route still loads and reports the reason through `/meta`.
 */
export declare const inject: readonly ["webServer"];
/** Register the plugin's routes. */
export declare function apply(ctx: Context): void;
