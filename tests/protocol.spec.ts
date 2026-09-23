/**
 * Tests for the wire contract shared by both halves.
 *
 * The drift explanation is the plugin's answer to a failure mode that used to
 * be invisible: the browser half hot-reloads while the host half does not, so a
 * rebuilt plugin can leave a new client talking to an old host.
 */
import { describe, expect, it } from 'vitest'
import { API_VERSION, describeDrift, LEGACY_HOST_VERSION } from '../src/protocol.ts'

describe('describeDrift', () => {
  it('says nothing when the halves agree', () => {
    expect(describeDrift(API_VERSION, API_VERSION)).toBe('')
  })

  it('names both revisions when the host is behind', () => {
    const text = describeDrift(API_VERSION - 1, API_VERSION)
    expect(text).toContain(`client v${String(API_VERSION)}`)
    expect(text).toContain('重启 profile')
  })

  it('calls out a host that predates the field entirely', () => {
    expect(describeDrift(LEGACY_HOST_VERSION, API_VERSION)).toContain('未上报版本')
  })

  it('treats a completely absent report the same way', () => {
    expect(describeDrift(undefined, API_VERSION)).toContain('未上报')
  })

  it('does not mistake a string for a version', () => {
    expect(describeDrift(String(API_VERSION), API_VERSION)).toContain('未上报')
  })
})
