const Components = require("unplugin-react-auto-components/webpack").default;
const {
  AntdResolver,
  ShadcnResolver,
} = require("unplugin-react-auto-components/resolvers");

module.exports = {
  mode: "production",
  entry: "./main.jsx",
  // react is loaded in the browser from a CDN via the importmap in index.html,
  // so keep it external (emitted as ESM imports).
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
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [["@babel/preset-react", { runtime: "automatic" }]],
          },
        },
      },
      {
        // Tailwind v4 via PostCSS — injected at runtime by style-loader.
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
      },
    ],
  },
  plugins: [
    Components({
      // Scan local components, but exclude components/ui — those are shadcn's,
      // owned by the resolver, so they shouldn't also register as bare locals.
      local: true,
      globs: ["**/*.jsx", "!**/components/ui/**"],
      resolvers: [
        AntdResolver({ version: 5, prefix: "Ant" }),
        // shadcn — write <UiButton>. Flat layout, so point discovery at ./components/ui.
        ShadcnResolver({ componentsRoot: "./components/ui" }),
      ],
      dts: true,
    }),
  ],
  experiments: { outputModule: true },
  output: { filename: "main.js", path: __dirname + "/dist", library: { type: "module" } },
  optimization: { minimize: false },
};
