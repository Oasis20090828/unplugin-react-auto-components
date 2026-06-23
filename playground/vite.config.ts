import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Components from "unplugin-react-components/vite";
import { AntdResolver } from "unplugin-react-components/resolvers";

export default defineConfig({
  plugins: [
    react(),
    // `/vite` returns a Vite plugin directly, so it slots straight into the
    // plugins array with matching types — no cast needed.
    Components({
      // Auto-import local components found by AST scan (the <HelloWorld/> case).
      local: true,
      // Auto-import antd on demand. Prefix MUST be PascalCase: write <AntButton>.
      resolvers: [AntdResolver({ version: 5, prefix: "Ant" })],
      // Emit components.d.ts so the editor knows the globals.
      dts: true,
    }),
  ],
});
