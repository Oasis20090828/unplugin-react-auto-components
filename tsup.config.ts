import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vite: "src/vite.ts",
    resolvers: "src/resolvers.ts",
  },
  format: ["cjs", "esm"],
  dts: {
    // 只对 src 目录下的文件生成 d.ts
    entry: {
      index: "src/index.ts",
      vite: "src/vite.ts",
      resolvers: "src/resolvers.ts",
    },
  },
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
    "estree-walker",
    "fast-glob",
    "local-pkg",
    "magic-string",
  ],
});
