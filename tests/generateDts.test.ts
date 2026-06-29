import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { generateDts } from '../src/core/generateDts'
import type { ComponentResolveResult, ComponentResolver, Components } from '../src/types'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'urc-dts-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function staticResolver(items: ComponentResolveResult[]): ComponentResolver {
  return {
    type: 'component',
    resolve(jsxName) {
      return items.find(i => i.jsxName === jsxName)
    },
    list() {
      return items
    },
  }
}

describe('generateDts', () => {
  it('emits declare global block for both local and resolver components', () => {
    const components: Components = new Set([
      { name: 'Hello', path: `${root}/src/Hello.tsx`, type: 'Export' },
      { name: 'World', path: `${root}/src/World.tsx`, type: 'ExportDefault' },
    ])
    const resolvers = [
      staticResolver([
        { jsxName: 'AntButton', name: 'Button', from: 'antd', type: 'Export' },
        { jsxName: 'MyDefault', name: 'MyDefault', from: './x', type: 'ExportDefault' },
      ]),
    ]

    generateDts({
      components,
      resolvers,
      local: true,
      rootPath: root,
      filename: 'components',
    })

    const out = readFileSync(`${root}/components.d.ts`, 'utf-8')
    expect(out).toContain('declare global {')
    expect(out).toContain(`const Hello: typeof import('./src/Hello')['Hello']`)
    expect(out).toContain(`const World: typeof import('./src/World')['default']`)
    expect(out).toContain(`const AntButton: typeof import('antd')['Button']`)
    expect(out).toContain(`const MyDefault: typeof import('./x')['default']`)
  })

  it('emits declarations in a stable, name-sorted order regardless of insertion order', () => {
    // Insertion order here is deliberately unsorted (and mixes local + resolver
    // sources) — the watcher re-appends an edited component at the end of the
    // Set, so we must not rely on insertion order for a clean git diff.
    const components: Components = new Set([
      { name: 'Zebra', path: `${root}/src/Zebra.tsx`, type: 'Export' },
      { name: 'Apple', path: `${root}/src/Apple.tsx`, type: 'Export' },
    ])
    const resolvers = [
      staticResolver([
        { jsxName: 'Mango', name: 'Mango', from: 'fruit', type: 'Export' },
      ]),
    ]

    generateDts({
      components,
      resolvers,
      local: true,
      rootPath: root,
      filename: 'components',
    })

    const out = readFileSync(`${root}/components.d.ts`, 'utf-8')
    const names = out
      .split('\n')
      .map((l) => l.match(/^\s+const (\w+):/)?.[1])
      .filter(Boolean)
    expect(names).toEqual(['Apple', 'Mango', 'Zebra'])
  })

  it('skips local block when local: false', () => {
    const components: Components = new Set([
      { name: 'OnlyLocal', path: `${root}/src/OnlyLocal.tsx`, type: 'Export' },
    ])
    generateDts({
      components,
      resolvers: [],
      local: false,
      rootPath: root,
      filename: 'components',
    })
    const out = readFileSync(`${root}/components.d.ts`, 'utf-8')
    expect(out).not.toContain('OnlyLocal')
  })

  it('never drops a component when a namespaced tag would collide with a real name', () => {
    // Two Card.tsx (one under ui/) plus a separately-authored UiCard. The ui/
    // collision would auto-namespace to "UiCard" — which must NOT clobber the
    // real UiCard. All three stay declared (none silently dropped).
    const components: Components = new Set([
      { name: 'Card', path: `${root}/a/Card.tsx`, type: 'ExportDefault' },
      { name: 'Card', path: `${root}/ui/Card.tsx`, type: 'ExportDefault' },
      { name: 'UiCard', path: `${root}/z/UiCard.tsx`, type: 'ExportDefault' },
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    generateDts({ components, resolvers: [], local: true, rootPath: root, filename: 'components' })
    warn.mockRestore()

    const out = readFileSync(`${root}/components.d.ts`, 'utf-8')
    // Every source file is represented — none overwritten/dropped.
    expect(out).toContain(`import('./a/Card')`)
    expect(out).toContain(`import('./ui/Card')`)
    expect(out).toContain(`import('./z/UiCard')`)
    const consts = out.split('\n').filter((l) => /^\s+const \w/.test(l))
    expect(consts).toHaveLength(3)
  })

  it('only emits valid JS identifiers, even when a disambiguating dir is identifier-illegal', () => {
    // The lower-path "1/" wins the bare tag; "9/" must be namespaced — and a
    // naive `9` + `Card` prefix would yield the illegal `const 9Card`.
    const components: Components = new Set([
      { name: 'Card', path: `${root}/1/Card.tsx`, type: 'ExportDefault' },
      { name: 'Card', path: `${root}/9/Card.tsx`, type: 'ExportDefault' },
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    generateDts({ components, resolvers: [], local: true, rootPath: root, filename: 'components' })
    warn.mockRestore()

    const out = readFileSync(`${root}/components.d.ts`, 'utf-8')
    const names = out
      .split('\n')
      .map((l) => l.match(/^\s+const (\S+):/)?.[1])
      .filter(Boolean) as string[]
    expect(names.length).toBe(2)
    for (const n of names) expect(n).toMatch(/^[A-Za-z_$][\w$]*$/)
    expect(out).toContain(`import('./1/Card')`)
    expect(out).toContain(`import('./9/Card')`)
  })

  it('dedupes: local wins over resolver of the same name + warns', () => {
    // Same identifier "App" coming from both a local file and a resolver — a
    // real case (user's App.tsx vs antd v5's App component). Without dedupe
    // the dts had two `const App: ...` lines.
    const components: Components = new Set([
      { name: 'App', path: `${root}/src/App.tsx`, type: 'ExportDefault' },
    ])
    const resolvers = [
      staticResolver([
        { jsxName: 'App', name: 'App', from: 'antd', type: 'Export' },
      ]),
    ]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    generateDts({
      components,
      resolvers,
      local: true,
      rootPath: root,
      filename: 'components',
    })

    const out = readFileSync(`${root}/components.d.ts`, 'utf-8')
    const appLines = out.split('\n').filter((l) => /^\s+const App:/.test(l))
    expect(appLines).toHaveLength(1)
    // local wins
    expect(appLines[0]).toContain(`typeof import('./src/App')['default']`)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toMatch(/"App" is both a local component/)
    warn.mockRestore()
  })

  it('namespaces same-named local files so both import, deterministically (no rewrite loop)', () => {
    // Two local components named "App" (e.g. components/App.jsx and a stray
    // pages/_app.jsx). The `components` Set's iteration order isn't stable across
    // scans, so without a deterministic assignment the emitted dts flips between
    // builds — an infinite rewrite → recompile loop in a dev server. Both must
    // be kept (not dropped): the lower path stays bare, the other is namespaced.
    const a = { name: 'App', path: `${root}/components/App.jsx`, type: 'ExportDefault' as const }
    const b = { name: 'App', path: `${root}/pages/_app.jsx`, type: 'ExportDefault' as const }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const forward = generateDts({
      components: new Set([a, b]),
      resolvers: [],
      local: true,
      rootPath: root,
      filename: 'components',
    })
    const reversed = generateDts({
      components: new Set([b, a]),
      resolvers: [],
      local: true,
      rootPath: root,
      filename: 'components',
    })

    // Same output regardless of Set order — this is what breaks the loop.
    expect(forward).toBe(reversed)
    // Lowest path keeps the bare tag; the other is namespaced by its parent dir.
    // BOTH are present — neither is silently dropped.
    expect(forward).toContain(`const App: typeof import('./components/App')['default']`)
    expect(forward).toContain(`const PagesApp: typeof import('./pages/_app')['default']`)
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toMatch(/local components named "App"/)
    warn.mockRestore()
  })

  it('dedupes: when two resolvers expose the same name, first wins', () => {
    const resolvers = [
      staticResolver([{ jsxName: 'Button', name: 'Button', from: 'lib-a', type: 'Export' }]),
      staticResolver([{ jsxName: 'Button', name: 'Button', from: 'lib-b', type: 'Export' }]),
    ]
    generateDts({
      components: new Set(),
      resolvers,
      local: false,
      rootPath: root,
      filename: 'components',
    })
    const out = readFileSync(`${root}/components.d.ts`, 'utf-8')
    const buttonLines = out.split('\n').filter((l) => /^\s+const Button:/.test(l))
    expect(buttonLines).toHaveLength(1)
    expect(buttonLines[0]).toContain("'lib-a'")
  })

  it('silently skips resolvers that do not implement list()', () => {
    const resolverWithoutList: ComponentResolver = {
      type: 'component',
      resolve() { return undefined },
    }
    generateDts({
      components: new Set(),
      resolvers: [resolverWithoutList],
      local: false,
      rootPath: root,
      filename: 'components',
    })
    const out = readFileSync(`${root}/components.d.ts`, 'utf-8')
    // Should produce a valid (empty) declare global block.
    expect(out).toContain('declare global {')
    expect(out).toContain('}')
  })
})
