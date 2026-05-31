# unplugin-react-auto-components

> Auto-import React components on-demand. Reads your JSX, figures out which
> components you used, and injects the imports for you. Works in Vite,
> Webpack, Rollup, Rspack, and esbuild via [unplugin](https://github.com/unjs/unplugin).
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
  return jsxs(_u1, { children: [jsx(_u2, { type: "primary", children: "Click" }), jsx(_u3, { name: "React" })] });
}
```

## Features

- 🚀 **Zero-import JSX** — local components and 3rd-party UI libs alike
- 📦 **Tree-shake friendly** — emits one `import { Name } from 'lib'` per component, no barrel imports
- 🎨 **Built-in resolvers** — Ant Design (v4 + v5), Ant Design Mobile, MUI, shadcn/ui
- 🔧 **Custom resolvers in one line** — `createResolver({ module, prefix })`
- 📝 **`components.d.ts`** — auto-emitted so TypeScript + your editor stay happy
- ♻️ **Live in dev** — add a new component file and it shows up without restarting; surgical HMR (no full page reload when possible)
- 🛠️ **Vite / Webpack / Rollup / Rspack / esbuild**

## Install

```bash
pnpm add -D unplugin-react-auto-components
# or npm i -D / yarn add -D
```

## Quick start

### Vite

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

### Webpack

```js
// webpack.config.js
const Components = require("unplugin-react-auto-components/webpack").default;
const { AntdResolver } = require("unplugin-react-auto-components/resolvers");

module.exports = {
  plugins: [
    Components({
      dts: true,
      resolvers: [AntdResolver({ version: 5, prefix: "Ant" })],
    }),
  ],
};
```

### Rollup / Rspack / esbuild

Same idea — `unplugin-react-auto-components/rollup`, `/rspack`, `/esbuild`.

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

Handles both v4 (CSS side-effects) and v5 (CSS-in-JS) — auto-detects the
installed version, override with `version` if needed.

```ts
import { AntdResolver } from "unplugin-react-auto-components/resolvers";

Components({
  resolvers: [
    AntdResolver({
      // version: 4 | 5,                  // default: auto-detect, fallback 5
      // prefix: 'Ant',                   // <AntButton/> → import { Button } from 'antd'
      // importStyle: 'css' | 'less' | 'css-in-js' | false,  // v4 only; default 'css'
      // cjs: false,                      // use lib/ instead of es/
      // packageName: 'antd',             // fork override
      // dynamic: false,                  // see below
      // exclude: (name) => false,
    }),
  ],
});
```

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
Components({ resolvers: [AntdMobileResolver({ /* prefix?, exclude? */ })] });
```

### Material UI

```ts
import { MuiResolver } from "unplugin-react-auto-components/resolvers";
Components({ resolvers: [MuiResolver()] }); // <MuiButton/> → import { Button } from '@mui/material'
```

### shadcn/ui

shadcn isn't an npm package — its CLI copies components into your repo. The
resolver discovers what you actually have by scanning the filesystem.

```ts
import { ShadcnResolver } from "unplugin-react-auto-components/resolvers";

Components({
  resolvers: [
    ShadcnResolver({
      // componentsDir: '@/components/ui',          // import alias (the `from` field)
      // componentsRoot: './src/components/ui',    // real filesystem path to scan
      // components: ['Button', 'Card'],           // explicit list, overrides scan
      // prefix: '',
      // defaultExport: false,
    }),
  ],
});
```

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
      { jsxName: "MyButton", name: "Button", from: "my-lib/Button", type: "Export" },
    ];
  },
};
```

## Options

| option      | type                                                             | default                       | description                                                                                  |
| ----------- | ---------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `rootDir`   | `string`                                                         | `process.cwd()`               | Project root. Used for `dirs` / `globs` resolution and dts location.                         |
| `dirs`      | `string[]`                                                       | `[]`                          | Sugar for `<dir>/**/*.{tsx,jsx}` globs. Resolved against `rootDir`.                          |
| `globs`     | `string[]`                                                       | `['**/*.tsx', '**/*.jsx']`    | Raw glob list (wins over `dirs`). Supports `!negation`.                                       |
| `local`     | `boolean`                                                        | `true`                        | Auto-import locally-scanned components.                                                       |
| `resolvers` | `ComponentResolver[]`                                            | `[]`                          | Third-party / custom resolvers.                                                              |
| `dts`       | `boolean \| { filename?, rootPath? }`                            | `false`                       | Emit `components.d.ts`. Pass an object to customize filename / output path.                  |
| `include`   | `FilterPattern`                                                  | `[/\.[jt]sx$/]`               | Which files to transform.                                                                    |
| `exclude`   | `FilterPattern`                                                  | `[/node_modules/, /\.git/]`   | Which files to skip.                                                                         |

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

| namespace        | what it logs                                                |
| ---------------- | ----------------------------------------------------------- |
| `urc:init`       | One line at boot: rootDir, resolver count, globs            |
| `urc:scan`       | Initial filesystem scan summary                             |
| `urc:transform`  | Per-file: which JSX names got auto-imported                 |
| `urc:watch`      | Each watcher flush (event count, changed flag, affected names) |
| `urc:dts`        | Each dts write — including "skipped (identical)"            |
| `urc:hmr`        | Surgical HMR decisions (`js-update` vs. fallback reload)    |

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
4. **Transform** — for each `.tsx`/`.jsx` file, regex-match `jsx(X` / `jsxs(X` / `jsxDEV(X` (the React JSX runtime's output) and inject imports for unrecognized capital-cased identifiers.
5. **Watch** — on dev-server changes, do an incremental single-file rescan and update `components.d.ts` + send precise HMR signals.

The transform is regex-based on the **post-JSX-runtime** output (so it runs
as a `post` plugin, after `@vitejs/plugin-react`/babel's JSX transform). This
avoids re-parsing JSX and means the plugin's hot path is microseconds, not
milliseconds.

## License

MIT — see [LICENSE](./LICENSE).
