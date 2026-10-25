// Подключение Chat/ к репозиторию продукта. Каталог не создаётся от одного
// факта доступа: только этот вызов и локальная команда chat0110 init.
import {
  SCAFFOLD,
  planInit,
  scaffoldContent,
  scaffoldViolation,
  type ChatActivation,
} from "@chat0110/chat-protocol";
import { forbidden } from "./errors.ts";
import { GitHubError, type GitHubClient, type RepoRef } from "./github.ts";

const COMMIT = "chat0110: подключить каталог Chat";

export async function activationStatus(gh: GitHubClient, repo: RepoRef): Promise<ChatActivation> {
  const info = await gh.getRepo(repo);
  return readActivation(gh, repo, info.full_name, info.default_branch, info.can_push);
}

export async function activateChat(gh: GitHubClient, repo: RepoRef): Promise<ChatActivation> {
  const info = await gh.getRepo(repo);
  if (!info.can_push) throw forbidden(`Нет права на запись в ${info.full_name}: подключить Chat нельзя`);
  const status = await readActivation(gh, repo, info.full_name, info.default_branch, info.can_push);
  if (status.protocol_invalid || status.gaps.length === 0) return { ...status, created: [] };

  const files = status.gaps.map((path) => {
    const content = scaffoldContent(path);
    if (content === null) throw forbidden(`Подключение не пишет произвольные пути: ${path}`);
    return { path, content };
  });
  const outside = scaffoldViolation(files.map((f) => f.path));
  if (outside) throw forbidden(`Подключение пишет только каркас Chat/: ${outside}`);

  await writeScaffold(gh, repo, info.default_branch, files);
  return {
    ...status,
    activated: true,
    agents_doc: true,
    gaps: [],
    created: files.map((f) => f.path),
  };
}

async function readActivation(gh: GitHubClient, repo: RepoRef, fullName: string, branch: string, canPush: boolean): Promise<ChatActivation> {
  const existing: Record<string, string | null> = {};
  await Promise.all(SCAFFOLD.map(async (file) => {
    existing[file.path] = await gh.getFileText(repo, file.path, branch);
  }));
  const plan = planInit(existing);
  return {
    repo: fullName,
    activated: plan.activated,
    agents_doc: plan.agentsDoc,
    legacy_chats: await gh.exists(repo, "chats", branch),
    protocol_invalid: plan.protocolInvalid,
    can_push: canPush,
    default_branch: branch,
    gaps: plan.gaps,
  };
}

async function writeScaffold(
  gh: GitHubClient,
  repo: RepoRef,
  branch: string,
  files: { path: string; content: string }[],
): Promise<void> {
  let head: string;
  try {
    head = await gh.getBranchHead(repo, branch);
  } catch (e) {
    if (e instanceof GitHubError && e.ghStatus === 409 && /empty/i.test(e.ghMessage)) {
      for (const file of files) await gh.putFile(repo, file.path, { message: COMMIT, content: file.content });
      return;
    }
    throw e;
  }
  for (let attempt = 1; ; attempt++) {
    const tree = await gh.createTree(repo, await gh.getCommitTree(repo, head), files);
    const commit = await gh.createCommit(repo, COMMIT, tree, [head]);
    try {
      await gh.updateBranch(repo, branch, commit);
      return;
    } catch (e) {
      const moved = e instanceof GitHubError && (e.ghStatus === 409 || (e.ghStatus === 422 && /fast[- ]forward/i.test(e.ghMessage)));
      if (attempt < 3 && moved) {
        head = await gh.getBranchHead(repo, branch);
        continue;
      }
      throw e;
    }
  }
}
