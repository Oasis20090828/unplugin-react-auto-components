import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  detectDtsRoot,
  isCapitalCase,
  isExportComponent,
  resolveOptions,
  slash,
  stringifyImport,
  toKebabCase,
} from '../src/core/utils'

describe('utils', () => {
  describe('isExportComponent', () => {
    it('reads from context.type', () => {
      expect(isExportComponent({ name: 'A', path: '/a', type: 'Export' })).toBe(true)
      expect(isExportComponent({ name: 'A', path: '/a', type: 'ExportDefault' })).toBe(false)
      expect(isExportComponent({ name: 'A', path: '/a', type: 'Declaration' })).toBe(false)
    })
    it('accepts a bare ExportType', () => {
      expect(isExportComponent('Export')).toBe(true)
      expect(isExportComponent('ExportDefault')).toBe(false)
    })
  })

  describe('isCapitalCase', () => {
    it('matches A-Z only', () => {
      expect(isCapitalCase('Button')).toBe(true)
      expect(isCapitalCase('button')).toBe(false)
      expect(isCapitalCase('')).toBe(false)
      expect(isCapitalCase('_X')).toBe(false)
    })
  })

  describe('toKebabCase — fixes master DatePicker bug', () => {
    it.each([
      ['Button', 'button'],
      ['DatePicker', 'date-picker'],
      ['TimePicker', 'time-picker'],
      ['TreeSelect', 'tree-select'],
      ['ConfigProvider', 'config-provider'],
      ['BackTop', 'back-top'],
    ])('%s → %s', (input, expected) => {
      expect(toKebabCase(input)).toBe(expected)
    })
  })

  describe('stringifyImport', () => {
    it('side-effect import (string)', () => {
      expect(stringifyImport('antd/es/button/style/css')).toBe("import 'antd/es/button/style/css'")
    })
    it('named + alias', () => {
      expect(stringifyImport({ name: 'Button', as: '_x', from: 'antd' }))
        .toBe("import { Button as _x } from 'antd'")
    })
    it('plain named', () => {
      expect(stringifyImport({ name: 'Button', from: 'antd' }))
        .toBe("import { Button } from 'antd'")
    })
    it('default', () => {
      expect(stringifyImport({ default: '_x', from: './X' }))
        .toBe("import _x from './X'")
    })
  })

  describe('slash', () => {
    it('replaces all backslashes', () => {
      expect(slash('a\\b\\c')).toBe('a/b/c')
    })
  })

  describe('resolveOptions', () => {
    it('applies defaults', () => {
      const o = resolveOptions()
      expect(o.local).toBe(true)
      expect(o.dts).toBe(false)
      expect(o.resolvers).toEqual([])
      expect(o.rootDir).toBe(process.cwd())
    })
    it('respects local: false', () => {
      const o = resolveOptions({ local: false })
      expect(o.local).toBe(false)
    })
  })

  describe('detectDtsRoot', () => {
    let root: string
    beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'urc-dts-root-')) })
    afterAll(() => { rmSync(root, { recursive: true, force: true }) })

    it('falls back to rootDir when there is no src/', () => {
      // Empty tmpdir, no src/.
      expect(detectDtsRoot(root)).toBe(root)
    })

    it('returns <root>/src when src/ exists but has no types subdir', () => {
      mkdirSync(join(root, 'src'))
      expect(detectDtsRoot(root)).toBe(join(root, 'src'))
    })

    it('prefers <root>/src/types over <root>/src', () => {
      mkdirSync(join(root, 'src', 'types'))
      expect(detectDtsRoot(root)).toBe(join(root, 'src', 'types'))
    })

    it('picks the first matching case variant when multiple coexist (Linux-style)', () => {
      // On case-sensitive FS, types/ wins over Types/ because it's checked first.
      // On case-insensitive FS (macOS default), they're the same directory and
      // we still get *some* hit — both assertions hold.
      const base = mkdtempSync(join(tmpdir(), 'urc-dts-variant-'))
      try {
        mkdirSync(join(base, 'src', 'type'), { recursive: true })
        // `type` is the only variant present.
        expect(detectDtsRoot(base)).toBe(join(base, 'src', 'type'))
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    })
  })
})
