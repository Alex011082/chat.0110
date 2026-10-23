/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { parseRoute, routePath, splitRepo } from "../src/lib/route.ts";

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
