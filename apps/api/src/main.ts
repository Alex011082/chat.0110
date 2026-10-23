// Точка входа сервиса chat0110 (systemd запускает `bun apps/api/src/main.ts`).
import { loadConfig, type Config } from "./config.ts";
import { createApp } from "./http.ts";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (e) {
  // Без секретов сервер всё равно бесполезен: падаем сразу и громко,
  // а не на первом входе пользователя.
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

const app = await createApp({ config });
// Только 127.0.0.1: снаружи сервис доступен через Caddy с TLS.
// idleTimeout 60 с; SSE снимает его для себя через server.timeout(req, 0).
const server = Bun.serve({ hostname: "127.0.0.1", port: config.port, idleTimeout: 60, fetch: app });
console.log(`chat.0110 слушает http://${server.hostname}:${server.port}, публичный адрес ${config.publicUrl}`);
