import { createRoot } from "react-dom/client";

// <App/> itself is auto-imported too (it's a local component) — no import here.
// (Tailwind CSS is precompiled by the CLI and <link>ed in index.html, because
//  rolldown no longer bundles CSS — see build.mjs.)
createRoot(document.getElementById("app")).render(<App />);
