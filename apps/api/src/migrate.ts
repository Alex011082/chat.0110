// Перенос старых чатов на их же ветки. Новый коммит, без force и без
// правки PR: номер, адрес и комментарии остаются.
import {
  SCAFFOLD,
  chatJsonPath,
  planMigrate,
  scaffoldContent,
  type ChatMigration,
  type ChatMigrationItem,
  type MigrateFile,
  type MigratePlan,
} from "@chat0110/chat-protocol";
import { forbidden } from "./errors.ts";
import { GitHubError, mapLimit, type ChatPull, type GitHubClient, type RepoRef } from "./github.ts";

const COMMIT = (chatId: string) => `chat0110: перенести чат ${chatId} в Chat/`;

interface Loaded {
  item: ChatMigrationItem;
  create: MigrateFile[];
}

export async function migrationStatus(gh: GitHubClient, repo: RepoRef): Promise<ChatMigration> {
  const info = await gh.getRepo(repo);
  const pulls = await gh.listChatPulls(repo);
  const loaded = await mapLimit(pulls, 4, (pull) => load(gh, repo, pull));
  return {
    repo: info.full_name,
    can_push: info.can_push,
    items: loaded.filter((row): row is Loaded => row !== null).map((row) => row.item),
  };
}

export async function migrateChats(gh: GitHubClient, repo: RepoRef): Promise<ChatMigration> {
  const info = await gh.getRepo(repo);
  if (!info.can_push) throw forbidden(`Нет права на запись в ${info.full_name}: перенести чаты нельзя`);
  const pulls = await gh.listChatPulls(repo);
  const items: ChatMigrationItem[] = [];
  for (const pull of pulls) {
    const row = await load(gh, repo, pull);
    if (!row) continue;
    items.push(row.item.status === "pending" ? await commitChat(gh, repo, pull, row) : row.item);
  }
  return { repo: info.full_name, can_push: true, items };
}

async function load(gh: GitHubClient, repo: RepoRef, pull: ChatPull): Promise<Loaded | null> {
  const base = { chat_id: pull.chatId, number: pull.number, url: pull.url, created: [] as string[], conflicts: [] as string[] };
  try {
    await gh.getBranchHead(repo, pull.headRef);
  } catch (e) {
    if (e instanceof GitHubError && e.code === "not_found") return { item: { ...base, status: "missing_branch" }, create: [] };
    throw e;
  }
  const jsonPath = chatJsonPath(pull.chatId, 1);
  const json = await gh.getFileText(repo, jsonPath, pull.headRef);
  if (json === null) return null;

  const [messages, decisions] = await Promise.all([
    gh.listMessageFiles(repo, pull.chatId, pull.headRef, 1),
    gh.listDecisionFiles(repo, pull.chatId, pull.headRef, 1),
  ]);
  const entries = [...messages, ...decisions];
  const bodies = await mapLimit(entries, 6, async (entry) => ({ path: entry.path, content: await gh.getBlob(repo, entry.sha) }));
  const legacy: MigrateFile[] = [{ path: jsonPath, content: json }, ...bodies];

  const existing: Record<string, string | null> = {};
  const dests = new Set<string>(SCAFFOLD.map((file) => file.path));
  for (const file of legacy) {
    dests.add(file.path.replace(`chats/${pull.chatId}/`, `Chat/conversations/${pull.chatId}/`));
  }
  await Promise.all([...dests].map(async (path) => {
    existing[path] = await gh.getFileText(repo, path, pull.headRef);
  }));

  const plan = planMigrate(pull.chatId, legacy, existing);
  return { item: itemFromPlan(base, plan), create: plan.create };
}

function itemFromPlan(base: Omit<ChatMigrationItem, "status">, plan: MigratePlan): ChatMigrationItem {
  if (plan.protocolInvalid) return { ...base, status: "protocol_invalid" };
  if (plan.conflicts.length) return { ...base, status: "conflict", conflicts: plan.conflicts };
  if (plan.create.length) return { ...base, status: "pending" };
  return { ...base, status: "migrated" };
}

async function commitChat(gh: GitHubClient, repo: RepoRef, pull: ChatPull, row: Loaded): Promise<ChatMigrationItem> {
  assertOwned(pull.chatId, row.create.map((file) => file.path));
  let head = await gh.getBranchHead(repo, pull.headRef);
  let create = row.create;
  for (let attempt = 1; ; attempt++) {
    if (create.length === 0) return { ...row.item, status: "migrated" };
    const tree = await gh.createTree(repo, await gh.getCommitTree(repo, head), create);
    const commit = await gh.createCommit(repo, COMMIT(pull.chatId), tree, [head]);
    try {
      await gh.updateBranch(repo, pull.headRef, commit);
      return { ...row.item, status: "migrated", created: create.map((file) => file.path), conflicts: [] };
    } catch (e) {
      const moved = e instanceof GitHubError && (e.ghStatus === 409 || (e.ghStatus === 422 && /fast[- ]forward/i.test(e.ghMessage)));
      if (attempt < 3 && moved) {
        head = await gh.getBranchHead(repo, pull.headRef);
        const again = await load(gh, repo, pull);
        if (!again || again.item.status !== "pending") return again?.item ?? row.item;
        assertOwned(pull.chatId, again.create.map((file) => file.path));
        create = again.create;
        row = again;
        continue;
      }
      throw e;
    }
  }
}

function assertOwned(chatId: string, paths: readonly string[]): void {
  const home = `Chat/conversations/${chatId}/`;
  for (const path of paths) {
    const parts = path.split("/");
    const inside = parts[0] === "Chat" && parts.length > 1 && !parts.some((part) => part === "" || part === "." || part === "..");
    const owned = scaffoldContent(path) !== null || path.startsWith(home);
    if (!inside || !owned) throw forbidden(`Миграция пишет только Chat/ этого чата: ${path}`);
  }
}
