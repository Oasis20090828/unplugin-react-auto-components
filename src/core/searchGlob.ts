import { readFileSync } from "fs";
import { resolve } from "path";
import fg from "fast-glob";
import { parse } from "@babel/parser";
import { walk } from "estree-walker";
import type { File, Node } from "@babel/types";
import type { Node as EstreeNode } from "estree";
import type {
  Components,
  ComponentsContext,
  SearchGlobOptions,
} from "../types";
import { isCapitalCase, pascalCase, slash } from "./utils";
import { createDebug } from "./debug";

const dbg = createDebug("scan");

/** A JSX-producing node: an element (`<div/>`) or a fragment (`<>…</>`). */
const isJsxNode = (t?: string): boolean =>
  t === "JSXElement" || t === "JSXFragment";

/**
 * Does a function body yield JSX? Covers the arrow-expression form (`() => <x/>`,
 * `() => cond ? <a/> : <b/>`) and any JSX reachable inside a block — direct
 * returns, conditional/logical returns, JSX assigned then returned, etc. We walk
 * the body but stop at nested function boundaries (their JSX belongs to them, not
 * to us), so a render callback like `items.map(i => <Item/>)` doesn't misclassify
 * the enclosing helper.
 */
function bodyReturnsJsx(body: Node): boolean {
  if (isJsxNode(body.type)) return true; // () => <x/> | () => <>…</>
  let found = false;
  walk(body as unknown as EstreeNode, {
    enter(raw) {
      if (found) return this.skip();
      const node = raw as unknown as Node;
      // Don't descend into nested functions — their JSX isn't this body's. (body
      // is always a block/expression here, never a function, so no self-skip.)
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        return this.skip();
      }
      if (isJsxNode(node.type)) found = true;
    },
  });
  return found;
}

/**
 * A React component HOC call — `forwardRef(...)`, `memo(...)`, `lazy(...)`, or
 * their `React.`-qualified forms (also matches the common `memo(forwardRef(...))`
 * outer call). We trust the callee name, which is the universal convention.
 */
function isComponentHoc(node: Node): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  const calleeName =
    callee.type === "Identifier"
      ? callee.name
      : callee.type === "MemberExpression" &&
          callee.property.type === "Identifier"
        ? callee.property.name // React.forwardRef → "forwardRef"
        : "";
  return (
    calleeName === "forwardRef" ||
    calleeName === "memo" ||
    calleeName === "lazy"
  );
}

/** Unwrap `memo(forwardRef(x))` / `lazy(x)` down to the innermost argument. */
function unwrapHoc(node: Node): Node {
  let cur: Node = node;
  while (isComponentHoc(cur) && cur.type === "CallExpression") {
    const arg = cur.arguments[0] as Node | undefined;
    if (!arg) break;
    cur = arg;
  }
  return cur;
}

/**
 * The declared name of an HOC-wrapped component, if one can be derived — the
 * inner named function/class (`memo(function Card(){…})` → `Card`). Anonymous
 * arrows (`forwardRef((p,r) => …)`) yield `""` (nothing to name a default with).
 */
function hocInnerName(call: Node): string {
  const inner = unwrapHoc(call);
  if (
    (inner.type === "FunctionExpression" ||
      inner.type === "FunctionDeclaration" ||
      inner.type === "ClassExpression") &&
    inner.id
  ) {
    return inner.id.name;
  }
  return "";
}

/**
 * A React class component: `class X extends React.Component | Component |
 * PureComponent`, or any class with a `render()` method that returns JSX (covers
 * classes extending a custom/renamed base).
 */
function isClassComponent(node: Node): boolean {
  if (node.type !== "ClassDeclaration" && node.type !== "ClassExpression")
    return false;
  const sc = node.superClass;
  const scName =
    sc?.type === "Identifier"
      ? sc.name
      : sc?.type === "MemberExpression" && sc.property.type === "Identifier"
        ? sc.property.name // React.Component → "Component"
        : "";
  if (scName === "Component" || scName === "PureComponent") return true;
  for (const m of node.body.body) {
    if (
      (m.type === "ClassMethod" || m.type === "ClassPrivateMethod") &&
      m.key.type === "Identifier" &&
      m.key.name === "render" &&
      bodyReturnsJsx(m.body as Node)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Is this initializer a component? A function returning JSX (element or
 * fragment), or a forwardRef/memo/lazy HOC call. Covers `() => <x/>`,
 * `function(){ return <>…</> }`, `forwardRef((p,ref) => <x/>)`, `memo(X)`,
 * `lazy(() => import('./X'))`.
 */
function initIsComponent(init: Node | null | undefined): boolean {
  if (!init) return false;
  if (
    init.type === "ArrowFunctionExpression" ||
    init.type === "FunctionExpression"
  ) {
    return bodyReturnsJsx(init.body);
  }
  if (init.type === "ClassExpression") return isClassComponent(init);
  return isComponentHoc(init);
}

/**
 * A name for an ANONYMOUS default-exported component, derived from the file:
 * `Card.tsx` → `Card`, `date-picker.tsx` → `DatePicker`. A bare `index.tsx`
 * falls back to its parent directory (`Button/index.tsx` → `Button`), the usual
 * convention. Returns `""` when nothing sensible can be derived.
 */
function deriveDefaultName(slashedPath: string): string {
  const segs = slashedPath.split("/").filter(Boolean);
  let base = (segs.pop() || "").replace(/\.[jt]sx?$/, "");
  if (base === "index") base = segs.pop() || "";
  const pascal = pascalCase(base).replace(/[^A-Za-z0-9_$]/g, "");
  return /^[A-Za-z]/.test(pascal) ? pascal : "";
}

/** A component-shaped default export (function/class/arrow/HOC returning JSX). */
function defaultIsComponent(d: Node): boolean {
  if (d.type === "FunctionDeclaration" || d.type === "FunctionExpression")
    return bodyReturnsJsx(d.body);
  if (d.type === "ArrowFunctionExpression") return bodyReturnsJsx(d.body);
  if (d.type === "ClassDeclaration" || d.type === "ClassExpression")
    return isClassComponent(d);
  return isComponentHoc(d);
}

/**
 * AST-scan a single `.tsx` / `.jsx` file and return the React components it
 * exports. Used by both `searchGlob` (initial full scan) and the dev-server
 * watcher (incremental update on add/change). Pure and synchronous.
 *
 * `Declaration`-only entries (top-level components never exported) are
 * dropped — we can't import what isn't exported.
 */
export function scanFile(fullPath: string): ComponentsContext[] {
  let code: string;
  try {
    code = readFileSync(fullPath, "utf-8");
  } catch {
    return [];
  }

  let program: File;
  try {
    program = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch {
    return [];
  }

  const slashedPath = slash(fullPath);
  const components: Components = new Set();

  // estree-walker types its argument as ESTree's `Node`. @babel/types is a
  // superset (it adds JSX/TS nodes) — same shape at runtime, but TS treats
  // them as nominally distinct trees. One cast at the boundary keeps the
  // walker callbacks fully typed against @babel/types below.
  // Promote a previously-found `Declaration` component to an exported one
  // (`export { X }` / `export default X`). Optionally rename it to `as` (the
  // exported identifier). Returns true if a matching declaration was promoted.
  const promote = (
    local: string,
    as: string,
    exportType: ComponentsContext["type"],
  ): boolean => {
    for (const c of components) {
      if (c.name === local && c.type === "Declaration") {
        c.type = exportType;
        if (as && as !== local) c.name = as;
        return true;
      }
    }
    return false;
  };

  walk(program as unknown as EstreeNode, {
    enter(rawNode) {
      const node = rawNode as unknown as Node;
      let name = "";
      let type: ComponentsContext["type"] = "Declaration";

      // const A = () => <x/> | forwardRef(...) | memo(...) | lazy(...) | class …
      if (node.type === "VariableDeclaration") {
        const decl = node.declarations.find(
          (d) =>
            d.type === "VariableDeclarator" &&
            d.id.type === "Identifier" &&
            initIsComponent(d.init)
        );
        if (decl && decl.id.type === "Identifier") {
          name = decl.id.name;
          type = "Declaration";
        }
      }
      // function A() { return <x/> }
      else if (
        node.type === "FunctionDeclaration" &&
        bodyReturnsJsx(node.body)
      ) {
        name = node.id?.name || "";
        type = "Declaration";
      }
      // class A extends React.Component { render() { return <x/> } }
      else if (node.type === "ClassDeclaration" && isClassComponent(node)) {
        name = node.id?.name || "";
        type = "Declaration";
      }
      // export default function A(){…} | class A {…} | memo(function A(){…})
      // export default () => <x/>   (anonymous → named from the file)
      // export default Identifier   (where Identifier was a Declaration)
      else if (node.type === "ExportDefaultDeclaration") {
        const d = node.declaration;
        if (d.type === "Identifier") {
          if (promote(d.name, "", "ExportDefault")) return;
        } else if (defaultIsComponent(d)) {
          // Prefer a real declared name (function/class id, or an HOC's inner
          // name); fall back to the filename for anonymous defaults such as
          // `export default () => <x/>` or `export default forwardRef(...)`.
          const declared =
            d.type === "FunctionDeclaration" ||
            d.type === "FunctionExpression" ||
            d.type === "ClassDeclaration" ||
            d.type === "ClassExpression"
              ? d.id?.name || ""
              : isComponentHoc(d)
                ? hocInnerName(d)
                : "";
          name = declared || deriveDefaultName(slashedPath);
          type = "ExportDefault";
        }
      }
      // export function A() {...} | export class A {...}
      // export const A = () => <x/> | forwardRef(...) | memo(...)
      else if (node.type === "ExportNamedDeclaration" && node.declaration) {
        const d = node.declaration;
        if (d.type === "FunctionDeclaration" && bodyReturnsJsx(d.body)) {
          name = d.id?.name || "";
          type = "Export";
        } else if (d.type === "ClassDeclaration" && isClassComponent(d)) {
          name = d.id?.name || "";
          type = "Export";
        } else if (d.type === "VariableDeclaration") {
          const decl = d.declarations.find(
            (v) =>
              v.type === "VariableDeclarator" &&
              v.id.type === "Identifier" &&
              initIsComponent(v.init)
          );
          if (decl && decl.id.type === "Identifier") {
            name = decl.id.name;
            type = "Export";
          }
        }
      }
      // export { A, B as C } from './x'   — re-export from a barrel. We can't
      // scan the source module here, so a capital-cased exported name is taken
      // to be a component, importable from THIS file. Marked `reexport` so the
      // manager can drop it if the same name is also found by direct scan.
      else if (
        node.type === "ExportNamedDeclaration" &&
        node.source &&
        !node.declaration
      ) {
        for (const spec of node.specifiers) {
          if (spec.type !== "ExportSpecifier") continue;
          const exported =
            spec.exported.type === "Identifier" ? spec.exported.name : "";
          // PascalCase only: capital first char AND at least one lowercase, so a
          // re-exported `SOME_CONST` / `API` isn't mistaken for a component.
          // (We can't scan the source module to verify, so this is the signal.)
          if (exported && isCapitalCase(exported) && /[a-z]/.test(exported)) {
            components.add({
              name: exported,
              type: "Export",
              path: slashedPath,
              reexport: true,
            });
          }
        }
      }
      // export { A, B as C }   — no source: promote earlier local declarations.
      else if (
        node.type === "ExportNamedDeclaration" &&
        !node.source &&
        !node.declaration
      ) {
        for (const spec of node.specifiers) {
          if (
            spec.type === "ExportSpecifier" &&
            spec.local.type === "Identifier" &&
            spec.exported.type === "Identifier"
          ) {
            promote(spec.local.name, spec.exported.name, "Export");
          }
        }
      }

      // `export *` can't be enumerated without resolving the source module.
      // Capital-cased first char keeps hooks/utilities (`useX`) and constants
      // out of the component set.
      if (name && isCapitalCase(name)) {
        components.add({ name, type, path: slashedPath });
      }
    },
  });

  // Drop dangling declarations that nothing ever exported.
  return Array.from(components).filter((c) => c.type !== "Declaration");
}

/**
 * Walk the project tree under `rootPath`, find every file matching `globs`
 * (default: `**\/*.{tsx,jsx}` under the root), delegate to `scanFile` for each,
 * and aggregate the results.
 */
export function searchGlob(options: SearchGlobOptions): Components {
  const { rootPath, globs = ["**/*.tsx", "**/*.jsx"] } = options;

  const files = fg.sync(globs, {
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
    cwd: rootPath,
  });

  const out: Components = new Set();
  for (const file of files) {
    for (const c of scanFile(resolve(rootPath, file))) out.add(c);
  }
  dbg(`scanned ${files.length} files, found ${out.size} component(s)`);
  return out;
}
