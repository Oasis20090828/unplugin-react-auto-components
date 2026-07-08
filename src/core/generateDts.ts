import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, relative, resolve } from "path";
import type {
  ComponentResolveResult,
  ComponentsContext,
  GenerateDtsOptions,
  ImportPathTransform,
} from "../types";
import { isExportComponent, slash } from "./utils";
import { listAllComponents, resolveLocalJsxNames } from "./manager";
import { createDebug } from "./debug";

const dbg = createDebug("dts");

// Monotonic per-process counter for unique temp filenames (see the atomic write
// in generateDts). Several plugin instances share this module, so it keeps their
// temp files from clobbering each other.
let dtsWriteSeq = 0;

/** Synchronous sleep (we're on the build's main thread; keep it tiny). */
function sleepSync(ms: number) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // SharedArrayBuffer unavailable in some sandboxes — skip the backoff.
  }
}

/**
 * `renameSync`, but on Windows MoveFileEx can fail with EPERM/EACCES/EBUSY when
 * another process (a TS server, or a sibling webpack compiler) holds the target
 * .d.ts open. POSIX rename atomically replaces even with open readers, so this
 * retry is a no-op there.
 */
function renameWithRetry(tmp: string, dest: string) {
  if (process.platform !== "win32") {
    renameSync(tmp, dest);
    return;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, dest);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        throw e;
      }
      sleepSync(10 * (attempt + 1));
    }
  }
}

/** Atomic dts write with temp-file cleanup on failure. */
function atomicWriteDts(outPath: string, dts: string) {
  const tmp = `${outPath}.${process.pid}.${dtsWriteSeq++}.tmp`;
  try {
    writeFileSync(tmp, dts, "utf-8");
    renameWithRetry(tmp, outPath);
  } catch (e) {
    // Don't strand the temp beside the user's source if write/rename failed.
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw e;
  }
}

function stringifyLocal(
  rootPath: string,
  c: ComponentsContext,
  xform?: ImportPathTransform,
) {
  // `relative` produces e.g. `src/Hello.tsx` when the dts sits above the
  // component, or `../components/Hello.tsx` when it sits in a sibling dir
  // (`src/types/`). Only the first case needs a `./` prefix; the second
  // form is already valid TS path syntax.
  let rel = relative(rootPath, c.path);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  const spec = slash(rel).replace(/\.[jt]sx$/, "");
  const key = isExportComponent(c) ? c.name : "default";
  return `typeof import('${xform?.(spec) ?? spec}')['${key}']`;
}

function stringifyResolved(r: ComponentResolveResult, xform?: ImportPathTransform) {
  const key = (r.type ?? "Export") === "Export" ? r.name : "default";
  return `typeof import('${xform?.(r.from) ?? r.from}')['${key}']`;
}

/**
 * Tell the user when two local files share an export name and were
 * auto-namespaced — so they know which tag maps to which file.
 */
function warnLocalCollisions(
  components: Iterable<ComponentsContext>,
  localNames: Map<string, ComponentsContext>,
) {
  const byName = new Map<string, ComponentsContext[]>();
  for (const c of components) {
    const arr = byName.get(c.name);
    if (arr) arr.push(c);
    else byName.set(c.name, [c]);
  }
  const jsxOf = new Map<ComponentsContext, string>();
  for (const [jsx, c] of localNames) jsxOf.set(c, jsx);

  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const labels = group
      .map((c) => `${c.path} → <${jsxOf.get(c) ?? name}/>`)
      .join(", ");
    // eslint-disable-next-line no-console
    console.warn(
      `[unplugin-react-auto-components] ${group.length} local components named "${name}"; ` +
        `auto-namespaced so each stays importable: ${labels}`
    );
  }
}

interface Entry {
  /** The declaration body — `typeof import('...')['...']`. */
  body: string;
  /** Where this declaration came from, for the conflict warning. */
  source: string;
  /** Local components win over resolver components on a name collision. */
  isLocal: boolean;
}

/**
 * Emit `<rootPath>/<filename>.d.ts` that augments the global scope with one
 * `const X: typeof import(...)` per known component — both local AST-scanned
 * ones (when `local` is on) and everything every resolver enumerates via `list()`.
 *
 * Dedupe rule: when the same identifier comes from both a local file and a
 * resolver (e.g. user's `App.tsx` vs antd v5's `App` component), the **local**
 * wins. A warning is logged so the user knows why their import path went one
 * way. Without this dedupe, the generated file had two `const App: ...` lines
 * — only saved by the `// @ts-nocheck` pragma at the top.
 */
export function generateDts(options: GenerateDtsOptions) {
  const {
    components,
    rootPath = process.cwd(),
    filename = "components",
    resolvers,
    local,
    importPathTransform,
  } = options;

  // Map<identifier, Entry>. Insertion order is what we emit, but local entries
  // are written *before* resolver entries so the iteration order is stable.
  const entries = new Map<string, Entry>();

  if (local) {
    // Assign each local component a unique JSX tag. Same-named files in
    // different folders are kept (not dropped): the lowest-path one stays bare,
    // the rest get a directory-namespaced tag (`<ExtraHelloWorld/>`). The
    // mapping is deterministic, so the emitted file is stable and a dev server
    // never enters a rewrite → recompile loop.
    const localNames = resolveLocalJsxNames(components);
    for (const [jsxName, c] of localNames) {
      entries.set(jsxName, {
        body: stringifyLocal(rootPath, c, importPathTransform),
        source: c.path,
        isLocal: true,
      });
    }
    // Warn from the deduped, actually-emitted set (localNames' values), not the
    // raw `components` — otherwise a barrel re-export that was dropped as a
    // duplicate would trigger a spurious "N components named X" warning.
    warnLocalCollisions(localNames.values(), localNames);
  }

  for (const item of listAllComponents(resolvers)) {
    const existing = entries.get(item.jsxName);
    if (existing) {
      if (existing.isLocal) {
        // eslint-disable-next-line no-console
        console.warn(
          `[unplugin-react-auto-components] dts: "${item.jsxName}" is both a local component ` +
            `(${existing.source}) and a resolver export (${item.from}). The local file wins; ` +
            `rename one to silence this warning.`
        );
        continue;
      }
      // resolver vs resolver: keep first; second is a redundant duplicate.
      continue;
    }
    entries.set(item.jsxName, {
      body: stringifyResolved(item, importPathTransform),
      source: item.from,
      isLocal: false,
    });
  }

  const lines: string[] = [];
  lines.push("/* generated by unplugin-react-auto-components */");
  lines.push("/* eslint-disable */");
  lines.push("// @ts-nocheck");
  lines.push("export {}");
  lines.push("declare global {");
  // Emit names in a stable, deterministic order instead of `entries`'
  // insertion order. The watcher applies a component edit as delete-then-add,
  // which re-appends the changed component at the *end* of the `components`
  // Set — so insertion order would make its `const X: ...` line jump to the
  // bottom of the block on every edit, producing noisy git diffs. Sorting by
  // name keeps each declaration in a fixed spot: editing or adding one
  // component now touches only its own line. Code-unit comparison (not
  // `localeCompare`) so the output is identical across machines/locales.
  const sorted = [...entries.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  for (const [name, entry] of sorted) {
    lines.push(`  const ${name}: ${entry.body}`);
  }
  lines.push("}");
  lines.push("");

  const dts = lines.join("\n");
  const outPath = resolve(rootPath, `${filename}.d.ts`);

  // Skip the write when the file content is already identical. The big win is
  // that the editor's TS server won't see a no-op file change → no needless
  // type-check pass. This matters because every chokidar `change` event on a
  // component file currently triggers `emitDts`, even when the file's *exports*
  // didn't change (the user just edited the JSX body).
  if (existsSync(outPath)) {
    try {
      if (readFileSync(outPath, "utf-8") === dts) {
        dbg(`skip write (identical) ${outPath}`);
        return dts;
      }
    } catch {
      // fall through to write
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  // Atomic write. Tools like Next run the plugin in several webpack compilers
  // (server + client) at once, each emitting this file. A plain writeFileSync
  // truncates-then-writes, so a concurrent compiler's content-equality read
  // above can catch a *partial* file, think it changed, and rewrite — an endless
  // rewrite → recompile loop. Writing to a unique temp file and renaming (atomic
  // on the same filesystem) means every reader sees a complete file, so the
  // identical-content check actually fires and the writes settle.
  atomicWriteDts(outPath, dts);
  dbg(`wrote ${entries.size} component(s) → ${outPath}`);

  return dts;
}
