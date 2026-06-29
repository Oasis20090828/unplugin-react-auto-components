import type { ComponentResolveResult, ComponentResolver } from "../../types";
import { discoverExports } from "../discover";

export interface CreateResolverOptions {
  /** npm package to introspect, e.g. `'@mui/material'`. */
  module: string;
  /**
   * Prefix required on JSX tags and stripped before importing.
   * Must be PascalCase (JSX only treats uppercase-initial tags as components).
   * @default ''
   */
  prefix?: string;
  /**
   * Drop unwanted exports. Returning `true` removes the name. Consistent with
   * the other resolvers in this project.
   */
  exclude?: (name: string) => boolean;
  /**
   * Build a side-effect style import path from `(exportName, module)`.
   * Return `undefined` for no style import (the default).
   */
  style?: (exportName: string, module: string) => string | undefined;
}

/**
 * Generic resolver factory for libraries published as an npm package whose
 * components are its capital-cased exports (antd, MUI, Mantine, …).
 *
 * Discovery is dynamic and async (`local-pkg` → `discoverExports`), so the
 * returned resolver fills its component set inside `setup()`, which the plugin
 * awaits in `buildStart`. Until then `resolve()`/`list()` simply match nothing.
 *
 * @example
 * export const MuiResolver = (o?) => createResolver({ module: '@mui/material', prefix: 'Mui' })
 */
export function createResolver(
  factoryOptions: CreateResolverOptions
): ComponentResolver {
  const { module: moduleName, prefix = "", exclude, style } = factoryOptions;

  let names: string[] = [];

  const build = (exportName: string): ComponentResolveResult => {
    const result: ComponentResolveResult = {
      jsxName: `${prefix}${exportName}`,
      name: exportName,
      from: moduleName,
      type: "Export",
    };
    const s = style?.(exportName, moduleName);
    if (s) result.style = s;
    return result;
  };

  return {
    type: "component",

    async setup() {
      const discovered = await discoverExports(moduleName);
      if (!discovered) {
        // eslint-disable-next-line no-console
        console.warn(
          `[unplugin-react-auto-components] createResolver: could not load "${moduleName}". ` +
            "Is it installed? This resolver will match nothing."
        );
        names = [];
        return;
      }
      names = exclude ? discovered.filter((n) => !exclude(n)) : discovered;
    },

    resolve(jsxName) {
      if (prefix && !jsxName.startsWith(prefix)) return;
      const name = prefix ? jsxName.slice(prefix.length) : jsxName;
      if (!names.includes(name)) return;
      return build(name);
    },

    list() {
      return names.map(build);
    },
  };
}
