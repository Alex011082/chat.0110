// chat0110 migrate — на ветке chat/<id> продукта, не на сервере.
// Копирует паспорт и сообщения в Chat/conversations/<id>/ и не удаляет chats/.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { SCAFFOLD, chatIdFromBranch, migrateDest, planMigrate, type MigrateFile } from "@chat0110/chat-protocol";

const args = process.argv.slice(2).filter((a) => a !== "migrate");
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

function readMaybe(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

if (!git(["rev-parse", "--is-inside-work-tree"]).ok) fail("Это не git-репозиторий. Запустите команду в каталоге продукта.");

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (!branch.ok) fail("Не удалось прочитать ветку.");
const chatId = chatIdFromBranch(branch.out);
console.log(`ветка: ${branch.out}`);
if (!chatId) fail("Миграция запускается на ветке chat/<id>. Файлы не изменены.");
console.log(`чат: ${chatId}`);

const remote = git(["remote", "get-url", "origin"]);
console.log(`remote: ${remote.ok ? remote.out : "нет"}`);
if (remote.ok && /github\.com[:/]([^/]+)\/([^/.]+)/.test(remote.out)) {
  const [, owner, name] = remote.out.match(/github\.com[:/]([^/]+)\/([^/.]+)/)!;
  const probe = spawnSync("gh", ["api", `repos/${owner}/${name}`, "--jq", ".permissions.push"], { encoding: "utf8" });
  if (probe.status !== 0) fail(`Не удалось проверить право записи в ${owner}/${name}. ${probe.stderr ?? ""}`.trim());
  if (probe.stdout.trim() !== "true") fail(`Нет права записи в ${owner}/${name}. Файлы не изменены.`);
  console.log("право записи: есть");
} else {
  console.log("право записи на GitHub не проверено: remote не GitHub");
}

const staged = git(["diff", "--cached", "--name-only"]);
if (staged.ok && staged.out.length > 0) fail("В индексе уже есть файлы. Миграция их не коммитит.");

const legacy: MigrateFile[] = [];
const walk = (dir: string) => {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs);
    else legacy.push({ path: relative(root, abs).split("\\").join("/"), content: readFileSync(abs, "utf8") });
  }
};
walk(join(root, "chats", chatId));

const existing: Record<string, string | null> = {};
for (const file of SCAFFOLD) existing[file.path] = readMaybe(join(root, file.path));
for (const file of legacy) {
  const dest = migrateDest(chatId, file.path);
  if (dest) existing[dest] = readMaybe(join(root, dest));
}
const plan = planMigrate(chatId, legacy, existing);
if (plan.absent) {
  console.log(`В ветке нет chats/${chatId}/chat.json. Переносить нечего.`);
  process.exit(0);
}
if (plan.protocolInvalid) fail("Chat/protocol.json есть, но это не схема 2. Файл не перезаписан.");
if (plan.conflicts.length) fail(`В Chat/ уже другой текст, файл не перезаписан: ${plan.conflicts.join(", ")}`);
if (plan.ignored.length) console.log(`не копируются: ${plan.ignored.join(", ")}`);
if (plan.create.length === 0) {
  console.log("Чат уже перенесён, новых файлов нет. Папка chats/ на месте.");
  process.exit(0);
}
const paths = plan.create.map((file) => file.path);
const bad = paths.filter((path) => !path.startsWith("Chat/") || path.split("/").some((part) => part === "" || part === "." || part === ".."));
if (bad.length) fail(`Отказ: вне Chat/: ${bad.join(", ")}`);

for (const file of plan.create) {
  const path = join(root, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.content);
  console.log(`создан ${file.path}`);
}
console.log("папка chats/ не удалена");

if (!commit && !push) {
  console.log("Файлы записаны в рабочее дерево. Коммит: --commit, отправка: --push.");
  process.exit(0);
}

const add = git(["add", "--", ...paths]);
if (!add.ok) fail(add.out || "git add не удался");
const stagedNow = git(["diff", "--cached", "--name-only"]);
const extra = (stagedNow.out ? stagedNow.out.split("\n") : []).filter((path) => path && !paths.includes(path));
if (extra.length) fail(`В коммит попали лишние файлы: ${extra.join(", ")}`);
const made = git(["commit", "-m", `chat0110: перенести чат ${chatId} в Chat/`]);
if (!made.ok && !/nothing to commit/i.test(made.out)) fail(made.out || "git commit не удался");
if (/nothing to commit/i.test(made.out)) console.log("коммитить нечего");
else console.log("коммит создан");

if (push) {
  const sent = git(["push", "origin", "HEAD"]);
  if (!sent.ok) fail(sent.out || "git push не удался");
  console.log("отправлено в origin");
}
