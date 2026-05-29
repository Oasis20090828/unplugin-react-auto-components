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

/** Apply defaults to user-supplied plugin options. */
export function resolveOptions(options: Options = {}): Required<Options> {
  return {
    rootDir: options.rootDir || process.cwd(),
    dts: options.dts ?? false,
    include: options.include ?? [/\.[jt]sx$/],
    exclude: options.exclude ?? [/[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/],
    resolvers: options.resolvers || [],
    local: typeof options.local === "boolean" ? options.local : true,
  };
}
