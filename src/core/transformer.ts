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

/** Add every identifier a binding pattern introduces (handles destructuring). */
function collectPatternNames(node: Node, out: Set<string>): void {
  switch (node.type) {
    case "Identifier":
      out.add(node.name);
      break;
    case "ObjectPattern":
      for (const p of node.properties) {
        if (p.type === "ObjectProperty") collectPatternNames(p.value as Node, out);
        else collectPatternNames(p.argument as Node, out); // RestElement
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) if (el) collectPatternNames(el as Node, out);
      break;
    case "AssignmentPattern":
      collectPatternNames(node.left as Node, out);
      break;
    case "RestElement":
      collectPatternNames(node.argument as Node, out);
      break;
  }
}

/**
 * Char offset at which injected imports must go so they land AFTER a module's
 * directive prologue (`"use client"` / `"use server"` / `"use strict"`), or `0`
 * when there's no directive. Prepending imports at position 0 would push them
 * above `"use client"`, which then stops being the first statement — Next.js
 * silently demotes the file to a Server Component and the build breaks. React
 * allows imports after the directive, so we insert right before the first real
 * statement (keeping any leading comments above the imports too).
 */
function directivePrologueEnd(program: File): number {
  const prog = program.program;
  const dirs = prog.directives;
  if (!dirs || !dirs.length) return 0;
  const firstStmt = prog.body[0];
  if (firstStmt && typeof firstStmt.start === "number") return firstStmt.start;
  const lastDir = dirs[dirs.length - 1];
  return typeof lastDir.end === "number" ? lastDir.end : 0;
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
  const { code, components, resolvers, local, id, consumerUsage, importPathTransform } =
    options;
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

  // Single AST pass collecting BOTH:
  //   • `used`       — capital-cased component names referenced in JSX
  //   • `boundNames` — identifiers the module already binds (value imports +
  //                    function/class/`const`/`let`/`var`, incl. destructuring)
  //
  // Parsing (not a regex) is what keeps TS generics like `useRef<HTMLDivElement>()`
  // from being mistaken for components, AND makes binding detection immune to
  // import/declaration keywords inside comments or strings. `import type { X }` /
  // `import { type X }` are erased at runtime, so they're NOT treated as bindings
  // (a type-only import never blocks the value import). One walk, not two — this
  // is the per-file hot path.
  const used = new Set<string>();
  const boundNames = new Set<string>();
  walk(program as unknown as EstreeNode, {
    enter(rawNode) {
      const node = rawNode as unknown as Node;
      if (node.type === "JSXOpeningElement") {
        const name = jsxRootName(node.name as Node);
        if (name) used.add(name);
        return;
      }
      switch (node.type) {
        case "ImportDeclaration": {
          if (node.importKind === "type") return this.skip(); // `import type { … }`
          for (const spec of node.specifiers) {
            if (spec.type === "ImportSpecifier" && spec.importKind === "type")
              continue; // `import { type X }`
            boundNames.add(spec.local.name);
          }
          return this.skip();
        }
        case "FunctionDeclaration":
        case "ClassDeclaration":
          if (node.id) boundNames.add(node.id.name);
          break;
        case "VariableDeclarator":
          collectPatternNames(node.id as Node, boundNames);
          break;
      }
    },
  });

  if (!used.size) return code.toString();

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

    // Let the user rewrite the specifier (e.g. `antd` → `antd/es`). The same
    // rewrite runs in generateDts, so the injected import and the emitted .d.ts
    // stay in agreement. Style side-effect paths are left untouched.
    const from = importPathTransform?.(info.from) ?? info.from;

    // Bind the JSX name directly — no call-site rewriting needed, because the
    // bundler turns `<Name/>` into `jsx(Name)` which then resolves to this import.
    // `<AntButton/>` → import { Button as AntButton } from 'antd'
    // `<HelloWorld/>` → import HelloWorld from './HelloWorld'
    if (isExportComponent(info.type)) {
      imports.push(
        info.importName === name
          ? stringifyImport({ name, from })
          : stringifyImport({ name: info.importName, as: name, from }),
      );
    } else {
      imports.push(stringifyImport({ default: name, from }));
    }

    if (info.style) imports.push(stringifyImport(info.style));
    injected.push(name);
  }

  if (imports.length) {
    const block = `${imports.join("\n")}\n`;
    // Insert after any `"use client"` / `"use server"` prologue so the directive
    // stays the module's first statement; otherwise prepend at the top.
    const at = directivePrologueEnd(program);
    if (at > 0) code.appendLeft(at, block);
    else code.prepend(block);
    dbg(`${id}: injected ${imports.length} import(s) for [${injected.join(", ")}]`);
  }

  return code.toString();
}
