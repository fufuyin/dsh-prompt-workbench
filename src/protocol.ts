/**
 * The wire contract shared by both halves.
 *
 * ## Why a version constant exists here at all
 *
 * The two halves do **not** reload together, and that asymmetry is a trap:
 *
 *   - the browser bundle is served fresh on every page load, and the client
 *     module system can hot-apply a rebuilt bundle;
 *   - the host half is imported once at profile boot and never re-imported.
 *
 * Rebuilding the plugin therefore leaves a running harness with a **new client
 * talking to an old host**. The symptom is a route that answers 404, which
 * reads like "the plugin is broken" when the truth is "restart the profile".
 *
 * So each half reports {@link API_VERSION}, and the browser half compares. When
 * they differ it says exactly that, instead of leaving the user to guess.
 *
 * Bump this whenever a route is added, removed, or changes shape.
 *
 * @module dsh-prompt-workbench/protocol
 */

/** Current wire revision. Bump on any route change. */
export const API_VERSION = 2

/**
 * Sentinel for "the host half answered, but reported no version".
 *
 * That answer is not a gap — it is the finding: a host that predates the field
 * is by definition an older build than any client that looks for it.
 */
export const LEGACY_HOST_VERSION = -1

/**
 * Explain a version mismatch in one sentence.
 *
 * Deliberately accepts `unknown` for the host value: the interesting case is an
 * *older* host that predates this field entirely and therefore reports nothing.
 *
 * @param hostVersion - whatever the host reported, if anything.
 * @param clientVersion - the browser half's own version.
 * @returns an empty string when they agree; otherwise the explanation to show.
 */
export function describeDrift(hostVersion: unknown, clientVersion: number): string {
  if (hostVersion === clientVersion) return ''
  const host = typeof hostVersion !== 'number'
    ? '未上报'
    : hostVersion === LEGACY_HOST_VERSION ? '未上报版本（旧构建）' : `v${String(hostVersion)}`
  return `宿主半与界面版本不一致（host ${host} / client v${String(clientVersion)}）。`
    + '磁盘上的构建已经更新，但运行中的 profile 仍在用启动时加载的旧代码——重启 profile 即可生效。'
}
