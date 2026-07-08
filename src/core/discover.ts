import { isCapitalCase } from "./utils";

/**
 * Asynchronously load `packageName` and return its capital-cased export names
 * (the ones that look like React components), or `null` if the package can't
 * be loaded.
 *
 * Uses `local-pkg`'s `importModule`, which resolves the package relative to the
 * consumer's project and handles ESM/CJS interop. Because it's async, callers
 * must run it from a resolver's `setup()` (awaited by the plugin in
 * `buildStart`), not from the synchronous `resolve()`/`list()`.
 *
 * `local-pkg` is imported lazily (dynamic `import`) — it's only needed by
 * resolvers that introspect a package at runtime. Static resolvers (antd,
 * shadcn, mui's curated list) never call this, so the dependency stays out of
 * their module graph and off the critical path.
 *
 * @example
 * const names = await discoverExports("@mui/material");
 * // → ["Accordion", "Alert", "AppBar", ...] | null
 */
export async function discoverExports(
  packageName: string,
): Promise<string[] | null> {
  try {
    const { importModule } = await import("local-pkg");
    const mod = await importModule<Record<string, unknown>>(packageName);
    if (!mod || typeof mod !== "object") return null;
    const names = Object.keys(mod).filter(isCapitalCase);
    return names.length ? names : null;
  } catch {
    return null;
  }
}
