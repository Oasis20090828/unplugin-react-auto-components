import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { resolve } from "path";
import { createFilter } from "@rollup/pluginutils";
import type { Components } from "../types";
import { scanFile } from "./searchGlob";
import { slash } from "./utils";
import { createDebug } from "./debug";

const dbg = createDebug("watch");

export interface FileEvent {
  /** Native filesystem path as emitted by chokidar (platform separators). */
  path: string;
  type: "add" | "change" | "unlink";
}

export interface ComponentWatcherOptions {
  /** Project root used as the chokidar root when we create our own watcher. */
  rootDir: string;
  /**
   * Glob patterns the user wants tracked. If provided, events outside these
   * globs are filtered out — both when we own the chokidar instance (we use
   * them to derive base dirs to watch) and when we piggyback on Vite's
   * `server.watcher` (we filter incoming events through them).
   *
   * Negation patterns (`!**\/*.test.tsx`) are supported. Defaults to
   * `**\/*.{tsx,jsx}` under `rootDir`.
   */
  globs?: string[];
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
   * have already been applied to `components`. Receives the full batched event
   * list plus a `changed` flag — `false` means the events were a no-op (e.g. a
   * body-only edit that left every exported name and type intact). Hosts can
   * skip their reload/invalidate work when `changed` is `false` to avoid
   * spurious full-reloads.
   */
  onFlush?: (
    events: FileEvent[],
    info: {
      changed: boolean;
      /**
       * Symmetric difference of component names before and after the batch.
       * Empty when only existing entries got re-scanned (body-only edits).
       * Hosts use this to compute the surgical HMR target set.
       */
      affectedNames: Set<string>;
    },
  ) => void;
}

const isComponentFile = (file: string) => /\.(?:tsx|jsx)$/.test(file);

/**
 * Build a `(file) => boolean` matcher from a user's globs. Splits positive vs.
 * negative (`!`-prefixed) patterns into createFilter's two args. Patterns are
 * resolved against `rootDir` so we can match absolute paths chokidar emits.
 */
function buildGlobMatcher(rootDir: string, globs: string[]) {
  const positives: string[] = [];
  const negatives: string[] = [];
  for (const g of globs) {
    if (g.startsWith("!")) negatives.push(resolve(rootDir, g.slice(1)));
    else positives.push(resolve(rootDir, g));
  }
  return createFilter(positives, negatives);
}

/**
 * Extract the static prefix from a glob — what to actually pass to
 * `chokidar.watch` (chokidar 4+ doesn't accept globs). For example:
 *   `src/components/**\/*.tsx` → `src/components`
 *   `src/**\/*.tsx`            → `src`
 *   `**\/*.tsx`                → `.`
 * Negation globs return `null` (we don't *positively* watch from them).
 */
function globBaseDir(glob: string): string | null {
  if (glob.startsWith("!")) return null;
  const idx = glob.search(/[*?{[]/);
  const head = idx === -1 ? glob : glob.slice(0, idx);
  const lastSlash = head.lastIndexOf("/");
  return lastSlash === -1 ? "." : head.slice(0, lastSlash);
}

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
  const { rootDir, globs, components, emitDts, onFlush } = options;
  const matchGlob = globs && globs.length ? buildGlobMatcher(rootDir, globs) : null;

  let queue: FileEvent[] = [];
  let scheduled = false;

  const removeForPath = (slashedTarget: string) => {
    for (const c of [...components]) {
      if (c.path === slashedTarget) components.delete(c);
    }
  };

  const fingerprint = (c: { name: string; type: string; path: string }) =>
    `${c.name}|${c.type}|${c.path}`;

  const drain = () => {
    scheduled = false;
    if (!queue.length) return;
    const events = queue;
    queue = [];

    // Pre-state fingerprint so we can tell whether anything *actually* changed
    // after applying the batch (vs. e.g. a body-only edit that leaves every
    // exported name + type intact). Cheap — O(n) string concat per event tick.
    const beforeFp = new Set<string>();
    const namesBefore = new Set<string>();
    for (const c of components) {
      beforeFp.add(fingerprint(c));
      namesBefore.add(c.name);
    }

    for (const e of events) {
      const target = slash(e.path);
      // Same logic for every event type: drop existing entries for this path,
      // then (for add/change) re-scan to pick up the file's current exports.
      removeForPath(target);
      if (e.type !== "unlink") {
        for (const c of scanFile(e.path)) {
          // Warn on a duplicate local component name from a *different* file.
          // The second registration silently wins; making that visible is
          // worth the one-time scan.
          let conflict: { path: string } | undefined;
          for (const x of components) {
            if (x.name === c.name && x.path !== c.path) {
              conflict = x;
              break;
            }
          }
          if (conflict) {
            // eslint-disable-next-line no-console
            console.warn(
              `[unplugin-react-components] duplicate local component name "${c.name}": ` +
                `${c.path} clashes with ${conflict.path}. The newer one wins.`,
            );
          }
          components.add(c);
        }
      }
    }

    // Did the set actually change? And which component *names* were affected
    // (symmetric difference) — needed for surgical HMR.
    let changed = components.size !== beforeFp.size;
    if (!changed) {
      for (const c of components) {
        if (!beforeFp.has(fingerprint(c))) {
          changed = true;
          break;
        }
      }
    }

    const affectedNames = new Set<string>();
    const namesAfter = new Set<string>();
    for (const c of components) namesAfter.add(c.name);
    for (const n of namesBefore) if (!namesAfter.has(n)) affectedNames.add(n);
    for (const n of namesAfter) if (!namesBefore.has(n)) affectedNames.add(n);

    if (changed) emitDts?.();
    dbg(
      `flush: events=${events.length}, changed=${changed}, affected=[${[...affectedNames].join(",")}]`,
    );
    onFlush?.(events, { changed, affectedNames });
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    process.nextTick(drain);
  };

  const enqueue = (file: string, type: FileEvent["type"]) => {
    if (!isComponentFile(file)) return;
    // If the user constrained scope via `globs`, only events on matching paths
    // count. This lets us safely piggyback on Vite's whole-project watcher.
    if (matchGlob && !matchGlob(file)) return;
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
  // Derive what to actually point chokidar at. With user-supplied globs, watch
  // only the static prefix of each — much less work than watching the whole
  // `rootDir` and filtering noise.
  let watchTargets: string | string[] = options.rootDir;
  if (options.globs && options.globs.length) {
    const dirs = new Set<string>();
    for (const g of options.globs) {
      const base = globBaseDir(g);
      if (base !== null) dirs.add(resolve(options.rootDir, base));
    }
    if (dirs.size) watchTargets = [...dirs];
  }

  const watcher = chokidar.watch(watchTargets, {
    ignored: [
      /[\\/]node_modules[\\/]/,
      /[\\/]dist[\\/]/,
      /[\\/]\.git[\\/]/,
    ],
    // Initial scan was already done by `searchGlob` in the factory; this
    // watcher only handles deltas.
    ignoreInitial: true,
    // No `awaitWriteFinish`: it adds a 100ms floor to every event in exchange
    // for guarding against half-written files. Modern editors save atomically
    // (write-tmp + rename), so the guard mostly burns latency. If a file *is*
    // written in chunks, the first `scanFile` may yield partial results, but
    // the resulting dts will be replaced by the next `change` event — and our
    // generateDts skips identical writes, so no churn downstream.
  });
  return attachComponentHandlers(watcher, options);
}
