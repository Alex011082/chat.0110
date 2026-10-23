/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { chatRoute, parseRoute, routePath, routeSearch, splitRepo } from "../src/lib/route.ts";

describe("parseRoute — адрес /<owner>/<repo>/<chatId>", () => {
  test("полный путь", () => {
    expect(parseRoute("/Alex011082/chat.0110/20261023-k7q2")).toEqual({
      owner: "Alex011082",
      repo: "chat.0110",
      chatId: "20261023-k7q2",
    });
  });
  test("только репозиторий и корень", () => {
    expect(parseRoute("/Alex011082/chat.0110")).toEqual({ owner: "Alex011082", repo: "chat.0110", chatId: null });
    expect(parseRoute("/Alex011082/chat.0110/")).toEqual({ owner: "Alex011082", repo: "chat.0110", chatId: null });
    expect(parseRoute("/")).toEqual({ owner: null, repo: null, chatId: null });
  });
  test("чужой id чата игнорируется, плохое имя репо — корень", () => {
    expect(parseRoute("/a/b/не-чат").chatId).toBeNull();
    expect(parseRoute("/a/b%20c/20261023-k7q2")).toEqual({ owner: null, repo: null, chatId: null });
    expect(parseRoute("/only-owner")).toEqual({ owner: null, repo: null, chatId: null });
  });
});

describe("routePath и splitRepo", () => {
  test("собирает путь", () => {
    expect(routePath({ owner: "a", repo: "b", chatId: "20261023-k7q2" })).toBe("/a/b/20261023-k7q2");
    expect(routePath({ owner: "a", repo: "b", chatId: null })).toBe("/a/b");
    expect(routePath({ owner: null, repo: null, chatId: null })).toBe("/");
  });
  test("делит owner/name", () => {
    expect(splitRepo("Alex011082/chat.0110")).toEqual({ owner: "Alex011082", name: "chat.0110" });
    expect(splitRepo("плохо")).toBeNull();
  });
});

describe("экран «Дерево» — /<owner>/<repo>/~tree?chat=<id>", () => {
  test("разбор адреса дерева", () => {
    expect(parseRoute("/a/b/~tree")).toEqual({ owner: "a", repo: "b", chatId: null, tree: true, select: null });
    expect(parseRoute("/a/b/~tree", "?mock=1&chat=20261023-k7q2")).toEqual({
      owner: "a",
      repo: "b",
      chatId: null,
      tree: true,
      select: "20261023-k7q2",
    });
    expect(parseRoute("/a/b/~tree", "?chat=плохо").select).toBeNull();
  });
  test("?chat у чата не действует", () => {
    expect(parseRoute("/a/b/20261023-k7q2", "?chat=20261023-aaaa")).toEqual({ owner: "a", repo: "b", chatId: "20261023-k7q2" });
  });
  test("сборка пути и строки запроса", () => {
    expect(routePath({ owner: "a", repo: "b", chatId: null, tree: true })).toBe("/a/b/~tree");
    expect(routeSearch({ owner: "a", repo: "b", chatId: null, tree: true, select: "20261023-k7q2" }, null)).toBe("?chat=20261023-k7q2");
    expect(routeSearch({ owner: "a", repo: "b", chatId: null, tree: true, select: "20261023-k7q2" }, "1")).toBe(
      "?mock=1&chat=20261023-k7q2",
    );
    expect(routeSearch({ owner: "a", repo: "b", chatId: "20261023-k7q2", select: "20261023-aaaa" }, null)).toBe("");
    expect(routeSearch({ owner: "a", repo: "b", chatId: null }, "1")).toBe("?mock=1");
  });
});

describe("chatRoute — адрес чата по имени репо", () => {
  test("owner/name + chatId", () => {
    expect(chatRoute("Alex011082/chat.0110", "20261023-k7q2")).toEqual({ owner: "Alex011082", repo: "chat.0110", chatId: "20261023-k7q2" });
    expect(chatRoute("плохо", "20261023-k7q2")).toEqual({ owner: null, repo: null, chatId: null });
  });
});
