import { createRoot } from "react-dom/client";
import "./index.css";

// <App/> itself is auto-imported too (it's a local component) — no import here.
createRoot(document.getElementById("app")).render(<App />);
