// Demonstrates auto-importing React components in Next.js via the `/next` entry.
const ReactComponents = require("unplugin-react-auto-components/next").default;
const {
  AntdResolver,
  ShadcnResolver,
} = require("unplugin-react-auto-components/resolvers");

module.exports = ReactComponents({
  // Auto-import local components found by AST scan (the <HelloWorld/> case).
  // Exclude components/ui (shadcn's, owned by the resolver) and pages/_app
  // (Next infrastructure — Next imports it itself; scanning it would register a
  // second component and, since it also returns JSX, collide on names).
  local: true,
  globs: ["**/*.jsx", "!**/components/ui/**", "!**/pages/_app.jsx"],
  resolvers: [
    AntdResolver({ dynamic: true, prefix: "Ant" }),
    // shadcn — write <UiButton>. Lives in components/ui (jsconfig maps @/*).
    ShadcnResolver({ componentsRoot: "./components/ui" }),
  ],
  // Emit components.d.ts so the editor knows the globals.
  dts: true,
})({
  reactStrictMode: true,
  // Auto-imported components read as "undefined" to ESLint's no-undef rule
  // (the import is injected at build time), so skip linting in this demo.
  eslint: { ignoreDuringBuilds: true },
});
