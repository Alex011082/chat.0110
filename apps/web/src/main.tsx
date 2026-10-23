import "@fontsource-variable/golos-text";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initApi } from "./api.ts";
import { App } from "./App.tsx";

// Шрифт — свой, с этого же сервера: CSP разрешает шрифты только с 'self'.
void initApi().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
