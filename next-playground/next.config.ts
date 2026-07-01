// next.config.mts — TypeScript + ESM config (Next.js >= 15)
import ReactComponents from "unplugin-react-auto-components/next";
import { AntdResolver, ShadcnResolver } from "unplugin-react-auto-components/resolvers";
import type { NextConfig } from "next";

// `satisfies`/typed const are TS-only — proves Next loaded this as TypeScript.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
};

export default ReactComponents({
  local: true,
  globs: ["**/*.jsx", "!**/components/ui/**", "!**/pages/_app.jsx"],
  resolvers: [
    AntdResolver({ dynamic: true, prefix: "Ant" }),
    ShadcnResolver({ componentsRoot: "./components/ui" }),
  ],
  dts: true,
})(nextConfig);
