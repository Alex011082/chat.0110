import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { DispatchStore } from "../src/dispatch.ts";
import { McpOAuth } from "../src/mcp-oauth.ts";
import { McpEvents } from "../src/mcp-events.ts";
import { createRemoteMcp } from "../src/remote-mcp.ts";
import { loadConfig } from "../src/config.ts";
import { SessionStore, importCookieKey, type SessionData } from "../src/session.ts";
import { SseHub } from "../src/sse.ts";
import { FakeGitHub } from "./fake-github.ts";
const ROOT = "https://chat.0110.digital",
  repo = "Alex011082/chat.0110",
  chat = "20261023-k7q2";
async function setup() {
  const db = new Database(":memory:");
  const key = await importCookieKey(new Uint8Array(32).fill(7));
  const fake = new FakeGitHub();
  const config = loadConfig({
    GITHUB_APP_CLIENT_ID: "client",
    GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_APP_SLUG: "chat",
    GITHUB_WEBHOOK_SECRET: "hook",
    CHAT0110_COOKIE_KEY: "07".repeat(32),
    CHAT0110_PUBLIC_URL: ROOT,
  });
  const sessions = new SessionStore({ key, dev: false, clientId: "client", clientSecret: "secret", fetch: fake.fetch });
  const user: SessionData = {
    uid: 7,
    login: "Alex011082",
    at: "test-github-access",
    rt: "",
    exp: Date.now() + 86400_000,
    rexp: Date.now() + 86400_000,
  };
  const cookie = (await sessions.cookieFor(user)).split(";")[0]!;
  const oauth = new McpOAuth({ db, key, config, sessions, publicUrl: ROOT });
  const dispatch = new DispatchStore(db);
  const delivered: any[] = [];
  const events = new McpEvents({
    db,
    key,
    webhooks: {
      verifyCallback: async () => {},
      sendEvent: async (_u, _s, _id, event) => {
        delivered.push(event);
        return { status: 200, accepted: true };
      },
    },
  });
  const remote = createRemoteMcp({ config, dispatch, oauth, events, hub: new SseHub(), fetch: fake.fetch });
  const request = (method: string, args: unknown = {}, token?: string) =>
    new Request(`${ROOT}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: args }),
    });
  const register = await oauth.handle(
    new Request(`${ROOT}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
        token_endpoint_auth_method: "none",
      }),
    }),
  );
  const client = (await register!.json()).client_id;
  const verifier = "v".repeat(43);
  const params = new URLSearchParams({
    client_id: client,
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    response_type: "code",
    scope: "chat:agent",
    resource: `${ROOT}/mcp`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "test",
  });
  const consent = await oauth.handle(new Request(`${ROOT}/oauth/authorize?${params}`, { headers: { cookie } }));
  const html = await consent!.text();
  params.set("consent_nonce", html.match(/name="consent_nonce" value="([^"]+)"/)![1]!);
  params.set("decision", "allow");
  const allowed = await oauth.handle(
    new Request(`${ROOT}/oauth/authorize`, {
      method: "POST",
      headers: {
        origin: ROOT,
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${cookie}; ${consent!.headers.getSetCookie()[0]!.split(";")[0]}`,
      },
      body: params,
    }),
  );
  const code = new URL(allowed!.headers.get("location")!).searchParams.get("code")!;
  const tokenResponse = await oauth.handle(
    new Request(`${ROOT}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client,
        redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
        resource: `${ROOT}/mcp`,
        code_verifier: verifier,
        code,
      }),
    }),
  );
  const token = (await tokenResponse!.json()).access_token;
  return { db, fake, dispatch, events, remote, token, request, delivered };
}
test("удалённый MCP требует OAuth, выдаёт события и доставляет ожидающий ход", async () => {
  const { db, fake, dispatch, remote, token, request, delivered } = await setup();
  try {
    const discovery = await (await remote.handle(request("server/discover"))).json();
    expect(discovery.result.capabilities.events).toEqual({});
    expect((await remote.handle(request("tools/call", { name: "chat0110_account" }))).status).toBe(401);
    const profile = await (await remote.handle(request("tools/call", { name: "chat0110_account" }, token))).json();
    expect(profile.result.structuredContent.id).toBe("github:7");
    const cloud = dispatch.ensureCloud(7, repo, chat);
    dispatch.enqueue("root", 7, repo, chat, "20261023T100300Z-alex011082-q9w1", "@чатжпт вопрос", [cloud.id]);
    fake
      .on("GET", `/repos/${repo.toLowerCase()}`, {
        body: {
          full_name: repo,
          name: "chat.0110",
          owner: { login: "Alex011082" },
          default_branch: "main",
          permissions: { push: true },
        },
      })
      .on("GET", /\/pulls\?state=all&head=/, {
        body: [
          {
            number: 1,
            title: "Chat",
            body: `<!-- chat0110\nchat_id: ${chat}\n-->`,
            state: "open",
            draft: true,
            created_at: "2026-10-23T00:00:00Z",
            updated_at: "2026-10-23T00:00:00Z",
            html_url: "url",
            user: { login: "Alex011082" },
            head: { ref: `chat/${chat}`, sha: "head", repo: { full_name: repo } },
            base: { ref: "main" },
          },
        ],
      });
    const sub = await (
      await remote.handle(
        request(
          "events/subscribe",
          {
            name: "chat0110.turn.ready",
            arguments: { recipient: "chatgpt" },
            delivery: {
              mode: "webhook",
              url: "https://chatgpt.com/events/callback",
              secret: `whsec_${Buffer.alloc(32, 1).toString("base64")}`,
            },
          },
          token,
        ),
      )
    ).json();
    expect(sub.result.id).toBeString();
    await remote.pump();
    // subscribe может уже выполнять pump; дождаться его завершения без повторной подписки.
    for (let i = 0; !delivered.length && i < 20; i++) await Bun.sleep(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].data).toMatchObject({ repo: repo.toLowerCase(), chat_id: chat });
    const take = await (
      await remote.handle(
        request("tools/call", { name: "chat0110_take", arguments: { task_id: dispatch.cloudTasks()[0]!.id } }, token),
      )
    ).json();
    expect(take.result.structuredContent.claim).toBeString();
    expect(dispatch.cloudTasks()).toEqual([]);
    const dup = await (
      await remote.handle(
        request(
          "tools/call",
          { name: "chat0110_take", arguments: { task_id: take.result.structuredContent.task_id } },
          token,
        ),
      )
    ).json();
    expect(dup.result.structuredContent.resumed).toBe(true);
    expect(dup.result.structuredContent.claim).toBe(take.result.structuredContent.claim);
  } finally {
    db.close();
  }
});

test("ожидание конкретной сессии не забирает задания другой сессии того же ИИ", async () => {
  const f = await setup();
  try {
    const code = f.dispatch.register(
      7,
      repo,
      chat,
      "remote:chatgpt:7:claude-code",
      "claude-code",
      "Claude Code",
      "claude",
      "",
    );
    const work = f.dispatch.register(
      7,
      repo,
      chat,
      "remote:chatgpt:7:claude-work",
      "claude-work",
      "Claude Cowork",
      "claude",
      "",
    );
    f.dispatch.enqueue(
      "claude-code-task",
      7,
      repo,
      chat,
      "20261023T100300Z-alex011082-q9w1",
      "@claude-code проверь",
      [code.id],
    );
    f.dispatch.enqueue(
      "claude-work-task",
      7,
      repo,
      chat,
      "20261023T100400Z-alex011082-q9w2",
      "@claude-work обсуди",
      [work.id],
    );
    const response = await f.remote.handle(
      f.request(
        "tools/call",
        {
          name: "chat0110_pending",
          arguments: { author: "claude", session_id: code.id },
        },
        f.token,
      ),
    );
    const body = await response.json();
    expect(body.result.structuredContent.turns).toHaveLength(1);
    expect(
      f.dispatch.ownedTask(body.result.structuredContent.turns[0].id, 7)
        .session_id,
    ).toBe(code.id);
    const other = await f.remote.handle(
      f.request(
        "tools/call",
        {
          name: "chat0110_pending",
          arguments: { author: "claude", session_id: "missing-session" },
        },
        f.token,
      ),
    );
    expect((await other.json()).result.structuredContent.turns).toEqual([]);
  } finally {
    f.db.close();
  }
});
