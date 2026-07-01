import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Force chokidar to poll instead of using native FS events. Native fsevents can
// silently drop/delay events when the whole suite runs in parallel (many test
// files contend for CPU) — the source of this file's historical flake. Polling
// stats on a fixed interval, so a write/unlink is always observed. vitest runs
// each test file in its own worker, so this env override is scoped to this file.
process.env.CHOKIDAR_USEPOLLING = "1";
process.env.CHOKIDAR_INTERVAL = "20";

import { createComponentWatcher, type FileEvent } from "../src/core/watcher";
import { searchGlob } from "../src/core/searchGlob";
import type { Components } from "../src/types";

let root: string;
let components: Components;

beforeAll(() => {
  // realpath: macOS tmpdir is /var/folders/... but realpath is /private/var/...
  // chokidar emits events with the realpath, so we need to match it for
  // path-based deletion to line up.
  root = realpathSync(mkdtempSync(join(tmpdir(), "urc-watch-")));
  mkdirSync(join(root, "src"), { recursive: true });
  // Seed one existing component so the initial scan is non-empty.
  writeFileSync(
    join(root, "src", "Existing.tsx"),
    "export default function Existing() { return <div /> }"
  );
  components = searchGlob({ rootPath: root });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Poll until `pred` holds, or time out. A fixed sleep flakes under parallel
// test load (chokidar's native FS event can land later than any constant we'd
// pick); polling returns as soon as the event is applied and only waits longer
// when the machine is actually slow.
const waitFor = async (pred: () => boolean, timeoutMs = 5000) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) return false;
    await wait(25);
  }
  return true;
};

describe("createComponentWatcher (batched via process.nextTick)", () => {
  it("applies add / unlink to the components Set + fires emitDts and onFlush per batch", async () => {
    let dtsEmits = 0;
    let flushCalls = 0;
    let lastFlush: FileEvent[] = [];
    const watcher = createComponentWatcher({
      rootDir: root,
      components,
      emitDts: () => {
        dtsEmits++;
      },
      onFlush: (events) => {
        flushCalls++;
        lastFlush = events;
      },
    });
    await new Promise<void>((r) => watcher.once("ready", () => r()));
    const baseEmits = dtsEmits;
    const baseFlush = flushCalls;

    // 1. add a brand new component file
    const added = join(root, "src", "Brand.tsx");
    writeFileSync(added, "export default function Brand() { return <i /> }");
    expect(
      await waitFor(() => [...components].some((c) => c.name === "Brand"))
    ).toBe(true);
    expect(dtsEmits).toBeGreaterThan(baseEmits);
    expect(flushCalls).toBeGreaterThan(baseFlush);
    expect(
      lastFlush.some((e) => e.type === "add" && /Brand\.tsx$/.test(e.path))
    ).toBe(true);

    // 2. unlink — components Set drops it, fresh flush call
    const beforeUnlink = flushCalls;
    rmSync(added);
    expect(
      await waitFor(() => ![...components].some((c) => c.name === "Brand"))
    ).toBe(true);
    expect(flushCalls).toBeGreaterThan(beforeUnlink);
    expect(lastFlush.some((e) => e.type === "unlink")).toBe(true);

    await watcher.close();
  }, 10000);

  it("reports changed=false when a change event leaves exports identical", async () => {
    // Re-fire a `change` event on the existing seed file. scanFile re-reads it
    // and returns the same component → fingerprint match → no-op batch.
    let lastInfo: { changed: boolean } | undefined;
    let emits = 0;
    const watcher = createComponentWatcher({
      rootDir: root,
      components,
      emitDts: () => {
        emits++;
      },
      onFlush: (_e, info) => {
        lastInfo = info;
      },
    });
    await new Promise<void>((r) => watcher.once("ready", () => r()));
    const baseEmits = emits;

    watcher.emit("change", join(root, "src", "Existing.tsx"));
    await new Promise<void>((r) => process.nextTick(() => r()));

    expect(lastInfo).toBeDefined();
    expect(lastInfo!.changed).toBe(false);
    // emitDts must be skipped on a no-op batch
    expect(emits).toBe(baseEmits);

    await watcher.close();
  }, 5000);

  it("coalesces multiple events fired in the same tick into ONE flush", async () => {
    let flushCalls = 0;
    let receivedAll: string[] = [];
    const watcher = createComponentWatcher({
      rootDir: root,
      components,
      onFlush: (events) => {
        flushCalls++;
        receivedAll = events.map((e) => e.path);
      },
    });
    await new Promise<void>((r) => watcher.once("ready", () => r()));

    // Drive multiple chokidar 'add' events into the SAME process.nextTick
    // batch by writing them synchronously in one turn. chokidar still emits
    // them one by one but we expect the helper to coalesce them.
    //
    // We trigger this from the test side by directly emitting on the watcher
    // (synchronous emit guarantees same-tick scheduling).
    flushCalls = 0;
    receivedAll = [];
    watcher.emit("add", join(root, "src", "A.tsx"));
    watcher.emit("add", join(root, "src", "B.tsx"));
    watcher.emit("add", join(root, "src", "C.tsx"));

    // process.nextTick runs after the current sync frame, before any I/O.
    await new Promise<void>((r) => process.nextTick(() => r()));

    expect(flushCalls).toBe(1);
    expect(receivedAll).toHaveLength(3);

    await watcher.close();
  }, 5000);
});
