import { createWebpackPlugin } from "unplugin";
import { unpluginFactory } from "./index";
import type { Options } from "./types";

const webpackPlugin = createWebpackPlugin(unpluginFactory);

/** The single field of a webpack config this helper mutates. */
interface WebpackConfigLike {
  plugins?: unknown[];
}

/** The single field of a Next.js config this helper reads / overrides. */
interface NextConfigLike {
  webpack?: (config: WebpackConfigLike, context: unknown) => WebpackConfigLike;
}

/**
 * Next.js entry. Next.js has no component auto-import of its own, so this wraps
 * your `next.config` and injects the plugin into Next's webpack pipeline — the
 * React analog of `unplugin-vue-components/nuxt`.
 *
 * The returned helper is generic over your config type `T`, so your config's
 * shape is preserved on the way out — no `any`, no index signature.
 *
 * @example
 * // next.config.mjs
 * import ReactComponents from 'unplugin-react-auto-components/next'
 * export default ReactComponents({ resolvers: [...] })()
 *
 * @example
 * // next.config.js (CommonJS — loaded via Node's require(ESM) on Node >= 20.19)
 * const ReactComponents = require('unplugin-react-auto-components/next').default
 * module.exports = ReactComponents({ resolvers: [...] })({ reactStrictMode: true })
 *
 * @remarks
 * Runs only under Next's **webpack** build. Turbopack (`next dev --turbo` and
 * Turbopack builds) bypasses webpack, so the plugin won't apply there.
 */
export default function ReactComponents(options?: Options) {
  return <T extends NextConfigLike>(nextConfig?: T): T => {
    const previousWebpack = nextConfig?.webpack;
    return Object.assign({}, nextConfig, {
      webpack(config: WebpackConfigLike, context: unknown): WebpackConfigLike {
        config.plugins = config.plugins ?? [];
        config.plugins.push(webpackPlugin(options));
        // Preserve a user-supplied `webpack` hook instead of clobbering it.
        return typeof previousWebpack === "function"
          ? previousWebpack(config, context)
          : config;
      },
    }) as T;
  };
}

export * from "./core/resolvers";
export type * from "./types";
