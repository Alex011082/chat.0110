import { describe, expect, test } from "bun:test";
import { githubRepo } from "../src/remote.ts";

describe("git remote GitHub", () => {
  test("имя с точкой и суффикс .git", () => {
    expect(githubRepo("https://github.com/Alex011082/chat.0110.git")).toEqual({ owner: "Alex011082", name: "chat.0110" });
    expect(githubRepo("git@github.com:Alex011082/checkaboutme.git")).toEqual({ owner: "Alex011082", name: "checkaboutme" });
    expect(githubRepo("не github")).toBeNull();
  });
});
