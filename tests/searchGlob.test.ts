import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanFile, searchGlob } from '../src/core/searchGlob'
import { resolveLocalJsxNames } from '../src/core/manager'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'urc-glob-'))
  mkdirSync(join(root, 'nested'), { recursive: true })

  writeFileSync(join(root, 'Named.tsx'), `
    export function NamedFn() { return <div /> }
  `)
  writeFileSync(join(root, 'Default.tsx'), `
    export default function DefaultFn() { return <span /> }
  `)
  writeFileSync(join(root, 'Arrow.tsx'), `
    export const ArrowExp = () => { return <p /> }
  `)
  writeFileSync(join(root, 'DanglingDecl.tsx'), `
    const NotExported = () => <div />
  `)
  writeFileSync(join(root, 'PromotedDefault.tsx'), `
    const Promoted = () => <div />
    export default Promoted
  `)
  writeFileSync(join(root, 'nested', 'Deep.tsx'), `
    export function Deep() { return <i /> }
  `)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('searchGlob', () => {
  it('classifies named, default, arrow, and nested exports', () => {
    const set = searchGlob({ rootPath: root })
    const byName = Object.fromEntries(Array.from(set).map(c => [c.name, c]))

    expect(byName.NamedFn?.type).toBe('Export')
    expect(byName.DefaultFn?.type).toBe('ExportDefault')
    expect(byName.ArrowExp?.type).toBe('Export')
    expect(byName.Promoted?.type).toBe('ExportDefault')
    expect(byName.Deep?.type).toBe('Export')
  })

  it('drops declarations that nothing ever exports', () => {
    const set = searchGlob({ rootPath: root })
    expect(Array.from(set).find(c => c.name === 'NotExported')).toBeUndefined()
  })
})

describe('searchGlob honors user-supplied globs', () => {
  it('only picks up files that match the globs', () => {
    // Default behavior (no globs): everything is found, including the dangling
    // declaration's parent dir.
    const wide = searchGlob({ rootPath: root })
    const wideNames = new Set([...wide].map((c) => c.name))
    expect(wideNames.has('Deep')).toBe(true)
    expect(wideNames.has('NamedFn')).toBe(true)

    // Narrowed to `nested/` only — `NamedFn` at the root falls out.
    const narrow = searchGlob({ rootPath: root, globs: ['nested/**/*.tsx'] })
    const narrowNames = new Set([...narrow].map((c) => c.name))
    expect(narrowNames.has('Deep')).toBe(true)
    expect(narrowNames.has('NamedFn')).toBe(false)
    expect(narrowNames.has('DefaultFn')).toBe(false)
  })

  it('respects negation globs', () => {
    const out = searchGlob({
      rootPath: root,
      globs: ['**/*.tsx', '!nested/**'],
    })
    const names = new Set([...out].map((c) => c.name))
    expect(names.has('Deep')).toBe(false)
    expect(names.has('NamedFn')).toBe(true)
  })
})

describe('scanFile (single-file path used by the dev watcher)', () => {
  it('classifies one file the same way the full scan would', () => {
    const out = scanFile(join(root, 'PromotedDefault.tsx'))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: 'Promoted', type: 'ExportDefault' })
    // path is slashed
    expect(out[0].path.endsWith('/PromotedDefault.tsx')).toBe(true)
  })

  it('returns [] for a non-existent file (no throw)', () => {
    expect(scanFile(join(root, 'NopeDoesNotExist.tsx'))).toEqual([])
  })
})

describe('scanFile — Fragment / forwardRef / memo / conditional shapes', () => {
  let n = 0
  const scan = (src: string) => {
    const f = join(root, `shape-${n++}.tsx`)
    writeFileSync(f, src)
    return Object.fromEntries(scanFile(f).map((c) => [c.name, c.type]))
  }

  it('detects a component returning a Fragment (<>…</>)', () => {
    expect(scan(`export default function App() { return <>hi</> }`))
      .toEqual({ App: 'ExportDefault' })
  })

  it('detects an arrow returning a Fragment', () => {
    expect(scan(`export const Row = () => <>a</>`)).toEqual({ Row: 'Export' })
  })

  it('detects forwardRef components', () => {
    expect(scan(
      `import { forwardRef } from 'react'\nexport const Input = forwardRef((p, ref) => <input ref={ref} />)`,
    )).toEqual({ Input: 'Export' })
  })

  it('detects React.memo components', () => {
    expect(scan(`export const Card = React.memo(function Card() { return <div /> })`))
      .toEqual({ Card: 'Export' })
  })

  it('detects memo(forwardRef(...)) nesting', () => {
    expect(scan(
      `import { memo, forwardRef } from 'react'\nexport const Btn = memo(forwardRef((p, r) => <button />))`,
    )).toEqual({ Btn: 'Export' })
  })

  it('detects a ternary return (return a ? <X/> : <Y/>)', () => {
    expect(scan(`export function Toggle({ on }) { return on ? <a /> : <b /> }`))
      .toEqual({ Toggle: 'Export' })
  })

  it('detects JSX returned only inside a conditional branch', () => {
    expect(scan(`export function Maybe({ on }) { if (on) return <div />; return null }`))
      .toEqual({ Maybe: 'Export' })
  })

  it('promotes a forwardRef default via `export default X`', () => {
    expect(scan(
      `import { forwardRef } from 'react'\nconst Fwd = forwardRef((p, r) => <i />)\nexport default Fwd`,
    )).toEqual({ Fwd: 'ExportDefault' })
  })

  it('does NOT treat a helper as a component just for JSX in a nested callback', () => {
    // The <tr> lives in the map arrow (a nested function); renderRows itself
    // returns an array, not JSX → correctly ignored (no false positive).
    expect(scan(`export function renderRows(items) { return items.map((i) => <tr key={i} />) }`))
      .toEqual({})
  })
})

describe('scanFile — class / re-export / default-HOC / lazy / capitalization', () => {
  let n = 0
  const scan = (src: string, file = `newshape-${n++}.tsx`) => {
    const f = join(root, file)
    writeFileSync(f, src)
    return Object.fromEntries(scanFile(f).map((c) => [c.name, c.type]))
  }

  it('detects a class component extending React.Component', () => {
    expect(scan(`export default class Panel extends React.Component { render() { return <div /> } }`))
      .toEqual({ Panel: 'ExportDefault' })
  })

  it('detects a class extending bare Component / PureComponent', () => {
    expect(scan(`export class Box extends Component { render() { return <div /> } }`))
      .toEqual({ Box: 'Export' })
    expect(scan(`export class Pure extends PureComponent { render() { return <b /> } }`))
      .toEqual({ Pure: 'Export' })
  })

  it('detects a class with a render() returning JSX even with a custom base', () => {
    expect(scan(`export class Weird extends MyBase { render() { return <i /> } }`))
      .toEqual({ Weird: 'Export' })
  })

  it('detects `export default memo(function Card(){…})`', () => {
    expect(scan(`export default React.memo(function Card() { return <div /> })`))
      .toEqual({ Card: 'ExportDefault' })
  })

  it('detects `export default forwardRef(function Input(){…})`', () => {
    expect(scan(`import { forwardRef } from 'react'\nexport default forwardRef(function Input(p, r) { return <input ref={r} /> })`))
      .toEqual({ Input: 'ExportDefault' })
  })

  it('names an ANONYMOUS default export from the filename (arrow / HOC / class)', () => {
    expect(scan(`export default () => <div/>`, 'Sidebar.tsx'))
      .toEqual({ Sidebar: 'ExportDefault' })
    expect(scan(`import { forwardRef } from 'react'\nexport default forwardRef((p, r) => <i ref={r}/>)`, 'IconButton.tsx'))
      .toEqual({ IconButton: 'ExportDefault' })
    expect(scan(`export default class extends React.Component { render() { return <div/> } }`, 'DataGrid.tsx'))
      .toEqual({ DataGrid: 'ExportDefault' })
  })

  it('kebab-case filenames become PascalCase component names', () => {
    expect(scan(`export default () => <div/>`, 'date-picker.tsx'))
      .toEqual({ DatePicker: 'ExportDefault' })
  })

  it('detects React.lazy components', () => {
    expect(scan(`export const Heavy = React.lazy(() => import('./Heavy'))`))
      .toEqual({ Heavy: 'Export' })
  })

  it('detects a capitalized named re-export from a barrel', () => {
    expect(scan(`export { Button, Card as Panel } from './widgets'`))
      .toEqual({ Button: 'Export', Panel: 'Export' })
  })

  it('ignores a lowercase re-export', () => {
    expect(scan(`export { helper } from './util'`)).toEqual({})
  })

  it('ignores a SCREAMING_CASE re-export (constant, not a component)', () => {
    // PascalCase-only: needs a lowercase letter, so ALL-CAPS names are skipped.
    expect(scan(`export { API_URL, THEME, Button } from './x'`))
      .toEqual({ Button: 'Export' })
  })

  it('promotes a declared component via `export { X }` (no source)', () => {
    expect(scan(`function Widget() { return <div /> }\nexport { Widget }`))
      .toEqual({ Widget: 'Export' })
  })

  it('drops a lowercase export that returns JSX (not a component tag)', () => {
    expect(scan(`export function useToolbar() { return <div /> }`)).toEqual({})
  })
})

describe('resolveLocalJsxNames — barrel re-export dedupe', () => {
  it('keeps a re-export only when the same name was not found by direct scan', () => {
    const direct = { name: 'Button', path: '/p/components/Button.tsx', type: 'ExportDefault' as const }
    const reexport = { name: 'Button', path: '/p/components/index.tsx', type: 'Export' as const, reexport: true }
    const orphanReexport = { name: 'Modal', path: '/p/components/index.tsx', type: 'Export' as const, reexport: true }

    const map = resolveLocalJsxNames([direct, reexport, orphanReexport])
    // The duplicate re-export of Button is dropped in favor of the direct file…
    expect(map.get('Button')).toBe(direct)
    // …but Modal, which only exists as a re-export, is still importable.
    expect(map.get('Modal')).toBe(orphanReexport)
    // No spurious namespaced duplicate for Button.
    expect([...map.keys()].filter((k) => k.endsWith('Button'))).toEqual(['Button'])
  })
})
