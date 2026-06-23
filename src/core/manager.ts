import type { ComponentResolveResult, Resolvers } from "../types";

/**
 * Run every resolver's optional async `setup()` once, in parallel. The plugin
 * awaits this in `buildStart` so dynamic resolvers (e.g. those discovering a
 * package's exports via `local-pkg`) are fully populated before any
 * `resolve()`/`list()` call during transform or dts generation.
 */
export async function setupResolvers(
  resolvers: Resolvers | undefined,
): Promise<void> {
  if (!resolvers || !resolvers.length) return;
  await Promise.all(resolvers.map((r) => r.setup?.()));
}

/**
 * Walk every resolver in order and ask "do you handle this JSX name?".
 * First non-`undefined` answer wins — same precedence rule unplugin-vue-components uses.
 */
export function resolveComponent(
  resolvers: Resolvers | undefined,
  jsxName: string,
): ComponentResolveResult | undefined {
  if (!resolvers || !resolvers.length) return;
  for (const r of resolvers) {
    if (r.type !== "component") continue;
    const hit = r.resolve(jsxName);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Enumerate every component every resolver claims to know.
 * Used at startup to seed `components.d.ts`. Resolvers that don't
 * implement `list()` are silently skipped.
 */
export function listAllComponents(
  resolvers: Resolvers | undefined,
): ComponentResolveResult[] {
  if (!resolvers || !resolvers.length) return [];
  const out: ComponentResolveResult[] = [];
  for (const r of resolvers) {
    if (r.type !== "component" || !r.list) continue;
    for (const item of r.list()) out.push(item);
  }
  return out;
}
