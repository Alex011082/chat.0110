import { describe, expect, test } from "bun:test";
import { PROTOCOL_JSON, SCAFFOLD } from "@chat0110/chat-protocol";
import { activateChat, activationStatus } from "../src/activate.ts";
import { createChat, createDecision } from "../src/chats.ts";
import { GitHubClient, createCaches } from "../src/github.ts";
import { FakeGitHub, b64 } from "./fake-github.ts";

const R = "/repos/Alex011082/checkaboutme";
const REPO = { owner: "Alex011082", name: "checkaboutme" };
const repoBody = (push = true) => ({
  full_name: "Alex011082/checkaboutme",
  name: "checkaboutme",
  owner: { login: "Alex011082" },
  private: true,
  default_branch: "main",
  permissions: { push },
});
const file = (text: string) => ({ body: { content: b64(text), encoding: "base64" } });
const NOT_FOUND = { status: 404, body: { message: "Not Found" } };

function client(fake: FakeGitHub): GitHubClient {
  return new GitHubClient({ token: "ghu", userId: 7, fetch: fake.fetch, caches: createCaches() });
}

function ctx(fake: FakeGitHub) {
  return {
    gh: client(fake),
    user: { login: "Alex011082", id: 7 },
    now: () => new Date("2026-10-26T12:00:03.000Z"),
    rand: () => "ab12",
  };
}

function bare(): FakeGitHub {
  const fake = new FakeGitHub()
    .on("GET", R, { body: repoBody() })
    .on("GET", `${R}/git/ref/heads/main`, { body: { object: { sha: "head" } } })
    .on("GET", `${R}/git/commits/head`, { body: { tree: { sha: "tree" } } })
    .on("GET", `${R}/contents/chats`, NOT_FOUND)
    .on("POST", `${R}/git/trees`, { status: 201, body: { sha: "newtree" } })
    .on("POST", `${R}/git/commits`, { status: 201, body: { sha: "newcommit" } })
    .on("PATCH", `${R}/git/refs/heads/main`, { body: {} });
  for (const item of SCAFFOLD) fake.on("GET", `${R}/contents/${item.path}`, NOT_FOUND);
  return fake;
}

describe("подключение репозитория", () => {
  test("первое подключение дописывает каркас и не трогает README", async () => {
    const fake = bare();
    const status = await activationStatus(client(fake), REPO);
    expect(status.activated).toBe(false);
    expect(status.agents_doc).toBe(false);
    expect(status.legacy_chats).toBe(false);
    expect(status.gaps).toContain("Chat/AGENTS.md");

    const done = await activateChat(client(fake), REPO);
    expect(done.created).toContain("Chat/AGENTS.md");
    expect(done.created).not.toContain("Chat/README.md");
    expect(done.activated).toBe(true);
    const tree = fake.find("POST", `${R}/git/trees`)[0]!.body.tree.map((e: { path: string }) => e.path);
    expect(tree).toContain("Chat/AGENTS.md");
    expect(tree.some((p: string) => p.startsWith("src/") || p === "Chat/README.md")).toBe(false);
    expect(fake.find("POST", `${R}/git/commits`)[0]!.body.message).toBe("chat0110: подключить каталог Chat");
  });

  test("повторное подключение не создаёт второй коммит", async () => {
    const fake = bare();
    for (const item of SCAFFOLD) fake.on("GET", `${R}/contents/${item.path}`, file(item.content));
    const done = await activateChat(client(fake), REPO);
    expect(done.created).toEqual([]);
    expect(done.activated).toBe(true);
    expect(fake.find("POST", `${R}/git/trees`).length).toBe(0);
  });

  test("свой AGENTS.md остаётся, protocol.json дописывается", async () => {
    const fake = bare().on("GET", `${R}/contents/Chat/AGENTS.md`, file("# свой\n"));
    const done = await activateChat(client(fake), REPO);
    const tree = fake.find("POST", `${R}/git/trees`)[0]!.body.tree.map((e: { path: string }) => e.path);
    expect(tree).not.toContain("Chat/AGENTS.md");
    expect(tree).toContain("Chat/protocol.json");
    expect(done.agents_doc).toBe(true);
  });

  test("старая папка chats/ только отмечается", async () => {
    const fake = bare().on("GET", `${R}/contents/chats`, { body: [{ type: "dir", name: "20261023-test" }] });
    const status = await activationStatus(client(fake), REPO);
    expect(status.legacy_chats).toBe(true);
    await activateChat(client(fake), REPO);
    const tree = fake.find("POST", `${R}/git/trees`)[0]!.body.tree.map((e: { path: string }) => e.path);
    expect(tree.some((p: string) => p.startsWith("chats/"))).toBe(false);
  });

  test("без права записи файлы не создаются", async () => {
    const fake = bare().on("GET", R, { body: repoBody(false) });
    await expect(activateChat(client(fake), REPO)).rejects.toMatchObject({ code: "forbidden" });
    expect(fake.find("POST", `${R}/git/trees`).length).toBe(0);
  });
});

describe("подключённый репозиторий", () => {
  test("новый чат пишется в Chat/conversations и ссылается на AGENTS.md", async () => {
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", `${R}/git/ref/heads/main`, { body: { object: { sha: "mainhead" } } })
      .on("GET", `${R}/git/commits/mainhead`, { body: { tree: { sha: "maintree" } } })
      .on("GET", `${R}/contents/Chat/protocol.json`, file(PROTOCOL_JSON))
      .on("GET", `${R}/contents/Chat/AGENTS.md`, file("# есть\n"))
      .on("GET", `${R}/contents/Chat/CLAUDE.md`, file("@AGENTS.md\n"))
      .on("POST", `${R}/git/trees`, { status: 201, body: { sha: "newtree" } })
      .on("POST", `${R}/git/commits`, { status: 201, body: { sha: "newcommit" } })
      .on("POST", `${R}/git/refs`, { status: 201, body: {} })
      .on("POST", `${R}/pulls`, {
        status: 201,
        body: {
          number: 3, title: "Проверка", draft: true, state: "open", html_url: "https://github.com/pull/3",
          created_at: "2026-10-26T12:00:04Z", updated_at: "2026-10-26T12:00:04Z", user: { login: "Alex011082" },
        },
      })
      .on("POST", `${R}/labels`, { status: 201, body: {} })
      .on("POST", `${R}/issues/3/labels`, { body: [] });
    await createChat(ctx(fake), REPO, { title: "Проверка" });
    const paths = fake.find("POST", `${R}/git/trees`)[0]!.body.tree.map((e: { path: string }) => e.path);
    expect(paths).toEqual(["Chat/conversations/20261026-ab12/chat.json"]);
    const body = fake.find("POST", `${R}/pulls`)[0]!.body.body as string;
    expect(body).toContain("Chat/AGENTS.md");
    expect(body).toContain("schema_version: 2");
    expect(body).not.toContain("chats/");
  });

  test("решение в подключённом репозитории отклоняется", async () => {
    const branch = "chat/20261026-ab12";
    const fake = new FakeGitHub()
      .on("GET", R, { body: repoBody() })
      .on("GET", `${R}/contents/Chat/protocol.json`, file(PROTOCOL_JSON));
    await expect(createDecision(ctx(fake), REPO, "20261026-ab12", { title: "Мост", source_messages: [] })).rejects.toMatchObject({ code: "forbidden" });
    expect(fake.find("PATCH", /./).length).toBe(0);
    expect(fake.find("PUT", /./).length).toBe(0);
    expect(branch).toBe("chat/20261026-ab12");
  });
});
