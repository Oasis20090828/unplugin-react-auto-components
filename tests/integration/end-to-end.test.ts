/**
 * End-to-end integration test for the plugin lifecycle.
 *
 * Instead of standing up a real Vite/Webpack build (which would balloon the
 * dev dependencies just for one test), we exercise the same pipeline a bundler
 * would: instantiate the unplugin factory, run `buildStart`, then feed
 * post-JSX-runtime code through `transform` and assert the injected imports,
 * the emitted `components.d.ts`, and the alias replacement.
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
  it('boots, scans the fixture, emits dts, transforms post-JSX code', async () => {
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

    // dts was written at buildStart and dedupes local + resolver.
    const dts = readFileSync(join(root, 'components.d.ts'), 'utf-8')
    expect(dts).toMatch(/const HelloWorld: typeof import\('\.\/src\/components\/HelloWorld'\)\['default'\]/)
    expect(dts).toMatch(/const UiButton: typeof import\('fake-ui'\)\['Button'\]/)
    expect(dts).toMatch(/const UiCard: typeof import\('fake-ui'\)\['Card'\]/)

    // Now feed the post-JSX-runtime form of App.tsx (what plugin-react would
    // emit) through transform. Should inject imports for the local component
    // AND the resolver component, leaving the user's own bindings alone.
    const postJsxApp = `import { jsx } from "react/jsx-runtime";
import alreadyImported from "./somewhere";
function App() {
  return jsx(UiButton, { children: [jsx(HelloWorld, {}), jsx(UiCard, {})] });
}`
    const out = plugin.transform(postJsxApp, join(root, 'src/App.tsx'))
    expect(out).toBeTruthy()
    const code = typeof out === 'string' ? out : (out as { code: string }).code

    // resolver-driven imports
    expect(code).toMatch(/import \{ Button as _unplugin_react_UiButton_\d+ \} from 'fake-ui'/)
    expect(code).toMatch(/import \{ Card as _unplugin_react_UiCard_\d+ \} from 'fake-ui'/)
    // local-component import via relative path (no leading '/')
    expect(code).toMatch(/import _unplugin_react_HelloWorld_\d+ from '\.\/components\/HelloWorld'/)
    // call sites were rewritten
    expect(code).toMatch(/jsx\(_unplugin_react_UiButton_\d+,/)
    expect(code).toMatch(/jsx\(_unplugin_react_HelloWorld_\d+,/)
    expect(code).toMatch(/jsx\(_unplugin_react_UiCard_\d+,/)
    // pre-existing import was not touched and not re-injected
    expect(code).toContain(`import alreadyImported from "./somewhere"`)
  })

  it('honors transformInclude filter (.ts is excluded by default)', () => {
    const plugin = realize(callFactory({ rootDir: root, dts: false }))
    expect(plugin.transformInclude('/anything/App.tsx')).toBe(true)
    expect(plugin.transformInclude('/anything/App.ts')).toBe(false)
    expect(plugin.transformInclude('/node_modules/x/App.tsx')).toBe(false)
  })
})
