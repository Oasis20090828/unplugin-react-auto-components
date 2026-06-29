import { createWebpackPlugin } from "unplugin";
import { unpluginFactory } from "./index";

/**
 * Webpack-specific entry. Returns a Webpack-compatible plugin instance:
 *
 * @example
 * // webpack.config.js
 * const Components = require('unplugin-react-auto-components/webpack').default
 * module.exports = { plugins: [Components({ resolvers: [...] })] }
 */
export default createWebpackPlugin(unpluginFactory);

export * from "./core/resolvers";
export type * from "./types";
