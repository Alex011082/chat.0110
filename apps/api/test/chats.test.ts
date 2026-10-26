import { describe, expect, test } from "bun:test";
import { buildPrBody, gapComments, parseMessageFile, parsePrBody, serializeDecisionFile, type DecisionEvent } from "@chat0110/chat-protocol";
import { CHATS_AGENTS_MD } from "../src/agents-md.ts";
import {
  acceptAgentPr, createChat, createDecision, decisionAction, forkChat, getGraph, getTimeline, listChats, postMessage, proposeToParent, type ChatCtx,
} from "../src/chats.ts";
import { HttpError } from "../src/errors.ts";
import { GitHubClient, createCaches } from "../src/github.ts";
import { FakeGitHub, b64 } from "./fake-github.ts";

const R = "/repos/Alex011082/chat.0110";
const REPO = { owner: "Alex011082", name: "chat.0110" };
const CHAT = "20261023-k7q2";
const BRANCH = `chat/${CHAT}`;
const DIR = `chats/${CHAT}/messages`;
const DDIR = `chats/${CHAT}/decisions`;
const A = "20261023T100300Z-alex011082-q9w1";
const C = "20261023T101400Z-claude-x7k2";
const G = "20261023T103000Z-codex-g7g7";
const NOW = new Date("2026-10-23T10:02:03.456Z");

const repoBody = (push = true) => ({
  full_name: "Alex011082/chat.0110", name: "chat.0110", owner: { login: "Alex011082" }, private: false, default_branch: "main", permissions: { push },
});

function ctx(fake: FakeGitHub, rands: string[] = [], login = "Alex011082"): ChatCtx {
  let i = 0;
  return {
    gh: new GitHubClient({ token: "ghu", userId: 7, fetch: fake.fetch, caches: createCaches() }),
    user: { login, id: 7 },
    now: () => NOW,
    rand: () => rands[i++] ?? `r${String(i).padStart(3, "0")}`,
  };
}

async function failure(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error("ожидалась ошибка");
}

const chatPr = (extra: object = {}) => ({
  number: 5, title: "RoboChain — захват", body: `Привет\n\n<!-- chat0110\nchat_id: ${CHAT}\nschema_version: 1\n-->\n`,
  state: "open", draft: true, html_url: "https://github.com/Alex011082/chat.0110/pull/5",
  created_at: "2026-10-23T10:02:00Z", updated_at: "2026-10-23T10:40:00Z", user: { login: "Alex011082" },
  head: { ref: BRANCH, sha: "headsha", repo: { full_name: "Alex011082/chat.0110" } }, base: { ref: "main" }, ...extra,
});

// Fork: sha должны быть настоящими hex — иначе parsePrBody отбросит родителя.
const CHILD = "20261023-m2p9";
const CHILD_BRANCH = `chat/${CHILD}`;
const S1 = "1".repeat(40);
const S2 = "2".repeat(40);
const S3 = "3".repeat(40);
const S4 = "4".repeat(40);

const childPr = (number: number, parent: { chat_id: string; message_id: string; commit_sha: string }, extra: object = {}, id = CHILD) => ({
  number, title: `Ветка ${number}`, body: buildPrBody({ chatId: id, intro: "Альтернатива", parent }),
  state: "open", draft: true, html_url: `https://github.com/Alex011082/chat.0110/pull/${number}`,
  created_at: "2026-10-23T11:00:00Z", updated_at: "2026-10-23T11:30:00Z", user: { login: "Bob" },
  head: { ref: `chat/${id}`, sha: `head${number}`, repo: { full_name: "Alex011082/chat.0110" } }, base: { ref: `chat/${parent.chat_id}` }, ...extra,
});

const ghCommit = (sha: string, login: string | null, name: string, date: string, message: string) => ({
  sha, html_url: `https://github.com/c/${sha}`, author: login ? { login } : null,
  commit: { message, author: { name, date }, committer: { date } },
});
const fileText = (id: string, author: string, at: string, extra = "") => `---\nid: ${id}\nauthor: ${author}\n${extra}created_at: ${at}\n---\n`;
const NOT_FOUND = { status: 404, body: { message: "Not Found" } };

// События решений для фейка: листинг папки decisions и блобы с содержимым.
function dev(over: Partial<DecisionEvent> & { id: string; action: DecisionEvent["action"] }): DecisionEvent {
  return { decision: over.id, author: "alex011082", created_at: "2026-10-23T09:00:00.000Z", source_messages: [], text: "", ...over };
}
function withDecisions(fake: FakeGitHub, chatId: string, events: DecisionEvent[]): FakeGitHub {
  const dir = `chats/${chatId}/decisions`;
  fake.on("GET", `${R}/contents/${dir}`, {
    body: events.map((e) => ({ type: "file", name: `${e.id}.md`, path: `${dir}/${e.id}.md`, sha: `sd-${e.id}` })),
  });
  for (const e of events) fake.on("GET", `${R}/git/blobs/sd-${e.id}`, { body: { content: b64(serializeDecisionFile(e)), encoding: "base64" } });
  return fake;
}
const D1 = "20261023T090000Z-alex011082-d001";
const D2 = "20261023T093000Z-codex-d002";

describe("список чатов", () => {
  test("PR чатов → ChatSummary, префикс [chat] снят", async () => {
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&sort=updated/, { body: [chatPr({ title: "[chat] RoboChain — захват", draft: false }), chatPr({ number: 6, head: { ref: "feature/x", sha: "x", repo: { full_name: "Alex011082/chat.0110" } } })] });
    expect(await listChats(ctx(fake).gh, REPO)).toEqual([{
      repo: "Alex011082/chat.0110", chat_id: CHAT, title: "RoboChain — захват", number: 5, state: "open", draft: false,
      branch: BRANCH, url: "https://github.com/Alex011082/chat.0110/pull/5",
      created_at: "2026-10-23T10:02:00Z", updated_at: "2026-10-23T10:40:00Z", created_by: "alex011082", parent: null,
    }]);
  });

  test("родитель Fork — из блока в теле PR, без чтения chat.json", async () => {
    const parent = { chat_id: CHAT, message_id: C, commit_sha: S2 };
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&sort=updated/, { body: [childPr(7, parent), chatPr()] });
    const list = await listChats(ctx(fake).gh, REPO);
    expect(list.map((c) => [c.chat_id, c.parent])).toEqual([[CHILD, parent], [CHAT, null]]);
    expect(fake.find("GET", /\/contents\//).length).toBe(0);
  });
});

describe("лента чата", () => {
  function timelineFake() {
    const commit = (sha: string, login: string | null, name: string, date: string, message = `chat(${CHAT}): ${name}`) => ({
      sha, html_url: `https://github.com/c/${sha}`, author: login ? { login } : null,
      commit: { message, author: { name, date }, committer: { date } },
    });
    const file = (id: string, author: string, at: string, extra = "") => `---\nid: ${id}\nauthor: ${author}\n${extra}created_at: ${at}\n---\n`;
    return new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&head=Alex011082%3Achat%2F20261023-k7q2/, { body: [chatPr()] })
      .on("GET", `${R}/contents/${DIR}`, {
        body: [
          { type: "file", name: `${A}.md`, path: `${DIR}/${A}.md`, sha: "sA" },
          { type: "file", name: `${C}.md`, path: `${DIR}/${C}.md`, sha: "sC" },
          { type: "file", name: "README.md", path: `${DIR}/README.md`, sha: "sR" },
        ],
      })
      .on("GET", `${R}/git/blobs/sA`, { body: { content: b64(file(A, "alex011082", "2026-10-23T10:03:00Z") + "Нужны варианты."), encoding: "base64" } })
      .on("GET", `${R}/git/blobs/sC`, { body: { content: b64(file(C, "claude", "2026-10-23T10:14:00Z", `reply_to: ${A}\n`) + "Вакуум."), encoding: "base64" } })
      .on("GET", `${R}/git/blobs/sG`, { body: { content: b64(file(G, "codex", "2026-10-23T10:30:00Z") + "Из PR."), encoding: "base64" } })
      .on("GET", `${R}/contents/chats/${CHAT}/chat.json`, {
        body: { content: b64(JSON.stringify({ schema_version: 1, chat_id: CHAT, title: "RoboChain — захват", created_at: "2026-10-23T10:02:00Z", created_by: "alex011082", parent: null })) },
      })
      .on("GET", `${R}/compare/main...${BRANCH}`, { body: { merge_base_commit: { sha: "base" } } })
      .on("GET", /\/commits\?sha=chat%2F20261023-k7q2/, {
        body: [
          commit("c3", "chatgpt-codex-connector[bot]", "Codex", "2026-10-23T10:20:00Z", "calc: оценка"),
          commit("c2", "Alex011082", "Alex", "2026-10-23T10:15:00Z"),
          commit("c1", "Alex011082", "Alex", "2026-10-23T10:02:00Z", `chat(${CHAT}): создан`),
          commit("base", "x", "x", "2026-10-01T00:00:00Z"),
        ],
      })
      .on("GET", `${R}/commits/c1`, { body: { files: [{ filename: `chats/${CHAT}/chat.json`, status: "added" }, { filename: `${DIR}/${A}.md`, status: "added" }] } })
      .on("GET", `${R}/commits/c2`, { body: { files: [{ filename: `${DIR}/${C}.md`, status: "added" }] } })
      .on("GET", `${R}/commits/c3`, { body: { files: [{ filename: `chats/${CHAT}/calc.md`, status: "added" }, { filename: "x.ts", status: "modified" }] } })
      .on("GET", `${R}/issues/5/comments`, {
        body: [{ id: 101, user: { login: "chatgpt-codex-connector[bot]" }, body: "Комментарием.", created_at: "2026-10-23T10:25:00Z", html_url: "https://github.com/i/101" }],
      })
      .on("GET", `${R}/pulls/5/reviews`, {
        body: [
          { id: 201, user: { login: "Bob" }, body: "Посмотрел.", state: "COMMENTED", submitted_at: "2026-10-23T10:26:00Z", html_url: "https://github.com/r/201" },
          { id: 202, user: { login: "Bob" }, body: "черновик", state: "PENDING", html_url: "https://github.com/r/202" },
        ],
      })
      .on("GET", `${R}/pulls/5/comments`, { body: [] })
      .on("GET", /\/pulls\?state=all&base=chat%2F20261023-k7q2/, {
        body: [{
          number: 9, title: "Codex: ответ", state: "open", merged_at: null, created_at: "2026-10-23T10:31:00Z", html_url: "https://github.com/pull/9",
          user: { login: "chatgpt-codex-connector[bot]" }, head: { ref: "codex/reply", repo: { full_name: "Alex011082/chat.0110" } }, base: { ref: BRANCH },
        }],
      })
      .on("GET", `${R}/pulls/9/files`, {
        body: [{ filename: `${DIR}/${G}.md`, status: "added", sha: "sG" }, { filename: "src/hack.ts", status: "added", sha: "sx" }],
      })
      .on("GET", /\/pulls\?state=all&sort=updated/, { body: [chatPr()] })
      .on("GET", `${R}/contents/${DDIR}`, NOT_FOUND);
  }

  test("собирает TimelineInput из GitHub и отдаёт ленту с участниками", async () => {
    const fake = timelineFake();
    const res = await getTimeline(ctx(fake).gh, REPO, CHAT);

    expect(res.chat).toMatchObject({
      repo: "Alex011082/chat.0110", chat_id: CHAT, number: 5, title: "RoboChain — захват", head_sha: "headsha", can_push: true,
      branch: BRANCH, created_by: "alex011082",
    });
    expect(res.chat.meta?.title).toBe("RoboChain — захват");

    expect(res.items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "created:c1",
      `message:${A}`,
      `message:${C}`,
      "push:c3",
      "message:c101",
      "review:r201",
      `message:${G}`,
      "agent_pr:pr9",
    ]);
    const c = res.items.find((i) => i.id === C);
    expect(c).toMatchObject({ kind: "message", actor: "alex011082", commit_sha: "c2", reply_to: A, source: "file" });
    const g = res.items.find((i) => i.id === G);
    expect(g).toMatchObject({ kind: "message", source: "agent_pr", pending: true, agent_pr: 9, text: "Из PR." });
    const pr9 = res.items.find((i) => i.id === "pr9");
    expect(pr9).toMatchObject({ kind: "agent_pr", message_ids: [G], author: "codex" });

    // Коммиты читаются только до merge-base, блоб чужого кода из PR — не читается.
    expect(fake.find("GET", `${R}/commits/base`).length).toBe(0);
    expect(fake.find("GET", `${R}/git/blobs/sx`).length).toBe(0);
    expect(fake.find("GET", `${R}/git/blobs/sR`).length).toBe(0);

    expect(res.chat.participants).toEqual([
      { author: "codex", display: "Codex", is_agent: true, last_at: "2026-10-23T10:30:00.000Z", count: 2 },
      { author: "claude", display: "Claude", is_agent: true, last_at: "2026-10-23T10:14:00.000Z", count: 1 },
      { author: "alex011082", display: "alex011082", is_agent: false, last_at: "2026-10-23T10:03:00.000Z", count: 1 },
    ]);
    expect(res.chat.parent).toBeNull();
    expect(res.forks).toEqual([]);
    expect(res.inherited).toBeNull();
  });

  test("дочерние чаты: forks из списка чатов, их PR в ветку чата — не PR агентов", async () => {
    const at = (message_id: string, commit_sha: string) => ({ chat_id: CHAT, message_id, commit_sha });
    const older = childPr(7, at(A, S1), { created_at: "2026-10-23T10:50:00Z", user: { login: "Alex011082" } });
    const newer = childPr(8, at(C, S2), { state: "closed", created_at: "2026-10-23T11:10:00Z" }, "20261023-zz11");
    const elsewhere = childPr(11, { chat_id: "20261023-aaaa", message_id: A, commit_sha: S3 }, {}, "20261023-bbbb");
    // Агент без права пуша работает в своём форке репо в ветке с тем же именем —
    // это по-прежнему PR агента, а не чат.
    const fromFork = {
      number: 10, title: "Claude из форка", state: "open", merged_at: null, created_at: "2026-10-23T10:35:00Z", html_url: "https://github.com/pull/10",
      user: { login: "claude[bot]" }, head: { ref: BRANCH, repo: { full_name: "someone/chat.0110" } }, base: { ref: BRANCH },
    };
    const fake = timelineFake()
      .on("GET", /\/pulls\?state=all&sort=updated/, { body: [newer, elsewhere, chatPr(), older] })
      .on("GET", /\/pulls\?state=all&base=chat%2F20261023-k7q2/, {
        body: [
          newer, older, fromFork,
          {
            number: 9, title: "Codex: ответ", state: "open", merged_at: null, created_at: "2026-10-23T10:31:00Z", html_url: "https://github.com/pull/9",
            user: { login: "chatgpt-codex-connector[bot]" }, head: { ref: "codex/reply", repo: { full_name: "Alex011082/chat.0110" } }, base: { ref: BRANCH },
          },
        ],
      })
      .on("GET", `${R}/pulls/10/files`, { body: [] });
    const res = await getTimeline(ctx(fake).gh, REPO, CHAT);

    expect(res.items.filter((i) => i.kind === "agent_pr").map((i) => i.id).sort()).toEqual(["pr10", "pr9"]);
    expect(fake.find("GET", `${R}/pulls/7/files`).length + fake.find("GET", `${R}/pulls/8/files`).length).toBe(0);
    expect(res.forks).toEqual([
      {
        chat_id: CHILD, title: "Ветка 7", number: 7, url: "https://github.com/Alex011082/chat.0110/pull/7", state: "open",
        message_id: A, commit_sha: S1, created_at: "2026-10-23T10:50:00Z", created_by: "alex011082",
      },
      {
        chat_id: "20261023-zz11", title: "Ветка 8", number: 8, url: "https://github.com/Alex011082/chat.0110/pull/8", state: "closed",
        message_id: C, commit_sha: S2, created_at: "2026-10-23T11:10:00Z", created_by: "bob",
      },
    ]);
  });

  test("нет PR чата — not_found", async () => {
    const fake = new FakeGitHub().on("GET", R, { body: repoBody() }).on("GET", /\/pulls\?state=all&head=/, { body: [] });
    expect((await failure(getTimeline(ctx(fake).gh, REPO, CHAT))).code).toBe("not_found");
  });

  test("решения: карточки в ленте и свёрнутые decisions; коммит с одними решениями — не push", async () => {
    const D1A = "20261023T104000Z-alex011082-a001";
    const fake = withDecisions(timelineFake(), CHAT, [
      dev({ id: D1A, decision: D1, action: "accept", created_at: "2026-10-23T10:40:00.000Z", text: "Берём." }),
      dev({ id: D1, action: "propose", title: "Вакуумные руки", source_messages: [C], text: "Почему: быстрее." }),
      dev({ id: D2, action: "propose", author: "codex", created_at: "2026-10-23T09:30:00.000Z", title: "Мост" }),
    ])
      .on("GET", /\/commits\?sha=chat%2F20261023-k7q2/, {
        body: [
          ghCommit("c4", "Alex011082", "Alex", "2026-10-23T10:40:01Z", `chat(${CHAT}): решение alex011082`),
          ghCommit("c2", "Alex011082", "Alex", "2026-10-23T10:15:00Z", `chat(${CHAT}): Alex`),
          ghCommit("c1", "Alex011082", "Alex", "2026-10-23T10:02:00Z", `chat(${CHAT}): создан`),
          ghCommit("base", "x", "x", "2026-10-01T00:00:00Z", "x"),
        ],
      })
      .on("GET", `${R}/commits/c4`, { body: { files: [{ filename: `${DDIR}/${D1}.md`, status: "added" }, { filename: `${DDIR}/${D1A}.md`, status: "added" }] } });
    const res = await getTimeline(ctx(fake).gh, REPO, CHAT);

    expect(fake.find("GET", `${R}/contents/${DDIR}`)[0]!.url.searchParams.get("ref")).toBe(BRANCH);
    expect(res.decisions.map((d) => [d.id, d.status])).toEqual([[D1, "accepted"], [D2, "proposed"]]);
    expect(res.decisions[0]).toMatchObject({
      title: "Вакуумные руки", created_by: "alex011082", decided_by: "alex011082", decided_at: "2026-10-23T10:40:00.000Z",
      source_messages: [C], text: "Почему: быстрее.",
    });
    expect(res.decisions[0]!.history.map((h) => [h.id, h.action])).toEqual([[D1, "propose"], [D1A, "accept"]]);
    expect(res.outgoing).toEqual([]);

    const kinds = res.items.map((i) => `${i.kind}:${i.id}`);
    expect(kinds).toContain(`decision:${D1}`);
    expect(kinds).toContain(`decision:${D2}`);
    expect(kinds).toContain(`decision_event:${D1A}`);
    expect(kinds).not.toContain("push:c4");
    expect(res.items.find((i) => i.id === D1)).toMatchObject({ kind: "decision", actor: "alex011082", commit_sha: "c4" });
  });
});

describe("лента дочернего чата", () => {
  const PARENT = { chat_id: CHAT, message_id: C, commit_sha: S2 };
  const CHILD_DIR = `chats/${CHILD}/messages`;

  function childFake(opts: { chatJson?: object | null; list?: object[] } = {}) {
    const meta = { schema_version: 1, chat_id: CHILD, title: "Ветка 7", created_at: "2026-10-23T11:00:00Z", created_by: "bob", parent: { ...PARENT, reason: "Механика" } };
    const chatJson = opts.chatJson === undefined ? meta : opts.chatJson;
    return new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&head=Alex011082%3Achat%2F20261023-m2p9/, { body: [childPr(7, PARENT)] })
      .on("GET", /\/pulls\?state=all&sort=updated/, { body: opts.list ?? [childPr(7, PARENT), chatPr()] })
      .on("GET", `${R}/contents/${CHILD_DIR}`, { status: 404, body: { message: "Not Found" } })
      .on("GET", `${R}/contents/chats/${CHILD}/decisions`, NOT_FOUND)
      .on("GET", `${R}/contents/${DDIR}`, NOT_FOUND)
      .on("GET", `${R}/contents/chats/${CHILD}/chat.json`, chatJson ? { body: { content: b64(JSON.stringify(chatJson)) } } : { status: 404, body: { message: "Not Found" } })
      .on("GET", `${R}/contents/chats/${CHILD}/context.json`, NOT_FOUND)
      .on("GET", `${R}/contents/chats/${CHAT}/chat.json`, NOT_FOUND)
      .on("GET", `${R}/compare/main...${CHILD_BRANCH}`, { body: { merge_base_commit: { sha: "base" } } })
      // Ветка ребёнка растёт из коммита родителя: ниже S4 — история родителя.
      .on("GET", /\/commits\?sha=chat%2F20261023-m2p9/, {
        body: [
          ghCommit(S4, "Bob", "Bob", "2026-10-23T11:00:00Z", `chat(${CHILD}): fork от ${CHAT}`),
          ghCommit(S2, "Alex011082", "Alex", "2026-10-23T10:15:00Z", `chat(${CHAT}): claude`),
          ghCommit(S1, "Alex011082", "Alex", "2026-10-23T10:02:00Z", `chat(${CHAT}): создан`),
          ghCommit("base", "x", "x", "2026-10-01T00:00:00Z", "x"),
        ],
      })
      .on("GET", `${R}/commits/${S4}`, { body: { files: [{ filename: `chats/${CHILD}/chat.json`, status: "added" }] } })
      .on("GET", `${R}/issues/7/comments`, { body: [] })
      .on("GET", `${R}/pulls/7/reviews`, { body: [] })
      .on("GET", `${R}/pulls/7/comments`, { body: [] })
      .on("GET", /\/pulls\?state=all&base=chat%2F20261023-m2p9/, { body: [] })
      .on("GET", `${R}/contents/${DIR}`, {
        body: [
          { type: "file", name: `${C}.md`, path: `${DIR}/${C}.md`, sha: "sC" },
          { type: "file", name: `${A}.md`, path: `${DIR}/${A}.md`, sha: "sA" },
        ],
      })
      .on("GET", `${R}/git/blobs/sA`, { body: { content: b64(fileText(A, "alex011082", "2026-10-23T10:03:00Z") + "Нужны варианты."), encoding: "base64" } })
      .on("GET", `${R}/git/blobs/sC`, { body: { content: b64(fileText(C, "claude", "2026-10-23T10:14:00Z", `reply_to: ${A}\n`) + "Вакуум."), encoding: "base64" } });
  }

  test("inherited: сообщения родителя на коммите ветвления; история родителя не в ленте", async () => {
    const fake = childFake();
    const res = await getTimeline(ctx(fake).gh, REPO, CHILD);

    expect(res.chat.parent).toEqual(PARENT);
    expect(res.chat.meta?.parent).toEqual({ ...PARENT, reason: "Механика" });
    expect(res.inherited).toEqual({
      chat_id: CHAT, title: "RoboChain — захват", number: 5, message_id: C, commit_sha: S2,
      complete: false,
      gaps: [gapComments(CHAT)],
      ancestors: [{ chat_id: CHAT, title: "RoboChain — захват", boundary_message_id: C }],
      items: [
        { kind: "message", id: A, origin_chat_id: CHAT, author: "alex011082", display: "alex011082", source: "file", text: "Нужны варианты.", created_at: "2026-10-23T10:03:00.000Z", pending: false },
        { kind: "message", id: C, origin_chat_id: CHAT, author: "claude", display: "Claude", source: "file", text: "Вакуум.", reply_to: A, created_at: "2026-10-23T10:14:00.000Z", pending: false },
      ],
    });
    const listing = fake.find("GET", `${R}/contents/${DIR}`);
    expect(listing.length).toBe(1);
    expect(listing[0]!.url.searchParams.get("ref")).toBe(S2);

    // Коммиты родителя до точки Fork — не события этого чата.
    expect(res.items.map((i) => `${i.kind}:${i.id}`)).toEqual([`created:${S4}`]);
    expect(fake.find("GET", `${R}/commits/${S2}`).length + fake.find("GET", `${R}/commits/${S1}`).length).toBe(0);
  });

  test("снимок на коммите неизменен: второй раз (и другому пользователю) — из кеша", async () => {
    const fake = childFake();
    const caches = createCaches();
    await getTimeline(new GitHubClient({ token: "a", userId: 1, fetch: fake.fetch, caches }), REPO, CHILD);
    const again = await getTimeline(new GitHubClient({ token: "b", userId: 2, fetch: fake.fetch, caches }), REPO, CHILD);
    expect(again.inherited?.items.map((i) => i.id)).toEqual([A, C]);
    expect(fake.find("GET", `${R}/contents/${DIR}`).length).toBe(1);
    expect(fake.find("GET", /\/git\/blobs\//).length).toBe(2);
  });

  test("outgoing: предложения этого Fork в папке решений родителя, со статусом в родителе", async () => {
    const P1 = "20261023T113000Z-bob-p001";
    const P2 = "20261023T113500Z-bob-p002";
    const fake = withDecisions(childFake(), CHAT, [
      dev({ id: P1, action: "propose", author: "bob", created_at: "2026-10-23T11:30:00.000Z", title: "Мост", from_chat: CHILD }),
      dev({ id: "20261023T114000Z-alex011082-a001", decision: P1, action: "accept", created_at: "2026-10-23T11:40:00.000Z" }),
      dev({ id: P2, action: "propose", author: "bob", created_at: "2026-10-23T11:35:00.000Z", title: "Чужой", from_chat: "20261023-zzzz" }),
      dev({ id: D1, action: "propose", title: "Своё решение родителя" }),
    ]);
    const res = await getTimeline(ctx(fake).gh, REPO, CHILD);
    expect(res.outgoing.map((d) => [d.id, d.status, d.from_chat])).toEqual([[P1, "accepted", CHILD]]);
    expect(res.decisions).toEqual([]);
    // Папка решений родителя читается на голове его ветки, а не на коммите Fork.
    expect(fake.find("GET", `${R}/contents/${DDIR}`)[0]!.url.searchParams.get("ref")).toBe(BRANCH);
  });

  test("нет chat.json — родитель из тела PR; PR родителя не найден — номер null, название = id", async () => {
    const fake = childFake({ chatJson: null, list: [childPr(7, PARENT)] });
    const res = await getTimeline(ctx(fake).gh, REPO, CHILD);
    expect(res.chat.meta).toBeNull();
    expect(res.inherited).toMatchObject({ chat_id: CHAT, title: CHAT, number: null, message_id: C, commit_sha: S2 });
    expect(res.inherited?.items.length).toBe(2);
  });

  test("снимок на ветке ребёнка: предки из файла, каталог родителя не читается", async () => {
    const root = "20261023-aaa1";
    const midMsg = "20261023T090000Z-alex011082-aaa1";
    const snap = {
      schema_version: 1, chat_id: CHILD, created_at: "2026-10-23T11:00:00Z", created_by: "bob",
      parent: PARENT, complete: true, gaps: [],
      ancestors: [
        { chat_id: root, title: "Корень", number: 4, boundary_message_id: midMsg, commit_sha: S1, messages: [
          { id: midMsg, origin_chat_id: root, author: "alex011082", source: "file", created_at: "2026-10-23T09:00:00.000Z", text: "Корень" },
        ] },
        { chat_id: CHAT, title: "RoboChain — захват", number: 5, boundary_message_id: C, commit_sha: S2, messages: [
          { id: A, origin_chat_id: CHAT, author: "alex011082", source: "file", created_at: "2026-10-23T10:03:00.000Z", text: "Нужны варианты." },
        ] },
      ],
    };
    const fake = childFake().on("GET", `${R}/contents/chats/${CHILD}/context.json`, { body: { content: b64(JSON.stringify(snap)) } });
    const res = await getTimeline(ctx(fake).gh, REPO, CHILD);
    expect(res.inherited?.complete).toBe(true);
    expect(res.inherited?.gaps).toEqual([]);
    expect(res.inherited?.items.map((m) => [m.origin_chat_id, m.id])).toEqual([[root, midMsg], [CHAT, A]]);
    expect(fake.find("GET", `${R}/contents/${DIR}`).length).toBe(0);
  });
});

describe("создание чата", () => {
  function createFake(opts: { agentsExists?: boolean } = {}) {
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", `${R}/git/ref/heads/main`, { body: { object: { sha: "mainhead" } } })
      .on("GET", `${R}/git/commits/mainhead`, { body: { tree: { sha: "maintree" } } })
      .on("GET", `${R}/contents/chats/AGENTS.md`, opts.agentsExists ? { body: { content: b64("x") } } : { status: 404, body: { message: "Not Found" } })
      .on("GET", `${R}/contents/chats/CLAUDE.md`, opts.agentsExists ? { body: { content: b64("x") } } : { status: 404, body: { message: "Not Found" } })
      .on("POST", `${R}/git/trees`, { status: 201, body: { sha: "newtree" } })
      .on("POST", `${R}/git/commits`, { status: 201, body: { sha: "newcommit" } })
      .on("POST", `${R}/git/refs`, { status: 201, body: {} })
      .on("POST", `${R}/pulls`, (c) => ({
        status: 201,
        body: { number: 12, title: c.body.title, draft: c.body.draft, state: "open", html_url: "https://github.com/pull/12", created_at: "2026-10-23T10:02:04Z", updated_at: "2026-10-23T10:02:04Z", user: { login: "Alex011082" } },
      }))
      .on("POST", `${R}/labels`, { status: 201, body: {} })
      .on("POST", `${R}/issues/12/labels`, { body: [] });
    return fake;
  }

  test("один коммит: chat.json, протокол агентов, первое сообщение; draft PR с меткой", async () => {
    const fake = createFake();
    const res = await createChat(ctx(fake, ["q9w1", "k7q2"]), REPO, { title: "  RoboChain —\n захват ", first_message: "Нужны варианты." });

    expect(fake.find("POST", `${R}/git/commits`).length).toBe(1);
    const tree = fake.find("POST", `${R}/git/trees`)[0]!.body;
    expect(tree.base_tree).toBe("maintree");
    const byPath = Object.fromEntries(tree.tree.map((e: any) => [e.path, e]));
    const M = "20261023T100203Z-alex011082-q9w1";
    expect(Object.keys(byPath).sort()).toEqual([`chats/${CHAT}/chat.json`, `${DIR}/${M}.md`, "chats/AGENTS.md", "chats/CLAUDE.md"].sort());
    expect(byPath["chats/AGENTS.md"]).toEqual({ path: "chats/AGENTS.md", mode: "100644", type: "blob", content: CHATS_AGENTS_MD });
    expect(byPath["chats/CLAUDE.md"].content).toBe("@AGENTS.md\n");
    expect(JSON.parse(byPath[`chats/${CHAT}/chat.json`].content)).toEqual({
      schema_version: 1, chat_id: CHAT, title: "RoboChain — захват", created_at: "2026-10-23T10:02:03Z", created_by: "alex011082", parent: null,
    });
    expect(parseMessageFile(`${M}.md`, byPath[`${DIR}/${M}.md`].content)).toEqual({ id: M, author: "alex011082", created_at: "2026-10-23T10:02:03.000Z", text: "Нужны варианты." } as any);

    expect(fake.find("POST", `${R}/git/commits`)[0]!.body).toEqual({ message: `chat(${CHAT}): создан`, tree: "newtree", parents: ["mainhead"] });
    expect(fake.find("POST", `${R}/git/refs`)[0]!.body).toEqual({ ref: `refs/heads/${BRANCH}`, sha: "newcommit" });

    const pr = fake.find("POST", `${R}/pulls`)[0]!.body;
    expect(pr).toMatchObject({ title: "RoboChain — захват", head: BRANCH, base: "main", draft: true });
    expect(parsePrBody(pr.body)).toEqual({ chat_id: CHAT, schema_version: 1 });
    expect(pr.body).toContain("Нужны варианты.");

    expect(fake.find("POST", `${R}/labels`)[0]!.body).toEqual({ name: "chat0110", color: "2f9a55", description: "Чат chat.0110: не сливать" });
    expect(fake.find("POST", `${R}/issues/12/labels`)[0]!.body).toEqual({ labels: ["chat0110"] });

    expect(res).toEqual({
      repo: "Alex011082/chat.0110", chat_id: CHAT, title: "RoboChain — захват", number: 12, state: "open", draft: true, branch: BRANCH,
      url: "https://github.com/pull/12", created_at: "2026-10-23T10:02:04Z", updated_at: "2026-10-23T10:02:04Z", created_by: "alex011082", parent: null,
    });
  });

  test("протокол уже есть в репо — не перезаписывается; без первого сообщения", async () => {
    const fake = createFake({ agentsExists: true });
    await createChat(ctx(fake, ["k7q2"]), REPO, { title: "Тема" });
    const paths = fake.find("POST", `${R}/git/trees`)[0]!.body.tree.map((e: any) => e.path);
    expect(paths).toEqual([`chats/${CHAT}/chat.json`]);
  });

  test("метка уже есть (422) — не ошибка", async () => {
    const fake = createFake().on("POST", `${R}/labels`, { status: 422, body: { message: "Validation Failed", errors: [{ code: "already_exists" }] } });
    const res = await createChat(ctx(fake, ["k7q2"]), REPO, { title: "Тема" });
    expect(res.number).toBe(12);
    expect(fake.find("POST", `${R}/issues/12/labels`).length).toBe(1);
  });

  test("пустое репо: сначала Contents API кладёт chats/AGENTS.md, потом коммит чата от него", async () => {
    const fake = createFake()
      .on("GET", `${R}/git/ref/heads/main`, { status: 409, body: { message: "Git Repository is empty." } })
      .on("PUT", `${R}/contents/chats/AGENTS.md`, { status: 201, body: { commit: { sha: "seed", html_url: "u" } } })
      .on("GET", `${R}/git/commits/seed`, { body: { tree: { sha: "seedtree" } } });
    await createChat(ctx(fake, ["k7q2"]), REPO, { title: "Тема" });
    const seed = fake.find("PUT", `${R}/contents/chats/AGENTS.md`)[0]!.body;
    expect(Buffer.from(seed.content, "base64").toString("utf8")).toBe(CHATS_AGENTS_MD);
    const tree = fake.find("POST", `${R}/git/trees`)[0]!.body;
    expect(tree.base_tree).toBe("seedtree");
    expect(tree.tree.map((e: any) => e.path).sort()).toEqual([`chats/${CHAT}/chat.json`, "chats/CLAUDE.md"]);
    expect(fake.find("POST", `${R}/git/commits`)[0]!.body.parents).toEqual(["seed"]);
  });

  test("id совпал с существующей веткой (422) — новый id", async () => {
    let refs = 0;
    const fake = createFake().on("POST", `${R}/git/refs`, () =>
      ++refs === 1 ? { status: 422, body: { message: "Reference already exists" } } : { status: 201, body: {} });
    const res = await createChat(ctx(fake, ["aaaa", "bbbb"]), REPO, { title: "Тема" });
    expect(fake.find("POST", `${R}/git/refs`).map((c) => c.body.ref)).toEqual(["refs/heads/chat/20261023-aaaa", "refs/heads/chat/20261023-bbbb"]);
    expect(res.chat_id).toBe("20261023-bbbb");
    expect(fake.find("POST", `${R}/pulls`)[0]!.body.head).toBe("chat/20261023-bbbb");
  });

  test("три совпадения подряд — ошибка, PR не создаётся", async () => {
    const fake = createFake().on("POST", `${R}/git/refs`, { status: 422, body: { message: "Reference already exists" } });
    const err = await failure(createChat(ctx(fake, ["aaaa", "bbbb", "cccc"]), REPO, { title: "Тема" }));
    expect(err.code).toBe("conflict");
    expect(fake.find("POST", `${R}/git/refs`).length).toBe(3);
    expect(fake.find("POST", `${R}/pulls`).length).toBe(0);
  });

  test("draft недоступен — обычный PR с префиксом [chat]", async () => {
    let n = 0;
    const fake = createFake().on("POST", `${R}/pulls`, (c) =>
      ++n === 1
        ? { status: 422, body: { message: "Validation Failed", errors: [{ message: "Draft pull requests are not supported in this repository." }] } }
        : { status: 201, body: { number: 12, title: c.body.title, draft: false, state: "open", html_url: "u", created_at: "t", updated_at: "t", user: { login: "Alex011082" } } });
    const res = await createChat(ctx(fake, ["k7q2"]), REPO, { title: "Тема" });
    const calls = fake.find("POST", `${R}/pulls`);
    expect(calls[1]!.body).toMatchObject({ title: "[chat] Тема", draft: false });
    expect(res).toMatchObject({ title: "Тема", draft: false });
  });

  test("PR не создался — ветка удаляется, ошибка пробрасывается", async () => {
    const fake = createFake()
      .on("POST", `${R}/pulls`, { status: 500, body: { message: "boom" } })
      .on("DELETE", `${R}/git/refs/heads/${BRANCH}`, { status: 204 });
    const err = await failure(createChat(ctx(fake, ["k7q2"]), REPO, { title: "Тема" }));
    expect(err.code).toBe("github_error");
    expect(fake.find("DELETE", `${R}/git/refs/heads/${BRANCH}`).length).toBe(1);
  });

  test("проверки: пустое название, нет права на запись", async () => {
    expect((await failure(createChat(ctx(createFake()), REPO, { title: "  " }))).code).toBe("bad_request");
    const ro = createFake().on("GET", R, { body: repoBody(false) });
    expect((await failure(createChat(ctx(ro), REPO, { title: "Тема" }))).code).toBe("forbidden");
  });
});

describe("Fork", () => {
  const M = "20261023T100203Z-alex011082-q9w1";

  // Родитель: S1 — создан (A), S2 — Claude (C), S3 — пуш без сообщений;
  // комментарий c101 написан между S2 и S3.
  function forkFake() {
    return new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&head=Alex011082%3Achat%2F20261023-k7q2/, { body: [chatPr()] })
      .on("GET", `${R}/contents/${DIR}`, {
        body: [
          { type: "file", name: `${A}.md`, path: `${DIR}/${A}.md`, sha: "sA" },
          { type: "file", name: `${C}.md`, path: `${DIR}/${C}.md`, sha: "sC" },
        ],
      })
      .on("GET", `${R}/git/blobs/sA`, { body: { content: b64(fileText(A, "alex011082", "2026-10-23T10:03:00Z") + "Нужны варианты."), encoding: "base64" } })
      .on("GET", `${R}/git/blobs/sC`, { body: { content: b64(fileText(C, "claude", "2026-10-23T10:14:00Z") + "Вакуум."), encoding: "base64" } })
      .on("GET", `${R}/contents/chats/${CHAT}/chat.json`, { status: 404, body: { message: "Not Found" } })
      .on("GET", `${R}/contents/chats/${CHAT}/context.json`, NOT_FOUND)
      .on("GET", `${R}/compare/main...${BRANCH}`, { body: { merge_base_commit: { sha: "base" } } })
      .on("GET", /\/commits\?sha=chat%2F20261023-k7q2/, {
        body: [
          ghCommit(S3, "Alex011082", "Alex", "2026-10-23T10:20:00Z", "calc: оценка"),
          ghCommit(S2, "Alex011082", "Alex", "2026-10-23T10:15:00Z", `chat(${CHAT}): claude`),
          ghCommit(S1, "Alex011082", "Alex", "2026-10-23T10:02:00Z", `chat(${CHAT}): создан`),
          ghCommit("base", "x", "x", "2026-10-01T00:00:00Z", "x"),
        ],
      })
      .on("GET", `${R}/commits/${S1}`, { body: { files: [{ filename: `chats/${CHAT}/chat.json`, status: "added" }, { filename: `${DIR}/${A}.md`, status: "added" }] } })
      .on("GET", `${R}/commits/${S2}`, { body: { files: [{ filename: `${DIR}/${C}.md`, status: "added" }] } })
      .on("GET", `${R}/commits/${S3}`, { body: { files: [{ filename: `chats/${CHAT}/calc.md`, status: "added" }] } })
      .on("GET", `${R}/issues/5/comments`, {
        body: [{ id: 101, user: { login: "chatgpt-codex-connector[bot]" }, body: "Комментарием.", created_at: "2026-10-23T10:17:00Z", html_url: "https://github.com/i/101" }],
      })
      .on("GET", `${R}/pulls/5/reviews`, { body: [] })
      .on("GET", `${R}/pulls/5/comments`, { body: [] })
      .on("GET", /\/pulls\?state=all&base=chat%2F20261023-k7q2/, { body: [] })
      .on("GET", `${R}/contents/${DDIR}`, NOT_FOUND)
      // Создание ребёнка: дерево коммита ветвления, протокол там уже есть, CLAUDE.md — нет.
      .on("GET", /\/git\/commits\/[0-9a-f]{40}$/, (c) => ({ body: { tree: { sha: `tree-${c.url.pathname.slice(-40, -36)}` } } }))
      .on("GET", `${R}/contents/chats/AGENTS.md`, { body: { content: b64("x") } })
      .on("GET", `${R}/contents/chats/CLAUDE.md`, { status: 404, body: { message: "Not Found" } })
      .on("POST", `${R}/git/trees`, { status: 201, body: { sha: "newtree" } })
      .on("POST", `${R}/git/commits`, { status: 201, body: { sha: "newcommit" } })
      .on("POST", `${R}/git/refs`, { status: 201, body: {} })
      .on("POST", `${R}/pulls`, (c) => ({
        status: 201,
        body: { number: 12, title: c.body.title, draft: c.body.draft, state: "open", html_url: "https://github.com/pull/12", created_at: "2026-10-23T10:02:04Z", updated_at: "2026-10-23T10:02:04Z", user: { login: "Alex011082" } },
      }))
      .on("POST", `${R}/labels`, { status: 201, body: {} })
      .on("POST", `${R}/issues/12/labels`, { body: [] });
  }

  test("от файла-сообщения: ветка от коммита, который его добавил; PR в ветку родителя", async () => {
    const fake = forkFake();
    const res = await forkChat(ctx(fake, ["q9w1", "m2p9"]), REPO, CHAT, {
      message_id: C, title: " Механический  захват ", reason: "Исследовать механику", first_message: "Начнём с моста.",
    });
    const point = { chat_id: CHAT, message_id: C, commit_sha: S2 };

    const tree = fake.find("POST", `${R}/git/trees`)[0]!.body;
    expect(tree.base_tree).toBe("tree-2222");
    const byPath = Object.fromEntries(tree.tree.map((e: any) => [e.path, e]));
    expect(Object.keys(byPath).sort()).toEqual([`chats/${CHILD}/chat.json`, `chats/${CHILD}/context.json`, `chats/${CHILD}/messages/${M}.md`, "chats/CLAUDE.md"].sort());
    const snap = JSON.parse(byPath[`chats/${CHILD}/context.json`].content);
    expect(snap.complete).toBe(true);
    expect(snap.gaps).toEqual([]);
    expect(snap.parent).toEqual(point);
    expect(snap.ancestors.map((a: { chat_id: string }) => a.chat_id)).toEqual([CHAT]);
    expect(snap.ancestors[0].messages.map((m: { id: string }) => m.id)).toEqual([A, C]);
    expect(JSON.parse(byPath[`chats/${CHILD}/chat.json`].content)).toEqual({
      schema_version: 1, chat_id: CHILD, title: "Механический захват", created_at: "2026-10-23T10:02:03Z", created_by: "alex011082",
      parent: { ...point, reason: "Исследовать механику" },
    });
    // Протокол ищется на коммите ветвления, а не на голове main.
    expect(fake.find("GET", `${R}/contents/chats/AGENTS.md`)[0]!.url.searchParams.get("ref")).toBe(S2);
    expect(fake.find("GET", `${R}/git/ref/heads/main`).length).toBe(0);

    expect(fake.find("POST", `${R}/git/commits`)[0]!.body).toEqual({ message: `chat(${CHILD}): fork от ${CHAT}`, tree: "newtree", parents: [S2] });
    expect(fake.find("POST", `${R}/git/refs`)[0]!.body).toEqual({ ref: `refs/heads/${CHILD_BRANCH}`, sha: "newcommit" });

    const pr = fake.find("POST", `${R}/pulls`)[0]!.body;
    expect(pr).toMatchObject({ title: "Механический захват", head: CHILD_BRANCH, base: BRANCH, draft: true });
    expect(parsePrBody(pr.body)).toEqual({ chat_id: CHILD, schema_version: 1, parent: point });
    expect(pr.body).toContain("Исследовать механику");
    expect(fake.find("POST", `${R}/issues/12/labels`)[0]!.body).toEqual({ labels: ["chat0110"] });

    expect(res).toEqual({
      repo: "Alex011082/chat.0110", chat_id: CHILD, title: "Механический захват", number: 12, state: "open", draft: true, branch: CHILD_BRANCH,
      url: "https://github.com/pull/12", created_at: "2026-10-23T10:02:04Z", updated_at: "2026-10-23T10:02:04Z", created_by: "alex011082", parent: point,
    });
  });

  test("от комментария: последний коммит не позже комментария; без причины intro = первое сообщение", async () => {
    const fake = forkFake();
    const res = await forkChat(ctx(fake, ["q9w1", "m2p9"]), REPO, CHAT, { message_id: "c101", title: "Тема", first_message: "Первое." });
    expect(fake.find("POST", `${R}/git/commits`)[0]!.body.parents).toEqual([S2]);
    const pr = fake.find("POST", `${R}/pulls`)[0]!.body;
    expect(pr.body).toContain("Первое.");
    expect(parsePrBody(pr.body)?.parent).toEqual({ chat_id: CHAT, message_id: "c101", commit_sha: S2 });
    const json = JSON.parse(fake.find("POST", `${R}/git/trees`)[0]!.body.tree.find((e: any) => e.path.endsWith("chat.json")).content);
    expect(json.parent).toEqual({ chat_id: CHAT, message_id: "c101", commit_sha: S2 });
    expect(res.parent).toEqual({ chat_id: CHAT, message_id: "c101", commit_sha: S2 });
  });

  test("сообщения нет в ветке чата — 404, ничего не создаётся", async () => {
    const fake = forkFake();
    const err = await failure(forkChat(ctx(fake), REPO, CHAT, { message_id: "20261023T110000Z-claude-none", title: "Тема" }));
    expect(err.code).toBe("not_found");
    expect(err.message).toBe("Сообщение не найдено в ветке чата");
    expect(fake.find("POST", /./).length).toBe(0);
  });

  test("проверки до GitHub: message_id, название, причина, первое сообщение", async () => {
    const fake = forkFake();
    const ok = { message_id: C, title: "Тема" };
    for (const bad of [
      { title: "Тема" },
      { ...ok, message_id: "../x" },
      { ...ok, message_id: "a".repeat(65) },
      { ...ok, message_id: 5 },
      { ...ok, title: "  " },
      { ...ok, title: "x".repeat(121) },
      { ...ok, reason: "x".repeat(501) },
      { ...ok, reason: 5 },
      { ...ok, first_message: "я".repeat(60_001) },
    ]) {
      expect((await failure(forkChat(ctx(fake), REPO, CHAT, bad as any))).code).toBe("bad_request");
    }
    expect(fake.calls.length).toBe(0);
  });

  test("нет права на запись — forbidden", async () => {
    const fake = forkFake().on("GET", R, { body: repoBody(false) });
    expect((await failure(forkChat(ctx(fake), REPO, CHAT, { message_id: C, title: "Тема" }))).code).toBe("forbidden");
    expect(fake.find("POST", /./).length).toBe(0);
  });

  test("PR не создался — ветка ребёнка удаляется", async () => {
    const fake = forkFake()
      .on("POST", `${R}/pulls`, { status: 500, body: { message: "boom" } })
      .on("DELETE", `${R}/git/refs/heads/${CHILD_BRANCH}`, { status: 204 });
    const err = await failure(forkChat(ctx(fake, ["m2p9"]), REPO, CHAT, { message_id: C, title: "Тема" }));
    expect(err.code).toBe("github_error");
    expect(fake.find("DELETE", `${R}/git/refs/heads/${CHILD_BRANCH}`).length).toBe(1);
  });

  test("два уровня: поздний файл середины не входит в снимок", async () => {
    const root = "20261023-aaa1";
    const mid = "20261023-bbb2";
    const sa = "a".repeat(40);
    const sb = "b".repeat(40);
    const mr = "20261023T090000Z-alex011082-aaa1";
    const mm = "20261023T100000Z-alex011082-bbb2";
    const late = "20261023T120000Z-alex011082-late";
    const midBranch = `chat/${mid}`;
    const passport = (id: string, title: string, parent: object | null) => ({
      schema_version: 1, chat_id: id, title, created_at: "2026-10-23T09:00:00Z", created_by: "alex011082", parent,
    });
    const listing = (id: string, names: string[]) => names.map((n) => ({ type: "file", name: `${n}.md`, path: `chats/${id}/messages/${n}.md`, sha: `blob-${n}` }));
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&head=Alex011082%3Achat%2F20261023-bbb2/, { body: [chatPr({ number: 8, title: "Середина", head: { ref: midBranch, sha: "headmid", repo: { full_name: "Alex011082/chat.0110" } }, body: `<!-- chat0110\nchat_id: ${mid}\nschema_version: 1\nparent_chat_id: ${root}\nparent_message_id: ${mr}\nfork_commit_sha: ${sa}\n-->\n` })] })
      .on("GET", `${R}/contents/chats/${mid}/messages`, (c) => ({ body: listing(mid, c.url.searchParams.get("ref") === sb ? [mm] : [mm, late]) }))
      .on("GET", `${R}/contents/chats/${root}/messages`, { body: listing(root, [mr]) })
      .on("GET", `${R}/contents/chats/${mid}/decisions`, NOT_FOUND)
      .on("GET", `${R}/contents/chats/${mid}/chat.json`, { body: { content: b64(JSON.stringify(passport(mid, "Середина", { chat_id: root, message_id: mr, commit_sha: sa }))) } })
      .on("GET", `${R}/contents/chats/${root}/chat.json`, { body: { content: b64(JSON.stringify(passport(root, "Корень", null))) } })
      .on("GET", `${R}/contents/chats/${mid}/context.json`, NOT_FOUND)
      .on("GET", `${R}/git/blobs/blob-${mr}`, { body: { content: b64(fileText(mr, "alex011082", "2026-10-23T09:00:00Z") + "Корень."), encoding: "base64" } })
      .on("GET", `${R}/git/blobs/blob-${mm}`, { body: { content: b64(fileText(mm, "alex011082", "2026-10-23T10:00:00Z") + "Середина."), encoding: "base64" } })
      .on("GET", `${R}/git/blobs/blob-${late}`, { body: { content: b64(fileText(late, "alex011082", "2026-10-23T12:00:00Z") + "Поздно."), encoding: "base64" } })
      .on("GET", `${R}/compare/main...${midBranch}`, { body: { merge_base_commit: { sha: "base" } } })
      .on("GET", /\/commits\?sha=chat%2F20261023-bbb2/, { body: [ghCommit(sb, "Alex011082", "Alex", "2026-10-23T10:00:00Z", `chat(${mid}): alex011082`)] })
      .on("GET", `${R}/commits/${sb}`, { body: { files: [{ filename: `chats/${mid}/messages/${mm}.md`, status: "added" }] } })
      .on("GET", `${R}/issues/8/comments`, { body: [] })
      .on("GET", `${R}/pulls/8/reviews`, { body: [] })
      .on("GET", `${R}/pulls/8/comments`, { body: [] })
      .on("GET", /\/pulls\?state=all&base=chat%2F20261023-bbb2/, { body: [] })
      .on("GET", `${R}/contents/chats/AGENTS.md`, { body: { content: b64("x") } })
      .on("GET", `${R}/contents/chats/CLAUDE.md`, { body: { content: b64("x") } })
      .on("GET", /\/git\/commits\/[0-9a-f]{40}$/, { body: { tree: { sha: "tree-mid" } } })
      .on("POST", `${R}/git/trees`, { status: 201, body: { sha: "newtree" } })
      .on("POST", `${R}/git/commits`, { status: 201, body: { sha: "newcommit" } })
      .on("POST", `${R}/git/refs`, { status: 201, body: {} })
      .on("POST", `${R}/pulls`, (c) => ({ status: 201, body: { number: 12, title: c.body.title, draft: true, state: "open", html_url: "https://github.com/pull/12", created_at: "2026-10-23T10:02:04Z", updated_at: "2026-10-23T10:02:04Z", user: { login: "Alex011082" } } }))
      .on("POST", `${R}/labels`, { status: 201, body: {} })
      .on("POST", `${R}/issues/12/labels`, { body: [] });
    await forkChat(ctx(fake, ["q9w1", "m2p9"]), REPO, mid, { message_id: mm, title: "Дальше" });
    const snap = JSON.parse(fake.find("POST", `${R}/git/trees`)[0]!.body.tree.find((e: { path: string }) => e.path.endsWith("context.json")).content);
    expect(snap.complete).toBe(false);
    expect(snap.ancestors.map((a: { chat_id: string; messages: { id: string }[] }) => [a.chat_id, a.messages.map((m) => m.id)])).toEqual([
      [root, [mr]],
      [mid, [mm]],
    ]);
    expect(JSON.stringify(snap)).not.toContain(late);
    expect(fake.find("GET", `${R}/contents/chats/${root}/messages`)[0]!.url.searchParams.get("ref")).toBe(sa);
    expect(fake.find("GET", `${R}/contents/chats/${mid}/messages`).some((c) => c.url.searchParams.get("ref") === sb)).toBe(true);
  });
});

describe("граф чатов", () => {
  const listing = (id: string, names: string[]) => names.map((n) => ({ type: "file", name: n, path: `chats/${id}/messages/${n}`, sha: `s-${n}` }));

  test("все чаты репо, сообщения из имён файлов, без чтения блобов", async () => {
    const T = "20261023T101400Z-claude-aaaa";
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&sort=updated/, {
        body: [
          childPr(7, { chat_id: CHAT, message_id: C, commit_sha: S2 }, { state: "closed" }),
          chatPr(),
          chatPr({ number: 6, head: { ref: "chat/20261023-gone", sha: "x", repo: { full_name: "Alex011082/chat.0110" } }, body: "<!-- chat0110\nchat_id: 20261023-gone\n-->" }),
        ],
      })
      .on("GET", `${R}/contents/${DIR}`, { body: listing(CHAT, [`${G}.md`, `${C}.md`, "README.md", `${T}.md`, `${A}.md`]) })
      .on("GET", `${R}/contents/chats/${CHILD}/messages`, { body: listing(CHILD, ["20261023T110500Z-bob-x1y2.md"]) })
      .on("GET", `${R}/contents/chats/20261023-gone/messages`, { status: 404, body: { message: "Not Found" } })
      .on("GET", /\/contents\/chats\/[^/]+\/decisions/, NOT_FOUND);
    const res = await getGraph(ctx(fake).gh, REPO);

    expect(res.repo).toBe("Alex011082/chat.0110");
    expect(res.chats.map((c) => [c.chat_id, c.state])).toEqual([[CHILD, "closed"], [CHAT, "open"], ["20261023-gone", "open"]]);
    expect(res.chats[0]).toMatchObject({ number: 7, branch: CHILD_BRANCH, parent: { chat_id: CHAT, message_id: C, commit_sha: S2 } });
    expect(res.chats[0]!.messages).toEqual([{ id: "20261023T110500Z-bob-x1y2", author: "bob", created_at: "2026-10-23T11:05:00.000Z" }]);
    expect(res.chats[1]!.parent).toBeNull();
    expect(res.chats[1]!.messages).toEqual([
      { id: A, author: "alex011082", created_at: "2026-10-23T10:03:00.000Z" },
      { id: T, author: "claude", created_at: "2026-10-23T10:14:00.000Z" },
      { id: C, author: "claude", created_at: "2026-10-23T10:14:00.000Z" },
      { id: G, author: "codex", created_at: "2026-10-23T10:30:00.000Z" },
    ]);
    expect(res.chats[2]!.messages).toEqual([]);
    expect(fake.find("GET", `${R}/contents/${DIR}`)[0]!.url.searchParams.get("ref")).toBe(BRANCH);
    expect(fake.find("GET", /\/git\/blobs\//).length).toBe(0);
  });

  test("решения каждого чата: свёрнутые статусы для дерева", async () => {
    const D3 = "20261023T120000Z-bob-d003";
    const fake = withDecisions(new FakeGitHub(), CHAT, [
      dev({ id: D1, action: "propose", title: "Вакуумные руки" }),
      dev({ id: "20261023T091000Z-alex011082-a001", decision: D1, action: "accept", created_at: "2026-10-23T09:10:00.000Z" }),
      dev({ id: D3, action: "propose", author: "bob", created_at: "2026-10-23T12:00:00.000Z", title: "Мост", from_chat: CHILD, supersedes: D1 }),
      dev({ id: "20261023T121000Z-alex011082-a002", decision: D3, action: "accept", created_at: "2026-10-23T12:10:00.000Z" }),
      dev({ id: D2, action: "propose", author: "codex", created_at: "2026-10-23T09:30:00.000Z", title: "Ещё" }),
      dev({ id: "20261023T093100Z-codex-a003", decision: D2, action: "accept", author: "codex", created_at: "2026-10-23T09:31:00.000Z" }),
    ])
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&sort=updated/, { body: [chatPr()] })
      .on("GET", `${R}/contents/${DIR}`, { body: [] });
    const res = await getGraph(ctx(fake).gh, REPO);
    expect(res.chats[0]!.decisions).toEqual([
      { id: D1, title: "Вакуумные руки", status: "superseded", created_at: "2026-10-23T09:00:00.000Z", decided_at: "2026-10-23T09:10:00.000Z" },
      // Принятие агентом статус не меняет (п. 2.3 спеки).
      { id: D2, title: "Ещё", status: "proposed", created_at: "2026-10-23T09:30:00.000Z" },
      { id: D3, title: "Мост", status: "accepted", created_at: "2026-10-23T12:00:00.000Z", decided_at: "2026-10-23T12:10:00.000Z", from_chat: CHILD, supersedes: D1 },
    ]);
    expect(fake.find("GET", `${R}/contents/${DDIR}`)[0]!.url.searchParams.get("ref")).toBe(BRANCH);
  });

  test("не больше 6 листингов разом — сообщения и решения вместе", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `20261023-g${String(i).padStart(3, "0")}`);
    let inflight = 0;
    let peak = 0;
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&sort=updated/, {
        body: ids.map((id, i) => chatPr({ number: 100 + i, head: { ref: `chat/${id}`, sha: "x", repo: { full_name: "Alex011082/chat.0110" } }, body: `<!-- chat0110\nchat_id: ${id}\n-->` })),
      })
      .on("GET", /\/contents\/chats\/20261023-g\d{3}\/(messages|decisions)/, async () => {
        peak = Math.max(peak, ++inflight);
        await Bun.sleep(5);
        inflight--;
        return { body: [] };
      });
    const res = await getGraph(ctx(fake).gh, REPO);
    expect(res.chats.length).toBe(10);
    expect(peak).toBe(6);
    expect(fake.find("GET", /\/decisions/).length).toBe(10);
  });

  test("не больше 200 чатов — самые свежие по обновлению", async () => {
    const n = 205;
    const id = (i: number) => `20261023-${i.toString(36).padStart(4, "0")}`;
    const updated = (i: number) => new Date(Date.UTC(2026, 9, 23, 0, 0, i)).toISOString();
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      // Порядок ответа не важен: отбираем по updated_at сами.
      .on("GET", /\/pulls\?state=all&sort=updated/, {
        body: Array.from({ length: n }, (_, i) =>
          chatPr({ number: i + 1, updated_at: updated(i), head: { ref: `chat/${id(i)}`, sha: "x", repo: { full_name: "Alex011082/chat.0110" } }, body: `<!-- chat0110\nchat_id: ${id(i)}\n-->` })),
      })
      .on("GET", /\/contents\/chats\/[^/]+\/(messages|decisions)/, { body: [] });
    const res = await getGraph(ctx(fake).gh, REPO);
    expect(res.chats.length).toBe(200);
    expect(res.chats[0]!.chat_id).toBe(id(n - 1));
    expect(res.chats.some((c) => c.chat_id === id(0))).toBe(false);
    expect(fake.find("GET", /\/contents\/chats\/[^/]+\/messages/).length).toBe(200);
    expect(fake.find("GET", /\/contents\/chats\/[^/]+\/decisions/).length).toBe(200);
  });
});

describe("сообщение из интерфейса", () => {
  const putPath = `${R}/contents/${DIR}/20261023T100203Z-alex011082-m3p8.md`;

  test("один PUT в ветку чата: путь, frontmatter, сообщение коммита", async () => {
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("PUT", /\/contents\/chats\/20261023-k7q2\/messages\//, { status: 201, body: { commit: { sha: "msgcommit", html_url: "https://github.com/c/msgcommit" } } });
    const item = await postMessage(ctx(fake, ["m3p8"]), REPO, CHAT, { text: "Ответ\r\nвторая строка  \n", reply_to: A });
    const put = fake.find("PUT", putPath)[0]!.body;
    expect(put.branch).toBe(BRANCH);
    expect(put.message).toBe(`chat(${CHAT}): alex011082`);
    expect(Buffer.from(put.content, "base64").toString("utf8")).toBe(
      `---\nid: 20261023T100203Z-alex011082-m3p8\nauthor: alex011082\nreply_to: ${A}\ncreated_at: 2026-10-23T10:02:03Z\n---\nОтвет\nвторая строка\n`,
    );
    expect(item).toEqual({
      kind: "message", id: "20261023T100203Z-alex011082-m3p8", author: "alex011082", display: "alex011082", source: "file",
      text: "Ответ\nвторая строка", reply_to: A, created_at: "2026-10-23T10:02:03.000Z", actor: "alex011082",
      commit_sha: "msgcommit", url: "https://github.com/c/msgcommit", pending: false,
    });
  });

  test("голова ветки сдвинулась (409) — повтор", async () => {
    let n = 0;
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("PUT", /\/contents\/chats\/20261023-k7q2\/messages\//, () =>
        ++n < 3 ? { status: 409, body: { message: "is at abc but expected def" } } : { status: 201, body: { commit: { sha: "ok", html_url: "u" } } });
    const item = await postMessage(ctx(fake, ["aaa1", "aaa2", "aaa3"]), REPO, CHAT, { text: "Привет" });
    expect(n).toBe(3);
    expect(item.commit_sha).toBe("ok");
  });

  test("409 четыре раза — ошибка conflict после трёх попыток", async () => {
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("PUT", /\/contents\//, { status: 409, body: { message: "conflict" } });
    expect((await failure(postMessage(ctx(fake), REPO, CHAT, { text: "Привет" }))).code).toBe("conflict");
    expect(fake.find("PUT", /\/contents\//).length).toBe(3);
  });

  test("проверки: пустой текст, слишком длинный, кривой reply_to", async () => {
    const fake = new FakeGitHub().on("GET", R, { body: repoBody() });
    expect((await failure(postMessage(ctx(fake), REPO, CHAT, { text: " \n " }))).code).toBe("bad_request");
    expect((await failure(postMessage(ctx(fake), REPO, CHAT, { text: "я".repeat(60_001) }))).code).toBe("bad_request");
    expect((await failure(postMessage(ctx(fake), REPO, CHAT, { text: "ок", reply_to: "../../etc" }))).code).toBe("bad_request");
    expect((await failure(postMessage(ctx(fake), REPO, CHAT, { text: 5 as any }))).code).toBe("bad_request");
    expect(fake.find("PUT", /./).length).toBe(0);
  });
});

describe("принять PR агента", () => {
  const pull = (extra: object = {}) => ({ number: 9, state: "open", merged: false, base: { ref: BRANCH }, head: { sha: "agenthead" }, ...extra });

  function acceptFake(files: object[], pr = pull()) {
    return new FakeGitHub()
      .on("GET", `${R}/pulls/9`, { body: pr })
      .on("GET", `${R}/pulls/9/files`, { body: files })
      .on("PUT", `${R}/pulls/9/merge`, { body: { sha: "mergesha", merged: true } });
  }

  test("только новые файлы-сообщения этого чата — слияние того самого head", async () => {
    const fake = acceptFake([{ filename: `${DIR}/${G}.md`, status: "added", sha: "s" }]);
    expect(await acceptAgentPr(ctx(fake).gh, REPO, CHAT, 9)).toEqual({ ok: true, merge_sha: "mergesha" });
    expect(fake.find("PUT", `${R}/pulls/9/merge`)[0]!.body).toEqual({ merge_method: "merge", sha: "agenthead" });
  });

  test("в PR есть код или изменение чужого файла — отказ, без слияния", async () => {
    for (const files of [
      [{ filename: `${DIR}/${G}.md`, status: "added", sha: "s" }, { filename: "src/x.ts", status: "added", sha: "s" }],
      [{ filename: `${DIR}/${A}.md`, status: "modified", sha: "s" }],
      [{ filename: `chats/20261023-zzzz/messages/${G}.md`, status: "added", sha: "s" }],
      [],
    ]) {
      const fake = acceptFake(files);
      const err = await failure(acceptAgentPr(ctx(fake).gh, REPO, CHAT, 9));
      expect(err.code).toBe("bad_request");
      expect(fake.find("PUT", /merge/).length).toBe(0);
    }
  });

  test("PR не в ветку чата или уже закрыт — отказ", async () => {
    const files = [{ filename: `${DIR}/${G}.md`, status: "added", sha: "s" }];
    const wrongBase = acceptFake(files, pull({ base: { ref: "main" } }));
    expect((await failure(acceptAgentPr(ctx(wrongBase).gh, REPO, CHAT, 9))).code).toBe("bad_request");
    const closed = acceptFake(files, pull({ state: "closed" }));
    expect((await failure(acceptAgentPr(ctx(closed).gh, REPO, CHAT, 9))).code).toBe("bad_request");
    expect(wrongBase.find("PUT", /merge/).length + closed.find("PUT", /merge/).length).toBe(0);
  });

  test("head сдвинулся между проверкой и слиянием — conflict", async () => {
    let n = 0;
    const fake = acceptFake([{ filename: `${DIR}/${G}.md`, status: "added", sha: "s" }])
      .on("GET", `${R}/pulls/9`, () => ({ body: pull({ head: { sha: ++n === 1 ? "agenthead" : "moved" } }) }));
    expect((await failure(acceptAgentPr(ctx(fake).gh, REPO, CHAT, 9))).code).toBe("conflict");
    expect(fake.find("PUT", /merge/).length).toBe(0);
  });
});

describe("решение в чате", () => {
  const P = "20261023T100203Z-alex011082-d001";
  const PA = "20261023T100204Z-alex011082-a001";

  function decisionFake(opts: { push?: boolean } = {}) {
    return new FakeGitHub()
      .on("GET", R, { body: repoBody(opts.push ?? true) })
      .on("GET", `${R}/git/ref/heads/${BRANCH}`, { body: { object: { sha: "chathead" } } })
      .on("GET", `${R}/git/commits/chathead`, { body: { tree: { sha: "chattree" } } })
      .on("POST", `${R}/git/trees`, { status: 201, body: { sha: "dtree" } })
      .on("POST", `${R}/git/commits`, { status: 201, body: { sha: "dcommit" } })
      .on("PATCH", `${R}/git/refs/heads/${BRANCH}`, { body: { object: { sha: "dcommit" } } })
      .on("GET", `${R}/contents/${DDIR}`, NOT_FOUND);
  }

  test("предложение: один коммит через Git Data API, ветка сдвигается без force", async () => {
    const fake = decisionFake();
    const d = await createDecision(ctx(fake, ["d001"]), REPO, CHAT, {
      title: "  Вакуумные\n руки ", text: "Почему: быстрее.\r\nРиск — вес.  \n", source_messages: [A, "c101"],
    });

    const tree = fake.find("POST", `${R}/git/trees`)[0]!.body;
    expect(tree.base_tree).toBe("chattree");
    expect(tree.tree).toEqual([{
      path: `${DDIR}/${P}.md`, mode: "100644", type: "blob",
      content: `---\nid: ${P}\ndecision: ${P}\naction: propose\nauthor: alex011082\ncreated_at: 2026-10-23T10:02:03Z\ntitle: Вакуумные руки\nsource_messages: ${A}, c101\n---\nПочему: быстрее.\nРиск — вес.\n`,
    }]);
    expect(fake.find("POST", `${R}/git/commits`)[0]!.body).toEqual({ message: `chat(${CHAT}): решение alex011082`, tree: "dtree", parents: ["chathead"] });
    expect(fake.find("PATCH", `${R}/git/refs/heads/${BRANCH}`)[0]!.body).toEqual({ sha: "dcommit", force: false });
    // Без supersedes чужие решения не читаются.
    expect(fake.find("GET", `${R}/contents/${DDIR}`).length).toBe(0);

    expect(d).toEqual({
      id: P, title: "Вакуумные руки", status: "proposed", created_at: "2026-10-23T10:02:03.000Z", created_by: "alex011082",
      source_messages: [A, "c101"], text: "Почему: быстрее.\nРиск — вес.",
      history: [{ id: P, action: "propose", author: "alex011082", created_at: "2026-10-23T10:02:03.000Z", text: "Почему: быстрее.\nРиск — вес." }],
    });
  });

  test("accept: true — предложение и принятие двумя файлами в одном коммите, принятие на секунду позже", async () => {
    const fake = decisionFake();
    const d = await createDecision(ctx(fake, ["d001", "a001"]), REPO, CHAT, { title: "Мост", source_messages: [], accept: true });
    expect(fake.find("POST", `${R}/git/commits`).length).toBe(1);
    const files = fake.find("POST", `${R}/git/trees`)[0]!.body.tree;
    expect(files.map((f: any) => f.path)).toEqual([`${DDIR}/${P}.md`, `${DDIR}/${PA}.md`]);
    expect(files[1].content).toBe(`---\nid: ${PA}\ndecision: ${P}\naction: accept\nauthor: alex011082\ncreated_at: 2026-10-23T10:02:04Z\n---\n\n`);
    expect(d).toMatchObject({ id: P, status: "accepted", decided_by: "alex011082", decided_at: "2026-10-23T10:02:04.000Z" });
    expect(d.history.map((h) => [h.id, h.action, h.author])).toEqual([[P, "propose", "alex011082"], [PA, "accept", "alex011082"]]);
  });

  test("ветку сдвинули (422 not a fast forward) — перечитываем голову и коммитим заново", async () => {
    let heads = 0;
    let patches = 0;
    const fake = decisionFake()
      .on("GET", `${R}/git/ref/heads/${BRANCH}`, () => ({ body: { object: { sha: ++heads === 1 ? "chathead" : "chathead2" } } }))
      .on("GET", `${R}/git/commits/chathead2`, { body: { tree: { sha: "chattree2" } } })
      .on("PATCH", `${R}/git/refs/heads/${BRANCH}`, () =>
        ++patches === 1 ? { status: 422, body: { message: "Update is not a fast forward" } } : { body: { object: { sha: "dcommit" } } });
    const d = await createDecision(ctx(fake, ["d001"]), REPO, CHAT, { title: "Мост", source_messages: [] });
    expect(d.id).toBe(P);
    expect(fake.find("POST", `${R}/git/trees`).map((c) => c.body.base_tree)).toEqual(["chattree", "chattree2"]);
    expect(fake.find("POST", `${R}/git/commits`).map((c) => c.body.parents)).toEqual([["chathead"], ["chathead2"]]);
  });

  test("ветку сдвигают каждый раз — conflict после трёх попыток; другие 422 не повторяются", async () => {
    const busy = decisionFake().on("PATCH", `${R}/git/refs/heads/${BRANCH}`, { status: 422, body: { message: "Update is not a fast forward" } });
    expect((await failure(createDecision(ctx(busy), REPO, CHAT, { title: "Мост", source_messages: [] }))).code).toBe("conflict");
    expect(busy.find("PATCH", /refs/).length).toBe(3);
    const other = decisionFake().on("PATCH", `${R}/git/refs/heads/${BRANCH}`, { status: 422, body: { message: "Object does not exist" } });
    expect((await failure(createDecision(ctx(other), REPO, CHAT, { title: "Мост", source_messages: [] }))).code).toBe("conflict");
    expect(other.find("PATCH", /refs/).length).toBe(1);
  });

  test("supersedes — только существующее решение этого чата", async () => {
    const ok = withDecisions(decisionFake(), CHAT, [dev({ id: D1, action: "propose", title: "Старое" })]);
    const d = await createDecision(ctx(ok, ["d001"]), REPO, CHAT, { title: "Новое", source_messages: [], supersedes: D1 });
    expect(d.supersedes).toBe(D1);
    expect(fake0(ok)).toContain(`supersedes: ${D1}\n`);
    expect(ok.find("GET", `${R}/contents/${DDIR}`)[0]!.url.searchParams.get("ref")).toBe(BRANCH);

    const missing = withDecisions(decisionFake(), CHAT, [dev({ id: D1, action: "propose", title: "Старое" })]);
    const err = await failure(createDecision(ctx(missing), REPO, CHAT, { title: "Новое", source_messages: [], supersedes: "20261023T080000Z-alex011082-none" }));
    expect(err.code).toBe("bad_request");
    expect(err.message).toContain("не найдено");
    expect(missing.find("POST", /./).length).toBe(0);
  });

  test("проверки до GitHub: название, текст, source_messages, supersedes, accept", async () => {
    const fake = decisionFake();
    const ok = { title: "Мост", source_messages: [] as unknown[] };
    for (const bad of [
      { source_messages: [] },
      { ...ok, title: "  " },
      { ...ok, title: 5 },
      { ...ok, title: "x".repeat(161) },
      { ...ok, text: "я".repeat(20_001) },
      { ...ok, text: 5 },
      { ...ok, source_messages: "c1" },
      { ...ok, source_messages: Array.from({ length: 51 }, (_, i) => `c${i}`) },
      { ...ok, source_messages: ["../x"] },
      { ...ok, source_messages: ["a".repeat(65)] },
      { ...ok, source_messages: [5] },
      { ...ok, supersedes: "../x" },
      { ...ok, supersedes: 5 },
      { ...ok, accept: "yes" },
    ]) {
      expect((await failure(createDecision(ctx(fake), REPO, CHAT, bad as any))).code).toBe("bad_request");
    }
    expect(fake.calls.length).toBe(0);
    // Ровно на границах — можно.
    await createDecision(ctx(fake, ["d001"]), REPO, CHAT, { title: "x".repeat(160), text: "я".repeat(20_000), source_messages: Array.from({ length: 50 }, (_, i) => `c${i}`) });
    expect(fake.find("PATCH", /refs/).length).toBe(1);
  });

  test("нет права на запись — forbidden; нет ветки чата — not_found", async () => {
    const ro = decisionFake({ push: false });
    expect((await failure(createDecision(ctx(ro), REPO, CHAT, { title: "Мост", source_messages: [] }))).code).toBe("forbidden");
    expect(ro.find("POST", /./).length).toBe(0);
    const gone = decisionFake().on("GET", `${R}/git/ref/heads/${BRANCH}`, NOT_FOUND);
    const err = await failure(createDecision(ctx(gone), REPO, CHAT, { title: "Мост", source_messages: [] }));
    expect(err.code).toBe("not_found");
    expect(err.message).toContain(BRANCH);
  });

  // Содержимое единственного файла в дереве коммита.
  function fake0(fake: FakeGitHub): string {
    return fake.find("POST", `${R}/git/trees`)[0]!.body.tree[0].content;
  }
});

describe("действие с решением", () => {
  const EV = "20261023T100203Z-alex011082-e001";
  const putPath = `${R}/contents/${DDIR}/${EV}.md`;
  const propose = dev({ id: D1, action: "propose", title: "Вакуумные руки" });
  const at = (hhmmss: string) => `2026-10-23T${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}.000Z`;
  const human = (action: DecisionEvent["action"], hhmmss: string, decision = D1) =>
    dev({ id: `20261023T${hhmmss}Z-alex011082-${action.slice(0, 1)}${hhmmss.slice(3)}`, decision, action, created_at: at(hhmmss) });

  function actionFake(events: DecisionEvent[], opts: { push?: boolean } = {}) {
    return withDecisions(new FakeGitHub(), CHAT, events)
      .on("GET", R, { body: repoBody(opts.push ?? true) })
      .on("PUT", /\/contents\/chats\/20261023-k7q2\/decisions\//, { status: 201, body: { commit: { sha: "evcommit", html_url: "https://github.com/c/evcommit" } } });
  }

  test("accept: один PUT в ветку чата, автор — логин человека; решение свёрнуто заново", async () => {
    const fake = actionFake([propose]);
    const d = await decisionAction(ctx(fake, ["e001"]), REPO, CHAT, D1, "accept", { text: " Берём. " });
    const put = fake.find("PUT", putPath)[0]!.body;
    expect(put.branch).toBe(BRANCH);
    expect(put.message).toBe(`chat(${CHAT}): accept решения alex011082`);
    expect(Buffer.from(put.content, "base64").toString("utf8")).toBe(
      `---\nid: ${EV}\ndecision: ${D1}\naction: accept\nauthor: alex011082\ncreated_at: 2026-10-23T10:02:03Z\n---\nБерём.\n`,
    );
    expect(fake.find("GET", `${R}/contents/${DDIR}`)[0]!.url.searchParams.get("ref")).toBe(BRANCH);
    expect(d).toMatchObject({ id: D1, status: "accepted", decided_by: "alex011082", decided_at: "2026-10-23T10:02:03.000Z" });
    expect(d.history.at(-1)).toEqual({ id: EV, action: "accept", author: "alex011082", created_at: "2026-10-23T10:02:03.000Z", text: "Берём." });
  });

  test("reject, discuss и reopen меняют статус как в протоколе", async () => {
    expect((await decisionAction(ctx(actionFake([propose]), ["e001"]), REPO, CHAT, D1, "reject", {})).status).toBe("rejected");
    expect((await decisionAction(ctx(actionFake([propose]), ["e001"]), REPO, CHAT, D1, "discuss", { text: "А вес?" })).status).toBe("under_discussion");
    const accepted = [propose, human("accept", "091000")];
    expect((await decisionAction(ctx(actionFake(accepted), ["e001"]), REPO, CHAT, D1, "reopen", {})).status).toBe("reopened");
  });

  test("бессмысленный переход — 409 с причиной, ничего не пишется", async () => {
    const D3 = "20261023T092000Z-alex011082-d003";
    const superseded = [
      propose, human("accept", "091000"),
      dev({ id: D3, action: "propose", title: "Мост", supersedes: D1, created_at: at("092000") }), human("accept", "093000", D3),
    ];
    const cases: [DecisionEvent[], "accept" | "reject" | "reopen" | "discuss", RegExp][] = [
      [[propose, human("accept", "091000")], "accept", /уже принято/],
      [[propose, human("reject", "091000")], "reject", /уже отклонено/],
      [[propose, human("reject", "091000")], "accept", /откройте/],
      [[propose, human("accept", "091000")], "reject", /откройте/],
      [[propose], "reopen", /открыто/],
      [[propose, human("discuss", "091000")], "reopen", /открыто/],
      [superseded, "accept", /заменено/],
      [superseded, "reject", /заменено/],
      [superseded, "discuss", /заменено/],
    ];
    for (const [events, action, reason] of cases) {
      const fake = actionFake(events);
      const err = await failure(decisionAction(ctx(fake), REPO, CHAT, D1, action, { text: "x" }));
      expect([action, err.status, err.code]).toEqual([action, 409, "conflict"]);
      expect(err.message).toMatch(reason);
      expect(fake.find("PUT", /./).length).toBe(0);
    }
    expect((await decisionAction(ctx(actionFake(superseded), ["e001"]), REPO, CHAT, D1, "reopen", {})).status).toBe("reopened");
  });

  const P0 = "20261023T100203Z-alex011082-d000";
  const P0A = "20261023T100204Z-alex011082-a000";

  test("событие встаёт после последнего события решения, даже если часы отстают", async () => {
    // Принятие из «создать и принять» стоит на секунду впереди часов сервера.
    const fake = actionFake([dev({ id: P0, action: "propose", title: "Т", created_at: at("100203") }), dev({ id: P0A, decision: P0, action: "accept", created_at: at("100204") })]);
    const d = await decisionAction(ctx(fake, ["e001"]), REPO, CHAT, P0, "reopen", {});
    expect(d.status).toBe("reopened");
    expect(fake.find("PUT", `${R}/contents/${DDIR}/20261023T100205Z-alex011082-e001.md`).length).toBe(1);
  });
  test("решения нет — 404; кривой id и действие, пустое обсуждение — 400 до записи", async () => {
    const fake = actionFake([propose]);
    expect((await failure(decisionAction(ctx(fake), REPO, CHAT, "20261023T080000Z-alex011082-none", "accept", {}))).code).toBe("not_found");
    for (const [id, action, body] of [
      ["../x", "accept", {}],
      [D1, "delete", {}],
      [D1, "discuss", {}],
      [D1, "discuss", { text: "  " }],
      [D1, "accept", { text: "я".repeat(20_001) }],
      [D1, "accept", { text: 5 }],
    ] as const) {
      expect((await failure(decisionAction(ctx(fake), REPO, CHAT, id, action as any, body as any))).code).toBe("bad_request");
    }
    expect(fake.find("PUT", /./).length).toBe(0);
  });

  test("логин совпадает с id агента — его accept/reject статус не изменят, поэтому отказ; обсуждать можно", async () => {
    const fake = actionFake([propose]);
    const err = await failure(decisionAction(ctx(fake, ["e001"], "Claude"), REPO, CHAT, D1, "accept", {}));
    expect(err.code).toBe("forbidden");
    expect(fake.find("PUT", /./).length).toBe(0);
    const d = await decisionAction(ctx(fake, ["e001"], "Claude"), REPO, CHAT, D1, "discuss", { text: "Мнение." });
    expect(d.history.at(-1)).toMatchObject({ action: "discuss", author: "claude" });
  });

  test("голова ветки сдвинулась (409) — повтор с новым id; нет права на запись — forbidden", async () => {
    let n = 0;
    const fake = actionFake([propose]).on("PUT", /\/contents\/chats\/20261023-k7q2\/decisions\//, () =>
      ++n < 2 ? { status: 409, body: { message: "is at abc but expected def" } } : { status: 201, body: { commit: { sha: "ok", html_url: "u" } } });
    await decisionAction(ctx(fake, ["e001", "e002"]), REPO, CHAT, D1, "accept", {});
    expect(fake.find("PUT", /./).map((c) => c.url.pathname.split("/").pop())).toEqual(["20261023T100203Z-alex011082-e001.md", "20261023T100203Z-alex011082-e002.md"]);
    const ro = actionFake([propose], { push: false });
    expect((await failure(decisionAction(ctx(ro), REPO, CHAT, D1, "accept", {}))).code).toBe("forbidden");
    expect(ro.find("PUT", /./).length).toBe(0);
  });
});

describe("предложить родителю", () => {
  const PARENT = { chat_id: CHAT, message_id: C, commit_sha: S2 };
  const EV = "20261023T100203Z-alex011082-p001";
  const putPath = `${R}/contents/${DDIR}/${EV}.md`;
  const forkMsg = "20261023T110500Z-bob-x1y2";

  function proposeFake(opts: { chatJson?: object | null; pr?: object | null; push?: boolean } = {}) {
    const meta = { schema_version: 1, chat_id: CHILD, title: "Ветка 7", created_at: "2026-10-23T11:00:00Z", created_by: "bob", parent: PARENT };
    const chatJson = opts.chatJson === undefined ? meta : opts.chatJson;
    return new FakeGitHub()
      .on("GET", R, { body: repoBody(opts.push ?? true) })
      .on("GET", `${R}/contents/chats/${CHILD}/chat.json`, chatJson ? { body: { content: b64(JSON.stringify(chatJson)) } } : NOT_FOUND)
      .on("GET", /\/pulls\?state=all&head=Alex011082%3Achat%2F20261023-m2p9/, { body: opts.pr === undefined ? [childPr(7, PARENT)] : opts.pr ? [opts.pr] : [] })
      .on("GET", `${R}/contents/${DDIR}`, NOT_FOUND)
      .on("PUT", /\/contents\/chats\/20261023-k7q2\/decisions\//, { status: 201, body: { commit: { sha: "pcommit", html_url: "u" } } });
  }

  test("событие propose с from_chat пишется в ветку и папку решений родителя", async () => {
    const fake = proposeFake();
    const d = await proposeToParent(ctx(fake, ["p001"]), REPO, CHILD, { title: "Мост", text: "11 коробок в минуту.", source_messages: [forkMsg] });
    const put = fake.find("PUT", putPath)[0]!.body;
    expect(put.branch).toBe(BRANCH);
    expect(put.message).toBe(`chat(${CHAT}): предложение из Fork ${CHILD}`);
    expect(Buffer.from(put.content, "base64").toString("utf8")).toBe(
      `---\nid: ${EV}\ndecision: ${EV}\naction: propose\nauthor: alex011082\ncreated_at: 2026-10-23T10:02:03Z\ntitle: Мост\nsource_messages: ${forkMsg}\nfrom_chat: ${CHILD}\n---\n11 коробок в минуту.\n`,
    );
    // Родитель — из chat.json Fork на его ветке; список PR не нужен.
    expect(fake.find("GET", `${R}/contents/chats/${CHILD}/chat.json`)[0]!.url.searchParams.get("ref")).toBe(CHILD_BRANCH);
    expect(fake.find("GET", /\/pulls\?/).length).toBe(0);
    expect(d).toEqual({
      id: EV, title: "Мост", status: "proposed", created_at: "2026-10-23T10:02:03.000Z", created_by: "alex011082",
      source_messages: [forkMsg], from_chat: CHILD, text: "11 коробок в минуту.",
      history: [{ id: EV, action: "propose", author: "alex011082", created_at: "2026-10-23T10:02:03.000Z", text: "11 коробок в минуту." }],
    });
  });

  test("нет chat.json — родитель из тела PR", async () => {
    const fake = proposeFake({ chatJson: null });
    const d = await proposeToParent(ctx(fake, ["p001"]), REPO, CHILD, { title: "Мост", text: "", source_messages: [] });
    expect(d.from_chat).toBe(CHILD);
    expect(fake.find("PUT", putPath).length).toBe(1);
  });

  test("не Fork — 400, ничего не пишется; чата нет — 404", async () => {
    const plain = proposeFake({ chatJson: { schema_version: 1, chat_id: CHILD, title: "Т", created_at: "2026-10-23T11:00:00Z", created_by: "bob", parent: null }, pr: chatPr({ number: 7, head: { ref: CHILD_BRANCH, sha: "x", repo: { full_name: "Alex011082/chat.0110" } }, body: `<!-- chat0110\nchat_id: ${CHILD}\n-->` }) });
    const err = await failure(proposeToParent(ctx(plain), REPO, CHILD, { title: "Мост", text: "", source_messages: [] }));
    expect(err.code).toBe("bad_request");
    expect(err.message).toBe("Это не Fork — предлагать некому");
    expect(plain.find("PUT", /./).length).toBe(0);
    const none = proposeFake({ chatJson: null, pr: null });
    expect((await failure(proposeToParent(ctx(none), REPO, CHILD, { title: "Мост", text: "", source_messages: [] }))).code).toBe("not_found");
  });

  test("supersedes — решение родителя, а не Fork", async () => {
    const ok = withDecisions(proposeFake(), CHAT, [dev({ id: D1, action: "propose", title: "Старое" })]);
    const d = await proposeToParent(ctx(ok, ["p001"]), REPO, CHILD, { title: "Мост", text: "", source_messages: [], supersedes: D1 });
    expect(d.supersedes).toBe(D1);
    expect(ok.find("GET", `${R}/contents/${DDIR}`)[0]!.url.searchParams.get("ref")).toBe(BRANCH);
    const missing = proposeFake();
    expect((await failure(proposeToParent(ctx(missing), REPO, CHILD, { title: "Мост", text: "", source_messages: [], supersedes: D1 }))).code).toBe("bad_request");
    expect(missing.find("PUT", /./).length).toBe(0);
  });

  test("проверки до GitHub; нет права на запись — forbidden", async () => {
    const fake = proposeFake();
    for (const bad of [
      { text: "", source_messages: [] },
      { title: "x".repeat(161), text: "", source_messages: [] },
      { title: "Мост", text: "я".repeat(20_001), source_messages: [] },
      { title: "Мост", text: "", source_messages: ["../x"] },
      { title: "Мост", text: "", source_messages: [], supersedes: "x" },
    ]) {
      expect((await failure(proposeToParent(ctx(fake), REPO, CHILD, bad as any))).code).toBe("bad_request");
    }
    expect(fake.calls.length).toBe(0);
    const ro = proposeFake({ push: false });
    expect((await failure(proposeToParent(ctx(ro), REPO, CHILD, { title: "Мост", text: "", source_messages: [] }))).code).toBe("forbidden");
    expect(ro.find("PUT", /./).length).toBe(0);
  });
});
