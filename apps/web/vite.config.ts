import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";
import {pwaPlugin} from "./pwa-plugin.ts";

// В разработке API живёт на :4340 (apps/api), а Vite — на своём порту.
const API = "http://localhost:4340";

const toApi: ProxyOptions = {
  target: API,
  changeOrigin: true,
  // SSE (/api/events) идёт через прокси потоком: без таймаута и без сжатия.
  timeout: 0,
  proxyTimeout: 0,
  configure(proxy) {
    proxy.on("proxyReq", (proxyReq, req) => {
      // Сервер сверяет Origin изменяющих запросов со своим адресом (защита от
      // CSRF). Подменяем только собственный origin dev-сервера — чужие сайты
      // по-прежнему получают отказ.
      const origin = req.headers.origin;
      if (origin && req.headers.host && origin === `http://${req.headers.host}`) {
        proxyReq.setHeader("origin", API);
      }
    });
    proxy.on("proxyRes", (proxyRes) => {
      if (String(proxyRes.headers["content-type"] ?? "").startsWith("text/event-stream")) {
        proxyRes.headers["cache-control"] = "no-cache, no-transform";
        proxyRes.headers["x-accel-buffering"] = "no";
      }
    });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), pwaPlugin()],
  server: {
    proxy: {
      "^/api/": toApi,
      "^/auth/": toApi,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
