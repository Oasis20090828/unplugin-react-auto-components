/**
 * End-to-end integration test for the plugin lifecycle.
 *
 * Instead of standing up a real Vite/Webpack build (which would balloon the
 * dev dependencies just for one test), we exercise the same pipeline a bundler
 * would: instantiate the unplugin factory, run `buildStart`, then feed
 * raw JSX through `transform` and assert the injected imports, the emitted
 * `components.d.ts`, and that the JSX is left untouched.
 *
 * Catches regressions across: searchGlob → setupResolvers → buildStart → dts
 * write → transform → bound-name guard → resolver precedence.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unpluginFactory } from '../../src/index'
import type { ComponentResolver } from '../../src/types'

// Stand-in for a UI library resolver. Doesn't touch the network or
// `local-pkg`; static curated list is enough.
function fakeUiResolver(): ComponentResolver {
  const components = [
    { jsxName: 'UiButton', name: 'Button', from: 'fake-ui' },
    { jsxName: 'UiCard', name: 'Card', from: 'fake-ui' },
  ] as const
  return {
    type: 'component',
    resolve(jsxName) {
      const hit = components.find((c) => c.jsxName === jsxName)
      return hit ? { ...hit, type: 'Export' } : undefined
    },
    list() {
      return components.map((c) => ({ ...c, type: 'Export' as const }))
    },
  }
}

// Minimal helper: realize whatever the factory returns into something we can
// call. unplugin's factory return type is UnpluginOptions | UnpluginOptions[];
// ours is always the single-object form, so we narrow with a cast for the
// test surface we touch.
interface PluginShape {
  name: string
  buildStart: () => Promise<void> | void
  transformInclude: (id: string) => boolean
  transform: (
    code: string,
    id: string,
  ) => { code: string; map?: unknown } | string | undefined | null
}

function realize(opts: ReturnType<typeof unpluginFactory>): PluginShape {
  return opts as unknown as PluginShape
}

// Wrap the factory so callers don't have to pass the `meta` arg a real bundler
// would supply. We're not in a bundler — `meta` doesn't matter for our code.
const callFactory = unpluginFactory as unknown as (opts: Parameters<typeof unpluginFactory>[0]) => ReturnType<typeof unpluginFactory>;

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'urc-e2e-'))
  // Real on-disk fixture so `searchGlob` finds something and the relative
  // path math in `transformer.toRelativeImport` has a real layout.
  mkdirSync(join(root, 'src', 'components'), { recursive: true })
  writeFileSync(
    join(root, 'src', 'components', 'HelloWorld.tsx'),
    'export default function HelloWorld() { return <h1>hi</h1> }',
  )
  writeFileSync(
    join(root, 'src', 'App.tsx'),
    'export default function App() { return <div>app</div> }',
  )
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('end-to-end pipeline', () => {
  it('boots, scans the fixture, emits dts, transforms raw JSX', async () => {
    const plugin = realize(
      callFactory({
        rootDir: root,
        resolvers: [fakeUiResolver()],
        dts: true,
        local: true,
      }),
    )

    // Bundler-side: filter, then run lifecycle.
    expect(plugin.transformInclude(join(root, 'src/App.tsx'))).toBe(true)
    await plugin.buildStart()

    // dts was written at buildStart and dedupes local + resolver. With smart
    // placement, the file lands in `<root>/src/` (the fixture has no `types/`
    // subfolder), and relative imports are computed from there.
    const dts = readFileSync(join(root, 'src/components.d.ts'), 'utf-8')
    expect(dts).toMatch(/const HelloWorld: typeof import\('\.\/components\/HelloWorld'\)\['default'\]/)
    expect(dts).toMatch(/const UiButton: typeof import\('fake-ui'\)\['Button'\]/)
    expect(dts).toMatch(/const UiCard: typeof import\('fake-ui'\)\['Card'\]/)

    // Now feed the RAW JSX form of App.tsx through transform. Should inject
    // imports for the local component AND the resolver components, leaving the
    // user's own bindings — and the JSX itself — alone.
    const rawApp = `import alreadyImported from "./somewhere";
function App() {
  return <UiButton><HelloWorld/><UiCard/></UiButton>;
}`
    const out = plugin.transform(rawApp, join(root, 'src/App.tsx'))
    expect(out).toBeTruthy()
    const code = typeof out === 'string' ? out : (out as { code: string }).code

    // resolver-driven imports (bound directly to the JSX name)
    expect(code).toContain("import { Button as UiButton } from 'fake-ui'")
    expect(code).toContain("import { Card as UiCard } from 'fake-ui'")
    // local-component import via relative path (no leading '/')
    expect(code).toMatch(/import HelloWorld from '\.\/components\/HelloWorld'/)
    // the JSX is left untouched — no call-site rewriting
    expect(code).toContain('<UiButton>')
    expect(code).toContain('<HelloWorld/>')
    // pre-existing import was not touched and not re-injected
    expect(code).toContain(`import alreadyImported from "./somewhere"`)
  })

  it('honors transformInclude filter (.ts is excluded by default)', () => {
    const plugin = realize(callFactory({ rootDir: root, dts: false }))
    expect(plugin.transformInclude('/anything/App.tsx')).toBe(true)
    expect(plugin.transformInclude('/anything/App.ts')).toBe(false)
    expect(plugin.transformInclude('/node_modules/x/App.tsx')).toBe(false)
  })

  it('skips the module (returns undefined, no sourcemap) when nothing is injected', () => {
    const plugin = realize(
      callFactory({ rootDir: root, resolvers: [fakeUiResolver()], dts: false, local: false }),
    )
    // No auto-importable component JSX → the transformer injects nothing → the
    // hook must return undefined so the bundler skips it (no wasted sourcemap).
    expect(plugin.transform('export const x = 1', join(root, 'src/plain.tsx'))).toBeUndefined()
  })

  it('returns { code, map } only when an import is actually injected', () => {
    const plugin = realize(
      callFactory({ rootDir: root, resolvers: [fakeUiResolver()], dts: false, local: false }),
    )
    const out = plugin.transform('const y = <UiButton/>', join(root, 'src/uses.tsx'))
    expect(out).toBeTruthy()
    const obj = out as { code: string; map?: unknown }
    expect(obj.code).toContain("import { Button as UiButton } from 'fake-ui'")
    expect(obj.map).toBeTruthy()
  })

  it('applies importPathTransform to both the injected import and the dts', async () => {
    const plugin = realize(
      callFactory({
        rootDir: root,
        resolvers: [fakeUiResolver()],
        dts: true,
        local: false,
        // Redirect the bare barrel to its ESM deep-import entry.
        importPathTransform: (p) => (p === 'fake-ui' ? 'fake-ui/es' : undefined),
      }),
    )
    await plugin.buildStart()

    // dts declaration points at the rewritten specifier…
    const dts = readFileSync(join(root, 'src/components.d.ts'), 'utf-8')
    expect(dts).toContain("typeof import('fake-ui/es')['Button']")
    expect(dts).not.toContain("typeof import('fake-ui')['Button']")

    // …and so does the injected import — the two stay in agreement.
    const out = plugin.transform('const y = <UiButton/>', join(root, 'src/uses.tsx'))
    const code = (out as { code: string }).code
    expect(code).toContain("import { Button as UiButton } from 'fake-ui/es'")
  })
})
