import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import Components from "unplugin-react-auto-components/vite";
import {
  AntdResolver,
  ShadcnResolver,
} from "unplugin-react-auto-components/resolvers";

export default defineConfig({
  // shadcn components import each other via the `@` alias.
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  plugins: [
    react(),
    tailwindcss(),
    // `/vite` returns a Vite plugin directly, so it slots straight into the
    // plugins array with matching types — no cast needed.
    Components({
      // Auto-import local components found by AST scan (the <HelloWorld/> case),
      // but exclude src/components/ui — those are shadcn's, owned by the
      // resolver below, so they shouldn't also register as bare locals.
      local: true,
      globs: ["**/*.tsx", "**/*.jsx", "!**/components/ui/**"],
      resolvers: [
        // antd on demand — write <AntButton>. Prefix MUST be PascalCase.
        AntdResolver({ version: 5, prefix: "Ant" }),
        // shadcn on demand — write <UiButton>. The Ui prefix is the default.
        ShadcnResolver(),
      ],
      // Emit components.d.ts so the editor knows the globals.
      dts: true,
      // Demo of `importPathTransform`: redirect antd's barrel to its ESM build.
      // Every auto-injected `<AntButton/>` import — and its components.d.ts
      // type — now points at `antd/es` instead of `antd`. Returning `undefined`
      // leaves all other specifiers (shadcn, local relative paths) untouched.
      importPathTransform: (path) => (path === "antd" ? "antd/es" : undefined),
    }),
  ],
});
