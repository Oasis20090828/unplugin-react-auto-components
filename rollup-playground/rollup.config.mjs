import { dirname } from "path";
import { fileURLToPath } from "url";
import alias from "@rollup/plugin-alias";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";
import { babel } from "@rollup/plugin-babel";
import postcss from "rollup-plugin-postcss";
import tailwindcss from "@tailwindcss/postcss";
import Components from "unplugin-react-auto-components/rollup";
import {
  AntdResolver,
  ShadcnResolver,
} from "unplugin-react-auto-components/resolvers";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  input: "main.jsx",
  // react is loaded in the browser from a CDN via the importmap in index.html;
  // antd is bundled (rollup needs commonjs for its CJS deps + replace for NODE_ENV).
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  plugins: [
    // Rollup ignores unplugin's `enforce`, running plugins in array order — so
    // this MUST come before the JSX transform: it injects imports into the raw
    // `<Hello/>` / `<UiButton/>`, then babel compiles the JSX.
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
    // Resolve the `@` alias shadcn components import each other with.
    alias({ entries: [{ find: "@", replacement: __dirname }] }),
    nodeResolve({ extensions: [".js", ".jsx"] }),
    commonjs(),
    replace({ preventAssignment: true, "process.env.NODE_ENV": '"development"' }),
    // Tailwind v4 via PostCSS — inject the compiled CSS at runtime.
    postcss({ plugins: [tailwindcss()], inject: true }),
    babel({
      babelHelpers: "bundled",
      exclude: "node_modules/**",
      presets: [["@babel/preset-react", { runtime: "automatic" }]],
      extensions: [".js", ".jsx"],
    }),
  ],
  output: { file: "dist/main.js", format: "esm" },
};
