import { createRolldownPlugin } from "unplugin";
import { unpluginFactory } from "./index";

/**
 * Rolldown-specific entry. Returns a Rolldown plugin:
 *
 * @example
 * // rolldown.config.ts
 * import Components from 'unplugin-react-auto-components/rolldown'
 * export default { plugins: [Components({ resolvers: [...] })] }
 */
export default createRolldownPlugin(unpluginFactory);

export * from "./core/resolvers";
export type * from "./types";
