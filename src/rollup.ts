import { createRollupPlugin } from "unplugin";
import { unpluginFactory } from "./index";

/**
 * Rollup-specific entry. Returns a Rollup plugin:
 *
 * @example
 * // rollup.config.js
 * import Components from 'unplugin-react-auto-components/rollup'
 * export default { plugins: [Components({ resolvers: [...] })] }
 */
export default createRollupPlugin(unpluginFactory);

export * from "./core/resolvers";
export type * from "./types";
