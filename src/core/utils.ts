import { existsSync, statSync } from "fs";
import { resolve } from "path";
import type {
  ComponentsContext,
  ExportType,
  ImportInfo,
  Options,
} from "../types";

/**
 * Decide whether a component should be imported as a named export.
 * Accepts either a context object (with `.type`) or the raw `ExportType`.
 */
export const isExportComponent = (component: ComponentsContext | ExportType) =>
  typeof component === "string"
    ? component === "Export"
    : component.type === "Export";

/**
 * True when the first character is an uppercase ASCII letter.
 * Used to filter package exports down to "looks like a component".
 */
export const isCapitalCase = (code: string) => {
  if (!code) return false;
  const ascii = code.charCodeAt(0);
  return ascii >= 65 && ascii <= 90;
};

/** Normalize Windows backslashes to forward slashes. */
export function slash(str: string) {
  return str.replace(/\\/g, "/");
}

/**
 * PascalCase a single path segment for use as a namespace prefix.
 * `extra` → `Extra`, `ui-kit` → `UiKit`, `my_widgets` → `MyWidgets`.
 */
export function pascalCase(str: string) {
  return str
    .replace(/(^|[-_\s]+)([a-zA-Z0-9])/g, (_, __, c) => String(c).toUpperCase())
    .replace(/[-_\s]+/g, "");
}

/**
 * Warn when a resolver `prefix` isn't PascalCase. JSX only treats
 * uppercase-initial tags as components, so a lowercase prefix silently fails:
 * `<uiButton/>` compiles to a host element that no resolver can rewrite. Shared
 * by every prefix-taking resolver so the guidance is identical everywhere.
 */
export function warnNonPascalPrefix(
  prefix: string | undefined,
  resolver: string,
): void {
  if (!prefix || /^[A-Z]/.test(prefix)) return;
  const fixed = pascalCase(prefix) || prefix[0].toUpperCase() + prefix.slice(1);
  // eslint-disable-next-line no-console
  console.warn(
    `[unplugin-react-auto-components] ${resolver}: prefix "${prefix}" must start with an ` +
      `uppercase letter. JSX treats <${prefix}Button> as a host element, so it will never be ` +
      `auto-imported. Use prefix "${fixed}".`,
  );
}

/**
 * Convert PascalCase / camelCase / snake_case to kebab-case.
 * `DatePicker` → `date-picker`, `TreeSelect` → `tree-select`.
 *
 * This fixes the master project's bug where `originalName.toLowerCase()`
 * produced `datepicker` (which doesn't exist in antd) instead of `date-picker`.
 */
export function toKebabCase(str: string) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

/** Emit a single import statement from a structured descriptor. */
export function stringifyImport(info: ImportInfo | string) {
  if (typeof info === "string") return `import '${info}'`;
  if (info.name && info.as)
    return `import { ${info.name} as ${info.as} } from '${info.from}'`;
  if (info.name) return `import { ${info.name} } from '${info.from}'`;
  return `import ${info.default} from '${info.from}'`;
}

/**
 * Resolve a user's `dirs` / `globs` settings to a final glob list. `globs`
 * wins if both are set; otherwise `dirs` is expanded; otherwise the default
 * "everything under rootDir" pattern is used.
 */
function resolveGlobs(options: Options): string[] {
  if (options.globs && options.globs.length) return options.globs;
  if (options.dirs && options.dirs.length) {
    return options.dirs.flatMap((d) => {
      const trimmed = d.replace(/\/+$/, "");
      return [`${trimmed}/**/*.tsx`, `${trimmed}/**/*.jsx`];
    });
  }
  return ["**/*.tsx", "**/*.jsx"];
}

/**
 * Pick a sensible default location for `components.d.ts`, in order of
 * preference:
 *
 *   1. `<rootDir>/src/{types|Types|type|Type}/` if such a folder exists
 *   2. `<rootDir>/src/` if it exists
 *   3. `<rootDir>/` as a final fallback
 *
 * Mirrors what unplugin-vue-components does — the file lives next to the
 * other ambient type files when the project has a `types/` convention,
 * and otherwise lands somewhere `tsconfig.json` is already including.
 *
 * The user can always override by passing `dts: { rootPath: ... }`.
 */
export function detectDtsRoot(rootDir: string): string {
  const srcDir = resolve(rootDir, "src");
  try {
    if (!statSync(srcDir).isDirectory()) return rootDir;
  } catch {
    return rootDir;
  }
  for (const name of ["types", "Types", "type", "Type"]) {
    const candidate = resolve(srcDir, name);
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) return candidate;
      } catch {}
    }
  }
  return srcDir;
}

/** Apply defaults to user-supplied plugin options. */
export function resolveOptions(options: Options = {}): Required<Options> {
  return {
    rootDir: options.rootDir || process.cwd(),
    dts: options.dts ?? false,
    include: options.include ?? [/\.[jt]sx$/],
    exclude: options.exclude ?? [/[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/],
    resolvers: options.resolvers || [],
    local: typeof options.local === "boolean" ? options.local : true,
    dirs: options.dirs ?? [],
    globs: resolveGlobs(options),
    // No-op default keeps every specifier as-is; call sites apply `?? original`.
    importPathTransform: options.importPathTransform ?? (() => undefined),
  };
}
