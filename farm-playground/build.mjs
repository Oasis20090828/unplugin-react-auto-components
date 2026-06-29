import { dirname } from "path";
import { fileURLToPath } from "url";
import { build, start } from "@farmfe/core";
import postcss from "@farmfe/js-plugin-postcss";
import Components from "unplugin-react-auto-components/farm";
import {
  AntdResolver,
  ShadcnResolver,
} from "unplugin-react-auto-components/resolvers";

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = {
  compilation: {
    // Farm is app-oriented (like Vite): feed it index.html so it processes the
    // source, splits chunks, and injects the right script tags. Unlike the other
    // playgrounds, react is BUNDLED here (Farm's dev server doesn't mesh with the
    // importmap/external-react setup), so there's no importmap in index.html.
    input: { index: "./index.html" },
    persistentCache: false,
    minify: false,
    // shadcn components import each other via the `@` alias.
    resolve: { alias: { "@": __dirname } },
    output: { path: "dist", targetEnv: "browser" },
  },
  plugins: [
    Components({
      local: true,
      // Exclude components/ui from local scan — shadcn owns it via the resolver.
      globs: ["**/*.jsx", "!**/components/ui/**"],
      resolvers: [
        AntdResolver({ version: 5, prefix: "Ant" }),
        ShadcnResolver({ componentsRoot: "./components/ui" }),
      ],
      dts: true,
    }),
    // Tailwind v4 via PostCSS (reads postcss.config.cjs) — Farm bundles the CSS.
    postcss(),
  ],
};

if (process.argv.includes("--watch")) {
  // `dev`: Farm's own dev server (Vite-like) — it serves index.html, handles
  // its chunk graph, and does HMR. A generic static server can't serve Farm's
  // split output correctly, so use Farm's server.
  await start({ ...config, server: { port: Number(process.env.PORT) || 9000 } });
} else {
  await build(config);
  console.log("farm build done");
}
