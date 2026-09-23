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
import { existsSync } from 'node:fs';
import { queryParam, readJsonBody, sameOrigin, sendJson } from "./http.js";
import { RunRegistry } from "./runs.js";
import { errorMessage } from "./prompt.js";
/** The module name the profile patch inserts. */
export const name = 'dsh-prompt-workbench';
/** The same name, narrowed to a string for the diagnostics payloads. */
const PACKAGE_NAME = name;
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
    /**
     * `GET /diag` — self-diagnosis for the browser half.
     *
     * The browser half can only fail where nobody can see it: a plugin whose
     * client module never reaches the boot graph renders nothing and reports
     * nothing, and the `/plugins/...` route answers unauthenticated probes with
     * 404 for *every* plugin, so it cannot be used to tell the cases apart.
     *
     * This route asks the host's own client-module registry the questions that
     * do distinguish them, so a user can open one URL instead of devtools.
     * Every probe is individually guarded: a diagnostic that throws is worse
     * than no diagnostic.
     */
    const diag = route('exact', `${API}/diag`, (_request, response) => {
        const checks = [];
        let moduleIds = [];
        let graphRev = null;
        let clientPath = null;
        let clientBundleExists = false;
        const clientModules = host.get('clientModules');
        if (clientModules === undefined || clientModules === null) {
            checks.push({ id: 'client-modules', ok: false, detail: 'clientModules 服务不可用（该 profile 没有 web 外壳）' });
        }
        else {
            if (typeof clientModules.graph === 'function') {
                try {
                    const graph = clientModules.graph();
                    graphRev = typeof graph.rev === 'string' ? graph.rev : null;
                    const entries = Array.isArray(graph.entries) ? graph.entries : [];
                    moduleIds = entries.flatMap((entry) => {
                        if (entry === null || typeof entry !== 'object')
                            return [];
                        const id = entry.id;
                        return typeof id === 'string' ? [id] : [];
                    });
                    checks.push({ id: 'client-graph', ok: true, detail: `启动图 rev=${graphRev ?? '?'}，模块 ${String(moduleIds.length)} 个` });
                    const inGraph = moduleIds.includes(PACKAGE_NAME);
                    checks.push({
                        id: 'module-in-graph',
                        ok: inGraph,
                        detail: inGraph
                            ? '客户端模块已在启动图中，外壳会预加载它'
                            : '客户端模块不在启动图中 —— 浏览器半永远不会执行（这正是界面不出现的直接原因）',
                    });
                }
                catch (error) {
                    checks.push({ id: 'client-graph', ok: false, detail: `读取启动图失败：${errorMessage(error)}` });
                }
            }
            if (typeof clientModules.clientPath === 'function') {
                try {
                    const resolved = clientModules.clientPath(PACKAGE_NAME);
                    clientPath = typeof resolved === 'string' ? resolved : null;
                    checks.push({
                        id: 'client-path',
                        ok: clientPath !== null,
                        detail: clientPath ?? 'clientModules 未登记本插件的 client 入口（dsh.client 未被识别）',
                    });
                }
                catch (error) {
                    checks.push({ id: 'client-path', ok: false, detail: `读取 clientPath 失败：${errorMessage(error)}` });
                }
            }
            if (clientPath !== null) {
                try {
                    clientBundleExists = existsSync(clientPath);
                    checks.push({
                        id: 'client-file',
                        ok: clientBundleExists,
                        detail: clientBundleExists ? 'client 入口文件存在' : `client 入口文件不存在：${clientPath}`,
                    });
                }
                catch {
                    // A filesystem probe that fails tells us nothing; omit the check rather than report a guess.
                }
            }
        }
        sendJson(response, 200, {
            ok: true,
            package: PACKAGE_NAME,
            node: process.versions.node,
            graphRev,
            moduleIds,
            clientPath,
            clientBundleExists,
            checks,
        });
    });
    host.effect(() => {
        const disposers = [meta, start, poll, cancel, diag];
        return () => {
            for (const dispose of disposers.reverse())
                dispose();
            registry.dispose();
        };
    }, 'dsh-prompt-workbench: http routes');
}
