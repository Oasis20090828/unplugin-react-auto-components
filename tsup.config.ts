import { defineConfig } from "tsup";

const entry = {
  index: "src/index.ts",
  vite: "src/vite.ts",
  webpack: "src/webpack.ts",
  rollup: "src/rollup.ts",
  rspack: "src/rspack.ts",
  esbuild: "src/esbuild.ts",
  resolvers: "src/resolvers.ts",
};

export default defineConfig({
  entry,
  format: ["cjs", "esm"],
  // Force `.cjs`/`.mjs` so emitted filenames match package.json's `exports`
  // map. Without this, tsup follows the package's module system — and with no
  // `"type": "module"` here, CJS gets a bare `.js`. That left `dist/index.cjs`
  // (and every `*.cjs` the `exports.require`/`main` fields point at) missing,
  // so any `require()` of this package 404'd.
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
  dts: { entry },
  splitting: false,
  sourcemap: true,
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
