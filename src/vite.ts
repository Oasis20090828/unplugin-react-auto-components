import { createVitePlugin } from "unplugin";
import { unpluginFactory } from "./index";

/**
 * Vite-specific entry. Returns a Vite `Plugin` directly, so the options type
 * lines up with Vite's plugin array:
 *
 * @example
 * // vite.config.ts
 * import Components from 'unplugin-react-auto-components/vite'
 * export default { plugins: [Components({ resolvers: [...] })] }
 */
export default createVitePlugin(unpluginFactory);

export * from "./core/resolvers";
export type * from "./types";
