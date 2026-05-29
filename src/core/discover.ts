import { importModule } from "local-pkg";
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
 * @example
 * const names = await discoverExports("@mui/material");
 * // → ["Accordion", "Alert", "AppBar", ...] | null
 */
export async function discoverExports(
  packageName: string,
): Promise<string[] | null> {
  try {
    const mod = await importModule<Record<string, unknown>>(packageName);
    if (!mod || typeof mod !== "object") return null;
    const names = Object.keys(mod).filter(isCapitalCase);
    return names.length ? names : null;
  } catch {
    return null;
  }
}
