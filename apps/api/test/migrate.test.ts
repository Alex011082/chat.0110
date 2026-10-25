import { describe, expect, test } from "bun:test";
import { PROTOCOL_JSON, SCAFFOLD } from "@chat0110/chat-protocol";
import { HttpError } from "../src/errors.ts";
import { GitHubClient, createCaches } from "../src/github.ts";
import { migrateChats, migrationStatus } from "../src/migrate.ts";
import { FakeGitHub, b64 } from "./fake-github.ts";

const R = "/repos/Alex011082/chat.0110";
const REPO = { owner: "Alex011082", name: "chat.0110" };
const CHAT = "20261023-k7q2";
const BRANCH = `chat/${CHAT}`;
const A = "20261023T100300Z-alex011082-q9w1";
const MSG = `---\nid: ${A}\nauthor: alex011082\ncreated_at: 2026-10-23T10:03:00Z\n---\nпривет\n`;
const JSON = `{\n  "schema_version": 1,\n  "chat_id": "${CHAT}",\n  "title": "Тест",\n  "created_at": "2026-10-23T10:02:00Z",\n  "created_by": "alex011082",\n  "parent": {\n    "chat_id": "20261023-test",\n    "message_id": "20261023T032640Z-alex011082-vuk8",\n    "commit_sha": "${"a".repeat(40)}"\n  }\n}\n`;
const PR_BODY = `Обсуждение\n\n<!-- chat0110\nchat_id: ${CHAT}\nschema_version: 1\n-->\n`;

const file = (text: string) => ({ body: { content: b64(text), encoding: "base64" } });
const NOT_FOUND = { status: 404, body: { message: "Not Found" } };

function client(fake: FakeGitHub): GitHubClient {
  return new GitHubClient({ token: "ghu", userId: 7, fetch: fake.fetch, caches: createCaches() });
}

const repoBody = (push = true) => ({
  full_name: "Alex011082/chat.0110",
  name: "chat.0110",
  owner: { login: "Alex011082" },
  private: false,
  default_branch: "main",
  permissions: { push },
});

function pull() {
  return {
    number: 5,
    title: "Тест",
    body: PR_BODY,
    state: "open",
    draft: true,
    html_url: "https://github.com/Alex011082/chat.0110/pull/5",
    created_at: "2026-10-23T10:02:00Z",
    updated_at: "2026-10-23T10:40:00Z",
    user: { login: "Alex011082" },
    head: { ref: BRANCH, sha: "headsha", repo: { full_name: "Alex011082/chat.0110" } },
    base: { ref: "main" },
  };
}

function legacy(fake: FakeGitHub): FakeGitHub {
  fake
    .on("GET", R, { body: repoBody() })
    .on("GET", /\/pulls\?state=all&sort=updated/, { body: [pull()] })
    .on("GET", `${R}/git/ref/heads/${BRANCH}`, { body: { object: { sha: "head" } } })
    .on("GET", `${R}/git/commits/head`, { body: { tree: { sha: "tree" } } })
    .on("GET", `${R}/contents/chats/${CHAT}/chat.json`, file(JSON))
    .on("GET", `${R}/contents/chats/${CHAT}/messages`, {
      body: [{ type: "file", name: `${A}.md`, path: `chats/${CHAT}/messages/${A}.md`, sha: "blob-msg" }],
    })
    .on("GET", `${R}/contents/chats/${CHAT}/decisions`, NOT_FOUND)
    .on("GET", `${R}/git/blobs/blob-msg`, { body: { content: b64(MSG), encoding: "base64" } })
    .on("POST", `${R}/git/trees`, { status: 201, body: { sha: "newtree" } })
    .on("POST", `${R}/git/commits`, { status: 201, body: { sha: "newcommit" } })
    .on("PATCH", `${R}/git/refs/heads/${BRANCH}`, { body: {} });
  for (const item of SCAFFOLD) fake.on("GET", `${R}/contents/${item.path}`, NOT_FOUND);
  fake.on("GET", `${R}/contents/Chat/conversations/${CHAT}/chat.json`, NOT_FOUND);
  fake.on("GET", `${R}/contents/Chat/conversations/${CHAT}/messages/${A}.md`, NOT_FOUND);
  return fake;
}

describe("перенос чатов", () => {
  test("копирует чат в Chat/ и не трогает PR", async () => {
    const fake = legacy(new FakeGitHub());
    const before = await migrationStatus(client(fake), REPO);
    expect(before.items.map((item) => item.status)).toEqual(["pending"]);
    expect(before.items[0]!.created).toEqual([]);

    const done = await migrateChats(client(fake), REPO);
    expect(done.items[0]!.status).toBe("migrated");
    expect(done.items[0]!.number).toBe(5);
    expect(done.items[0]!.url).toBe("https://github.com/Alex011082/chat.0110/pull/5");
    const tree = fake.find("POST", `${R}/git/trees`)[0]!.body.tree as { path: string; content: string }[];
    const paths = tree.map((entry) => entry.path);
    expect(paths).toContain(`Chat/conversations/${CHAT}/chat.json`);
    expect(paths).toContain(`Chat/conversations/${CHAT}/messages/${A}.md`);
    expect(paths).toContain("Chat/protocol.json");
    expect(paths.every((path) => path.startsWith("Chat/"))).toBe(true);
    expect(paths.some((path) => path.startsWith("chats/") || path.includes("20261023-test"))).toBe(false);
    expect(tree.find((entry) => entry.path.endsWith("chat.json"))!.content).toBe(JSON);
    expect(tree.find((entry) => entry.path.endsWith(`${A}.md`))!.content).toBe(MSG);
    expect(fake.find("POST", `${R}/git/commits`)[0]!.body.message).toBe(`chat0110: перенести чат ${CHAT} в Chat/`);
    expect(fake.find("POST", `${R}/git/commits`)[0]!.body.parents).toEqual(["head"]);
    expect(fake.find("PATCH", `${R}/git/refs/heads/${BRANCH}`)[0]!.body.force).toBe(false);
    expect(fake.find("PATCH", /\/pulls\//).length).toBe(0);
    expect(fake.calls.some((call) => call.method === "PATCH" && call.url.pathname.includes("/pulls"))).toBe(false);
  });

  test("повторный перенос не создаёт второй коммит", async () => {
    const fake = legacy(new FakeGitHub());
    fake.on("GET", `${R}/contents/Chat/conversations/${CHAT}/chat.json`, file(JSON));
    fake.on("GET", `${R}/contents/Chat/conversations/${CHAT}/messages/${A}.md`, file(MSG));
    for (const item of SCAFFOLD) fake.on("GET", `${R}/contents/${item.path}`, file(item.content));
    const done = await migrateChats(client(fake), REPO);
    expect(done.items[0]!.status).toBe("migrated");
    expect(done.items[0]!.created).toEqual([]);
    expect(fake.find("POST", `${R}/git/trees`).length).toBe(0);
  });

  test("другая копия останавливает запись", async () => {
    const fake = legacy(new FakeGitHub());
    fake.on("GET", `${R}/contents/Chat/conversations/${CHAT}/messages/${A}.md`, file("другой\n"));
    const done = await migrateChats(client(fake), REPO);
    expect(done.items[0]!.status).toBe("conflict");
    expect(done.items[0]!.conflicts).toContain(`Chat/conversations/${CHAT}/messages/${A}.md`);
    expect(fake.find("POST", `${R}/git/trees`).length).toBe(0);
  });

  test("без права записи коммита нет", async () => {
    const fake = new FakeGitHub().on("GET", R, { body: repoBody(false) });
    const err = await migrateChats(client(fake), REPO).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe("forbidden");
    expect(fake.find("POST", `${R}/git/trees`).length).toBe(0);
  });

  test("старый коммит читается из chats/, голова после маркера — из Chat/", async () => {
    const fake = new FakeGitHub()
      .on("GET", /\/contents\/Chat\/protocol\.json/, (call) => (
        call.url.searchParams.get("ref") === "oldsha" ? NOT_FOUND : file(PROTOCOL_JSON)
      ))
      .on("GET", `${R}/contents/chats/${CHAT}/messages`, {
        body: [{ type: "file", name: `${A}.md`, path: `chats/${CHAT}/messages/${A}.md`, sha: "old-blob" }],
      })
      .on("GET", `${R}/contents/Chat/conversations/${CHAT}/messages`, (call) => (
        call.url.searchParams.get("ref") === "oldsha"
          ? NOT_FOUND
          : { body: [{ type: "file", name: `${A}.md`, path: `Chat/conversations/${CHAT}/messages/${A}.md`, sha: "new-blob" }] }
      ))
      .on("GET", `${R}/git/blobs/old-blob`, { body: { content: b64(MSG), encoding: "base64" } })
      .on("GET", `${R}/git/blobs/new-blob`, { body: { content: b64(MSG), encoding: "base64" } });
    const gh = client(fake);
    expect(await gh.getMessageFilesAt(REPO, CHAT, "oldsha")).toEqual([{ name: `${A}.md`, content: MSG }]);
    const head = await gh.listMessageFiles(REPO, CHAT, BRANCH);
    expect(head.map((entry) => entry.name)).toEqual([`${A}.md`]);
    expect(await gh.getBlob(REPO, head[0]!.sha)).toBe(MSG);
    expect(head[0]!.path.startsWith("Chat/conversations/")).toBe(true);
  });
});
