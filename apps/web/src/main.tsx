import "@fontsource-variable/golos-text";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initApi } from "./api.ts";
import { App } from "./App.tsx";
import {AppFrame} from "./ui/AppFrame.tsx";
import { applyDesign } from "./lib/design.ts";

// Дизайн — до первого кадра, чтобы светлый не мигал «прибором».
applyDesign();

// Шрифт — свой, с этого же сервера: CSP разрешает шрифты только с 'self'.
void initApi().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppFrame><App /></AppFrame>
    </StrictMode>,
  );
});
