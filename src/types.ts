import type MagicString from "magic-string";
import type { FilterPattern } from "@rollup/pluginutils";

export type ExportType = "Export" | "ExportDefault";

// ---------------------------------------------------------------------------
// Resolver API — modelled after unplugin-vue-components
// ---------------------------------------------------------------------------

export interface ComponentResolveResult {
  /** Identifier as it appears in JSX (with prefix if any). */
  jsxName: string;
  /** Export name in the source module. */
  name: string;
  /** Module path. */
  from: string;
  /** Default vs named export. Defaults to `'Export'`. */
  type?: ExportType;
  /** Optional side-effect (style) import path. */
  style?: string;
}

export interface ComponentResolver {
  /** Reserved for future use; currently only `'component'` is honored. */
  type: "component" | "directive";
  /**
   * Optional async initialization, awaited once by the plugin in `buildStart`
   * before any `resolve()`/`list()` call. Use it for work that can't run
   * synchronously — e.g. discovering a package's exports via `local-pkg`'s
   * async `importModule`. Synchronous resolvers can omit it.
   */
  setup?(): Promise<void>;
  /** Per-name lookup. Return `undefined` to pass on this name. */
  resolve(jsxName: string): ComponentResolveResult | undefined | void;
  /**
   * Optional: enumerate every component this resolver knows about.
   * Used to pre-emit `components.d.ts`. Resolvers without `list()`
   * still work at transform time but won't appear in the dts file.
   */
  list?(): ComponentResolveResult[];
}

export type Resolvers = ComponentResolver[];

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface Options {
  /** Root directory to scan local components and emit dts. */
  rootDir?: string;
  /** Generate `<filename>.d.ts` at build start. */
  dts?: boolean | Partial<Omit<GenerateDtsOptions, "components">>;
  /** Auto-import locally-declared components found via AST scan. */
  local?: boolean;
  /** Files to transform. */
  include?: FilterPattern;
  /** Files to skip. */
  exclude?: FilterPattern;
  /** Third-party component resolvers. */
  resolvers?: Resolvers;
  /**
   * Directories to scan for local components. Each is sugar for
   * `<dir>/**\/*.{tsx,jsx}`. Resolved against `rootDir`. Lets you avoid
   * picking up things like `pages/` or `tests/` as component sources.
   *
   * If both `dirs` and `globs` are set, `globs` wins.
   */
  dirs?: string[];
  /**
   * Raw glob patterns to scan + watch. Resolved against `rootDir`.
   * Negation globs (prefixed with `!`) supported.
   * @example ['src/components/**\/*.tsx', '!**\/*.test.tsx']
   */
  globs?: string[];
}

// ---------------------------------------------------------------------------
// Internal shapes used by transformer / dts / scan
// ---------------------------------------------------------------------------

export interface ImportInfo {
  as?: string;
  name?: string;
  default?: string;
  from: string;
}

export interface ComponentsContext {
  name: string;
  path: string;
  type: ExportType | "Declaration";
}

export type Components = Set<ComponentsContext>;

export interface TransformOptions {
  id: string;
  code: MagicString;
  components: Components;
  rootDir: string;
  resolvers: Resolvers;
  local: boolean;
  /**
   * Optional `consumerId → Set<jsxName>` map. When provided, the transformer
   * records which auto-imported JSX names each file uses. The plugin (in the
   * dev-server hook) then uses this to send surgical `js-update` HMR events
   * to only the files that actually use a changed/added/removed component —
   * instead of a blanket page reload.
   */
  consumerUsage?: Map<string, Set<string>>;
}

export interface GenerateDtsOptions {
  components: Components;
  rootPath: string;
  filename: string;
  resolvers: Resolvers;
  local: boolean;
}

export interface SearchGlobOptions {
  rootPath: string;
  /** Glob patterns (fast-glob syntax). Defaults to `['**\/*.tsx', '**\/*.jsx']`. */
  globs?: string[];
}
