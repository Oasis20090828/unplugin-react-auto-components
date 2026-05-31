import { createRspackPlugin } from "unplugin";
import { unpluginFactory } from "./index";

/**
 * Rspack-specific entry. Returns an Rspack-compatible plugin instance:
 *
 * @example
 * // rspack.config.js
 * const Components = require('unplugin-react-components/rspack').default
 * module.exports = { plugins: [Components({ resolvers: [...] })] }
 */
export default createRspackPlugin(unpluginFactory);

export * from "./core/resolvers";
export type * from "./types";
