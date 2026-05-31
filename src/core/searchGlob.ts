import { readFileSync } from "fs";
import { resolve } from "path";
import fg from "fast-glob";
import { parse } from "@babel/parser";
import { walk } from "estree-walker";
import type { Node } from "@babel/types";
import type {
  Components,
  ComponentsContext,
  SearchGlobOptions,
} from "../types";
import { slash } from "./utils";
import { createDebug } from "./debug";

const dbg = createDebug("scan");

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

  let program: any;
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

  walk(program as any, {
    enter(rawNode) {
      const node = rawNode as unknown as Node;
      let name = "";
      let type: ComponentsContext["type"] = "Declaration";

      // const A = () => <jsx/>
      if (
        node.type === "VariableDeclaration" &&
        node.declarations[0]?.init?.type === "ArrowFunctionExpression" &&
        (node.declarations[0].init.body as any)?.type === "JSXElement"
      ) {
        const decl = node.declarations.find(
          (d) => d.type === "VariableDeclarator" && d.id.type === "Identifier",
        );
        if (decl && decl.id.type === "Identifier") {
          type = "Declaration";
          name = decl.id.name;
        }
      }
      // function A() { return <jsx/> }
      else if (
        node.type === "FunctionDeclaration" &&
        node.body.type === "BlockStatement" &&
        node.body.body.some(
          (s) =>
            s.type === "ReturnStatement" &&
            (s.argument as any)?.type === "JSXElement",
        )
      ) {
        name = node.id?.name || "";
        type = "Declaration";
      }
      // export default function A() { return <jsx/> }
      // export default Identifier  (where Identifier was a Declaration)
      else if (node.type === "ExportDefaultDeclaration") {
        if (
          node.declaration.type === "FunctionDeclaration" &&
          node.declaration.body.body.some(
            (s) =>
              s.type === "ReturnStatement" &&
              (s.argument as any)?.type === "JSXElement",
          )
        ) {
          name = (node.declaration as any).id?.name || "";
          type = "ExportDefault";
        } else if (node.declaration.type === "Identifier") {
          const exportedName = node.declaration.name;
          const found = Array.from(components).find(
            (c) => c.name === exportedName,
          );
          if (found && found.type === "Declaration") {
            found.type = "ExportDefault";
            return;
          }
        }
      }
      // export function A() { return <jsx/> }
      // export const A = () => { return <jsx/> }
      else if (node.type === "ExportNamedDeclaration" && node.declaration) {
        if (
          node.declaration.type === "FunctionDeclaration" &&
          node.declaration.body.type === "BlockStatement" &&
          node.declaration.body.body.some(
            (s) =>
              s.type === "ReturnStatement" &&
              (s.argument as any)?.type === "JSXElement",
          )
        ) {
          name = node.declaration.id?.name || "";
          type = "Export";
        } else if (node.declaration.type === "VariableDeclaration") {
          const decl = node.declaration.declarations.find(
            (d) =>
              d.type === "VariableDeclarator" &&
              d.init?.type === "ArrowFunctionExpression",
          );
          if (decl && decl.init?.type === "ArrowFunctionExpression") {
            const body = decl.init.body;
            const returnsJsx =
              body.type === "JSXElement" ||
              (body.type === "BlockStatement" &&
                body.body.some(
                  (s) =>
                    s.type === "ReturnStatement" &&
                    (s.argument as any)?.type === "JSXElement",
                ));
            if (returnsJsx && decl.id.type === "Identifier") {
              name = decl.id.name;
              type = "Export";
            }
          }
        }
      }

      if (name) {
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
