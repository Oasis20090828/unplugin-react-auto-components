# unplugin-react-auto-components

> Auto-import React components on-demand. Reads your JSX, figures out which
> components you used, and injects the imports for you. Works in Vite, Webpack,
> Rollup, Rspack, esbuild, Rolldown, and Farm — plus Next.js — via
> [unplugin](https://github.com/unjs/unplugin).
> Inspired by [unplugin-vue-components](https://github.com/unplugin/unplugin-vue-components).

```tsx
// You write this:
export default function App() {
  return (
    <Space>
      <Button type="primary">Click</Button>
      <HelloWorld name="React" />
    </Space>
  );
}

// The plugin turns it into this:
import { Space as _u1, Button as _u2 } from "antd";
import _u3 from "./components/HelloWorld";
export default function App() {
  return jsxs(_u1, {
    children: [
      jsx(_u2, { type: "primary", children: "Click" }),
      jsx(_u3, { name: "React" }),
    ],
  });
}
```

## Features

- 🚀 **Zero-import JSX** — local components and 3rd-party UI libs alike
- 📦 **Tree-shake friendly** — emits one `import { Name } from 'lib'` per component, no barrel imports
- 🎨 **Built-in resolvers** — Ant Design (v4 + v5), Ant Design Mobile, MUI, shadcn/ui
- 🔧 **Custom resolvers in one line** — `createResolver({ module, prefix })`
- 📝 **`components.d.ts`** — auto-emitted so TypeScript + your editor stay happy
- ♻️ **Live in dev** — add a new component file and it shows up without restarting; surgical HMR (no full page reload when possible)
- 🛠️ **Vite / Webpack / Rollup / Rspack / esbuild / Rolldown / Farm** — plus **Next.js** (webpack mode, verified)

## Install

```bash
pnpm add -D unplugin-react-auto-components
# or npm i -D / yarn add -D
```

> **ESM-only**, requires **Node ≥ 20.19**. It still works from a CommonJS
> bundler config (e.g. a `webpack.config.js` using `require`) — Node ≥ 20.19
> loads the ESM build through its built-in `require(ESM)`.

## Quick start

Import the plugin from the entry that matches your bundler and drop
`Components({ … })` into its plugins array — the options are identical
everywhere. Click a bundler to expand its config.

> **Config in TypeScript?** Supported by Vite, Farm, Rolldown, Rspack (CLI ≥ v1.5)
> and Next.js (≥ 15) — all verified. Which extension to use:
>
> - **Vite / Farm / Next.js → `.ts`.** They load the config with their own
>   toolchain, which handles this ESM-only plugin's `import`. (Next.js accepts
>   `next.config.ts` but **rejects `.mts`**.)
> - **Rspack / Rolldown → `.mts`.** They use Node's native TS loader, so `.mts`
>   guarantees the config is ESM; a plain `.ts` there needs `"type": "module"` in
>   `package.json`.
> - **Webpack / Rollup** need `ts-node` / a config plugin for a TS config, so
>   their examples below stay `.mjs`.

<details open>
<summary><b>Vite</b></summary>

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Components from "unplugin-react-auto-components/vite";
import { AntdResolver } from "unplugin-react-auto-components/resolvers";

export default defineConfig({
  plugins: [
    react(),
    Components({
      dts: true,
      resolvers: [AntdResolver({ version: 5, prefix: "Ant" })],
    }),
  ],
});
```

</details>

<details>
<summary><b>Webpack</b></summary>

```js
// webpack.config.mjs  (or any config that uses ESM `import`)
import Components from "unplugin-react-auto-components/webpack";
import { AntdResolver } from "unplugin-react-auto-components/resolvers";

export default {
  plugins: [
    Components({
      dts: true,
      resolvers: [AntdResolver({ version: 5, prefix: "Ant" })],
    }),
  ],
};
```

> Prefer a CommonJS `webpack.config.js`? Still works on Node ≥ 20.19:
> `const Components = require("unplugin-react-auto-components/webpack").default`
> (Node loads the ESM build via its built-in `require(ESM)`).

</details>

<details>
<summary><b>Rollup</b></summary>

```js
// rollup.config.mjs
import Components from "unplugin-react-auto-components/rollup";
import { AntdResolver } from "unplugin-react-auto-components/resolvers";

export default {
  input: "src/main.jsx",
  plugins: [
    // ⚠️ Rollup ignores unplugin's `enforce` and runs plugins in array order,
    // so Components MUST come before your JSX transform (e.g. @rollup/plugin-babel).
    Components({
      dts: true,
      resolvers: [AntdResolver({ version: 5, prefix: "Ant" })],
    }),
    // …@rollup/plugin-node-resolve, @rollup/plugin-babel, etc.
  ],
};
```

</details>

<details>
<summary><b>Rspack</b></summary>

```js
// rspack.config.mts  (TypeScript; Rspack CLI ≥ v1.5. A CommonJS .js with `require` also works)
import Components from "unplugin-react-auto-components/rspack";
import { AntdResolver } from "unplugin-react-auto-components/resolvers";

export default {
  plugins: [
    Components({
      dts: true,
      resolvers: [AntdResolver({ version: 5, prefix: "Ant" })],
    }),
  ],
};
```

</details>

<details>
<summary><b>esbuild</b></summary>

```js
// build.mjs — esbuild plugins are JS-API only (they can't run via the esbuild CLI)
import { build } from "esbuild";
import Components from "unplugin-react-auto-components/esbuild";
import { AntdResolver } from "unplugin-react-auto-components/resolvers";

await build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  jsx: "automatic",
  plugins: [
    Components({
      dts: true,
      resolvers: [AntdResolver({ version: 5, prefix: "Ant" })],
    }),
  ],
});
```

</details>

<details>
<summary><b>Rolldown</b></summary>

```js
// rolldown.config.mts  (TypeScript)
import { defineConfig } from "rolldown";
import Components from "unplugin-react-auto-components/rolldown";
import { AntdResolver } from "unplugin-react-auto-components/resolvers";

export default defineConfig({
  input: "src/main.jsx",
  plugins: [
    // ⚠️ Like Rollup, Rolldown runs plugins in array order (ignores `enforce`) —
    // put Components before the JSX transform.
    Components({
      dts: true,
      resolvers: [AntdResolver({ version: 5, prefix: "Ant" })],
    }),
  ],
});
```

</details>

<details>
<summary><b>Farm</b></summary>

```ts
// farm.config.ts
import { defineConfig } from "@farmfe/core";
import Components from "unplugin-react-auto-components/farm";
import { AntdResolver } from "unplugin-react-auto-components/resolvers";

export default defineConfig({
  plugins: [
    Components({
      dts: true,
      resolvers: [AntdResolver({ version: 5, prefix: "Ant" })],
    }),
  ],
});
```

</details>

<details>
<summary><b>Next.js</b></summary>

Next.js has no built-in component auto-import — use the dedicated `/next` entry
to wrap your config (the React analog of `unplugin-vue-components/nuxt`):

```js
// next.config.ts  (TypeScript, Next.js ≥ 15 — Next accepts .ts, NOT .mts)
import ReactComponents from "unplugin-react-auto-components/next";

export default ReactComponents({
  dts: true,
  // dirs / resolvers / … same options as everywhere else
})({
  reactStrictMode: true, // ← your usual Next.js config (optional)
});
```

```js
// next.config.js (CommonJS)
const ReactComponents = require("unplugin-react-auto-components/next").default;
module.exports = ReactComponents({ dts: true })({ reactStrictMode: true });
```

<details><summary>Or wire the webpack plugin by hand</summary>

```js
// next.config.js
const Components = require("unplugin-react-auto-components/webpack").default;
module.exports = {
  webpack(config) {
    config.plugins.push(Components({ dts: true }));
    return config;
  },
};
```

</details>

> ✅ **Verified on Next.js 15 (Pages Router, `next build` / webpack, a TS
> `next.config.ts`)** — a component used in JSX with no import is auto-injected
> at build time. (Works on Next.js 14 too, via `next.config.js`.)
>
> ⚠️ **Turbopack is not supported.** `next dev --turbo` and Turbopack builds
> bypass the webpack pipeline, so the plugin won't run — use the default
> webpack mode. In the App Router this works for **Client Components**;
> auto-import inside Server Components is untested.

</details>

## Local components — zero config

By default everything under `process.cwd()` is scanned for `.tsx` / `.jsx`
files that look like React components.

```
src/
├── App.tsx
└── components/
    └── HelloWorld.tsx     ← export default function HelloWorld() { ... }
```

```tsx
// src/App.tsx — no import needed for <HelloWorld/>
export default function App() {
  return <HelloWorld name="React" />;
}
```

Restrict the scan with `dirs` (sugar) or `globs` (raw):

```ts
Components({
  // dirs: 'src/components' → 'src/components/**/*.{tsx,jsx}'
  dirs: ["src/components", "src/widgets"],
  // …or for full control + negation:
  globs: ["src/components/**/*.tsx", "!**/*.test.tsx"],
});
```

## Built-in resolvers

All resolvers live in `unplugin-react-auto-components/resolvers`.

### Ant Design

Handles v4 (CSS side-effects) and v5 / v6 (CSS-in-JS) — auto-detects the
installed major version, override with `version` if needed.

```ts
import { AntdResolver } from "unplugin-react-auto-components/resolvers";

Components({
  resolvers: [
    AntdResolver({
      // version: 5,                      // any number; default: auto-detect, fallback 5
      // prefix: 'Ant',                   // <AntButton/> → import { Button } from 'antd'
      // importStyle: 'css' | 'less' | 'css-in-js' | false,  // default: <5 → 'css', >=5 → false
      // cjs: false,                      // use lib/ instead of es/
      // packageName: 'antd',             // fork override
      // dynamic: false,                  // see below
      // exclude: (name) => false,
    }),
  ],
});
```

`version` is a **number**, and behavior splits on `>= 5`:

- **`< 5`** (v4 and earlier) → CSS style imports (`importStyle: 'css'`) and the
  v4 component set (`BackTop`, `Comment`, `PageHeader`, …).
- **`>= 5`** (v5, v6, …) → no style import (CSS-in-JS) and the v5+ component set
  (`App`, `FloatButton`, `Splitter`, …).

So `6`, `7`, … Just Work without a code change. When omitted, the resolver reads
the installed `antd`'s major version and falls back to `5`.

> ⚠️ **`prefix` must be PascalCase.** JSX treats `<antButton/>` as the HTML
> tag `"antButton"` (a string), not a component reference, so a lowercase
> prefix can never match. Use `'Ant'` and write `<AntButton/>`.

**Static vs. dynamic discovery**: by default we ship a curated component list
(fast, no antd install required for CI). Pass `dynamic: true` to instead
`require('antd')` at startup and use its real exports — slower, but always
matches the precise installed version.

### Ant Design Mobile

```ts
import { AntdMobileResolver } from "unplugin-react-auto-components/resolvers";
Components({
  resolvers: [
    AntdMobileResolver({
      /* prefix?, exclude? */
    }),
  ],
});
```

### Material UI

```ts
import { MuiResolver } from "unplugin-react-auto-components/resolvers";
Components({ resolvers: [MuiResolver()] }); // <MuiButton/> → import { Button } from '@mui/material'
```

### shadcn/ui

shadcn isn't an npm package — its CLI copies components into your repo. The
resolver discovers what you actually have by scanning the filesystem.

Tags carry a **`Ui` prefix by default** — write `<UiButton/>`, `<UiCard/>` — so
shadcn components read distinctly from native HTML tags (`<button>`) and your own
PascalCase components. The prefix is stripped to find the file and re-applied as
an import alias: `<UiButton/>` → `import { Button as UiButton } from '@/components/ui/button'`.

```ts
import { ShadcnResolver } from "unplugin-react-auto-components/resolvers";

Components({
  resolvers: [
    ShadcnResolver({
      // prefix: 'Ui',                             // default; set '' for bare <Button/>
      // componentsDir: '@/components/ui',          // import alias (the `from` field)
      // componentsRoot: './src/components/ui',    // real filesystem path to scan
      // components: ['Button', 'Card'],           // explicit list, overrides scan
      // defaultExport: false,
    }),
  ],
});
```

> **Migration (≥ 0.2.6):** the default `prefix` changed from `''` to `'Ui'`. If
> you previously used bare shadcn tags (`<Button/>`), either rewrite them as
> `<UiButton/>` or pass `prefix: ''` to keep the old behavior.

## Custom resolvers — `createResolver`

For any npm package whose components are top-level capital-cased exports
(antd, MUI, Mantine, your own UI lib, …) — one line.

```ts
import { createResolver } from "unplugin-react-auto-components";

Components({
  resolvers: [
    createResolver({
      module: "my-lib",
      prefix: "My", // <MyButton/> → import { Button } from 'my-lib'
      exclude: (name) => name.startsWith("Internal"),
      // style: (name, mod) => `${mod}/styles/${name}.css`, // optional CSS side-effect
    }),
  ],
});
```

`createResolver` reads the package's real exports asynchronously at startup
(via `local-pkg`), so it always matches the installed version. It falls back
to matching nothing (with a warning) if the package isn't installed.

### Fully hand-rolled `ComponentResolver`

For libraries with non-barrel layouts (e.g. `my-lib/SubPath/X`) or unusual
naming, implement `ComponentResolver` directly:

```ts
import type { ComponentResolver } from "unplugin-react-auto-components";

const MyResolver: ComponentResolver = {
  type: "component",
  resolve(jsxName) {
    if (!jsxName.startsWith("My")) return;
    const name = jsxName.slice(2);
    return { jsxName, name, from: `my-lib/${name}`, type: "Export" };
  },
  // Optional — needed if you want this resolver's components in components.d.ts
  list() {
    return [
      {
        jsxName: "MyButton",
        name: "Button",
        from: "my-lib/Button",
        type: "Export",
      },
    ];
  },
};
```

## Options

| option      | type                                  | default                     | description                                                                 |
| ----------- | ------------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `rootDir`   | `string`                              | `process.cwd()`             | Project root. Used for `dirs` / `globs` resolution and dts location.        |
| `dirs`      | `string[]`                            | `[]`                        | Sugar for `<dir>/**/*.{tsx,jsx}` globs. Resolved against `rootDir`.         |
| `globs`     | `string[]`                            | `['**/*.tsx', '**/*.jsx']`  | Raw glob list (wins over `dirs`). Supports `!negation`.                     |
| `local`     | `boolean`                             | `true`                      | Auto-import locally-scanned components.                                     |
| `resolvers` | `ComponentResolver[]`                 | `[]`                        | Third-party / custom resolvers.                                             |
| `dts`       | `boolean \| { filename?, rootPath? }` | `false`                     | Emit `components.d.ts`. Pass an object to customize filename / output path. |
| `include`   | `FilterPattern`                       | `[/\.[jt]sx$/]`             | Which files to transform.                                                   |
| `exclude`   | `FilterPattern`                       | `[/node_modules/, /\.git/]` | Which files to skip.                                                        |

## Live updates without restart

Both Vite (via `server.watcher`) and Webpack (via a private chokidar) watch
your component directories. When a file is added/changed/removed:

1. `components.d.ts` is regenerated (skipped if the content didn't actually change — so the TS server stays calm)
2. Surgical HMR signal is sent **only to the files that actually use the affected component name** (React Fast Refresh keeps state); falls back to a `full-reload` only if nothing in the usage map matches
3. In Webpack, `compilation.fileDependencies` is updated so webpack starts watching the new file too

End result: add `Foo.tsx` to your components dir → `<Foo/>` becomes usable in
your editor + browser within ~100ms, no restart.

## Gotchas

- **`prefix` must be PascalCase.** `<antButton/>` is a host element string; `<AntButton/>` is a component reference. The plugin will warn if you pass a lowercase prefix.
- **Already-imported names are left alone.** If your file does `import App from './App'`, the plugin won't shadow it even if a resolver also exports `App`.
- **Local wins over resolver in dts.** Same name from both your `App.tsx` and antd v5's `App` → local wins, console warning emitted.

## Debug logging

Set `DEBUG=urc:*` (standard [`debug`](https://github.com/debug-js/debug)
syntax) when running your bundler to see what the plugin is doing:

```bash
DEBUG=urc:* vite
```

Namespaces (combine with comma):

| namespace       | what it logs                                                   |
| --------------- | -------------------------------------------------------------- |
| `urc:init`      | One line at boot: rootDir, resolver count, globs               |
| `urc:scan`      | Initial filesystem scan summary                                |
| `urc:transform` | Per-file: which JSX names got auto-imported                    |
| `urc:watch`     | Each watcher flush (event count, changed flag, affected names) |
| `urc:dts`       | Each dts write — including "skipped (identical)"               |
| `urc:hmr`       | Surgical HMR decisions (`js-update` vs. fallback reload)       |

Example session:

```
[urc:init] boot: rootDir=/repo resolvers=1 local=true dts=true globs=["**/*.tsx","**/*.jsx"]
[urc:scan] scanned 24 files, found 18 component(s)
[urc:dts] wrote 87 component(s) → /repo/components.d.ts
[urc:transform] /repo/src/App.tsx: injected 4 import(s) for [AntSpace, AntButton, HelloWorld, AntTag]
[urc:watch] flush: events=1, changed=true, affected=[NewWidget]
[urc:hmr] surgical js-update for 1 consumer(s): /src/App.tsx
```

Zero overhead when `DEBUG` is unset — each `createDebug()` returns a no-op
function (no string formatting, no allocation per call).

## How it works

1. **Scan** — at startup, walk the project (`dirs` / `globs`) and AST-parse every `.tsx`/`.jsx` to find exported React components.
2. **Setup resolvers** — `await resolver.setup?.()` for each (lets dynamic resolvers like `AntdResolver({dynamic:true})` introspect `node_modules` asynchronously).
3. **Emit dts** — write `components.d.ts` so TypeScript knows about every component before the first build.
4. **Transform** — runs as a `pre` plugin on the **raw JSX**: AST-parse each `.tsx`/`.jsx`, find capital-cased components used in JSX (`<Hello/>`) that aren't already in scope, and prepend the matching `import`. The JSX itself is left untouched — the bundler's own JSX transform then compiles `<Hello/>` → `jsx(Hello)`, now resolving to the injected import.
5. **Watch** — on dev-server changes, do an incremental single-file rescan and update `components.d.ts` + send precise HMR signals.

Working on the **raw JSX** (rather than the post-transform `jsx(...)` output) is
what lets the plugin run in every bundler — including ones whose JSX transform
is built in and runs _after_ plugins (esbuild, Farm), where there is no
`jsx(...)` for a post pass to match. A cheap `<[A-Z]` pre-check keeps files
without component JSX off the parse hot path.

> **Rollup / Rolldown ordering:** these run plugins in array order and ignore
> unplugin's `enforce`, so place this plugin **before** your JSX-transform
> plugin (e.g. `@rollup/plugin-babel`) — it must see the raw JSX first.

## License

MIT — see [LICENSE](./LICENSE).
