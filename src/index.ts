import { createUnplugin, type UnpluginFactory } from "unplugin";
import MagicString from "magic-string";
import { createFilter } from "@rollup/pluginutils";
import type { GenerateDtsOptions, Options, TransformOptions } from "./types";
import { transform } from "./core/transformer";
import { searchGlob } from "./core/searchGlob";
import { generateDts } from "./core/generateDts";
import { setupResolvers } from "./core/manager";
import { resolveOptions } from "./core/utils";

export * from "./core/resolvers";
export * from "./core/manager";
export * from "./core/discover";
export * from "./core/generateDts";
export * from "./core/searchGlob";
export * from "./core/transformer";
export * from "./core/utils";
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
      if (options.dts === true) {
        generateDts(dtsBase);
      } else if (typeof options.dts === "object" && options.dts) {
        generateDts({
          ...dtsBase,
          ...(options.dts as Partial<GenerateDtsOptions>),
        });
      }
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
  };
};

export const unplugin = createUnplugin(unpluginFactory);

export default unplugin;
