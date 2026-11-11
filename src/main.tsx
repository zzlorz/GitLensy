import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { ensureHighlightTheme } from "./lib/highlight";
import { applyPreviewFontSize, loadPreviewFontSize } from "./lib/fontSize";

ensureHighlightTheme();
applyPreviewFontSize(loadPreviewFontSize());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
