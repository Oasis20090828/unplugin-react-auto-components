import { dirname } from "path";
import { fileURLToPath } from "url";
import { build, context } from "esbuild";
import stylePlugin from "esbuild-style-plugin";
import tailwindcss from "@tailwindcss/postcss";
import Components from "unplugin-react-auto-components/esbuild";
import {
  AntdResolver,
  ShadcnResolver,
} from "unplugin-react-auto-components/resolvers";
import { serve } from "../serve.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["main.jsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/main.js",
  jsx: "automatic",
  minify: false,
  // react is loaded in the browser from a CDN via the importmap in index.html;
  // antd is bundled (esm.sh's antd build doesn't resolve cleanly via importmap).
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  // antd reads process.env.NODE_ENV at runtime — define it for the browser.
  define: { "process.env.NODE_ENV": '"development"' },
  // Resolve the `@` alias shadcn components import each other with.
  alias: { "@": __dirname },
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
    // Tailwind v4 via PostCSS — esbuild bundles the compiled CSS into dist/main.css.
    stylePlugin({ postcss: { plugins: [tailwindcss()] } }),
  ],
};

if (process.argv.includes("--watch")) {
  // `dev`: build + rebuild on change, then serve so you can open it in a browser.
  // The plugin lives here (esbuild plugins are JS-API only), so this can't go
  // through the esbuild CLI.
  const ctx = await context(options);
  await ctx.rebuild();
  await ctx.watch();
  serve();
} else {
  await build(options);
  console.log("esbuild build done");
}
