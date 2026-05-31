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
