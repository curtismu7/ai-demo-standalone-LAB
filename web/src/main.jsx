import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { visible } from "./safeText.js";
// Rule 24: JsonView uses the lab's visible() guard for strings in both modes.
window.__safeTextVisible = visible;
import "./tokens.css";
import "./styles/standalone-ui.css";
import "./top-menu/top-menu.css";
import "./shell.css";
import "./app.css";

// Mirror the OS colour scheme into data-theme (tokens.css keys dark mode on it), and follow changes live.
// "auto" in the picker removes data-theme so this mirror shows through.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
  if (document.documentElement.dataset.theme !== "light" && document.documentElement.dataset.theme !== "dark") {
    document.documentElement.dataset.theme = darkQuery.matches ? "dark" : "light";
  }
};
const saved = (() => { try { return localStorage.getItem("aidemo.theme"); } catch { return null; } })();
if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved; else applyTheme();
darkQuery.addEventListener("change", () => {
  if (document.documentElement.dataset.theme !== "light" && document.documentElement.dataset.theme !== "dark") applyTheme();
});

createRoot(document.getElementById("root")).render(<App />);
