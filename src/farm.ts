import { createFarmPlugin, type UnpluginFactoryOutput } from "unplugin";
import { unpluginFactory } from "./index";
import type { Options } from "./types";

/**
 * Farm-specific entry. Returns a Farm plugin:
 *
 * @example
 * // farm.config.ts
 * import Components from 'unplugin-react-auto-components/farm'
 * export default { plugins: [Components({ resolvers: [...] })] }
 */
// Explicit annotation: createFarmPlugin's inferred return references
// @farmfe/core's `JsPlugin`, which can't be named portably in the emitted
// `.d.ts` (TS2883). Widen the plugin type to `unknown` so this entry's types
// stay self-contained instead of dragging @farmfe/core into the package.
const farm: UnpluginFactoryOutput<Options | undefined, unknown> =
  createFarmPlugin(unpluginFactory);

export default farm;

export * from "./core/resolvers";
export type * from "./types";
