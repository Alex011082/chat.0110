import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { McpCredentials, mcpOrigin } from "../src/mcp-auth.ts";

test("OAuth PKCE: loopback проверяет state, токены приватны; параллельный refresh один", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat0110-auth-"));
  let redirect = "", challenge = "", refreshes = 0;
  const requests: string[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push(String(url));
    if (String(url).endsWith("/oauth/register")) {
      redirect = JSON.parse(String(init?.body)).redirect_uris[0];
      return Response.json({ client_id: "fixture-client" });
    }
    const p = new URLSearchParams(String(init?.body));
    expect(p.get("resource")).toBe("https://chat.0110.digital/mcp");
    if (p.get("grant_type") === "authorization_code") {
      expect(createHash("sha256").update(p.get("code_verifier")!).digest("base64url")).toBe(challenge);
      expect(p.get("code")).toBe("fixture-code");
      return Response.json({ access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600, token_type: "Bearer" });
    }
    refreshes++;
    await Bun.sleep(30);
    expect(p.get("refresh_token")).toBe("fixture-refresh");
    return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600, token_type: "Bearer" });
  }) as typeof fetch;
  const file = join(root, "private", "oauth.json");
  try {
    const store = new McpCredentials(file, "https://chat.0110.digital", fetcher);
    await store.login(async (url) => {
      challenge = url.searchParams.get("code_challenge")!;
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      const wrong = new URL(redirect); wrong.searchParams.set("code", "fixture-code"); wrong.searchParams.set("state", "wrong");
      expect((await fetch(wrong)).status).toBe(400);
      const right = new URL(redirect); right.searchParams.set("code", "fixture-code"); right.searchParams.set("state", url.searchParams.get("state")!); right.searchParams.set("iss", "https://chat.0110.digital");
      expect((await fetch(right)).status).toBe(200);
    });
    expect(await store.token()).toBe("fixture-access");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "private")).mode & 0o777).toBe(0o700);
    const other = new McpCredentials(file, "https://chat.0110.digital", fetcher);
    expect(await Promise.all([store.token("fixture-access"), other.token("fixture-access")])).toEqual(["rotated-access", "rotated-access"]);
    expect(refreshes).toBe(1);
    expect(readFileSync(file, "utf8")).not.toContain("fixture-code");
    expect(requests.every(u => u.startsWith("https://chat.0110.digital/"))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("OAuth отказывает чужому origin, symlink и отзыву без скрытого входа", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat0110-auth-denied-"));
  const file = join(root, "auth.json");
  try {
    for (const value of ["https://evil.test", "https://chat.0110.digital.evil.test", "https://u:p@chat.0110.digital", "http://chat.0110.digital", "https://chat.0110.digital/path"])
      expect(() => mcpOrigin(value)).toThrow();
    expect(mcpOrigin("https://chat.0110.digital")).toBe("https://chat.0110.digital");
    expect(mcpOrigin("http://127.0.0.1:5123")).toBe("http://127.0.0.1:5123");
    writeFileSync(file, JSON.stringify({ origin: "https://evil.test", access: "never-send", refresh: "never-send", client: "x", expires: Date.now() + 3600000 }), { mode: 0o600 });
    let calls = 0;
    const store = new McpCredentials(file, "https://chat.0110.digital", (async (_url: any, _init?: RequestInit) => { calls++; return Response.json({ error: "invalid_grant", secret: "must-not-log" }, { status: 400 }); }) as typeof fetch);
    await expect(store.token()).rejects.toThrow(); expect(calls).toBe(0);
    symlinkSync(file, join(root, "link"));
    await expect(new McpCredentials(join(root, "link"), "https://chat.0110.digital").token()).rejects.toThrow();
    writeFileSync(file, JSON.stringify({ origin: "https://chat.0110.digital", access: "expired", refresh: "revoked", client: "x", expires: 0 }), { mode: 0o600 });
    await expect(store.token()).rejects.not.toThrow("must-not-log");
    expect(calls).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
