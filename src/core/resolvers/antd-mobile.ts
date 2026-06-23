import type { ComponentResolveResult, ComponentResolver } from "../../types";

// @keep-sorted
const components = [
  "ActionSheet",
  "AutoCenter",
  "Avatar",
  "Badge",
  "Button",
  "Calendar",
  "CalendarPicker",
  "CalendarPickerView",
  "CapsuleTabs",
  "Card",
  "Cascader",
  "CascaderView",
  "CenterPopup",
  "CheckList",
  "Checkbox",
  "Collapse",
  "ConfigProvider",
  "DatePicker",
  "DatePickerView",
  "Dialog",
  "Divider",
  "DotLoading",
  "Dropdown",
  "Ellipsis",
  "Empty",
  "ErrorBlock",
  "FloatingBubble",
  "FloatingPanel",
  "Footer",
  "Form",
  "Grid",
  "Image",
  "ImageUploader",
  "ImageViewer",
  "IndexBar",
  "InfiniteScroll",
  "Input",
  "JumboTabs",
  "List",
  "Loading",
  "Mask",
  "Modal",
  "NavBar",
  "NoticeBar",
  "NumberKeyboard",
  "PageIndicator",
  "PasscodeInput",
  "Picker",
  "PickerView",
  "Popover",
  "Popup",
  "ProgressBar",
  "ProgressCircle",
  "PullToRefresh",
  "Radio",
  "ResultPage",
  "SafeArea",
  "ScrollMask",
  "SearchBar",
  "Selector",
  "SideBar",
  "Skeleton",
  "Slider",
  "Space",
  "Stepper",
  "Steps",
  "Swiper",
  "Switch",
  "TabBar",
  "Tabs",
  "Tag",
  "TextArea",
  "Toast",
  "Tree",
  "VirtualInput",
  "WaterMark",
];

export interface AntdMobileResolverOptions {
  /**
   * Prefix to require on JSX tags.
   * @default ''
   */
  prefix?: string;
  /** Drop components you don't want auto-imported. */
  exclude?: (name: string) => boolean;
}

/**
 * Resolver for Ant Design Mobile (`antd-mobile@^5`).
 *
 * antd-mobile is CSS-in-JS; no style side-effect is emitted.
 *
 * @link https://mobile.ant.design/
 */
export function AntdMobileResolver(
  options: AntdMobileResolverOptions = {}
): ComponentResolver {
  const { prefix = "", exclude } = options;
  const matchable = exclude
    ? components.filter((c) => !exclude(c))
    : components;

  return {
    type: "component",

    resolve(jsxName) {
      if (prefix && !jsxName.startsWith(prefix)) return;
      const name = prefix ? jsxName.slice(prefix.length) : jsxName;
      if (!matchable.includes(name)) return;
      return { jsxName, name, from: "antd-mobile", type: "Export" };
    },

    list() {
      return matchable.map<ComponentResolveResult>((name) => ({
        jsxName: `${prefix}${name}`,
        name,
        from: "antd-mobile",
        type: "Export",
      }));
    },
  };
}
