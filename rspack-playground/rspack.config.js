const Components = require("unplugin-react-auto-components/rspack").default;
const {
  AntdResolver,
  ShadcnResolver,
} = require("unplugin-react-auto-components/resolvers");

module.exports = {
  mode: "production",
  entry: "./main.jsx",
  // react is loaded in the browser from a CDN via the importmap in index.html.
  externalsType: "module",
  externals: {
    react: "react",
    "react/jsx-runtime": "react/jsx-runtime",
    "react-dom": "react-dom",
    "react-dom/client": "react-dom/client",
  },
  resolve: {
    extensions: [".js", ".jsx"],
    // shadcn components import each other via the `@` alias → playground root.
    alias: { "@": __dirname },
  },
  module: {
    rules: [
      {
        test: /\.jsx$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: { syntax: "ecmascript", jsx: true },
              transform: { react: { runtime: "automatic" } },
            },
          },
        },
        type: "javascript/auto",
      },
      {
        // Tailwind v4 via PostCSS — injected at runtime by style-loader.
        // `experiments.css: false` below hands .css to this chain, not
        // rspack's native CSS pipeline.
        test: /\.css$/,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "postcss-loader",
            options: {
              postcssOptions: { plugins: ["@tailwindcss/postcss"] },
            },
          },
        ],
        type: "javascript/auto",
      },
    ],
  },
  plugins: [
    Components({
      // Scan local components, but exclude components/ui — those are shadcn's.
      local: true,
      globs: ["**/*.jsx", "!**/components/ui/**"],
      resolvers: [
        AntdResolver({ version: 5, prefix: "Ant" }),
        ShadcnResolver({ componentsRoot: "./components/ui" }),
      ],
      dts: true,
    }),
  ],
  experiments: { outputModule: true, css: false },
  output: { filename: "main.js", library: { type: "module" } },
  optimization: { minimize: false },
};
