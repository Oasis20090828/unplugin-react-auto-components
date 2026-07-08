import { defineConfig } from "tsup";

const entry = {
  index: "src/index.ts",
  vite: "src/vite.ts",
  webpack: "src/webpack.ts",
  rollup: "src/rollup.ts",
  rspack: "src/rspack.ts",
  esbuild: "src/esbuild.ts",
  rolldown: "src/rolldown.ts",
  farm: "src/farm.ts",
  next: "src/next.ts",
  resolvers: "src/resolvers.ts",
};

export default defineConfig({
  entry,
  // ESM-only. Key deps (estree-walker, local-pkg, chokidar) are ESM-only, so a
  // CJS build can't `require()` them — it was broken at runtime. The `.js`
  // output is ESM via the package's `"type": "module"`. CJS consumers (e.g. a
  // CommonJS webpack.config.js) still load it through Node's `require(esm)`,
  // supported by default on the Node >= 20.19 this package already requires.
  format: ["esm"],
  dts: { entry },
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: false,
  external: [
    "react",
    "unplugin",
    "@babel/parser",
    "@rollup/pluginutils",
    "chokidar",
    "estree-walker",
    "fast-glob",
    "local-pkg",
    "magic-string",
  ],
});
