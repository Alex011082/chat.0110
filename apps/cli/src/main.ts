// chat0110 init — в каталоге продукта, не на сервере Chat.0110.
// Пишет только недостающие файлы каркаса Chat/ и не трогает уже лежащие.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SCAFFOLD, planInit, scaffoldViolation } from "@chat0110/chat-protocol";

if (process.argv[2] === "migrate") {
  await import("./migrate.ts");
  process.exit(0);
}

const args = process.argv.slice(2).filter((a) => a !== "init");
const dirFlag = args.indexOf("--dir");
const root = dirFlag >= 0 && args[dirFlag + 1] ? args[dirFlag + 1]! : process.cwd();
const commit = args.includes("--commit");
const push = args.includes("--push");

function git(cmd: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", cmd, { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function fail(text: string): never {
  console.error(text);
  process.exit(1);
}

if (!git(["rev-parse", "--is-inside-work-tree"]).ok) fail("Это не git-репозиторий. Запустите команду в каталоге продукта.");

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const remote = git(["remote", "get-url", "origin"]);
console.log(`ветка: ${branch.ok ? branch.out : "неизвестна"}`);
console.log(`remote: ${remote.ok ? remote.out : "нет"}`);

if (remote.ok && /github\.com[:/]([^/]+)\/([^/.]+)/.test(remote.out)) {
  const [, owner, name] = remote.out.match(/github\.com[:/]([^/]+)\/([^/.]+)/)!;
  const probe = spawnSync("gh", ["api", `repos/${owner}/${name}`, "--jq", ".permissions.push"], { encoding: "utf8" });
  if (probe.status !== 0) fail(`Не удалось проверить право записи в ${owner}/${name}. ${probe.stderr ?? ""}`.trim());
  if (probe.stdout.trim() !== "true") fail(`Нет права записи в ${owner}/${name}. Chat/ не создан.`);
  console.log("право записи: есть");
} else {
  console.log("право записи на GitHub не проверено: remote не GitHub");
}

const legacy = git(["ls-tree", "-d", "--name-only", "HEAD", "chats"]);
const legacyPresent = legacy.ok && legacy.out.split("\n").includes("chats");
const existing: Record<string, string | null> = {};
for (const file of SCAFFOLD) {
  const path = join(root, file.path);
  try {
    existing[file.path] = readFileSync(path, "utf8");
  } catch {
    existing[file.path] = null;
  }
}
const plan = planInit(existing);
if (legacyPresent) console.log("найдена прежняя папка chats/. Файлы не переносятся — миграция отдельным шагом.");
if (plan.protocolInvalid) fail("Chat/protocol.json есть, но это не схема 2. Файл не перезаписан.");
if (plan.create.length === 0) {
  console.log("Chat уже подключён, новых файлов нет.");
  process.exit(0);
}
const outside = scaffoldViolation(plan.create.map((f) => f.path));
if (outside) fail(`Отказ: вне каркаса Chat/: ${outside}`);

for (const file of plan.create) {
  const path = join(root, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.content);
  console.log(`создан ${file.path}`);
}
if (plan.kept.length) console.log(`оставлено как есть: ${plan.kept.join(", ")}`);

if (!commit && !push) {
  console.log("Файлы записаны в рабочее дерево. Коммит: --commit, отправка: --push.");
  process.exit(0);
}

const add = git(["add", "--", ...plan.create.map((f) => f.path)]);
if (!add.ok) fail(add.out || "git add не удался");
const made = git(["commit", "-m", "chat0110: подключить каталог Chat"]);
if (!made.ok && !/nothing to commit/i.test(made.out)) fail(made.out || "git commit не удался");
if (/nothing to commit/i.test(made.out)) console.log("коммитить нечего");
else console.log("коммит создан");

if (push) {
  const sent = git(["push", "origin", "HEAD"]);
  if (!sent.ok) fail(sent.out || "git push не удался");
  console.log("отправлено в origin");
}
