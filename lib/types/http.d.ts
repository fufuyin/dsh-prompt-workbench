/**
 * Minimal HTTP helpers for the plugin's own routes.
 *
 * The pattern mirrors the one the third-party `dsh-market` plugin established
 * for out-of-tree plugins: JSON with no-store caching, a same-origin gate for
 * mutating verbs, and a size-capped body reader.
 *
 * `sameOrigin` matters because plugin routes are NOT covered by the shipped
 * web connection's Host/Origin checks — those only protect the harness's own
 * `/api` surface. Every POST route this plugin owns must gate itself.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Write a JSON payload with no-store caching. */
export declare function sendJson(response: ServerResponse, status: number, payload: unknown): void;
/**
 * True when the request's Origin matches its Host.
 *
 * Only meaningful for mutating verbs: browsers omit `Origin` on same-origin
 * GET, so applying this to a polling route would reject the plugin's own
 * traffic.
 */
export declare function sameOrigin(request: IncomingMessage): boolean;
/** Read and parse a JSON request body, rejecting anything over `maxBytes`. */
export declare function readJsonBody(request: IncomingMessage, maxBytes?: number): Promise<unknown>;
/** Read one query parameter off the request URL, or `undefined`. */
export declare function queryParam(request: IncomingMessage, name: string): string | undefined;
