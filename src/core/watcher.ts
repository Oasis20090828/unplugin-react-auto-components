import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import type { Components } from "../types";
import { scanFile } from "./searchGlob";
import { slash } from "./utils";

export interface FileEvent {
  /** Native filesystem path as emitted by chokidar (platform separators). */
  path: string;
  type: "add" | "change" | "unlink";
}

export interface ComponentWatcherOptions {
  /** Project root used as the chokidar root when we create our own watcher. */
  rootDir: string;
  /**
   * The same `Set<ComponentsContext>` the plugin's factory captured for
   * `transform()` to read. We mutate it in place so subsequent transforms
   * see new / removed components without restart.
   */
  components: Components;
  /** Re-emit `components.d.ts`. Called once per batch. Caller decides whether dts is even enabled. */
  emitDts?: () => void;
  /**
   * Called once per `process.nextTick` batch *after* all events in this batch
   * have already been applied to `components` and `emitDts` has run. Receives
   * the full batched event list — host hooks use it to fire a single coalesced
   * action (Vite: one `ws.send`, Webpack: one `watching.invalidate()`).
   */
  onFlush?: (events: FileEvent[]) => void;
}

const isComponentFile = (file: string) => /\.(?:tsx|jsx)$/.test(file);

/**
 * Attach our component-tracking handlers to an *existing* chokidar instance —
 * notably Vite's own `server.watcher` in dev mode, so we don't spawn a second
 * watcher when one is already running and watching the same root.
 *
 * Batching strategy (replaces the old setTimeout debounce):
 *
 *   1. Each chokidar event pushes a `FileEvent` into an internal queue and
 *      schedules a single `process.nextTick` drain (subsequent events in the
 *      same tick are coalesced — the `scheduled` flag short-circuits them).
 *   2. The drain applies every queued event to `components` in order, calls
 *      `emitDts` once, then calls `onFlush(events)` once.
 *
 * `process.nextTick` runs after the current sync turn but *before* I/O, so
 *  it's faster than `setTimeout(_, 0)` and never queues into the timer phase.
 */
export function attachComponentHandlers(
  watcher: FSWatcher,
  options: ComponentWatcherOptions,
): FSWatcher {
  const { components, emitDts, onFlush } = options;

  let queue: FileEvent[] = [];
  let scheduled = false;

  const removeForPath = (slashedTarget: string) => {
    for (const c of [...components]) {
      if (c.path === slashedTarget) components.delete(c);
    }
  };

  const drain = () => {
    scheduled = false;
    if (!queue.length) return;
    const events = queue;
    queue = [];

    for (const e of events) {
      const target = slash(e.path);
      // Same logic for every event type: drop existing entries for this path,
      // then (for add/change) re-scan to pick up the file's current exports.
      removeForPath(target);
      if (e.type !== "unlink") {
        for (const c of scanFile(e.path)) components.add(c);
      }
    }

    emitDts?.();
    onFlush?.(events);
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    process.nextTick(drain);
  };

  const enqueue = (file: string, type: FileEvent["type"]) => {
    if (!isComponentFile(file)) return;
    queue.push({ path: file, type });
    schedule();
  };

  watcher.on("add", (file) => enqueue(file, "add"));
  watcher.on("change", (file) => enqueue(file, "change"));
  watcher.on("unlink", (file) => enqueue(file, "unlink"));

  return watcher;
}

/**
 * Create a fresh chokidar instance over `rootDir` and attach our handlers to
 * it. Used by callers that don't have a watcher to piggyback on (Webpack, and
 * `vite build --watch`).
 */
export function createComponentWatcher(
  options: ComponentWatcherOptions,
): FSWatcher {
  const watcher = chokidar.watch(options.rootDir, {
    ignored: [
      /[\\/]node_modules[\\/]/,
      /[\\/]dist[\\/]/,
      /[\\/]\.git[\\/]/,
    ],
    // Initial scan was already done by `searchGlob` in the factory; this
    // watcher only handles deltas.
    ignoreInitial: true,
    // Wait until the file size stops changing before firing. This is the
    // chokidar-level "write finished" guard — replaces the JS-side
    // setTimeout debounce we used to have.
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });
  return attachComponentHandlers(watcher, options);
}
