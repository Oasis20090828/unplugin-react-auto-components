import { describe, expect, it } from 'vitest'
import { parseDebugEnv } from '../src/core/debug'

const matches = (env: string | undefined, ns: string) =>
  parseDebugEnv(env).some((re) => re.test(ns))

describe('parseDebugEnv', () => {
  it('returns no matchers for empty / undefined', () => {
    expect(parseDebugEnv(undefined)).toEqual([])
    expect(parseDebugEnv('')).toEqual([])
  })

  it('matches exact namespaces', () => {
    expect(matches('urc:scan', 'urc:scan')).toBe(true)
    expect(matches('urc:scan', 'urc:watch')).toBe(false)
    expect(matches('urc:scan', 'urc:scanner')).toBe(false) // anchored, no partial
  })

  it('treats * as a wildcard', () => {
    expect(matches('urc:*', 'urc:scan')).toBe(true)
    expect(matches('urc:*', 'urc:watch')).toBe(true)
    expect(matches('urc:*', 'foo:bar')).toBe(false)
    expect(matches('*', 'anything:here')).toBe(true)
  })

  it('supports comma- or space-separated lists', () => {
    expect(matches('urc:scan,urc:watch', 'urc:watch')).toBe(true)
    expect(matches('urc:scan urc:watch', 'urc:scan')).toBe(true)
    expect(matches('urc:scan,urc:watch', 'urc:hmr')).toBe(false)
  })
})
