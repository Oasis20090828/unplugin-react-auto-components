/**
 * Functional tests for the `rootDir` option.
 *
 * `rootDir` (default: process.cwd()) is the anchor for everything filesystem:
 *   - searchGlob scans it for local components,
 *   - detectDtsRoot places `components.d.ts` relative to it,
 *   - globs are resolved against it.
 *
 * These exercise the real factory pipeline (no bundler) against on-disk
 * fixtures and assert that rootDir actually scopes/relocates that behavior.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unpluginFactory } from '../../src/index'
import { resolveOptions } from '../../src/core/utils'

interface PluginShape {
  buildStart: () => Promise<void> | void
  transform: (
    code: string,
    id: string,
  ) => { code: string; map?: unknown } | string | undefined | null
}
const callFactory = unpluginFactory as unknown as (
  opts: Parameters<typeof unpluginFactory>[0],
) => ReturnType<typeof unpluginFactory>
const realize = (o: ReturnType<typeof unpluginFactory>) =>
  o as unknown as PluginShape
const codeOf = (out: ReturnType<PluginShape['transform']>) =>
  typeof out === 'string' ? out : (out as { code: string }).code

const comp = (name: string) =>
  `export default function ${name}() { return <i/> }`

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'urc-rootdir-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('rootDir option', () => {
  it('defaults to process.cwd() when omitted', () => {
    expect(resolveOptions({}).rootDir).toBe(process.cwd())
    expect(resolveOptions({ rootDir: '/custom/root' }).rootDir).toBe('/custom/root')
  })

  it('scopes component discovery to rootDir — siblings outside it are ignored', async () => {
    // <root>/outside/Stranger.tsx   ← OUTSIDE the chosen rootDir
    // <root>/app/src/components/Widget.tsx
    // <root>/app/src/App.tsx
    const appRoot = join(root, 'app')
    mkdirSync(join(root, 'outside'), { recursive: true })
    writeFileSync(join(root, 'outside', 'Stranger.tsx'), comp('Stranger'))
    mkdirSync(join(appRoot, 'src', 'components'), { recursive: true })
    writeFileSync(join(appRoot, 'src', 'components', 'Widget.tsx'), comp('Widget'))
    writeFileSync(join(appRoot, 'src', 'App.tsx'), comp('App'))

    const plugin = realize(callFactory({ rootDir: appRoot, dts: true, local: true }))
    await plugin.buildStart()

    // dts lands under <appRoot>/src (detectDtsRoot: src/ exists, no types/).
    const dtsPath = join(appRoot, 'src', 'components.d.ts')
    expect(existsSync(dtsPath)).toBe(true)
    const dts = readFileSync(dtsPath, 'utf-8')
    expect(dts).toContain('const Widget:')
    expect(dts).toContain('const App:')
    // The sibling component outside rootDir is never discovered…
    expect(dts).not.toContain('Stranger')
    // …and no dts leaks to the outer dir.
    expect(existsSync(join(root, 'components.d.ts'))).toBe(false)
  })

  it('places components.d.ts relative to rootDir (rootDir itself when no src/)', async () => {
    // No src/ → detectDtsRoot falls back to rootDir.
    const appRoot = join(root, 'flat')
    mkdirSync(appRoot, { recursive: true })
    writeFileSync(join(appRoot, 'Widget.tsx'), comp('Widget'))

    const plugin = realize(callFactory({ rootDir: appRoot, dts: true, local: true }))
    await plugin.buildStart()

    expect(existsSync(join(appRoot, 'components.d.ts'))).toBe(true)
    expect(existsSync(join(appRoot, 'src', 'components.d.ts'))).toBe(false)
  })

  it('lets dts.rootPath override the rootDir-derived dts location', async () => {
    const appRoot = join(root, 'app')
    const typesDir = join(appRoot, 'typings')
    mkdirSync(join(appRoot, 'src'), { recursive: true })
    mkdirSync(typesDir, { recursive: true })
    writeFileSync(join(appRoot, 'src', 'Widget.tsx'), comp('Widget'))

    const plugin = realize(
      callFactory({ rootDir: appRoot, dts: { rootPath: typesDir }, local: true }),
    )
    await plugin.buildStart()

    expect(existsSync(join(typesDir, 'components.d.ts'))).toBe(true)
    // not at the detectDtsRoot default (<appRoot>/src)
    expect(existsSync(join(appRoot, 'src', 'components.d.ts'))).toBe(false)
  })

  it('resolves globs against rootDir', async () => {
    const appRoot = join(root, 'app')
    mkdirSync(join(appRoot, 'keep'), { recursive: true })
    mkdirSync(join(appRoot, 'skip'), { recursive: true })
    writeFileSync(join(appRoot, 'keep', 'Keeper.tsx'), comp('Keeper'))
    writeFileSync(join(appRoot, 'skip', 'Skipped.tsx'), comp('Skipped'))

    const plugin = realize(
      callFactory({
        rootDir: appRoot,
        dts: true,
        local: true,
        globs: ['**/*.tsx', '!**/skip/**'],
      }),
    )
    await plugin.buildStart()

    const dts = readFileSync(join(appRoot, 'components.d.ts'), 'utf-8')
    expect(dts).toContain('const Keeper:')
    expect(dts).not.toContain('Skipped')
  })

  it('transforms a rootDir-scoped local component into a relative import', async () => {
    const appRoot = join(root, 'app')
    mkdirSync(join(appRoot, 'src', 'components'), { recursive: true })
    writeFileSync(join(appRoot, 'src', 'components', 'Widget.tsx'), comp('Widget'))

    const plugin = realize(callFactory({ rootDir: appRoot, dts: false, local: true }))
    await plugin.buildStart()
    const out = plugin.transform(
      'function Page() { return <Widget/> }',
      join(appRoot, 'src', 'pages', 'Page.tsx'),
    )
    // relative to the consumer, no leading "/", no extension
    expect(codeOf(out)).toContain("import Widget from '../components/Widget'")
  })
})
