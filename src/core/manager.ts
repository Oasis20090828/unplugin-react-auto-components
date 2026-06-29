import { dirname } from "path";
import type {
  ComponentResolveResult,
  ComponentsContext,
  Resolvers,
} from "../types";
import { pascalCase, slash } from "./utils";

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

/** A legal JS identifier (so the emitted `const <name>` parses). */
const isValidIdent = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s);

/**
 * Walk up `c`'s parent directories, prefixing the name until the candidate tag
 * is both a valid JS identifier and unused. Each directory segment is
 * PascalCased *and* stripped of identifier-illegal characters, so a folder like
 * `9-cols` or `ui.kit` can't produce a tag that breaks the generated dts. If the
 * whole path yields nothing usable, fall back to a numeric suffix on the (always
 * valid) export name.
 */
function uniqueNamespaced(
  c: ComponentsContext,
  name: string,
  taken: Map<string, unknown>,
): string {
  const segs = slash(dirname(c.path)).split("/").filter(Boolean);
  let prefix = "";
  for (let i = segs.length - 1; i >= 0; i--) {
    prefix = pascalCase(segs[i]).replace(/[^A-Za-z0-9_$]/g, "") + prefix;
    const candidate = `${prefix}${name}`;
    if (isValidIdent(candidate) && !taken.has(candidate)) return candidate;
  }
  // Path exhausted (or every prefix was identifier-illegal) — suffix the name.
  let n = 2;
  while (taken.has(`${name}${n}`)) n++;
  return `${name}${n}`;
}

/**
 * Assign every AST-scanned local component a unique JSX tag name.
 *
 * Unique export names stay bare (`<HelloWorld/>`). When several files export the
 * same name, the lowest-path one keeps the bare name and the rest are
 * disambiguated by prefixing their parent directory (PascalCased) —
 * `components/extra/Hello.jsx` → `<ExtraHelloWorld/>`. So BOTH stay
 * auto-importable under distinct tags instead of one silently winning.
 *
 * Crucially this is deterministic regardless of filesystem scan order (names and
 * paths are sorted before assignment): the emitted `components.d.ts` is stable,
 * so a dev server doesn't enter a rewrite → recompile loop.
 *
 * Returns `Map<jsxName, component>`. Each component keeps its original export
 * `name` (the import binding); `jsxName` is the tag the user writes — when they
 * differ, the transformer/dts alias the import.
 */
export function resolveLocalJsxNames(
  components: Iterable<ComponentsContext>,
): Map<string, ComponentsContext> {
  const byName = new Map<string, ComponentsContext[]>();
  for (const c of components) {
    const arr = byName.get(c.name);
    if (arr) arr.push(c);
    else byName.set(c.name, [c]);
  }

  const cmp = (a: ComponentsContext, b: ComponentsContext) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

  // Sort names so assignment order — and thus the result — never depends on the
  // (unstable) scan order of the `components` Set.
  const groups = [...byName.keys()]
    .sort()
    .map((name) => ({ name, members: byName.get(name)!.slice().sort(cmp) }));

  const out = new Map<string, ComponentsContext>();
  // Pass 1: reserve every group's bare name (each is distinct) for its
  // lowest-path member. Doing this BEFORE any namespacing means a real
  // component's bare name can never be clobbered by — nor clobber — a generated
  // namespaced tag (e.g. a `ui/Card.tsx` collision producing `UiCard` must not
  // overwrite a separately-authored `UiCard` component). Every component stays
  // reachable; `out.size` always equals the input count.
  for (const g of groups) out.set(g.name, g.members[0]);
  // Pass 2: disambiguate the remaining members of collided groups. `out` already
  // holds all bare names, so uniqueNamespaced's `taken` check avoids them too.
  for (const g of groups) {
    for (let i = 1; i < g.members.length; i++) {
      out.set(uniqueNamespaced(g.members[i], g.name, out), g.members[i]);
    }
  }
  return out;
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
