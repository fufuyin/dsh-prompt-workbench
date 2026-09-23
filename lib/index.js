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
import { queryParam, readJsonBody, sameOrigin, sendJson } from "./http.js";
import { RunRegistry } from "./runs.js";
/** The module name the profile patch inserts. */
export const name = 'dsh-prompt-workbench';
/**
 * `webServer` is a hard dependency: without it there is no carrier at all.
 * `llm` is read lazily through `ctx.get`, so a profile that has not mounted a
 * model route still loads and reports the reason through `/meta`.
 */
export const inject = ['webServer'];
/** Route namespace. Kept under one prefix so the plugin owns one URL space. */
const API = '/dsh-prompt-workbench/api';
/** Register the plugin's routes. */
export function apply(ctx) {
    const host = ctx;
    const webServer = host.get('webServer');
    if (webServer === undefined || webServer === null || typeof webServer.register !== 'function')
        return;
    const registry = new RunRegistry(host);
    const route = (kind, path, handler) => webServer.register({ kind, path, handler });
    /** `GET /meta` — the model route in force and the host-side limits. */
    const meta = route('exact', `${API}/meta`, (_request, response) => {
        sendJson(response, 200, registry.meta());
    });
    /** `POST /start` — begin one rewrite. Body: `{ text, mode, lang }`. */
    const start = route('exact', `${API}/start`, async (request, response) => {
        if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' });
            response.end();
            return;
        }
        if (!sameOrigin(request)) {
            sendJson(response, 403, { ok: false, code: 'origin', message: 'untrusted origin' });
            return;
        }
        let body;
        try {
            body = await readJsonBody(request);
        }
        catch (error) {
            sendJson(response, 400, { ok: false, code: 'body', message: error instanceof Error ? error.message : 'bad body' });
            return;
        }
        const fields = body !== null && typeof body === 'object' ? body : {};
        const result = registry.start({ text: fields.text, mode: fields.mode, lang: fields.lang });
        sendJson(response, result.ok ? 200 : 409, result);
    });
    /** `GET /poll?id=&cursor=` — the delta since `cursor`, plus status. */
    const poll = route('exact', `${API}/poll`, (request, response) => {
        const id = queryParam(request, 'id');
        if (id === undefined) {
            sendJson(response, 400, { ok: false, code: 'id', message: 'missing id' });
            return;
        }
        const rawCursor = queryParam(request, 'cursor');
        const cursor = rawCursor === undefined ? 0 : Number.parseInt(rawCursor, 10);
        const snapshot = registry.poll(id, Number.isNaN(cursor) ? 0 : cursor);
        if (snapshot === null) {
            sendJson(response, 404, { ok: false, code: 'missing', message: '增强任务已失效，请重新开始' });
            return;
        }
        sendJson(response, 200, snapshot);
    });
    /** `POST /cancel` — abort one live run. */
    const cancel = route('exact', `${API}/cancel`, async (request, response) => {
        if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' });
            response.end();
            return;
        }
        if (!sameOrigin(request)) {
            sendJson(response, 403, { ok: false, code: 'origin', message: 'untrusted origin' });
            return;
        }
        let body;
        try {
            body = await readJsonBody(request);
        }
        catch {
            body = undefined;
        }
        const fields = body !== null && typeof body === 'object' ? body : {};
        const id = typeof fields.id === 'string' ? fields.id : undefined;
        const found = id === undefined ? false : registry.cancel(id);
        sendJson(response, 200, { ok: found, status: found ? 'cancelled' : 'missing' });
    });
    host.effect(() => {
        const disposers = [meta, start, poll, cancel];
        return () => {
            for (const dispose of disposers.reverse())
                dispose();
            registry.dispose();
        };
    }, 'dsh-prompt-workbench: http routes');
}
