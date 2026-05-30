import { createUnplugin, type UnpluginFactory } from "unplugin";
import MagicString from "magic-string";
import { createFilter } from "@rollup/pluginutils";
import type { GenerateDtsOptions, Options, TransformOptions } from "./types";
import { transform } from "./core/transformer";
import { searchGlob } from "./core/searchGlob";
import { generateDts } from "./core/generateDts";
import { setupResolvers } from "./core/manager";
import { resolveOptions } from "./core/utils";
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

export const PLUGIN_NAME = "unplugin-react-components";

/**
 * The unplugin factory. Exported so the per-bundler entrypoints
 * (`./vite`, etc.) can wrap it with `createVitePlugin` and friends.
 */
export const unpluginFactory: UnpluginFactory<Options | undefined> = (
  rawOptions = {},
) => {
  const options = resolveOptions(rawOptions);

  const filter = createFilter(options.include, options.exclude);
  const searchGlobResult = searchGlob({
    rootPath: (options.dts as any)?.rootPath || options.rootDir,
  });

  const dtsBase = {
    components: searchGlobResult,
    filename: (options.dts as GenerateDtsOptions)?.filename || "components",
    rootPath: (options.dts as GenerateDtsOptions)?.rootPath || options.rootDir,
    local: options.local,
    resolvers: options.resolvers,
  } as GenerateDtsOptions;

  const dtsEnabled =
    options.dts === true || (typeof options.dts === "object" && !!options.dts);

  const emitDts = () => {
    if (options.dts === true) {
      generateDts(dtsBase);
    } else if (typeof options.dts === "object" && options.dts) {
      generateDts({
        ...dtsBase,
        ...(options.dts as Partial<GenerateDtsOptions>),
      });
    }
  };

  // Whether a live watcher makes sense at all. If neither local auto-import
  // nor dts is enabled, there's nothing to keep in sync.
  const liveEnabled = options.local || dtsEnabled;

  return {
    name: PLUGIN_NAME,
    // Run after React's JSX transform has emitted `jsx(...)`, since the
    // transformer rewrites those call sites.
    enforce: "post",

    // Resolvers may need async initialization (e.g. dynamic package
    // introspection). Do it once here, before any transform or dts emit, then
    // generate the dts (which depends on resolvers being populated).
    async buildStart() {
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
          components: searchGlobResult,
          emitDts,
          onFlush: (events, { changed }) => {
            // `changed === false` means the batch was a no-op (body-only edit
            // etc.) — no need to reload. Also skip pure-`change` events; Vite's
            // per-module HMR handles those.
            if (!changed) return;
            const structural = events.some(
              (e) => e.type === "add" || e.type === "unlink",
            );
            if (structural) {
              server.ws.send({ type: "full-reload", path: "*" });
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
      compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation: any) => {
        if (!fileDepQueue.length) return;
        for (const { path, type } of fileDepQueue) {
          if (type === "unlink") {
            compilation.fileDependencies.delete(path);
          } else {
            compilation.fileDependencies.add(path);
          }
        }
        fileDepQueue = [];
      });

      compiler.hooks.shutdown?.tapPromise?.(PLUGIN_NAME, async () => {
        await ownedWatcher?.close();
        ownedWatcher = undefined;
      });
    },
  };
};

export const unplugin = createUnplugin(unpluginFactory);

export default unplugin;
