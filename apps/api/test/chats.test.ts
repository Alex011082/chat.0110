import { describe, expect, test } from "bun:test";
import { buildPrBody, parseMessageFile, parsePrBody } from "@chat0110/chat-protocol";
import { CHATS_AGENTS_MD } from "../src/agents-md.ts";
import { acceptAgentPr, createChat, forkChat, getGraph, getTimeline, listChats, postMessage, type ChatCtx } from "../src/chats.ts";
import { HttpError } from "../src/errors.ts";
import { GitHubClient, createCaches } from "../src/github.ts";
import { FakeGitHub, b64 } from "./fake-github.ts";

const R = "/repos/Alex011082/chat.0110";
const REPO = { owner: "Alex011082", name: "chat.0110" };
const CHAT = "20261023-k7q2";
const BRANCH = `chat/${CHAT}`;
const DIR = `chats/${CHAT}/messages`;
const A = "20261023T100300Z-alex011082-q9w1";
const C = "20261023T101400Z-claude-x7k2";
const G = "20261023T103000Z-codex-g7g7";
const NOW = new Date("2026-10-23T10:02:03.456Z");

const repoBody = (push = true) => ({
  full_name: "Alex011082/chat.0110", name: "chat.0110", owner: { login: "Alex011082" }, private: false, default_branch: "main", permissions: { push },
});

function ctx(fake: FakeGitHub, rands: string[] = []): ChatCtx {
  let i = 0;
  return {
    gh: new GitHubClient({ token: "ghu", userId: 7, fetch: fake.fetch, caches: createCaches() }),
    user: { login: "Alex011082", id: 7 },
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
      .on("GET", /\/pulls\?state=all&sort=updated/, { body: [chatPr()] });
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
      .on("GET", `${R}/contents/chats/${CHILD}/chat.json`, chatJson ? { body: { content: b64(JSON.stringify(chatJson)) } } : { status: 404, body: { message: "Not Found" } })
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
      items: [
        { kind: "message", id: A, author: "alex011082", display: "alex011082", source: "file", text: "Нужны варианты.", created_at: "2026-10-23T10:03:00.000Z", pending: false },
        { kind: "message", id: C, author: "claude", display: "Claude", source: "file", text: "Вакуум.", reply_to: A, created_at: "2026-10-23T10:14:00.000Z", pending: false },
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

  test("нет chat.json — родитель из тела PR; PR родителя не найден — номер null, название = id", async () => {
    const fake = childFake({ chatJson: null, list: [childPr(7, PARENT)] });
    const res = await getTimeline(ctx(fake).gh, REPO, CHILD);
    expect(res.chat.meta).toBeNull();
    expect(res.inherited).toMatchObject({ chat_id: CHAT, title: CHAT, number: null, message_id: C, commit_sha: S2 });
    expect(res.inherited?.items.length).toBe(2);
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
    expect(Object.keys(byPath).sort()).toEqual([`chats/${CHILD}/chat.json`, `chats/${CHILD}/messages/${M}.md`, "chats/CLAUDE.md"].sort());
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
      .on("GET", `${R}/contents/chats/20261023-gone/messages`, { status: 404, body: { message: "Not Found" } });
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

  test("не больше 6 листингов разом", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `20261023-g${String(i).padStart(3, "0")}`);
    let inflight = 0;
    let peak = 0;
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", /\/pulls\?state=all&sort=updated/, {
        body: ids.map((id, i) => chatPr({ number: 100 + i, head: { ref: `chat/${id}`, sha: "x", repo: { full_name: "Alex011082/chat.0110" } }, body: `<!-- chat0110\nchat_id: ${id}\n-->` })),
      })
      .on("GET", /\/contents\/chats\/20261023-g\d{3}\/messages/, async () => {
        peak = Math.max(peak, ++inflight);
        await Bun.sleep(5);
        inflight--;
        return { body: [] };
      });
    const res = await getGraph(ctx(fake).gh, REPO);
    expect(res.chats.length).toBe(10);
    expect(peak).toBe(6);
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
      .on("GET", /\/contents\/chats\/[^/]+\/messages/, { body: [] });
    const res = await getGraph(ctx(fake).gh, REPO);
    expect(res.chats.length).toBe(200);
    expect(res.chats[0]!.chat_id).toBe(id(n - 1));
    expect(res.chats.some((c) => c.chat_id === id(0))).toBe(false);
    expect(fake.find("GET", /\/contents\//).length).toBe(200);
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
