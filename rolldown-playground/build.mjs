import { dirname } from "path";
import { fileURLToPath } from "url";
import { rolldown, watch } from "rolldown";
import { babel } from "@rollup/plugin-babel";
import alias from "@rollup/plugin-alias";
import Components from "unplugin-react-auto-components/rolldown";
import {
  AntdResolver,
  ShadcnResolver,
} from "unplugin-react-auto-components/resolvers";
import { serve } from "../serve.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const input = {
  input: "main.jsx",
  // react is loaded in the browser from a CDN via the importmap in index.html;
  // antd is bundled, and reads process.env.NODE_ENV at runtime — define it.
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  define: { "process.env.NODE_ENV": '"development"' },
  // Rolldown runs plugins in array order and ignores `enforce`, so the
  // auto-import plugin MUST come before the JSX transform.
  //
  // NOTE on Tailwind: rolldown removed CSS bundling (rolldown#4271), so the
  // stylesheet is NOT imported through the bundle. It's precompiled by the
  // Tailwind CLI (see package.json `build`) into tailwind.css and <link>ed in
  // index.html. rolldown only bundles JS here.
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
    // Resolve the `@` alias shadcn components import each other with.
    alias({ entries: [{ find: "@", replacement: __dirname }] }),
    babel({
      babelHelpers: "bundled",
      presets: [["@babel/preset-react", { runtime: "automatic" }]],
      extensions: [".js", ".jsx"],
    }),
  ],
};
const output = { file: "dist/main.js", format: "esm" };

if (process.argv.includes("--watch")) {
  // `dev`: rebuild on change, then serve so you can open it in a browser.
  await watch({ ...input, output });
  serve();
} else {
  const bundle = await rolldown(input);
  await bundle.write(output);
  await bundle.close();
  console.log("rolldown build done");
}
