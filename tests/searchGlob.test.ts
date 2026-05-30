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
