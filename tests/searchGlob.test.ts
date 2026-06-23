import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanFile, searchGlob } from '../src/core/searchGlob'

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
