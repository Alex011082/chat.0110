// Цепочка предков Fork. Новый чат пишет снимок в свой коммит. Чтение снимка
// не ходит в ветку родителя: её могут удалить, а комментарий PR — изменить.
import {
  GAP_BOUNDARY,
  GAP_DAMAGED,
  assembleChain,
  branchForChat,
  chatJsonPath,
  chatTitleFromPr,
  forkContextPath,
  inheritedItems,
  parentSlice,
  parseChatJson,
  parseForkContext,
  type ChainLevel,
  type FileInput,
  type ForkAncestor,
  type ForkContextFile,
  type ForkPoint,
  type InheritedContext,
  type TimelineInput,
} from "@chat0110/chat-protocol";
import { GitHubError, type ChatPull, type GitHubClient, type RepoRef } from "./github.ts";

export interface ForkContextDraft {
  complete: boolean;
  gaps: string[];
  ancestors: ForkAncestor[];
}

function contextOf(file: ForkContextFile, fallbackTitle: string): InheritedContext {
  const immediate = file.ancestors.find((a) => a.chat_id === file.parent.chat_id) ?? file.ancestors[file.ancestors.length - 1];
  return {
    chat_id: file.parent.chat_id,
    title: immediate?.title ?? fallbackTitle,
    number: immediate?.number ?? null,
    message_id: file.parent.message_id,
    commit_sha: file.parent.commit_sha,
    items: inheritedItems(file.ancestors),
    complete: file.complete,
    gaps: file.gaps,
    ancestors: file.ancestors.map((a) => ({ chat_id: a.chat_id, title: a.title, boundary_message_id: a.boundary_message_id })),
  };
}

const isMissing = (e: unknown) => e instanceof GitHubError && e.code === "not_found";

function stub(point: ForkPoint): ForkAncestor {
  return {
    chat_id: point.chat_id,
    title: point.chat_id,
    number: null,
    boundary_message_id: point.message_id,
    commit_sha: point.commit_sha,
    messages: [],
  };
}

// live — лента, которую только что прочитали: её комментарии можно заморозить.
// Для предков выше live нет: в снимок попадают только файлы на коммите.
async function levelAt(
  gh: GitHubClient,
  repo: RepoRef,
  point: ForkPoint,
  chats: readonly ChatPull[],
  live: TimelineInput | null,
  known: ChatPull | null,
): Promise<{ level: ChainLevel; next: ForkPoint | null }> {
  let files: FileInput[] = [];
  let gone = false;
  try {
    files = await gh.getMessageFilesAt(repo, point.chat_id, point.commit_sha);
  } catch (e) {
    if (!isMissing(e)) throw e;
    gone = true;
  }
  if (!gone && files.length === 0) {
    try {
      await gh.getCommitTree(repo, point.commit_sha);
    } catch (e) {
      if (!isMissing(e)) throw e;
      gone = true;
    }
  }
  const pull = chats.find((c) => c.chatId === point.chat_id) ?? (known?.chatId === point.chat_id ? known : undefined);
  const store = gone ? 1 : await gh.chatStore(repo, point.commit_sha);
  const passport = gone ? null : await gh.getFileText(repo, chatJsonPath(point.chat_id, store), point.commit_sha);
  const meta = passport ? parseChatJson(passport) : null;
  const title = meta?.title ?? (pull ? chatTitleFromPr(pull.title) : point.chat_id);
  const slice = parentSlice({
    chatId: point.chat_id,
    title,
    number: pull?.number ?? null,
    messageId: point.message_id,
    commitSha: point.commit_sha,
    files,
    comments: live?.comments ?? [],
    reviews: live?.reviews ?? [],
    reviewComments: live?.reviewComments ?? [],
  });
  const level: ChainLevel = { ancestor: slice.ancestor, commentsFrozen: live !== null };
  if (gone) return { level: { ...level, missing: true }, next: null };
  if (!meta) {
    if (!pull) return { level: { ...level, parentUnknown: true }, next: null };
    return { level, next: pull.parent };
  }
  return { level, next: meta.parent };
}

// Черновик снимка для нового Fork.
export async function draftForkContext(
  gh: GitHubClient,
  repo: RepoRef,
  parent: ForkPoint,
  input: TimelineInput,
  known: ChatPull,
): Promise<ForkContextDraft> {
  const store = await gh.chatStore(repo, parent.commit_sha);
  const snapText = await gh.getFileText(repo, forkContextPath(parent.chat_id, store), parent.commit_sha);
  const snap = snapText ? parseForkContext(snapText) : null;
  const { level, next } = await levelAt(gh, repo, parent, [], input, known);
  const boundaryInSlice = level.ancestor.messages.some((m) => m.id === parent.message_id);

  if (snap && snap.chat_id === parent.chat_id) {
    const own = assembleChain([level]);
    const gaps = [...snap.gaps, ...own.gaps];
    if (!boundaryInSlice) gaps.unshift(GAP_BOUNDARY);
    return {
      ancestors: [...snap.ancestors.filter((a) => a.chat_id !== parent.chat_id), ...own.ancestors],
      complete: snap.complete && own.complete && boundaryInSlice,
      gaps,
    };
  }

  const levels: ChainLevel[] = [level];
  let cursor = next;
  const seen = new Set([parent.chat_id]);
  while (cursor) {
    if (seen.has(cursor.chat_id)) {
      levels.push({ ancestor: stub(cursor), commentsFrozen: true });
      break;
    }
    seen.add(cursor.chat_id);
    const step = await levelAt(gh, repo, cursor, [], null, null);
    levels.push(step.level);
    if (step.level.missing || step.level.parentUnknown) break;
    cursor = step.next;
  }
  const chain = assembleChain(levels);
  if (!boundaryInSlice) {
    chain.gaps.unshift(GAP_BOUNDARY);
    chain.complete = false;
  }
  return chain;
}

// Снимок чата, если он есть. Иначе файлы по коммитам, с явной неполнотой.
export async function readInherited(
  gh: GitHubClient,
  repo: RepoRef,
  chatId: string,
  parent: ForkPoint,
  chats: ChatPull[],
  store: 1 | 2,
): Promise<InheritedContext> {
  const text = await gh.getFileText(repo, forkContextPath(chatId, store), branchForChat(chatId));
  if (text !== null) {
    const snap = parseForkContext(text);
    if (snap && snap.chat_id === chatId) return contextOf(snap, parent.chat_id);
    const rebuilt = await walk(gh, repo, parent, chats);
    return { ...rebuilt, complete: false, gaps: [GAP_DAMAGED, ...rebuilt.gaps.filter((g) => g !== GAP_DAMAGED)] };
  }
  return walk(gh, repo, parent, chats);
}

async function walk(gh: GitHubClient, repo: RepoRef, parent: ForkPoint, chats: ChatPull[]): Promise<InheritedContext> {
  const levels: ChainLevel[] = [];
  let cursor: ForkPoint | null = parent;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.chat_id)) {
      levels.push({ ancestor: stub(cursor), commentsFrozen: true });
      break;
    }
    seen.add(cursor.chat_id);
    const step = await levelAt(gh, repo, cursor, chats, null, null);
    levels.push(step.level);
    if (step.level.missing || step.level.parentUnknown) break;
    cursor = step.next;
  }
  const chain = assembleChain(levels);
  const immediate = chain.ancestors.find((a) => a.chat_id === parent.chat_id) ?? chain.ancestors[chain.ancestors.length - 1];
  return {
    chat_id: parent.chat_id,
    title: immediate?.title ?? parent.chat_id,
    number: immediate?.number ?? null,
    message_id: parent.message_id,
    commit_sha: parent.commit_sha,
    items: inheritedItems(chain.ancestors),
    complete: chain.complete,
    gaps: chain.gaps,
    ancestors: chain.ancestors.map((a) => ({ chat_id: a.chat_id, title: a.title, boundary_message_id: a.boundary_message_id })),
  };
}
