import type { ComponentResolver } from "../../types";
import { createResolver } from "./createResolver";

export interface MuiResolverOptions {
  /**
   * Drop additional exports. The named export `FormLabelRoot` is always
   * excluded (it's an internal styled component, not a public component).
   */
  exclude?: (name: string) => boolean;
}

/**
 * Resolver for [Material UI](https://mui.com) (`@mui/material`).
 *
 * Components are discovered dynamically from the installed package's exports
 * (async, via `local-pkg`). `FormLabelRoot` is excluded because it's an
 * internal styled primitive that leaks into the export surface.
 *
 * @example
 * Components.vite({ resolvers: [MuiResolver()] })
 * // <MuiButton/> → import { Button as ... } from '@mui/material'
 */
export function MuiResolver(options: MuiResolverOptions = {}): ComponentResolver {
  return createResolver({
    module: "@mui/material",
    prefix: "Mui",
    exclude: (name) => name === "FormLabelRoot" || (options.exclude?.(name) ?? false),
  });
}
