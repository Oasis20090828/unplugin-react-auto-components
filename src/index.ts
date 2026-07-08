import { createUnplugin, type UnpluginFactory } from "unplugin";
import MagicString from "magic-string";
import { relative } from "path";
import { createFilter } from "@rollup/pluginutils";
import type {
  Components,
  GenerateDtsOptions,
  Options,
  TransformOptions,
} from "./types";
import { transform } from "./core/transformer";
import { searchGlob } from "./core/searchGlob";
import { generateDts } from "./core/generateDts";
import { resolveLocalJsxNames, setupResolvers } from "./core/manager";
import { detectDtsRoot, resolveOptions, slash } from "./core/utils";
import { createDebug } from "./core/debug";

const dbgInit = createDebug("init");
const dbgHmr = createDebug("hmr");
import type { FSWatcher } from "chokidar";
import {
  attachComponentHandlers,
  createComponentWatcher,
  type FileEvent,
} from "./core/watcher";

export * from "./core/resolvers";
export * from "./core/manager";
export * from "./core/discover";
export * from "./core/generateDts";
export * from "./core/searchGlob";
export * from "./core/transformer";
export * from "./core/utils";
export * from "./core/watcher";
export type * from "./types";

export const PLUGIN_NAME = "unplugin-react-auto-components";

/**
 * The unplugin factory. Exported so the per-bundler entrypoints
 * (`./vite`, etc.) can wrap it with `createVitePlugin` and friends.
 */
export const unpluginFactory: UnpluginFactory<Options | undefined> = (
  rawOptions = {}
) => {
  const options = resolveOptions(rawOptions);

  // `dts` is `boolean | Partial<GenerateDtsOptions>`. Narrow once into a
  // typed shape so the rest of the factory doesn't keep casting.
  const dtsConfig: Partial<GenerateDtsOptions> | undefined =
    typeof options.dts === "object" && options.dts ? options.dts : undefined;
  const dtsEnabled = options.dts === true || !!dtsConfig;

  const filter = createFilter(options.include, options.exclude);
  // Scan from the project root, *always*. `dts.rootPath` is purely about
  // where the dts file lives, not where to look for components — conflating
  // them was the old footgun (set dts.rootPath → suddenly empty dts because
  // the scanner pointed at the dts folder, which has no .tsx).
  //
  // But skip the scan entirely when nothing consumes it — local auto-import off
  // AND dts off (a resolver-only setup). The scan is synchronous and Babel-parses
  // every matched file, so on a large repo it's a real, wasted cold-start cost.
  const needsScan = options.local || dtsEnabled;
  const searchGlobResult: Components = needsScan
    ? searchGlob({ rootPath: options.rootDir, globs: options.globs })
    : new Set();

  // Auto-pick a sensible dts location when the user didn't say.
  // Precedence: dts.rootPath > src/types > src > rootDir
  const defaultDtsRoot = detectDtsRoot(options.rootDir);
  const dtsBase: GenerateDtsOptions = {
    components: searchGlobResult,
    filename: dtsConfig?.filename || "components",
    rootPath: dtsConfig?.rootPath || defaultDtsRoot,
    local: options.local,
    resolvers: options.resolvers,
    importPathTransform: options.importPathTransform,
  };

  const emitDts = () => {
    if (!dtsEnabled) return;
    generateDts(dtsConfig ? { ...dtsBase, ...dtsConfig } : dtsBase);
  };

  // Whether a live watcher makes sense at all. If neither local auto-import
  // nor dts is enabled, there's nothing to keep in sync.
  const liveEnabled = options.local || dtsEnabled;

  // `consumerId → Set<jsxName>` — populated by the transformer as files go
  // through it, consumed by the Vite hook to compute surgical HMR targets.
  // Lives in the factory closure so all hooks share the same instance.
  const consumerUsage = new Map<string, Set<string>>();

  // Memoized `jsxTag → local component` map shared by every file's transform.
  // Rebuilding it per file is O(N log N) wasted work; build once and invalidate
  // only when the component set actually changes (the watcher's onFlush calls
  // `invalidateLocalNames` on a structural add/unlink/rename). `undefined` means
  // "needs (re)build"; `null` means local discovery is off.
  let localNamesCache:
    | ReturnType<typeof resolveLocalJsxNames>
    | null
    | undefined;
  const getLocalNames = () => {
    if (localNamesCache === undefined) {
      localNamesCache = options.local
        ? resolveLocalJsxNames(searchGlobResult)
        : null;
    }
    return localNamesCache;
  };
  const invalidateLocalNames = () => {
    localNamesCache = undefined;
  };

  // One-time guard for the "plugin ran after the JSX transform" warning below.
  let warnedMisorder = false;

  // ── Webpack + Rspack: identical Compiler API, so share the wiring ──────────
  // Own chokidar + fileDependencies + batched invalidate. Gated on
  // `compiler.watching` so a one-shot build never starts a watcher.
  interface WatchCompiler {
    watching?: { invalidate?(): void };
    hooks: {
      watchRun: { tap(name: string, cb: () => void): void };
      compilation: {
        tap(
          name: string,
          cb: (c: {
            fileDependencies: { add(p: string): void; delete(p: string): void };
          }) => void
        ): void;
      };
      shutdown?: { tapPromise?(name: string, cb: () => Promise<void>): void };
    };
  }
  const setupCompilerWatch = (compiler: WatchCompiler) => {
    if (!liveEnabled) return;
    let ownedWatcher: ReturnType<typeof createComponentWatcher> | undefined;
    let fileDepQueue: FileEvent[] = [];

    compiler.hooks.watchRun.tap(PLUGIN_NAME, () => {
      // `watchRun` re-fires per rebuild; guard so we don't spawn duplicates.
      // Gate on `compiler.watching` so a one-shot build never starts a watcher
      // (which would keep the process alive).
      if (ownedWatcher || !compiler.watching) return;
      ownedWatcher = createComponentWatcher({
        rootDir: options.rootDir,
        globs: options.globs,
        components: searchGlobResult,
        emitDts,
        onFlush: (events, { changed }) => {
          if (!changed) return;
          invalidateLocalNames();
          fileDepQueue.push(...events);
          compiler.watching?.invalidate?.();
        },
      });
    });

    // Drain queued events into the live compilation's `fileDependencies` so the
    // bundler's own watcher starts tracking these files going forward.
    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      if (!fileDepQueue.length) return;
      for (const { path, type } of fileDepQueue) {
        if (type === "unlink") compilation.fileDependencies.delete(path);
        else compilation.fileDependencies.add(path);
      }
      fileDepQueue = [];
    });

    compiler.hooks.shutdown?.tapPromise?.(PLUGIN_NAME, async () => {
      await ownedWatcher?.close();
      ownedWatcher = undefined;
    });
  };

  // ── Rollup / Rolldown / Farm: no dev-server hook, so run our own chokidar ──
  // Keeps `searchGlobResult` + the dts + the localNames cache fresh; the next
  // consumer rebuild then injects the new imports. Started only when watch mode
  // is confirmed (see the buildStart / farm hooks) so a one-shot build never
  // starts it — which would hang the process.
  let standaloneWatcher: ReturnType<typeof createComponentWatcher> | undefined;
  const startStandaloneWatcher = () => {
    if (standaloneWatcher || !liveEnabled) return;
    standaloneWatcher = createComponentWatcher({
      rootDir: options.rootDir,
      globs: options.globs,
      components: searchGlobResult,
      emitDts,
      onFlush: (_events, { changed }) => {
        if (changed) invalidateLocalNames();
      },
    });
  };
  const stopStandaloneWatcher = () => {
    void standaloneWatcher?.close();
    standaloneWatcher = undefined;
  };

  return {
    name: PLUGIN_NAME,
    // Run BEFORE the JSX transform: the transformer detects components in the
    // raw JSX (`<Hello/>`) and injects imports, then lets the bundler's own JSX
    // transform compile `<Hello/>` → `jsx(Hello)`. Running `pre` (rather than
    // matching post-transform `jsx()`) is what lets the plugin work even in
    // bundlers whose JSX transform is built in and runs after plugins (esbuild,
    // Farm), where no `jsx()` exists for a post pass to match.
    enforce: "pre",

    // Resolvers may need async initialization (e.g. dynamic package
    // introspection). Do it once here, before any transform or dts emit, then
    // generate the dts (which depends on resolvers being populated).
    async buildStart() {
      dbgInit(
        `boot: rootDir=${options.rootDir} resolvers=${options.resolvers.length} ` +
          `local=${options.local} dts=${dtsEnabled} globs=${JSON.stringify(options.globs)}`
      );
      await setupResolvers(options.resolvers);
      emitDts();
      // Rollup / Rolldown call `buildStart` with their PluginContext as `this`,
      // exposing `this.meta.watchMode`. They ignore our `enforce` and have no
      // dev-server hook, so start our own watcher — but only in watch mode, so a
      // one-shot build never starts it. (Other bundlers' `this` has no `.meta`,
      // and Vite dev is handled by `configureServer` below.)
      const rollupMeta = (
        this as unknown as {
          meta?: { watchMode?: boolean };
        }
      ).meta;
      if (rollupMeta?.watchMode) startStandaloneWatcher();
    },

    transformInclude(id) {
      return filter(id);
    },

    transform(code, id) {
      // Ordering self-check. If the code we receive is already JSX-compiled
      // (a `react/jsx-runtime` import + no raw `<Tag>` left), a JSX transform
      // ran BEFORE us — auto-import can't see the original tags. Rollup and
      // Rolldown ignore `enforce: 'pre'`, so this is their classic foot-gun:
      // the plugin must be placed before the JSX/babel plugin manually.
      if (
        !warnedMisorder &&
        /\.[jt]sx$/.test(id) &&
        /react\/jsx-(dev-)?runtime/.test(code) &&
        !/<[A-Z]/.test(code)
      ) {
        warnedMisorder = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[${PLUGIN_NAME}] This plugin appears to run AFTER your JSX transform ` +
            `(code is already compiled to react/jsx-runtime calls with no raw <Tag> to detect), ` +
            `so auto-import can't work. In Rollup and Rolldown, \`enforce: 'pre'\` is ignored — ` +
            `place this plugin BEFORE @rollup/plugin-babel / your JSX plugin in the plugins array.`
        );
      }
      const ctx: TransformOptions = {
        id,
        code: new MagicString(code),
        components: searchGlobResult,
        rootDir: options.rootDir,
        resolvers: options.resolvers,
        local: options.local,
        localNames: getLocalNames(),
        consumerUsage,
        importPathTransform: options.importPathTransform,
      };
      const result = transform(ctx);
      // The transformer only ever *prepends* import lines, and only when it
      // actually injects something. If the buffer is unchanged (no `<Capital`
      // JSX, or every tag was already bound / unresolvable — the vast majority
      // of files), skip the module entirely: no needless sourcemap generation
      // and no identity map threaded through the bundler. `hasChanged()` is
      // exactly the "an import was injected" signal.
      if (!ctx.code.hasChanged()) return undefined;
      return {
        code: result,
        // Injected imports are whole-line prepends, so a line-granularity map is
        // exact (every original line just shifts down) — no need for the far
        // costlier per-character `hires` mode.
        map: ctx.code.generateMap({ hires: false, source: id }),
      };
    },

    // ── Vite: piggyback on the dev server's own chokidar ───────────────────
    vite: {
      configureServer(server) {
        if (!liveEnabled) return;
        // Reuse `server.watcher` — Vite already runs chokidar over the project
        // root; we don't need a second one in dev. (`vite build --watch` is a
        // different mode that has no `server`; if we ever want it we'd start
        // our own chokidar in `configResolved` under that branch.)
        //
        // The cast goes from Vite's bundled-chokidar typing to our installed
        // chokidar@5 typing — they're structurally compatible for the
        // `on('add' | 'change' | 'unlink', cb)` surface we touch.
        attachComponentHandlers(server.watcher as unknown as FSWatcher, {
          rootDir: options.rootDir,
          globs: options.globs,
          components: searchGlobResult,
          emitDts,
          onFlush: (events, { changed, affectedNames }) => {
            // `changed === false` means the batch was a no-op (body-only edit
            // etc.) — no need to reload. Pure-`change` events are left to
            // Vite's per-module HMR.
            if (!changed) return;
            // The component set changed → the cached jsxTag map is stale.
            invalidateLocalNames();
            const structural = events.some(
              (e) => e.type === "add" || e.type === "unlink"
            );
            if (!structural) return;

            // Surgical HMR: find files we *know* use one of the affected
            // component names (we recorded this in the transformer). Send a
            // precise `js-update` for each — React Fast Refresh keeps state.
            // Fall back to full-reload only if we have no idea who uses them.
            const consumers = new Set<string>();
            if (affectedNames.size > 0) {
              for (const [consumerId, usedNames] of consumerUsage) {
                for (const n of usedNames) {
                  if (affectedNames.has(n)) {
                    consumers.add(consumerId);
                    break;
                  }
                }
              }
            }

            // Also drop usage records for any unlinked consumer (no point
            // tracking dependencies of a file that no longer exists).
            for (const e of events) {
              if (e.type === "unlink") consumerUsage.delete(e.path);
            }

            if (consumers.size === 0) {
              dbgHmr(
                `fallback full-reload (no tracked consumers for affected names)`
              );
              server.ws.send({ type: "full-reload", path: "*" });
              return;
            }

            const timestamp = Date.now();
            const updates = [] as {
              type: "js-update";
              path: string;
              acceptedPath: string;
              timestamp: number;
            }[];
            for (const cid of consumers) {
              const rel = slash(relative(options.rootDir, cid));
              if (rel.startsWith("..")) continue; // outside root → can't address
              const urlPath = `/${rel}`;
              updates.push({
                type: "js-update",
                path: urlPath,
                acceptedPath: urlPath,
                timestamp,
              });
            }
            if (updates.length === 0) {
              dbgHmr(`fallback full-reload (consumers outside rootDir)`);
              server.ws.send({ type: "full-reload", path: "*" });
            } else {
              dbgHmr(
                `surgical js-update for ${updates.length} consumer(s): ` +
                  updates.map((u) => u.path).join(", ")
              );
              server.ws.send({ type: "update", updates });
            }
          },
        });
      },
    },

    // ── Webpack + Rspack: same Compiler API, shared wiring ─────────────────
    webpack(compiler) {
      setupCompilerWatch(compiler as unknown as WatchCompiler);
    },
    rspack(compiler) {
      setupCompilerWatch(compiler as unknown as WatchCompiler);
    },

    // ── Rollup / Rolldown: watcher starts in buildStart (this.meta.watchMode);
    // close it when the watch process exits. `closeWatcher` is a no-op field on
    // a one-shot build (it never started a watcher).
    rollup: { closeWatcher: stopStandaloneWatcher },
    rolldown: { closeWatcher: stopStandaloneWatcher },

    // ── Farm: `configureDevServer` runs ONLY in dev (never in `farm build`),
    // so it's the one safe place to start our watcher without risking a hung
    // one-shot build.
    farm: {
      configureDevServer() {
        startStandaloneWatcher();
      },
    },
  };
};

export const unplugin = createUnplugin(unpluginFactory);

export default unplugin;
