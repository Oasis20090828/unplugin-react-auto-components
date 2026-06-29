// Next requires global CSS to be imported from _app. This pulls in Tailwind v4
// (compiled by @tailwindcss/postcss via postcss.config.mjs) for the shadcn bits.
import "../styles/globals.css";

export default function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
