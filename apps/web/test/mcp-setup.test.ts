import { test, expect } from "bun:test";
import { MCP_PACKAGE_VERSION } from "@chat0110/chat-protocol";
import { agentCards } from "../src/lib/agent-catalog.ts";
import { mcpSetupCommand, connectContext,sessionSetupTask,sessionSetupAction } from "../src/lib/mcp-setup.ts";
import {autoReplyLaunchUrl} from "../src/lib/auto-replies.ts";

test("установка ведёт к настоящему версионированному пакету, не к заданию для модели", () => {
  for (const id of ["codex", "claude-code", "grok-build", "other-ai"]) {
    const command = mcpSetupCommand({ id },"local")!;
    expect(command).toContain(`chat0110-mcp-${MCP_PACKAGE_VERSION}.tgz`);
    expect(command).toContain(" setup --client ");
    expect(command).not.toMatch(/[\n;&|]|gh auth|API_KEY|participation/i);
  }
  for (const card of agentCards(false).filter(c => ["chatgpt", "claude-chat", "claude-work", "grok"].includes(c.id))) expect(mcpSetupCommand(card)).toBeNull();
});
test("запрос мастера привязан к чату для каждого клиента и не требует опроса моделью",()=>{
 for(const en of [false,true])for(const card of agentCards(en)){
  const task=sessionSetupTask(card,en,{repo:"owner/product",chat_id:"20261103-abcd"},{newParticipant:true});
  expect(task).toContain('"repo":"owner/product"');expect(task).toContain('"chat_id":"20261103-abcd"');
  expect(task).toContain("chat0110_connect");expect(task).toContain("session_id");
 }
});
test("общий remote путь не требует установки локального пакета",()=>{
 for(const id of ["chatgpt","codex","claude-code","grok-build","other-ai"])expect(mcpSetupCommand({id})).toBeNull();
 const url=new URL(autoReplyLaunchUrl("owner/product","20261103-abcd","chatgpt",false),"https://chat.0110.digital");
 expect(url.origin).toBe("https://chat.0110.digital");expect(url.pathname).toBe("/connect");expect(url.searchParams.get("repo")).toBe("owner/product");expect(url.hash).toBe("#chatgpt");
});
test("прежний remote участник проверяется status без регистрации и мутаций",()=>{
 const card=agentCards(false).find(c=>c.id==="codex")!;
 const context={repo:"owner/product",chat_id:"20261103-abcd"};
 const existing={id:"73873dad-e998-4f36-bb29-5eb54702d35b",alias:"codex",name:"Existing",author:"codex"};
 expect(sessionSetupAction(card,context,{existing})).toEqual({mode:"resume",request:{name:"chat0110_status",arguments:{session_id:"73873dad-e998-4f36-bb29-5eb54702d35b"}},expected:{repo:"owner/product",chat:"20261103-abcd",author:"codex",alias:"codex",id:"73873dad-e998-4f36-bb29-5eb54702d35b"}});
 expect(sessionSetupAction(card,context).mode).toBe("choose");
 expect(sessionSetupAction(card,context,{newParticipant:true}).request.name).toBe("chat0110_connect");
 expect(()=>sessionSetupAction(card,context,{existing:{...existing,author:"chatgpt"}})).toThrow();
 expect(()=>sessionSetupAction(card,context,{existing:{...existing,id:""}})).toThrow();
 expect(sessionSetupAction(card,context,{existing,transport:"local"}).mode).toBe("blocked");
});
test("контекст чата сохраняется без shell-аргументов и произвольных адресов", () => {
  expect(connectContext("?repo=a/b&chat=20261102-abcd")).toEqual({ repo: "a/b", chat_id: "20261102-abcd" });
  expect(connectContext("?repo=a/b;echo&chat=20261102-abcd")).toBeNull();
  expect(connectContext("?repo=https://evil.test&chat=20261102-abcd")).toBeNull();
});
