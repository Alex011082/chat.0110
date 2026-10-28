import { Privacy } from "../src/privacy.ts";
// Детерминированные интеграционные тесты проверяют границы записи, отдельно
// от качества весов. Настоящая модель проверяется privacy/benchmark.py.
export const testPrivacy = new Privacy(async () => []);
