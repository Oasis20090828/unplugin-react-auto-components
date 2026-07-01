/**
 * Smoke / wiring tests for every public build-tool entry adapter. These files
 * are pure `createXPlugin(unpluginFactory)` wiring (plus next's config wrapper),
 * and had zero automated coverage — a broken import or adapter shape would only
 * surface in a downstream project. Here we instantiate each entry and assert it
 * produces the plugin shape its bundler expects.
 */
import { describe, it, expect, vi } from 'vitest'
import vite from '../../src/vite'
import webpack from '../../src/webpack'
import rollup from '../../src/rollup'
import rspack from '../../src/rspack'
import esbuild from '../../src/esbuild'
import rolldown from '../../src/rolldown'
import farm from '../../src/farm'
import ReactComponents from '../../src/next'
import * as resolversBarrel from '../../src/resolvers'
import { PLUGIN_NAME } from '../../src/index'

// Minimal valid options — no resolvers, no dts, so instantiation has no side effects.
const opts = { resolvers: [], dts: false as const }

// unplugin's vite plugin is normally a single object; tolerate the array form.
const first = (p: unknown) => (Array.isArray(p) ? p[0] : p) as { name?: string }

describe('build-tool entry adapters', () => {
  it.each([
    ['vite', vite],
    ['rollup', rollup],
    ['rolldown', rolldown],
    ['farm', farm],
  ])('%s entry returns a named plugin', (_label, factory) => {
    expect(typeof factory).toBe('function')
    const plugin = first((factory as (o: unknown) => unknown)(opts))
    expect(plugin).toBeTruthy()
    expect(plugin.name).toBe(PLUGIN_NAME)
  })

  it('esbuild entry returns a plugin with name + setup()', () => {
    const p = esbuild(opts) as { name?: string; setup?: unknown }
    expect(p.name).toBe(PLUGIN_NAME)
    expect(typeof p.setup).toBe('function')
  })

  it.each([
    ['webpack', webpack],
    ['rspack', rspack],
  ])('%s entry returns a plugin instance with apply()', (_label, factory) => {
    const p = (factory as (o: unknown) => { apply?: unknown })(opts)
    expect(p).toBeTruthy()
    expect(typeof p.apply).toBe('function')
  })

  it('next entry wraps the config, injects the webpack plugin, and preserves a user webpack hook', () => {
    expect(typeof ReactComponents).toBe('function')
    const userWebpack = vi.fn((c: unknown) => c)
    const cfg = ReactComponents(opts)({
      reactStrictMode: true,
      webpack: userWebpack,
    } as never) as { reactStrictMode?: boolean; webpack: (c: unknown, ctx: unknown) => unknown }

    // user config is preserved on the way out
    expect(cfg.reactStrictMode).toBe(true)
    expect(typeof cfg.webpack).toBe('function')

    // calling the merged webpack hook injects exactly our plugin AND chains the
    // user's original hook.
    const wpConfig: { plugins: unknown[] } = { plugins: [] }
    cfg.webpack(wpConfig, {})
    expect(wpConfig.plugins).toHaveLength(1)
    expect(userWebpack).toHaveBeenCalledTimes(1)
  })

  it('next entry works without a user-supplied webpack hook', () => {
    const cfg = ReactComponents(opts)({} as never) as {
      webpack: (c: unknown, ctx: unknown) => unknown
    }
    const wpConfig: { plugins: unknown[] } = { plugins: [] }
    const returned = cfg.webpack(wpConfig, {})
    expect(wpConfig.plugins).toHaveLength(1)
    expect(returned).toBe(wpConfig) // returns the config untouched (no user hook)
  })

  it('resolvers barrel re-exports every built-in resolver + factory', () => {
    for (const name of [
      'AntdResolver',
      'AntdMobileResolver',
      'MuiResolver',
      'ShadcnResolver',
      'createResolver',
    ]) {
      expect(typeof (resolversBarrel as Record<string, unknown>)[name]).toBe(
        'function',
      )
    }
  })
})
