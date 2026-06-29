import { dirname, relative } from "path";
import { parse } from "@babel/parser";
import { walk } from "estree-walker";
import type { File, Node } from "@babel/types";
import type { Node as EstreeNode } from "estree";
import type { ExportType, TransformOptions } from "../types";
import { isExportComponent, slash, stringifyImport } from "./utils";
import { resolveComponent, resolveLocalJsxNames } from "./manager";
import { createDebug } from "./debug";

const dbg = createDebug("transform");

/**
 * Turn an absolute component path into a specifier relative to the file that
 * imports it. Bundlers (Vite especially) resolve a leading `/` against the
 * project *root*, not the filesystem root — so emitting the raw absolute path
 * would break. A `./`-prefixed relative path resolves correctly everywhere.
 */
function toRelativeImport(fromId: string, targetPath: string): string {
  let rel = slash(relative(dirname(fromId), targetPath)).replace(
    /\.[jt]sx?$/,
    "",
  );
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/**
 * The capital-cased *root* identifier of a JSX element name, or `null` for
 * intrinsic (lowercase) tags, fragments, and namespaced names:
 *   <Button/>      → "Button"
 *   <Ant.Button/>  → "Ant"   (the base — same identifier the old jsx(Ant.Button) path keyed on)
 *   <div/>         → null
 */
function jsxRootName(name: Node): string | null {
  if (name.type === "JSXIdentifier")
    return /^[A-Z]/.test(name.name) ? name.name : null;
  if (name.type === "JSXMemberExpression")
    return jsxRootName(name.object as Node);
  return null;
}

/**
 * Collect every identifier the module already binds — imports and top-level
 * declarations. We must NOT auto-import a name that's already in scope, or we'd
 * clobber the user's own binding (e.g. `import App from './App'` colliding with
 * antd's `App` component).
 */
function collectBoundNames(src: string): Set<string> {
  const bound = new Set<string>();

  // import clauses: `import <clause> from '...'`
  const importRE = /import\s+([\s\S]*?)\s+from\s*['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRE.exec(src))) {
    const clause = m[1];

    // named bindings: { a, b as c }  → local names a, c
    const named = clause.match(/\{([\s\S]*?)\}/);
    if (named) {
      for (const part of named[1].split(",")) {
        const seg = part.trim();
        if (!seg) continue;
        const local = /\sas\s/.test(seg) ? seg.split(/\sas\s/)[1].trim() : seg;
        if (/^[A-Za-z_$][\w$]*$/.test(local)) bound.add(local);
      }
    }

    // default + namespace bindings live outside the braces
    const outside = clause.replace(/\{[\s\S]*?\}/, " ");
    for (let tok of outside.split(",")) {
      tok = tok.trim();
      const ns = tok.match(/\*\s*as\s+([\w$]+)/);
      if (ns) {
        bound.add(ns[1]);
        continue;
      }
      if (/^[A-Za-z_$][\w$]*$/.test(tok)) bound.add(tok);
    }
  }

  // top-level declarations: function/class/const/let/var Name
  const declRE =
    /(?:^|[;{}\n])\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRE.exec(src))) bound.add(m[1]);

  return bound;
}

interface ResolvedImport {
  importName: string;
  type: ExportType;
  from: string;
  style?: string;
}

/**
 * Detect auto-importable components used in a file's **raw JSX** (`<Hello/>`)
 * and prepend the matching `import` statements — then leave the JSX untouched
 * so the bundler's own JSX transform compiles `<Hello/>` → `jsx(Hello)`, now
 * resolving to the injected import.
 *
 * Working on the raw source (rather than the post-transform `jsx(...)` output)
 * is why the plugin runs `enforce: 'pre'` and works in every bundler — even
 * ones whose JSX transform is built in and runs *after* plugins (esbuild, Farm),
 * where there is no `jsx(...)` for a post pass to match.
 */
export function transform(options: TransformOptions) {
  const { code, components, resolvers, local, id, consumerUsage } = options;
  const src = code.original;

  // Clear stale usage records for this file before we re-record. If the user
  // just deleted `<Foo/>` from their source, we don't want Foo to stay flagged
  // as a dependency of this consumer.
  consumerUsage?.delete(id);

  // Cheap gate: no capital-cased tag-looking token → no component JSX possible,
  // so skip the parse entirely (keeps non-component files off the hot path).
  if (!/<[A-Z]/.test(src)) return code.toString();

  let program: File;
  try {
    program = parse(src, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch {
    // Unparseable input — leave it for the bundler to report. Never throw.
    return code.toString();
  }

  // Capital-cased component names actually used in JSX, in first-seen order.
  // Parsing (not a regex) is what keeps TS generics like `useRef<HTMLDivElement>()`
  // or `Map<string, Foo>` from being mistaken for components.
  const used = new Set<string>();
  walk(program as unknown as EstreeNode, {
    enter(rawNode) {
      const node = rawNode as unknown as Node;
      if (node.type === "JSXOpeningElement") {
        const name = jsxRootName(node.name as Node);
        if (name) used.add(name);
      }
    },
  });

  if (!used.size) return code.toString();

  const boundNames = collectBoundNames(src);
  const imports: string[] = [];
  const injected: string[] = [];

  // Map of JSX tag → local component, with same-named files disambiguated by
  // directory namespace (`<ExtraHelloWorld/>`). The plugin precomputes this once
  // per component-set change and passes it in; fall back to building it here for
  // tests / direct callers. The same deterministic mapping backs generateDts, so
  // the injected import always matches the emitted declaration.
  const localNames =
    options.localNames !== undefined
      ? options.localNames
      : local
        ? resolveLocalJsxNames(components)
        : null;

  const resolveInfo = (name: string): ResolvedImport | null => {
    // 1. Local AST-scanned components win, looked up by the (possibly
    // namespaced) JSX tag. `found.name` is the real export — when it differs
    // from the tag, the injection below aliases the import. Local-first matches
    // generateDts's dedupe ("the local file wins" on a name collision), so the
    // injected import and the emitted .d.ts always agree on where a tag resolves.
    if (localNames) {
      const found = localNames.get(name);
      if (found) {
        return {
          importName: found.name,
          type: found.type as ExportType,
          from: toRelativeImport(id, found.path),
        };
      }
    }
    // 2. Fall back to user-supplied resolvers.
    const hit = resolveComponent(resolvers, name);
    if (hit) {
      return {
        importName: hit.name,
        type: hit.type ?? "Export",
        from: hit.from,
        style: hit.style,
      };
    }
    return null;
  };

  for (const name of used) {
    // Never shadow a name the module already binds (imported or declared).
    if (boundNames.has(name)) continue;

    const info = resolveInfo(name);
    if (!info) continue;

    // Record that this file uses this component name (powers surgical HMR
    // in the dev-server hook: when the component changes/appears/disappears,
    // we only nudge the files that actually consume it).
    if (consumerUsage) {
      let usedSet = consumerUsage.get(id);
      if (!usedSet) {
        usedSet = new Set();
        consumerUsage.set(id, usedSet);
      }
      usedSet.add(name);
    }

    // Bind the JSX name directly — no call-site rewriting needed, because the
    // bundler turns `<Name/>` into `jsx(Name)` which then resolves to this import.
    // `<AntButton/>` → import { Button as AntButton } from 'antd'
    // `<HelloWorld/>` → import HelloWorld from './HelloWorld'
    if (isExportComponent(info.type)) {
      imports.push(
        info.importName === name
          ? stringifyImport({ name, from: info.from })
          : stringifyImport({ name: info.importName, as: name, from: info.from }),
      );
    } else {
      imports.push(stringifyImport({ default: name, from: info.from }));
    }

    if (info.style) imports.push(stringifyImport(info.style));
    injected.push(name);
  }

  if (imports.length) {
    code.prepend(`${imports.join("\n")}\n`);
    dbg(`${id}: injected ${imports.length} import(s) for [${injected.join(", ")}]`);
  }

  return code.toString();
}
