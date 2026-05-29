import { dirname, relative } from "path";
import type { ExportType, TransformOptions } from "../types";
import { isExportComponent, slash, stringifyImport } from "./utils";
import { resolveComponent } from "./manager";

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

// Match a post-JSX-runtime call site for a capital-letter component. We capture
// the runtime fn name (group 1) and the component identifier (group 2).
//
// The fn is one of jsx / jsxs / jsxDEV, with an OPTIONAL leading underscore —
// both spellings occur in the wild:
//   jsxDEV(Button, ...)    ← Vite dev (binding named `jsxDEV`)
//   _jsxDEV(Button, ...)   ← Babel automatic dev runtime
//   jsx(Button) / jsxs(..) ← prod react/jsx-runtime (single / static children)
//   _jsx(Button) / _jsxs   ← Babel automatic prod runtime
//
// `jsxDEV` is listed before `jsxs`/`jsx` so the longest name wins. The
// `(?<![\w.])` lookbehind avoids matching inside another identifier
// (`foo_jsx(`) or a member access (`React.jsx(`). Requiring `[A-Z]` for the
// component skips intrinsic tags (`jsx("div")`) and lowercase locals.
const callRE = /(?<![\w.])(_?(?:jsxDEV|jsxs|jsx))\(([A-Z]\w*)/g;

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

export function transform(options: TransformOptions) {
  const { code, components, resolvers, local, id } = options;
  const src = code.original;

  const matches = Array.from(src.matchAll(callRE)).map((m) => ({
    fn: m[1],
    name: m[2],
    original: m[0], // e.g. "jsxs(Button"
  }));

  if (!matches.length) return code.toString();

  const boundNames = collectBoundNames(src);
  const aliasOf = new Map<string, string>(); // component name -> local alias
  const processedTokens = new Set<string>(); // exact "fn(Name" tokens handled
  const imports: string[] = [];
  let index = 0;

  const resolveInfo = (name: string): ResolvedImport | null => {
    // 1. User-supplied resolvers win.
    const hit = resolveComponent(resolvers, name);
    if (hit) {
      return {
        importName: hit.name,
        type: hit.type ?? "Export",
        from: hit.from,
        style: hit.style,
      };
    }
    // 2. Fall back to AST-scanned local components.
    if (!local) return null;
    const found = Array.from(components).find((c) => c.name === name);
    if (!found) return null;
    return {
      importName: found.name,
      type: found.type as ExportType,
      from: toRelativeImport(id, found.path),
    };
  };

  for (const matched of matches) {
    // A given "fn(Name" token only needs one replaceAll pass.
    if (processedTokens.has(matched.original)) continue;
    processedTokens.add(matched.original);

    // Never shadow a name the module already binds (imported or declared).
    if (boundNames.has(matched.name)) continue;

    const info = resolveInfo(matched.name);
    if (!info) continue;

    // Reuse one alias + one import per component, even across jsx/jsxs/_jsx.
    let alias = aliasOf.get(matched.name);
    if (!alias) {
      alias = `_unplugin_react_${matched.name}_${index}`;
      index++;
      aliasOf.set(matched.name, alias);

      if (isExportComponent(info.type))
        imports.push(
          stringifyImport({ name: info.importName, as: alias, from: info.from }),
        );
      else imports.push(stringifyImport({ default: alias, from: info.from }));

      if (info.style) imports.push(stringifyImport(info.style));
    }

    // Preserve the original runtime fn (jsx vs jsxs matters — they differ in
    // how children are passed), only swap the component identifier.
    code.replaceAll(matched.original, `${matched.fn}(${alias}`);
  }

  if (imports.length) code.prepend(`${imports.join("\n")}\n`);

  return code.toString();
}
