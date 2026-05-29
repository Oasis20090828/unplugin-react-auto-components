import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
