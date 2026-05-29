import { existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import type { ComponentResolveResult, ComponentResolver } from "../../types";
import { toKebabCase } from "../utils";

export interface ShadcnResolverOptions {
  /**
   * Import path prefix used when emitting `from`.
   * Maps to whatever alias your tsconfig / vite resolves to the components folder.
   *
   * @default '@/components/ui'
   */
  componentsDir?: string;
  /**
   * Real filesystem path used to *discover* what components exist.
   * Resolved against `process.cwd()` if relative.
   *
   * @default './src/components/ui'
   */
  componentsRoot?: string;
  /**
   * Explicit list of component names. Takes precedence over filesystem discovery.
   * Useful for cases where the components live outside `componentsRoot` (e.g.
   * monorepo packages).
   */
  components?: string[];
  /**
   * Prefix to require on JSX tags. shadcn doesn't ship with one, so leaving
   * this empty is normal.
   *
   * @default ''
   */
  prefix?: string;
  /**
   * shadcn-cli emits named exports by default. Set this if your generator
   * produces default exports instead.
   *
   * @default false
   */
  defaultExport?: boolean;
  /** Drop components you don't want auto-imported. */
  exclude?: (name: string) => boolean;
}

function pascalize(s: string) {
  return s.replace(/(^|[-_])([a-z0-9])/g, (_, __, c) =>
    String(c).toUpperCase()
  );
}

function discoverFromDisk(rootAbs: string): string[] {
  if (!existsSync(rootAbs) || !statSync(rootAbs).isDirectory()) return [];
  return readdirSync(rootAbs)
    .filter((f) => /\.(tsx|ts|jsx|js)$/.test(f))
    .map((f) => f.replace(/\.(tsx|ts|jsx|js)$/, ""))
    .map(pascalize)
    .filter((n) => /^[A-Z]/.test(n));
}

/**
 * Resolver for [shadcn/ui](https://ui.shadcn.com) components.
 *
 * Unlike antd, shadcn is *not* an npm package — its CLI copies components
 * into your repo. We therefore can't introspect a module; the source of
 * truth is your filesystem.
 *
 * Discovery precedence:
 *   1. `options.components` if provided.
 *   2. Scan `options.componentsRoot` (default `./src/components/ui`).
 *   3. Empty list — we emit a one-time warning so you know nothing matched.
 *
 * The previous hardcoded catalog was removed: it caused two failure modes —
 * declaring components that aren't installed, and ignoring custom components
 * the user added themselves.
 */
export function ShadcnResolver(
  options: ShadcnResolverOptions = {}
): ComponentResolver {
  const {
    componentsDir = "@/components/ui",
    componentsRoot = "./src/components/ui",
    prefix = "",
    defaultExport = false,
    exclude,
  } = options;

  let names: string[];
  if (options.components && options.components.length) {
    names = options.components;
  } else {
    const rootAbs = resolve(process.cwd(), componentsRoot);
    names = discoverFromDisk(rootAbs);
    if (!names.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[unplugin-react-components] ShadcnResolver: nothing found at ${rootAbs}. ` +
          "Run `npx shadcn add <component>` first, set `componentsRoot`, or pass `components: [...]` explicitly."
      );
    }
  }

  if (exclude) names = names.filter((n) => !exclude(n));

  const type = defaultExport ? "ExportDefault" : "Export";

  return {
    type: "component",

    resolve(jsxName) {
      if (prefix && !jsxName.startsWith(prefix)) return;
      const name = prefix ? jsxName.slice(prefix.length) : jsxName;
      if (!names.includes(name)) return;
      return {
        jsxName,
        name,
        from: `${componentsDir}/${toKebabCase(name)}`,
        type,
      };
    },

    list() {
      return names.map<ComponentResolveResult>((name) => ({
        jsxName: `${prefix}${name}`,
        name,
        from: `${componentsDir}/${toKebabCase(name)}`,
        type,
      }));
    },
  };
}
