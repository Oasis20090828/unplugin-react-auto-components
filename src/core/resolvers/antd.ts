import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { ComponentResolveResult, ComponentResolver } from "../../types";
import { toKebabCase } from "../utils";
import { discoverExports } from "../discover";

// ---------------------------------------------------------------------------
// Component catalog — top-level exports of `antd`.
//
// Subcomponents like `Form.Item`, `Menu.Item`, `DatePicker.RangePicker` are
// JSXMemberExpressions (`_jsx(Form.Item, ...)`), our transformer matches on
// the *leading* identifier only, so we don't need them in the list.
// ---------------------------------------------------------------------------

// @keep-sorted
const allComponents = [
  "Affix",
  "Alert",
  "Anchor",
  "App",
  "AutoComplete",
  "Avatar",
  "BackTop",
  "Badge",
  "Breadcrumb",
  "Button",
  "Calendar",
  "Card",
  "Carousel",
  "Cascader",
  "Checkbox",
  "Col",
  "Collapse",
  "ColorPicker",
  "Comment",
  "ConfigProvider",
  "DatePicker",
  "Descriptions",
  "Divider",
  "Drawer",
  "Dropdown",
  "Empty",
  "Flex",
  "FloatButton",
  "Form",
  "Grid",
  "Image",
  "Input",
  "InputNumber",
  "Layout",
  "List",
  "Mentions",
  "Menu",
  "Modal",
  "PageHeader",
  "Pagination",
  "Popconfirm",
  "Popover",
  "Progress",
  "QRCode",
  "Qrcode",
  "Radio",
  "Rate",
  "Result",
  "Row",
  "Segmented",
  "Select",
  "Skeleton",
  "Slider",
  "Space",
  "Spin",
  "Splitter",
  "Statistic",
  "Steps",
  "Switch",
  "Table",
  "Tabs",
  "Tag",
  "TimePicker",
  "Timeline",
  "Tooltip",
  "Tour",
  "Transfer",
  "Tree",
  "TreeSelect",
  "Typography",
  "Upload",
  "Watermark",
];

const v4Only = new Set(["BackTop", "Comment", "PageHeader"]);
const v5Only = new Set([
  "App",
  "ColorPicker",
  "Flex",
  "FloatButton",
  "QRCode",
  "Qrcode",
  "Segmented",
  "Splitter",
  "Tour",
  "Watermark",
]);

/**
 * Handle the few cases where the JSX tag the user types doesn't match
 * antd's actual export. e.g. user-friendly `<Qrcode>` → real export `QRCode`.
 */
function getImportName(name: string): string {
  if (name === "Qrcode") return "QRCode";
  return name;
}

// ---------------------------------------------------------------------------
// Version auto-detection
// ---------------------------------------------------------------------------

function detectMajorSync(packageName: string): number | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, "node_modules", packageName, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
          version?: string;
        };
        const major = Number.parseInt((pkg.version || "").split(".")[0]!, 10);
        if (Number.isFinite(major)) return major;
      } catch {}
      return undefined;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

export interface AntdResolverOptions {
  /**
   * Antd major version, as a number. The behavior splits on `>= 5`:
   *   - `< 5`  (v4 and earlier) → CSS style imports (`importStyle: 'css'`) and
   *     the v4 component set (includes `BackTop`/`Comment`/`PageHeader`).
   *   - `>= 5` (v5, v6, …)      → no style import (CSS-in-JS) and the v5+
   *     component set (includes `App`/`FloatButton`/`Splitter`/…).
   *
   * Any number works — e.g. `6` is treated like v5+. If omitted, the resolver
   * reads `node_modules/<packageName>/package.json` and uses the installed
   * major; falls back to `5`.
   */
  version?: number;
  /**
   * Prefix to require on JSX tags. Empty by default — write `<Button />`
   * directly. Set to e.g. `'Ant'` to make it explicit (`<AntButton />`).
   *
   * @default ''
   */
  prefix?: string;
  /**
   * CSS side-effect handling.
   * - `'css'`        → `<pkg>/es/<dir>/style/css` (v4 default)
   * - `'less'`       → `<pkg>/es/<dir>/style`     (v4 with less customization)
   * - `'css-in-js'`  → `<pkg>/es/<dir>/style`     (v5 compatible-mode users)
   * - `false`        → no style import           (v5 default — CSS-in-JS)
   */
  importStyle?: "css" | "less" | "css-in-js" | false;
  /**
   * Use commonjs `lib/` instead of `es/` for the style path.
   * @default false
   */
  cjs?: boolean;
  /**
   * Override the package name. Useful for forks or proxies.
   * @default 'antd'
   */
  packageName?: string;
  /**
   * Discover the component set by loading the installed package (async, via
   * `local-pkg`) and reading its real exports, instead of using the built-in
   * static catalog. Resolution happens in `setup()`, awaited by the plugin in
   * `buildStart`.
   *
   * Trade-off: this executes the entire antd bundle once at startup (noticeable
   * cost + memory) in exchange for always matching exactly what's installed —
   * the precise version's component set, plus any exports the static list
   * hasn't caught up with. The static default is faster and works even when
   * antd isn't installed (e.g. CI emitting dts).
   *
   * Falls back to the static catalog (with a warning) if the package can't be
   * loaded.
   *
   * @default false
   */
  dynamic?: boolean;
  /** Drop unwanted components. */
  exclude?: (name: string) => boolean;
}

/**
 * Resolver for [Ant Design](https://ant.design) (`antd@^4` / `antd@^5`).
 *
 * Auto-detects the installed major version and toggles:
 *   - The matchable component set (`BackTop` is v4-only, `FloatButton` is v5-only, etc.)
 *   - The default `importStyle` (v4 = `'css'`, v5 = `false`, because v5 is CSS-in-JS)
 *
 * Override `version` explicitly if auto-detection is wrong for your setup
 * (e.g. building against a private fork, or using v5 in compat mode).
 *
 * @link https://ant.design/
 */
export function AntdResolver(
  options: AntdResolverOptions = {}
): ComponentResolver {
  const packageName = options.packageName ?? "antd";
  const version = options.version ?? detectMajorSync(packageName) ?? 5;
  const prefix = options.prefix ?? "";
  const cjs = options.cjs ?? false;

  // A lowercase-initial prefix can never work: JSX compiles `<antButton>` to
  // the string "antButton" (a host element), so it never becomes a component
  // reference we can rewrite. The prefix must be PascalCase.
  if (prefix && !/^[A-Z]/.test(prefix)) {
    const fixed = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    // eslint-disable-next-line no-console
    console.warn(
      `[unplugin-react-auto-components] AntdResolver: prefix "${prefix}" must start with an uppercase letter. ` +
        `JSX treats <${prefix}Button> as a host element, so it will never be auto-imported. ` +
        `Use prefix "${fixed}" and write <${fixed}Button>.`
    );
  }
  const lib = cjs ? "lib" : "es";
  // The behavior splits on v5: v5+ is CSS-in-JS (no style import) and uses the
  // v5+ component set; anything below 5 (v4 and earlier) gets CSS imports and
  // the v4 set. Comparing by magnitude lets any number — 6, 7, … — Just Work.
  const v5Plus = version >= 5;
  const importStyle = options.importStyle ?? (v5Plus ? false : "css");

  const isCompat = (name: string) =>
    v5Plus ? !v4Only.has(name) : !v5Only.has(name);

  const applyExclude = (list: string[]) =>
    options.exclude ? list.filter((n) => !options.exclude!(n)) : list;

  // The static catalog is available synchronously. In `dynamic` mode, setup()
  // (awaited by the plugin in buildStart) swaps in the installed package's real
  // exports; on failure we keep the static catalog.
  let matchable = applyExclude(allComponents.filter(isCompat));

  function buildStyle(name: string): string | undefined {
    if (importStyle === false) return undefined;
    // Use the real export name for the style dir, not the user-facing alias.
    // e.g. `<Qrcode>` → kebab of `QRCode` = `qr-code`, the real antd dir.
    const realName = getImportName(name);
    const styleDir = toKebabCase(realName);
    if (importStyle === "css")
      return `${packageName}/${lib}/${styleDir}/style/css`;
    // 'less' and 'css-in-js' both stop at /style
    return `${packageName}/${lib}/${styleDir}/style`;
  }

  return {
    type: "component",

    async setup() {
      if (!options.dynamic) return;
      const discovered = await discoverExports(packageName);
      if (discovered) {
        // Real exports already reflect the installed version → no v4/v5 gating.
        matchable = applyExclude(discovered);
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[unplugin-react-auto-components] AntdResolver: dynamic discovery failed for "${packageName}" ` +
            "(not installed or not loadable). Falling back to the static catalog."
        );
      }
    },

    resolve(jsxName) {
      if (prefix && !jsxName.startsWith(prefix)) return;
      const tag = prefix ? jsxName.slice(prefix.length) : jsxName;
      if (!matchable.includes(tag)) return;

      const result: ComponentResolveResult = {
        jsxName,
        name: getImportName(tag),
        from: packageName,
        type: "Export",
      };
      const style = buildStyle(tag);
      if (style) result.style = style;
      return result;
    },

    list() {
      return matchable.map<ComponentResolveResult>((tag) => {
        const result: ComponentResolveResult = {
          jsxName: `${prefix}${tag}`,
          name: getImportName(tag),
          from: packageName,
          type: "Export",
        };
        const style = buildStyle(tag);
        if (style) result.style = style;
        return result;
      });
    },
  };
}
