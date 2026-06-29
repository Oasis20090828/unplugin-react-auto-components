import { createEsbuildPlugin } from "unplugin";
import { unpluginFactory } from "./index";

/**
 * esbuild-specific entry. Returns an esbuild plugin:
 *
 * @example
 * import { build } from 'esbuild'
 * import Components from 'unplugin-react-auto-components/esbuild'
 * await build({ plugins: [Components({ resolvers: [...] })] })
 */
export default createEsbuildPlugin(unpluginFactory);

export * from "./core/resolvers";
export type * from "./types";
