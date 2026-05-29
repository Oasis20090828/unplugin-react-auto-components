import { describe, expect, it } from 'vitest'
import {
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
})
