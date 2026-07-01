/**
 * End-to-end coverage for plugin options that had no integration test:
 *   - `dirs`   (sugar that scopes the scan to specific folders)
 *   - custom `include` / `exclude` (the transform filter)
 *   - a REAL resolver (ShadcnResolver) flowing through the whole factory
 *     pipeline (buildStart → dts emit → transform), not just the fake one.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unpluginFactory } from '../../src/index'
import { ShadcnResolver } from '../../src/core/resolvers/shadcn'

interface PluginShape {
  buildStart: () => Promise<void> | void
  transformInclude: (id: string) => boolean
  transform: (
    code: string,
    id: string,
  ) => { code: string; map?: unknown } | string | undefined | null
}
const callFactory = unpluginFactory as unknown as (
  o: Parameters<typeof unpluginFactory>[0],
) => ReturnType<typeof unpluginFactory>
const realize = (o: ReturnType<typeof unpluginFactory>) =>
  o as unknown as PluginShape
const codeOf = (out: ReturnType<PluginShape['transform']>) =>
  typeof out === 'string' ? out : (out as { code: string }).code
const comp = (n: string) => `export default function ${n}() { return <i/> }`

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'urc-opts-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('dirs option', () => {
  it('scopes the scan to the listed folders (sugar over globs)', async () => {
    mkdirSync(join(root, 'widgets'), { recursive: true })
    mkdirSync(join(root, 'other'), { recursive: true })
    writeFileSync(join(root, 'widgets', 'Widget.tsx'), comp('Widget'))
    writeFileSync(join(root, 'other', 'Other.tsx'), comp('Other'))

    const plugin = realize(
      callFactory({ rootDir: root, dirs: ['widgets'], dts: true, local: true }),
    )
    await plugin.buildStart()

    // no src/ → dts lands at the root
    const dts = readFileSync(join(root, 'components.d.ts'), 'utf-8')
    expect(dts).toContain('const Widget:')
    expect(dts).not.toContain('Other')
  })
})

describe('include / exclude filter', () => {
  it('default: matches .tsx/.jsx, skips .ts and node_modules', () => {
    const p = realize(callFactory({ rootDir: root, dts: false }))
    expect(p.transformInclude('/x/App.tsx')).toBe(true)
    expect(p.transformInclude('/x/App.jsx')).toBe(true)
    expect(p.transformInclude('/x/App.ts')).toBe(false)
    expect(p.transformInclude('/x/node_modules/y/App.tsx')).toBe(false)
  })

  it('custom exclude drops matching files', () => {
    const p = realize(
      callFactory({ rootDir: root, dts: false, exclude: [/[\\/]generated[\\/]/] }),
    )
    expect(p.transformInclude('/x/App.tsx')).toBe(true)
    expect(p.transformInclude('/x/generated/App.tsx')).toBe(false)
  })

  it('custom include replaces the default extension set', () => {
    const p = realize(
      callFactory({ rootDir: root, dts: false, include: [/\.custom$/] }),
    )
    expect(p.transformInclude('/x/a.custom')).toBe(true)
    expect(p.transformInclude('/x/a.tsx')).toBe(false)
  })
})

describe('real resolver through the full factory pipeline', () => {
  it('ShadcnResolver: emits Ui-prefixed dts and injects the aliased import', async () => {
    const ui = join(root, 'ui')
    mkdirSync(ui, { recursive: true })
    writeFileSync(join(ui, 'button.tsx'), 'export function Button() { return null }')

    const plugin = realize(
      callFactory({
        rootDir: root,
        local: false, // shadcn owns its components via the resolver
        dts: true,
        resolvers: [
          ShadcnResolver({ componentsRoot: ui, componentsDir: '@/components/ui' }),
        ],
      }),
    )
    await plugin.buildStart()

    // dts: list() ran through the factory → Ui-prefixed declaration
    const dts = readFileSync(join(root, 'components.d.ts'), 'utf-8')
    expect(dts).toContain(
      "const UiButton: typeof import('@/components/ui/button')['Button']",
    )

    // transform: resolve() ran through the factory → aliased import injected
    const out = plugin.transform(
      'function Page() { return <UiButton/> }',
      join(root, 'Page.tsx'),
    )
    expect(codeOf(out)).toContain(
      "import { Button as UiButton } from '@/components/ui/button'",
    )
    // local discovery is off → no stray dts beside it from the ui/ scan
    expect(existsSync(join(root, 'ui', 'components.d.ts'))).toBe(false)
  })
})
