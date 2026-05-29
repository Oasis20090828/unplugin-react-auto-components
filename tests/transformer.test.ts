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

describe('transformer (post-JSX runtime)', () => {
  it('matches bare jsxDEV( (Vite dev binding, no underscore)', () => {
    const src = `import { jsxDEV } from "react/jsx-dev-runtime";\nexport default function App() { return jsxDEV(Button, {}); }`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Button', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).toContain("import { Button as _unplugin_react_Button_0 } from 'antd'")
    expect(out).toMatch(/[^_]jsxDEV\(_unplugin_react_Button_0,/)
  })

  it('rewrites _jsxDEV(Button) and prepends a named import', () => {
    const src = `import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";\nexport default function App() { return _jsxDEV(Button, { children: "x" }); }`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Button', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).toContain("import { Button as _unplugin_react_Button_0 } from 'antd'")
    expect(out).toContain('_jsxDEV(_unplugin_react_Button_0,')
    expect(out).not.toMatch(/_jsxDEV\(Button,/)
  })

  it('honors prefix mapping: AntButton → import { Button } from "antd"', () => {
    const src = `import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";\n_jsxDEV(AntButton, {})`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'AntButton', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).toContain("import { Button as _unplugin_react_AntButton_0 } from 'antd'")
    expect(out).toContain('_jsxDEV(_unplugin_react_AntButton_0,')
  })

  it('handles prod jsxs() (multiple children) and preserves the fn name', () => {
    const src = `import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";\n_jsxs(Card, { children: [_jsx(Button, {}), _jsx(Button, {})] })`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Card', name: 'Card', from: 'antd', type: 'Export' },
        { jsxName: 'Button', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    // jsxs stays jsxs (NOT rewritten to jsx — they pass children differently)
    expect(out).toMatch(/_jsxs\(_unplugin_react_Card_0,/)
    expect(out).toMatch(/_jsx\(_unplugin_react_Button_1,/)
    // Button used twice but imported once
    expect((out.match(/import \{ Button as/g) || []).length).toBe(1)
  })

  it('emits default-import when type is ExportDefault', () => {
    const src = `import { jsx as _jsx } from "react/jsx-runtime";\nconst x = _jsx(Foo, {})`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Foo', name: 'Foo', from: './Foo', type: 'ExportDefault' },
      ])],
    })
    const out = transform(o)
    expect(out).toContain("import _unplugin_react_Foo_0 from './Foo'")
    expect(out).toContain('jsx(_unplugin_react_Foo_0,')
  })

  it('emits a side-effect style import when present', () => {
    const src = `import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";\n_jsxDEV(DatePicker, {})`
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
    expect(out).toContain("import { DatePicker as _unplugin_react_DatePicker_0 } from 'antd'")
    expect(out).toContain("import 'antd/es/date-picker/style/css'")
  })

  it('deduplicates repeated uses of the same component', () => {
    const src = `import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";\n_jsxDEV(Button, {}); _jsxDEV(Button, {});`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Button', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    const matches = out.match(/import \{ Button as/g) || []
    expect(matches.length).toBe(1)
  })

  it('falls back to local components when no resolver matches', () => {
    const local: Components = new Set([
      { name: 'Hello', path: '/repo/src/Hello.tsx', type: 'ExportDefault' },
    ])
    const src = `import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";\n_jsxDEV(Hello, {})`
    const o = ctx(src, { components: local, id: '/repo/src/App.tsx' })
    const out = transform(o)
    expect(out).toContain("import _unplugin_react_Hello_0 from './Hello'")
  })

  it('emits a RELATIVE specifier for local components (Vite resolves "/" against root)', () => {
    const local: Components = new Set([
      { name: 'Card', path: '/repo/src/components/Card.tsx', type: 'ExportDefault' },
    ])
    const src = `import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";\n_jsxDEV(Card, {})`
    const o = ctx(src, { components: local, id: '/repo/src/pages/Home.tsx' })
    const out = transform(o)
    // ../components/Card  — never a leading "/", never a ".tsx" extension
    expect(out).toContain("import _unplugin_react_Card_0 from '../components/Card'")
    expect(out).not.toContain("'/repo")
  })

  it('first-match-wins between resolvers', () => {
    const src = `import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";\n_jsxDEV(Button, {})`
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
    const src = `import App from "./App";\nimport { jsx } from "react/jsx-runtime";\njsx(App, {})`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'App', name: 'App', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).not.toContain("from 'antd'")
    expect(out).not.toContain('_unplugin_react_App')
  })

  it('does NOT re-import a name with an existing named import', () => {
    const src = `import { Button } from "./ui";\nimport { jsx } from "react/jsx-runtime";\njsx(Button, {})`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Button', name: 'Button', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).not.toContain("from 'antd'")
  })

  it('does NOT auto-import a locally declared component', () => {
    const src = `import { jsx } from "react/jsx-runtime";\nfunction Card() { return null }\njsx(Card, {})`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Card', name: 'Card', from: 'antd', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).not.toContain("from 'antd'")
  })

  it('ignores intrinsic HTML tag calls', () => {
    const src = `import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";\n_jsxDEV("div", { children: "x" })`
    const o = ctx(src, {
      resolvers: [tableResolver([
        { jsxName: 'Div', name: 'Div', from: 'whatever', type: 'Export' },
      ])],
    })
    const out = transform(o)
    expect(out).not.toContain('whatever')
  })

  it('returns input unchanged when there is no JSX runtime', () => {
    const src = `export const x = 1`
    const o = ctx(src)
    const out = transform(o)
    expect(out).toBe(src)
  })
})
