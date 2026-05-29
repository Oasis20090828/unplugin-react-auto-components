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

/**
 * Walk the project tree under `rootPath`, find every `.tsx` / `.jsx` file,
 * AST-scan each one and collect "this file exports a React component" facts.
 *
 * Mirrors the master implementation: we classify each declaration as
 * `Declaration` (top-level but not exported), `Export` (named export) or
 * `ExportDefault`. Pure `Declaration` entries are filtered out at the end —
 * if a component isn't exported, we can't import it.
 */
export function searchGlob(options: SearchGlobOptions): Components {
  const { rootPath } = options;

  const files = fg.sync(["**/*.tsx", "**/*.jsx"], {
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
    cwd: rootPath,
  });

  const components: Components = new Set();

  for (const file of files) {
    const fullPath = resolve(rootPath, file);
    let code: string;
    try {
      code = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    let program: any;
    try {
      program = parse(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
        errorRecovery: true,
      });
    } catch {
      continue;
    }

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
            (d) => d.type === "VariableDeclarator" && d.id.type === "Identifier"
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
              (s.argument as any)?.type === "JSXElement"
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
                (s.argument as any)?.type === "JSXElement"
            )
          ) {
            name = (node.declaration as any).id?.name || "";
            type = "ExportDefault";
          } else if (node.declaration.type === "Identifier") {
            const exportedName = node.declaration.name;
            const found = Array.from(components).find(
              (c) => c.name === exportedName
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
                (s.argument as any)?.type === "JSXElement"
            )
          ) {
            name = node.declaration.id?.name || "";
            type = "Export";
          } else if (node.declaration.type === "VariableDeclaration") {
            const decl = node.declaration.declarations.find(
              (d) =>
                d.type === "VariableDeclarator" &&
                d.init?.type === "ArrowFunctionExpression"
            );
            if (decl && decl.init?.type === "ArrowFunctionExpression") {
              const body = decl.init.body;
              const returnsJsx =
                body.type === "JSXElement" ||
                (body.type === "BlockStatement" &&
                  body.body.some(
                    (s) =>
                      s.type === "ReturnStatement" &&
                      (s.argument as any)?.type === "JSXElement"
                  ));
              if (returnsJsx && decl.id.type === "Identifier") {
                name = decl.id.name;
                type = "Export";
              }
            }
          }
        }

        if (name) {
          components.add({
            name,
            type,
            path: slash(fullPath),
          });
        }
      },
    });
  }

  // Drop dangling declarations that nothing ever exported.
  return new Set(
    Array.from(components).filter((c) => c.type !== "Declaration")
  );
}
