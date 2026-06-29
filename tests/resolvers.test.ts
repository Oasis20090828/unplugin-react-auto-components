import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AntdMobileResolver } from '../src/core/resolvers/antd-mobile'
import { AntdResolver } from '../src/core/resolvers/antd'
import { MuiResolver } from '../src/core/resolvers/mui'
import { createResolver } from '../src/core/resolvers/createResolver'
import { ShadcnResolver } from '../src/core/resolvers/shadcn'
import { discoverExports } from '../src/core/discover'

describe('discoverExports (async, local-pkg)', () => {
  it('returns capital-cased exports of an installed package', async () => {
    // react is installed; its capital-cased exports include Fragment, Suspense.
    const names = await discoverExports('react')
    expect(names).not.toBeNull()
    expect(names).toContain('Fragment')
    expect(names).toContain('Suspense')
    // lowercase helpers (useState, createElement) are filtered out
    expect(names).not.toContain('useState')
  })

  it('returns null when the package cannot be loaded', async () => {
    expect(await discoverExports('this-pkg-does-not-exist-xyz')).toBeNull()
  })
})

describe('AntdResolver — dynamic discovery', () => {
  it('discovers real exports once setup() has run', async () => {
    // `react` stands in for an installed package with capital-cased exports.
    const r = AntdResolver({ version: 5, dynamic: true, packageName: 'react' })
    // Before setup(): dynamic resolver still holds the static antd catalog.
    expect(r.resolve('Fragment')).toBeUndefined()
    await r.setup!()
    const hit = r.resolve('Fragment')
    expect(hit).toMatchObject({ name: 'Fragment', from: 'react', type: 'Export' })
    // A name react doesn't export must not match.
    expect(r.resolve('Button')).toBeUndefined()
  })

  it('falls back to the static catalog (with a warning) when not loadable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Point dynamic discovery at a package that can't be loaded → it fails and
    // falls back to the static antd catalog. (Don't rely on antd being absent:
    // a workspace example installs it, which would make discovery succeed.)
    const r = AntdResolver({
      version: 5,
      dynamic: true,
      packageName: 'this-pkg-does-not-exist-xyz',
    })
    await r.setup!()
    expect(r.resolve('Button')).toBeDefined()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('createResolver + MuiResolver', () => {
  it('createResolver discovers exports in setup(), prefixes, and excludes', async () => {
    // Use react as a stand-in installed package.
    const r = createResolver({
      module: 'react',
      prefix: 'Re',
      exclude: (n) => n === 'Suspense',
    })
    expect(r.resolve('ReFragment')).toBeUndefined() // before setup
    await r.setup!()
    expect(r.resolve('ReFragment')).toMatchObject({
      jsxName: 'ReFragment',
      name: 'Fragment',
      from: 'react',
      type: 'Export',
    })
    // excluded name drops out of both resolve() and list()
    expect(r.resolve('ReSuspense')).toBeUndefined()
    expect(r.list!().find((i) => i.name === 'Suspense')).toBeUndefined()
    // prefix is required
    expect(r.resolve('Fragment')).toBeUndefined()
  })

  it('MuiResolver targets @mui/material with the Mui prefix', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = MuiResolver()
    expect(r.type).toBe('component')
    // @mui/material isn't installed here, so setup() warns and matches nothing —
    // proving the wiring (module + prefix) without requiring the heavy dep.
    await r.setup!()
    expect(r.resolve('MuiButton')).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('AntdResolver — v5 default', () => {
  // version: 5 is explicit so the test doesn't depend on whatever antd is
  // currently installed in node_modules.
  const r = AntdResolver({ version: 5 })

  it('resolves Button with NO style side-effect (CSS-in-JS)', () => {
    expect(r.resolve('Button')).toEqual({
      jsxName: 'Button',
      name: 'Button',
      from: 'antd',
      type: 'Export',
    })
  })

  it('includes v5-only components', () => {
    expect(r.resolve('FloatButton')).toBeDefined()
    expect(r.resolve('ColorPicker')).toBeDefined()
    expect(r.resolve('Watermark')).toBeDefined()
    expect(r.resolve('App')).toBeDefined()
    expect(r.resolve('Flex')).toBeDefined()
    expect(r.resolve('Splitter')).toBeDefined()
    expect(r.resolve('Tour')).toBeDefined()
    expect(r.resolve('Segmented')).toBeDefined()
    expect(r.resolve('QRCode')).toBeDefined()
  })

  it('blocks v4-only components', () => {
    expect(r.resolve('BackTop')).toBeUndefined()
    expect(r.resolve('Comment')).toBeUndefined()
    expect(r.resolve('PageHeader')).toBeUndefined()
  })

  it('translates user-friendly "Qrcode" tag to real "QRCode" export', () => {
    const hit = r.resolve('Qrcode')!
    expect(hit.jsxName).toBe('Qrcode')
    expect(hit.name).toBe('QRCode')
  })

  it('css-in-js opt-in: emits /style (no /css suffix) for v5 compat mode', () => {
    const cij = AntdResolver({ version: 5, importStyle: 'css-in-js' })
    expect(cij.resolve('Button')?.style).toBe('antd/es/button/style')
    expect(cij.resolve('DatePicker')?.style).toBe('antd/es/date-picker/style')
  })
})

describe('AntdResolver — v4', () => {
  const r = AntdResolver({ version: 4 })

  it('emits the css style side-effect by default', () => {
    expect(r.resolve('Button')).toEqual({
      jsxName: 'Button',
      name: 'Button',
      from: 'antd',
      type: 'Export',
      style: 'antd/es/button/style/css',
    })
  })

  it('maps multi-word names through kebab-case (fixes master bug)', () => {
    expect(r.resolve('DatePicker')?.style).toBe('antd/es/date-picker/style/css')
    expect(r.resolve('TreeSelect')?.style).toBe('antd/es/tree-select/style/css')
    expect(r.resolve('ConfigProvider')?.style).toBe('antd/es/config-provider/style/css')
    expect(r.resolve('AutoComplete')?.style).toBe('antd/es/auto-complete/style/css')
  })

  it('keeps v4-only components', () => {
    expect(r.resolve('BackTop')).toBeDefined()
    expect(r.resolve('Comment')).toBeDefined()
    expect(r.resolve('PageHeader')).toBeDefined()
  })

  it('blocks v5-only components', () => {
    expect(r.resolve('FloatButton')).toBeUndefined()
    expect(r.resolve('ColorPicker')).toBeUndefined()
    expect(r.resolve('Watermark')).toBeUndefined()
    expect(r.resolve('App')).toBeUndefined()
  })

  it('importStyle "less" drops /css suffix', () => {
    const less = AntdResolver({ version: 4, importStyle: 'less' })
    expect(less.resolve('DatePicker')?.style).toBe('antd/es/date-picker/style')
  })

  it('importStyle:false strips style entirely', () => {
    const none = AntdResolver({ version: 4, importStyle: false })
    expect(none.resolve('Button')?.style).toBeUndefined()
  })

  it('cjs:true switches /es to /lib', () => {
    const c = AntdResolver({ version: 4, cjs: true })
    expect(c.resolve('Button')?.style).toBe('antd/lib/button/style/css')
  })

  it('packageName override propagates to both import and style paths', () => {
    const fork = AntdResolver({ version: 4, packageName: '@my-corp/antd' })
    const hit = fork.resolve('Button')!
    expect(hit.from).toBe('@my-corp/antd')
    expect(hit.style).toBe('@my-corp/antd/es/button/style/css')
  })

  it('prefix gates matching and is stripped from the imported name', () => {
    const pre = AntdResolver({ version: 4, prefix: 'Ant' })
    expect(pre.resolve('Button')).toBeUndefined()
    const hit = pre.resolve('AntButton')!
    expect(hit.name).toBe('Button')
    expect(hit.jsxName).toBe('AntButton')
  })

  it('exclude filter applies to both resolve() and list()', () => {
    const filtered = AntdResolver({ version: 4, exclude: n => n === 'Button' })
    expect(filtered.resolve('Button')).toBeUndefined()
    expect(filtered.list!().find(i => i.name === 'Button')).toBeUndefined()
  })

  it('list() enumerates everything matchable', () => {
    expect(r.list!().length).toBeGreaterThan(40)
    expect(r.list!().every(i => i.from === 'antd')).toBe(true)
    expect(r.list!().every(i => !!i.style)).toBe(true)
  })

  it('does not match unknown components', () => {
    expect(r.resolve('NotARealComponent')).toBeUndefined()
  })
})

describe('AntdResolver — arbitrary numeric version (>= 5 threshold)', () => {
  it('treats version 6 like v5+: CSS-in-JS, v5 component set', () => {
    const r = AntdResolver({ version: 6 })
    // v5+ set: FloatButton in, BackTop out
    expect(r.resolve('FloatButton')).toBeDefined()
    expect(r.resolve('BackTop')).toBeUndefined()
    // CSS-in-JS → no style side-effect
    expect(r.resolve('Button')!.style).toBeUndefined()
  })

  it('treats a sub-5 version like v4: CSS imports, v4 component set', () => {
    const r = AntdResolver({ version: 3 })
    // v4 set: BackTop in, FloatButton out
    expect(r.resolve('BackTop')).toBeDefined()
    expect(r.resolve('FloatButton')).toBeUndefined()
    // v4 default → css style import
    expect(r.resolve('Button')!.style).toBe('antd/es/button/style/css')
  })
})

describe('AntdMobileResolver', () => {
  const r = AntdMobileResolver()

  it('resolves Button from antd-mobile, no style', () => {
    expect(r.resolve('Button')).toEqual({
      jsxName: 'Button',
      name: 'Button',
      from: 'antd-mobile',
      type: 'Export',
    })
  })

  it('matches mobile-specific components like NavBar / Swiper / TabBar', () => {
    expect(r.resolve('NavBar')).toBeDefined()
    expect(r.resolve('Swiper')).toBeDefined()
    expect(r.resolve('TabBar')).toBeDefined()
  })

  it('rejects desktop-only components', () => {
    expect(r.resolve('FloatButton')).toBeUndefined()
    expect(r.resolve('ColorPicker')).toBeUndefined()
  })
})

describe('ShadcnResolver', () => {
  let uiDir: string

  beforeAll(() => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'urc-shadcn-'))
    uiDir = join(projectRoot, 'src/components/ui')
    mkdirSync(uiDir, { recursive: true })
    writeFileSync(join(uiDir, 'button.tsx'), 'export const Button = () => null')
    writeFileSync(join(uiDir, 'dropdown-menu.tsx'), 'export const DropdownMenu = () => null')
    writeFileSync(join(uiDir, 'data-table.tsx'), 'export const DataTable = () => null')
  })

  afterAll(() => {
    rmSync(uiDir, { recursive: true, force: true })
  })

  it('discovers components from the filesystem (under the default Ui prefix)', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir })
    // Tags carry the `Ui` prefix; the resolver strips it to find the file and
    // reports the real export name to import.
    expect(r.resolve('UiButton')?.from).toBe('@/components/ui/button')
    expect(r.resolve('UiButton')?.name).toBe('Button')
    expect(r.resolve('UiDropdownMenu')?.from).toBe('@/components/ui/dropdown-menu')
    // User-authored component in the same folder works too — no hardcoded list to gate it.
    expect(r.resolve('UiDataTable')?.from).toBe('@/components/ui/data-table')
    // Bare (unprefixed) names are ignored so they don't shadow native tags.
    expect(r.resolve('Button')).toBeUndefined()
  })

  it('prefix: "" opts out, matching bare component names', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir, prefix: '' })
    expect(r.resolve('Button')?.from).toBe('@/components/ui/button')
    expect(r.resolve('Button')?.name).toBe('Button')
  })

  it('returns Export type by default', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir })
    expect(r.resolve('UiButton')?.type).toBe('Export')
  })

  it('defaultExport: true flips to ExportDefault', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir, defaultExport: true })
    expect(r.resolve('UiButton')?.type).toBe('ExportDefault')
  })

  it('explicit components list overrides filesystem', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir, components: ['CustomThing'] })
    expect(r.resolve('UiCustomThing')?.from).toBe('@/components/ui/custom-thing')
    expect(r.resolve('UiButton')).toBeUndefined()
  })

  it('componentsDir override changes the emitted import path', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir, componentsDir: '~/ui' })
    expect(r.resolve('UiButton')?.from).toBe('~/ui/button')
  })

  it('warns + returns empty when nothing matches', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = ShadcnResolver({ componentsRoot: '/tmp/does-not-exist-urc-test' })
    expect(r.resolve('UiButton')).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('list() yields one Ui-prefixed entry per discovered file', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir })
    const list = r.list!()
    const names = list.map(i => i.jsxName).sort()
    expect(names).toEqual(['UiButton', 'UiDataTable', 'UiDropdownMenu'])
    // jsxName carries the prefix; name stays the real export.
    expect(list.find(i => i.jsxName === 'UiButton')?.name).toBe('Button')
  })
})
