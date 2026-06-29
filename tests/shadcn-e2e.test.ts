/**
 * End-to-end shadcn/ui compatibility: a shadcn project keeps its components on
 * disk (the CLI copies them in), so the resolver discovers them from the
 * filesystem. This exercises the real pipeline — ShadcnResolver feeding the
 * plan-B raw-JSX transform — and asserts the injected imports.
 *
 * By default shadcn tags carry a `Ui` prefix (`<UiButton/>`), so the injected
 * import aliases the real export back to the prefixed name.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import MagicString from 'magic-string'
import { transform } from '../src/core/transformer'
import { ShadcnResolver } from '../src/core/resolvers/shadcn'
import type { Components, ComponentResolver, TransformOptions } from '../src/types'

let uiDir: string

beforeAll(() => {
  // Mimic what `npx shadcn add ...` drops into the repo: one file per component,
  // kebab-cased filename, named export.
  uiDir = mkdtempSync(join(tmpdir(), 'urc-shadcn-e2e-'))
  writeFileSync(join(uiDir, 'button.tsx'), 'export function Button() { return null }')
  writeFileSync(join(uiDir, 'card.tsx'), 'export function Card() { return null }')
  writeFileSync(join(uiDir, 'alert-dialog.tsx'), 'export function AlertDialog() { return null }')
})

afterAll(() => rmSync(uiDir, { recursive: true, force: true }))

function ctx(input: string, resolvers: ComponentResolver[]): TransformOptions {
  return {
    id: '/app/src/pages/Page.tsx',
    code: new MagicString(input),
    components: new Set() as Components,
    rootDir: process.cwd(),
    resolvers,
    local: false,
    consumerUsage: undefined,
  }
}

describe('shadcn/ui end-to-end (resolver + plan-B transform)', () => {
  it('auto-imports Ui-prefixed shadcn components, aliasing the real export', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir, componentsDir: '@/components/ui' })
    const src = `export default function Page() { return <div><UiButton/><UiCard/></div> }`
    const out = transform(ctx(src, [r]))
    expect(out).toContain("import { Button as UiButton } from '@/components/ui/button'")
    expect(out).toContain("import { Card as UiCard } from '@/components/ui/card'")
    // JSX is left untouched — the bundler compiles it afterwards.
    expect(out).toContain('<UiButton/>')
  })

  it('kebab-cases multi-word component file paths (UiAlertDialog → alert-dialog)', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir, componentsDir: '@/components/ui' })
    const out = transform(ctx(`const x = <UiAlertDialog/>`, [r]))
    expect(out).toContain("import { AlertDialog as UiAlertDialog } from '@/components/ui/alert-dialog'")
  })

  it('emits a default import when defaultExport is set', () => {
    const r = ShadcnResolver({
      componentsRoot: uiDir,
      componentsDir: '@/components/ui',
      defaultExport: true,
    })
    const out = transform(ctx(`const x = <UiButton/>`, [r]))
    expect(out).toContain("import UiButton from '@/components/ui/button'")
  })

  it('honors an explicit components list (monorepo / outside the ui dir)', () => {
    const r = ShadcnResolver({
      components: ['DataTable'],
      componentsDir: '@/ui',
    })
    const out = transform(ctx(`const x = <UiDataTable/>`, [r]))
    expect(out).toContain("import { DataTable as UiDataTable } from '@/ui/data-table'")
  })

  it('prefix: "" matches bare names without aliasing', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir, componentsDir: '@/components/ui', prefix: '' })
    const out = transform(ctx(`const x = <Button/>`, [r]))
    expect(out).toContain("import { Button } from '@/components/ui/button'")
  })

  it('leaves bare + non-shadcn tags alone under the default Ui prefix', () => {
    const r = ShadcnResolver({ componentsRoot: uiDir, componentsDir: '@/components/ui' })
    // `<Button/>` lacks the Ui prefix, `<NotAShadcnComponent/>` isn't on disk.
    const src = `const x = <div><Button/><NotAShadcnComponent/></div>`
    expect(transform(ctx(src, [r]))).toBe(src)
  })
})
