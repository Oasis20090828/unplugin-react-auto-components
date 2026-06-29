import { describe, expect, it } from 'vitest'
import MagicString from 'magic-string'
import type {
  ComponentResolveResult,
  ComponentResolver,
  Components,
  TransformOptions,
} from '../src/types'
import { transform } from '../src/core/transformer'

function ctx(input: string, partial: Partial<TransformOptions> = {}): TransformOptions {
  return {
    id: partial.id ?? '/virtual/App.tsx',
    code: new MagicString(input),
    components: partial.components ?? (new Set() as Components),
    rootDir: process.cwd(),
    resolvers: partial.resolvers ?? [],
    local: partial.local ?? true,
    localNames: partial.localNames,
    consumerUsage: partial.consumerUsage,
  }
}

function tableResolver(items: ComponentResolveResult[]): ComponentResolver {
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

describe('transformer (raw JSX)', () => {
  it('injects a named import for a resolver component, leaving the JSX untouched', () => {
    const src = `export default function App() { return <Button>ok</Button>; }`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Button', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).toContain("import { Button } from 'antd'")
    // The JSX itself is NOT rewritten — the bundler compiles it afterwards.
    expect(out).toContain('<Button>ok</Button>')
  })

  it('honors prefix mapping: <AntButton/> → import { Button as AntButton }', () => {
    const src = `const x = <AntButton />`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'AntButton', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).toContain("import { Button as AntButton } from 'antd'")
  })

  it('emits a default import when type is ExportDefault', () => {
    const src = `const x = <Foo />`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Foo', name: 'Foo', from: './Foo', type: 'ExportDefault' },
      ])],
    })
    const out = transform(o)
    expect(out).toContain("import Foo from './Foo'")
  })

  it('emits a side-effect style import when present', () => {
    const src = `const x = <DatePicker />`
    const o = ctx(src, {
      resolvers: [tableResolver([{
        jsxName: 'DatePicker',
        name: 'DatePicker',
        from: 'antd',
        type: 'Export',
        style: 'antd/es/date-picker/style/css',
      }])],
    })
    const out = transform(o)
    expect(out).toContain("import { DatePicker } from 'antd'")
    expect(out).toContain("import 'antd/es/date-picker/style/css'")
  })

  it('handles nested JSX (jsxs path) and imports each component once', () => {
    const src = `const x = <Card><Button/><Button/></Card>`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Card', name: 'Card', from: 'antd', type: 'Export' },
        { jsxName: 'Button', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).toContain("import { Card } from 'antd'")
    expect(out).toContain("import { Button } from 'antd'")
    // Button used twice but imported once.
    expect((out.match(/import \{ Button \} from 'antd'/g) || []).length).toBe(1)
  })

  it('deduplicates repeated uses of the same component', () => {
    const src = `const a = <Button/>; const b = <Button/>;`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Button', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    const matches = out.match(/import \{ Button \} from 'antd'/g) || []
    expect(matches.length).toBe(1)
  })

  it('falls back to local components when no resolver matches', () => {
    const local: Components = new Set([
      { name: 'Hello', path: '/repo/src/Hello.tsx', type: 'ExportDefault' },
    ])
    const src = `const x = <Hello />`
    const o = ctx(src, { components: local, id: '/repo/src/App.tsx' })
    const out = transform(o)
    expect(out).toContain("import Hello from './Hello'")
  })

  it('namespaces same-named local files: <Hello/> bare, <ExtraHello/> by dir', () => {
    // Two files export `Hello`. Lowest path keeps the bare tag; the other is
    // reachable via a directory-namespaced tag — so BOTH stay importable.
    const local: Components = new Set([
      { name: 'Hello', path: '/repo/src/extra/Hello.tsx', type: 'ExportDefault' },
      { name: 'Hello', path: '/repo/src/Hello.tsx', type: 'ExportDefault' },
    ])
    const src = `const x = <div><Hello /><ExtraHello /></div>`
    const o = ctx(src, { components: local, id: '/repo/src/App.tsx' })
    const out = transform(o)
    expect(out).toContain("import Hello from './Hello'")
    expect(out).toContain("import ExtraHello from './extra/Hello'")
  })

  it('uses a precomputed localNames map (perf path) instead of rebuilding from components', () => {
    // `components` is empty, but the precomputed map says <Widget/> is local —
    // the transformer must trust the passed map (the plugin builds it once and
    // reuses it across files instead of recomputing per transform).
    const localNames = new Map<string, { name: string; path: string; type: 'ExportDefault' }>([
      ['Widget', { name: 'Widget', path: '/repo/src/ui/Widget.tsx', type: 'ExportDefault' }],
    ])
    const src = `const x = <Widget/>`
    const o = ctx(src, {
      components: new Set() as Components,
      localNames: localNames as unknown as TransformOptions['localNames'],
      id: '/repo/src/App.tsx',
    })
    const out = transform(o)
    expect(out).toContain("import Widget from './ui/Widget'")
  })

  it('prefers a local component over a resolver on a name collision (matches dts "local wins")', () => {
    // <App/> exists both as a local file and as a resolver export (e.g. antd's
    // App). generateDts declares the local one, so the transformer must inject
    // the local import too — otherwise the emitted .d.ts type and the actual
    // import would point at different modules.
    const local: Components = new Set([
      { name: 'App', path: '/repo/src/App.tsx', type: 'ExportDefault' },
    ])
    const src = `const x = <App/>`
    const o = ctx(src, {
      components: local,
      id: '/repo/src/pages/Home.tsx',
      resolvers: [tableResolver([
        { jsxName: 'App', name: 'App', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).toContain("import App from '../App'")
    expect(out).not.toContain("from 'antd'")
  })

  it('emits a RELATIVE specifier for local components (Vite resolves "/" against root)', () => {
    const local: Components = new Set([
      { name: 'Card', path: '/repo/src/components/Card.tsx', type: 'ExportDefault' },
    ])
    const src = `const x = <Card />`
    const o = ctx(src, { components: local, id: '/repo/src/pages/Home.tsx' })
    const out = transform(o)
    // ../components/Card — never a leading "/", never a ".tsx" extension
    expect(out).toContain("import Card from '../components/Card'")
    expect(out).not.toContain("'/repo")
  })

  it('first-match-wins between resolvers', () => {
    const src = `const x = <Button />`
    const o = ctx(src, {
      resolvers: [
        tableResolver([{ jsxName: 'Button', name: 'Button', from: 'lib-a', type: 'Export' }]),
        tableResolver([{ jsxName: 'Button', name: 'Button', from: 'lib-b', type: 'Export' }]),
      ],
    })
    const out = transform(o)
    expect(out).toContain("from 'lib-a'")
    expect(out).not.toContain("from 'lib-b'")
  })

  it('does NOT shadow a name already imported by the module', () => {
    // The classic footgun: user has their own <App/> but antd also exports App.
    const src = `import App from "./App";\nconst x = <App/>`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'App', name: 'App', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).not.toContain("from 'antd'")
  })

  it('does NOT re-import a name with an existing named import', () => {
    const src = `import { Button } from "./ui";\nconst x = <Button/>`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Button', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).not.toContain("from 'antd'")
  })

  it('does NOT auto-import a locally declared component', () => {
    const src = `function Card() { return null }\nconst x = <Card/>`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Card', name: 'Card', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).not.toContain("from 'antd'")
  })

  it('ignores intrinsic (lowercase) HTML tags', () => {
    const src = `const x = <div>hi</div>`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Div', name: 'Div', from: 'whatever', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).not.toContain('whatever')
  })

  it('does NOT mistake TS generics for components (AST, not regex)', () => {
    // `<Card>` here is a type argument, not JSX — must not be auto-imported.
    const src = `const r = useRef<Card>(null); const m = new Map<string, Card>();`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Card', name: 'Card', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).not.toContain("from 'antd'")
    expect(out).toBe(src)
  })

  it('returns input unchanged when there is no component JSX', () => {
    const src = `export const x = 1`
    const o = ctx(src)
    const out = transform(o)
    expect(out).toBe(src)
  })

  it('records consumer usage and clears stale entries on re-transform', () => {
    const consumerUsage = new Map<string, Set<string>>()
    const resolver = tableResolver([
      { jsxName: 'Foo', name: 'Foo', from: 'lib', type: 'Export' },
      { jsxName: 'Bar', name: 'Bar', from: 'lib', type: 'Export' },
    ])

    // First pass: file uses Foo and Bar.
    const src1 = `const x = <div><Foo/><Bar/></div>`
    transform(ctx(src1, { id: '/p/A.tsx', resolvers: [resolver], consumerUsage }))
    expect(consumerUsage.get('/p/A.tsx')).toEqual(new Set(['Foo', 'Bar']))

    // Second pass: user removed <Bar/>. Re-transform clears stale entries
    // first, then re-records — leaving only Foo for this consumer.
    const src2 = `const x = <div><Foo/></div>`
    transform(ctx(src2, { id: '/p/A.tsx', resolvers: [resolver], consumerUsage }))
    expect(consumerUsage.get('/p/A.tsx')).toEqual(new Set(['Foo']))
  })
})
