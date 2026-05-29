# unplugin-react-components

> Auto-import React components on-demand. Inspired by [unplugin-vue-components](https://github.com/Oasis20090828/unplugin-react-auto-components.git).

## Features

- **Auto Import** — components used in JSX are imported automatically
- **On-demand** — only what you actually use ends up in the bundle
- **UI library presets** — built-in resolvers for Ant Design, MUI, Chakra UI, React Icons
- **Pluggable** — write your own resolver in a few lines
- **TypeScript** — generates `components.d.ts` so the editor stops complaining
- **Build-tool agnostic** — Vite, Webpack, Rollup, Rspack, esbuild (powered by [unplugin](https://github.com/Oasis20090828/unplugin-react-auto-components.git))

## Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react/vite";
import Components from "unplugin-react-components/vite";

export default defineConfig({
  plugins: [
    react(),
    Components({
      dirs: ["src/components"],
      dts: true,
    }),
  ],
});
```

## Webpack

```js
// webpack.config.js
const Components = require("unplugin-react-components").default;

module.exports = {
  plugins: [Components.webpack({ dirs: ["src/components"] })],
};
```

## Rollup

```js
// rollup.config.js
import Components from "unplugin-react-components";

export default {
  plugins: [Components.rollup({ dirs: ["src/components"] })],
};
```

## Usage

Just use the component. No `import` required.

```tsx
// src/components/HelloWorld.tsx
export default function HelloWorld({ msg }: { msg: string }) {
  return <h1>{msg}</h1>;
}

// src/App.tsx — no import needed
export default function App() {
  return <HelloWorld msg="hi" />;
}
```

The plugin scans `dirs` for components, then walks each transformed file looking for JSX tags that resolve to one of them (or to a custom resolver), and prepends the import.

## Resolvers

### Ant Design

```ts
import Components from "unplugin-react-components/vite";
import { AntDesignResolver } from "unplugin-react-components/resolvers";

Components({
  resolvers: [AntDesignResolver()],
});
```

```tsx
export default function App() {
  return (
    <Space>
      <Button type="primary">Click</Button>
      <DatePicker />
    </Space>
  );
}
```

Options:

| option         | type                       | default | description                                     |
| -------------- | -------------------------- | ------- | ----------------------------------------------- |
| `importStyle`  | `'css' \| 'less' \| false` | `'css'` | Whether to inject a style side-effect import.   |
| `resolveIcons` | `boolean`                  | `false` | Resolve `*Icon` names from `@ant-design/icons`. |
| `prefix`       | `string`                   | `''`    | Only match names starting with this prefix.     |

### React Icons

```ts
import Components from "unplugin-react-components/vite";
import { ReactIconsResolver } from "unplugin-react-components/resolvers";

Components({ resolvers: [ReactIconsResolver()] });
```

```tsx
// FiHome → react-icons/fi
// Io5Home → react-icons/io5
export default function App() {
  return <FiHome />;
}
```

### Material UI

```ts
import Components from "unplugin-react-components/vite";
import { MUIResolver } from "unplugin-react-components/resolvers";
Components({ resolvers: [MUIResolver()] });
```

### Chakra UI

```ts
import Components from "unplugin-react-components/vite";
import { ChakraUIResolver } from "unplugin-react-components/resolvers";
Components({ resolvers: [ChakraUIResolver()] });
```

### Custom resolver

```ts
import type { ComponentResolver } from "unplugin-react-components";

function MyLibResolver(): ComponentResolver {
  return {
    type: "component",
    resolve(name) {
      if (name.startsWith("My")) {
        return {
          name,
          from: `my-lib/${name}`,
          importName: name,
          isDefault: false,
        };
      }
    },
  };
}
```

## Options

| option               | type                  | default                      | description                                          |
| -------------------- | --------------------- | ---------------------------- | ---------------------------------------------------- |
| `dirs`               | `string \| string[]`  | `['src/components']`         | Directories to scan for local components.            |
| `extensions`         | `string[]`            | `['tsx', 'jsx', 'ts', 'js']` | File extensions to treat as components.              |
| `deep`               | `boolean`             | `true`                       | Recurse into subdirectories.                         |
| `include`            | `RegExp \| RegExp[]`  | `[/\.[tj]sx?$/]`             | Files to transform.                                  |
| `exclude`            | `RegExp \| RegExp[]`  | `[/node_modules/, /\.git/]`  | Files to skip.                                       |
| `resolvers`          | `ComponentResolver[]` | `[]`                         | Library/custom resolvers.                            |
| `globalComponents`   | `string[]`            | `[]`                         | Paths to register as always-available.               |
| `dts`                | `boolean \| string`   | `true`                       | Generate a `.d.ts` file (or pass a custom filename). |
| `dtsDir`             | `string`              | `'.'`                        | Where to write the dts file.                         |
| `transformComponent` | `(c) => c`            | identity                     | Hook to post-process every resolved component.       |

## How it works

1. **Scan** — at startup, walk `dirs` and build a name → file map.
2. **Detect** — for each transformed file, parse with `@babel/parser` and traverse the AST.
3. **Resolve** — for every PascalCase JSX tag that isn't already in scope, ask the resolvers (then the scanned map) for an import location.
4. **Inject** — prepend the import statements with `magic-string`, preserving sourcemaps.
5. **Type** — emit `components.d.ts` so TypeScript and the editor accept the unresolved identifiers before the transform runs.

## Resolution order

For each PascalCase JSX identifier:

1. Skip if already imported, declared, or React built-in (`Fragment`, `Suspense`, …).
2. Globally-registered components.
3. Each entry in `resolvers` (in order).
4. The scanned `dirs` map.

The first hit wins. If nothing matches, the tag is left alone — useful for components you'd rather import by hand.

## License

MIT
