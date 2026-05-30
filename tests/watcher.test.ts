import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createComponentWatcher, type FileEvent } from '../src/core/watcher'
import { searchGlob } from '../src/core/searchGlob'
import type { Components } from '../src/types'

let root: string
let components: Components

beforeAll(() => {
  // realpath: macOS tmpdir is /var/folders/... but realpath is /private/var/...
  // chokidar emits events with the realpath, so we need to match it for
  // path-based deletion to line up.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'urc-watch-')))
  mkdirSync(join(root, 'src'), { recursive: true })
  // Seed one existing component so the initial scan is non-empty.
  writeFileSync(
    join(root, 'src', 'Existing.tsx'),
    'export default function Existing() { return <div /> }',
  )
  components = searchGlob({ rootPath: root })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Wait long enough for `awaitWriteFinish` (100ms stability) + native FS event
// hop. macOS is fast (~150ms) but Linux CI can be slower; 600ms is comfortable.
const settle = () => wait(600)

describe('createComponentWatcher (batched via process.nextTick)', () => {
  it('applies add / unlink to the components Set + fires emitDts and onFlush per batch', async () => {
    let dtsEmits = 0
    let flushCalls = 0
    let lastFlush: FileEvent[] = []
    const watcher = createComponentWatcher({
      rootDir: root,
      components,
      emitDts: () => {
        dtsEmits++
      },
      onFlush: (events) => {
        flushCalls++
        lastFlush = events
      },
    })
    await new Promise<void>((r) => watcher.once('ready', () => r()))
    const baseEmits = dtsEmits
    const baseFlush = flushCalls

    // 1. add a brand new component file
    const added = join(root, 'src', 'Brand.tsx')
    writeFileSync(added, 'export default function Brand() { return <i /> }')
    await settle()
    expect([...components].some((c) => c.name === 'Brand')).toBe(true)
    expect(dtsEmits).toBeGreaterThan(baseEmits)
    expect(flushCalls).toBeGreaterThan(baseFlush)
    expect(lastFlush.some((e) => e.type === 'add' && /Brand\.tsx$/.test(e.path))).toBe(true)

    // 2. unlink — components Set drops it, fresh flush call
    const beforeUnlink = flushCalls
    rmSync(added)
    await settle()
    expect([...components].some((c) => c.name === 'Brand')).toBe(false)
    expect(flushCalls).toBeGreaterThan(beforeUnlink)
    expect(lastFlush.some((e) => e.type === 'unlink')).toBe(true)

    await watcher.close()
  }, 10000)

  it('coalesces multiple events fired in the same tick into ONE flush', async () => {
    let flushCalls = 0
    let receivedAll: string[] = []
    const watcher = createComponentWatcher({
      rootDir: root,
      components,
      onFlush: (events) => {
        flushCalls++
        receivedAll = events.map((e) => e.path)
      },
    })
    await new Promise<void>((r) => watcher.once('ready', () => r()))

    // Drive multiple chokidar 'add' events into the SAME process.nextTick
    // batch by writing them synchronously in one turn. chokidar still emits
    // them one by one but we expect the helper to coalesce them.
    //
    // We trigger this from the test side by directly emitting on the watcher
    // (synchronous emit guarantees same-tick scheduling).
    flushCalls = 0
    receivedAll = []
    watcher.emit('add', join(root, 'src', 'A.tsx'))
    watcher.emit('add', join(root, 'src', 'B.tsx'))
    watcher.emit('add', join(root, 'src', 'C.tsx'))

    // process.nextTick runs after the current sync frame, before any I/O.
    await new Promise<void>((r) => process.nextTick(() => r()))

    expect(flushCalls).toBe(1)
    expect(receivedAll).toHaveLength(3)

    await watcher.close()
  }, 5000)
})
