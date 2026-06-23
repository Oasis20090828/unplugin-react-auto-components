import { createUnplugin, type UnpluginFactory } from "unplugin";
import MagicString from "magic-string";
import { relative } from "path";
import { createFilter } from "@rollup/pluginutils";
import type { GenerateDtsOptions, Options, TransformOptions } from "./types";
import { transform } from "./core/transformer";
import { searchGlob } from "./core/searchGlob";
import { generateDts } from "./core/generateDts";
import { setupResolvers } from "./core/manager";
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
  const searchGlobResult = searchGlob({
    rootPath: options.rootDir,
    globs: options.globs,
  });

  // Auto-pick a sensible dts location when the user didn't say.
  // Precedence: dts.rootPath > src/types > src > rootDir
  const defaultDtsRoot = detectDtsRoot(options.rootDir);
  const dtsBase: GenerateDtsOptions = {
    components: searchGlobResult,
    filename: dtsConfig?.filename || "components",
    rootPath: dtsConfig?.rootPath || defaultDtsRoot,
    local: options.local,
    resolvers: options.resolvers,
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

  return {
    name: PLUGIN_NAME,
    // Run after React's JSX transform has emitted `jsx(...)`, since the
    // transformer rewrites those call sites.
    enforce: "post",

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
    },

    transformInclude(id) {
      return filter(id);
    },

    transform(code, id) {
      const ctx: TransformOptions = {
        id,
        code: new MagicString(code),
        components: searchGlobResult,
        rootDir: options.rootDir,
        resolvers: options.resolvers,
        local: options.local,
        consumerUsage,
      };
      const result = transform(ctx);
      return {
        code: result,
        map: ctx.code.generateMap({ hires: true, source: id }),
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

    // ── Webpack: own chokidar + fileDependencies + batched invalidate ──────
    webpack(compiler) {
      if (!liveEnabled) return;

      let ownedWatcher: ReturnType<typeof createComponentWatcher> | undefined;
      // Events that the next `compilation` hook should drain into
      // `compilation.fileDependencies`. Without this, webpack wouldn't watch
      // component files that aren't (yet) imported by anything.
      let fileDepQueue: FileEvent[] = [];

      compiler.hooks.watchRun.tap(PLUGIN_NAME, () => {
        // `watchRun` re-fires on every rebuild; guard so we don't keep
        // spawning watchers. Also gate on `compiler.watching` so a one-shot
        // `webpack` build never starts a watcher (and never keeps the process
        // alive).
        if (ownedWatcher || !compiler.watching) return;

        ownedWatcher = createComponentWatcher({
          rootDir: options.rootDir,
          globs: options.globs,
          components: searchGlobResult,
          emitDts,
          onFlush: (events, { changed }) => {
            // No actual change → don't bother webpack. The watcher already
            // coalesces same-tick events via `process.nextTick`, so `onFlush`
            // fires at most once per tick. We stash events for the next
            // compilation hook and ask webpack to rebuild.
            if (!changed) return;
            fileDepQueue.push(...events);
            compiler.watching?.invalidate();
          },
        });
      });

      // Drain queued events into the live compilation's `fileDependencies` so
      // webpack's own watcher starts tracking these files going forward.
      // We don't depend on `webpack` types; declare only the surface we touch.
      interface WebpackCompilation {
        fileDependencies: {
          add(path: string): void;
          delete(path: string): void;
        };
      }
      compiler.hooks.compilation.tap(
        PLUGIN_NAME,
        (compilation: WebpackCompilation) => {
          if (!fileDepQueue.length) return;
          for (const { path, type } of fileDepQueue) {
            if (type === "unlink") {
              compilation.fileDependencies.delete(path);
            } else {
              compilation.fileDependencies.add(path);
            }
          }
          fileDepQueue = [];
        }
      );

      compiler.hooks.shutdown?.tapPromise?.(PLUGIN_NAME, async () => {
        await ownedWatcher?.close();
        ownedWatcher = undefined;
      });
    },
  };
};

export const unplugin = createUnplugin(unpluginFactory);

export default unplugin;
