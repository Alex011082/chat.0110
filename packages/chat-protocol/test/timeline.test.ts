import { describe, expect, test } from "bun:test";
import { buildTimeline, type TimelineInput } from "../src/timeline.ts";

const CHAT = "20261023-k7q2";
const dir = `chats/${CHAT}/messages`;
const A = "20261023T100300Z-alex011082-q9w1";
const C = "20261023T101400Z-claude-x7k2";

function input(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    chatId: CHAT,
    files: [],
    commits: [],
    comments: [],
    reviews: [],
    reviewComments: [],
    agentPrs: [],
    ...over,
  };
}

const fileA = { name: `${A}.md`, content: `---\nid: ${A}\nauthor: alex011082\ncreated_at: 2026-10-23T10:03:00Z\n---\nНужны варианты захвата.` };
const fileC = { name: `${C}.md`, content: `---\nid: ${C}\nauthor: claude\nreply_to: ${A}\ncreated_at: 2026-10-23T10:14:00Z\n---\nВакуумные руки.` };

describe("лента чата", () => {
  test("файлы-сообщения по времени, с тем, кто запушил", () => {
    const items = buildTimeline(input({
      files: [fileC, fileA],
      commits: [
        { sha: "c1", message: "chat: создан", login: "Alex011082", name: "Alex", date: "2026-10-23T10:02:00Z", added: [`chats/${CHAT}/chat.json`, `${dir}/${A}.md`], url: "u1" },
        { sha: "c2", message: `chat(${CHAT}): claude`, login: "Alex011082", name: "Alex", date: "2026-10-23T10:15:00Z", added: [`${dir}/${C}.md`], url: "u2" },
      ],
    }));
    const messages = items.filter((i) => i.kind === "message");
    expect(messages.map((m) => m.id)).toEqual([A, C]);
    expect(messages[1]).toMatchObject({
      author: "claude",
      display: "Claude",
      source: "file",
      reply_to: A,
      actor: "alex011082",
      commit_sha: "c2",
      text: "Вакуумные руки.",
    });
  });

  test("коммит, создавший чат, — событие created", () => {
    const items = buildTimeline(input({
      commits: [{ sha: "c1", message: "chat: создан", login: "Alex011082", name: "Alex", date: "2026-10-23T10:02:00Z", added: [`chats/${CHAT}/chat.json`], url: "u1" }],
    }));
    expect(items).toEqual([{ kind: "created", id: "c1", actor: "alex011082", created_at: "2026-10-23T10:02:00.000Z", url: "u1" }]);
  });

  test("коммит без сообщений — событие push с автором-агентом", () => {
    const items = buildTimeline(input({
      commits: [{ sha: "c3", message: "calc: оценка\n\nподробности", login: "chatgpt-codex-connector[bot]", name: "Codex", date: "2026-10-23T10:21:00Z", added: ["chats/x/calc.md"], url: "u3" }],
    }));
    expect(items[0]).toEqual({
      kind: "push", id: "c3", actor: "chatgpt-codex-connector[bot]", author: "codex", display: "Codex",
      title: "calc: оценка", files: 1, created_at: "2026-10-23T10:21:00.000Z", url: "u3",
    });
  });

  test("агент, пушащий от имени владельца, узнаётся по сообщению коммита chat(<id>): <author>", () => {
    const items = buildTimeline(input({
      commits: [{ sha: "c5", message: `chat(${CHAT}): codex`, login: "Alex011082", name: "Al Davidov", date: "2026-10-23T10:31:00Z", added: ["chats/x/notes.md"], url: "u5" }],
    }));
    expect(items[0]).toMatchObject({ kind: "push", actor: "alex011082", author: "codex", display: "Codex" });
  });

  test("агент узнаётся по трейлеру Co-Authored-By, если сообщение коммита произвольное", () => {
    const items = buildTimeline(input({
      commits: [{ sha: "c6", message: "calc: поправка скорости\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", login: "Alex011082", name: "Alexander Davidov", date: "2026-10-23T10:32:00Z", added: ["calc.md"], url: "u6" }],
    }));
    expect(items[0]).toMatchObject({ actor: "alex011082", author: "claude", display: "Claude" });
  });

  test("трейлер с не-агентом не подменяет автора", () => {
    const items = buildTimeline(input({
      commits: [{ sha: "c7", message: "fix\n\nCo-Authored-By: Bob <bob@example.com>", login: "Alex011082", name: "A", date: "2026-10-23T10:33:00Z", added: ["x.md"], url: "u7" }],
    }));
    expect(items[0]).toMatchObject({ author: "alex011082" });
  });

  test("коммит без GitHub-логина подписан именем из git", () => {
    const items = buildTimeline(input({
      commits: [{ sha: "c4", message: "x", login: null, name: "Claude", date: "2026-10-23T10:30:00Z", added: [], url: "u4" }],
    }));
    expect(items[0]).toMatchObject({ actor: "Claude", author: "claude" });
  });

  test("комментарий с блоком — сообщение с логическим автором", () => {
    const items = buildTimeline(input({
      comments: [{ id: 77, login: "Alex011082", body: "Мост.\n<!-- chat0110\nid: 20261023T102200Z-codex-m3p8\nauthor: codex\n-->", created_at: "2026-10-23T10:22:00Z", url: "c77" }],
    }));
    expect(items[0]).toMatchObject({
      kind: "message", id: "20261023T102200Z-codex-m3p8", author: "codex", display: "Codex",
      source: "comment", actor: "alex011082", text: "Мост.", url: "c77",
    });
  });

  test("комментарий без блока — автор по логину, id по номеру", () => {
    const items = buildTimeline(input({
      comments: [{ id: 78, login: "chatgpt-codex-connector[bot]", body: "Ревью готово", created_at: "2026-10-23T10:25:00Z", url: "c78" }],
    }));
    expect(items[0]).toMatchObject({ id: "c78", author: "codex", text: "Ревью готово" });
  });

  test("повтор файлом и комментарием склеивается, файл главнее", () => {
    const items = buildTimeline(input({
      files: [fileC],
      comments: [{ id: 79, login: "claude[bot]", body: `Вакуумные руки.\n<!-- chat0110\nid: ${C}\nauthor: claude\n-->`, created_at: "2026-10-23T10:16:00Z", url: "c79" }],
    }));
    const messages = items.filter((i) => i.kind === "message");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ source: "file" });
  });

  test("ревью и комментарии к строкам — вид review", () => {
    const items = buildTimeline(input({
      reviews: [
        { id: 5, login: "claude[bot]", body: "В целом ок", state: "COMMENTED", submitted_at: "2026-10-23T10:26:00Z", url: "r5" },
        { id: 6, login: "claude[bot]", body: "", state: "APPROVED", submitted_at: "2026-10-23T10:27:00Z", url: "r6" },
      ],
      reviewComments: [{ id: 9, login: "claude[bot]", body: "Скорость из старой спеки", path: "calc.md", line: 12, diff_hunk: "@@ скорость = 0.6", created_at: "2026-10-23T10:26:30Z", url: "rc9" }],
    }));
    expect(items.map((i) => i.kind)).toEqual(["review", "review"]);
    expect(items[1]).toMatchObject({ author: "claude", path: "calc.md", line: 12, text: "Скорость из старой спеки" });
  });

  test("PR агента в ветку чата — событие и сообщения «не влито»", () => {
    const P = "20261023T103000Z-claude-p5p5";
    const items = buildTimeline(input({
      agentPrs: [{
        number: 5, title: "Ответ Claude", login: "claude[bot]", state: "open", merged: false,
        created_at: "2026-10-23T10:30:00Z", url: "pr5",
        files: [{ name: `${P}.md`, content: `---\nauthor: claude\ncreated_at: 2026-10-23T10:29:00Z\n---\nГибрид.` }],
      }],
    }));
    expect(items.map((i) => i.kind)).toEqual(["message", "agent_pr"]);
    expect(items[0]).toMatchObject({ id: P, source: "agent_pr", pending: true, agent_pr: 5, text: "Гибрид." });
    expect(items[1]).toMatchObject({ number: 5, state: "open", author: "claude", message_ids: [P] });
  });

  test("влитый PR агента не дублирует сообщение, уже лежащее в ветке", () => {
    const items = buildTimeline(input({
      files: [fileC],
      agentPrs: [{ number: 6, title: "x", login: "claude[bot]", state: "closed", merged: true, created_at: "2026-10-23T10:13:00Z", url: "pr6", files: [fileC] }],
    }));
    const messages = items.filter((i) => i.kind === "message");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ source: "file", pending: false });
    expect(items.find((i) => i.kind === "agent_pr")).toMatchObject({ state: "merged" });
  });

  test("сообщения закрытого без слияния PR агента не показываются", () => {
    const P = "20261023T103000Z-claude-p5p5";
    const items = buildTimeline(input({
      agentPrs: [{ number: 7, title: "x", login: "claude[bot]", state: "closed", merged: false, created_at: "2026-10-23T10:30:00Z", url: "pr7", files: [{ name: `${P}.md`, content: "Текст" }] }],
    }));
    expect(items.map((i) => i.kind)).toEqual(["agent_pr"]);
  });

  test("при равном времени порядок — по id", () => {
    const b = "20261023T100300Z-claude-bbbb";
    const a = "20261023T100300Z-codex-aaaa";
    const items = buildTimeline(input({ files: [{ name: `${b}.md`, content: "b" }, { name: `${a}.md`, content: "a" }] }));
    expect(items.map((i) => i.id)).toEqual([b, a]);
  });

  test("файлы с чужими именами в папке сообщений пропускаются", () => {
    const items = buildTimeline(input({ files: [{ name: "README.md", content: "x" }, fileA] }));
    expect(items.map((i) => i.id)).toEqual([A]);
  });
});
