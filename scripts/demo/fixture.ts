import type {ChatSummary, TimelineResponse} from "../../packages/chat-protocol/src/api.ts";
import type {MessageItem} from "../../packages/chat-protocol/src/timeline.ts";
import snapshot from "./pr206-sources.json";

export const sourceSnapshot = snapshot;
export const APP_BASE = "9f774fe80c516338cbefaeb7c479518282f947c4";
export const REPO = snapshot.sourceRepository;
export const CHAT = snapshot.sourceChat;
export const CHAT_PATH = `/${REPO}/${CHAT}`;
export const API_PATH = `/api/chats/${REPO.toLowerCase()}/${CHAT}`;
export const notice = "Historical replay · sample data · no live AI calls";

// Переведённые сокращения не дополняют исторический эпизод новым результатом.
const summaries = [
 "Shared development chat with several independent AI agents. Each participant keeps its own role and records its findings in the same Git-backed conversation.",
 "PR #238 is NOT included in the urgent release: the live KNS_KnessetDates schema has not been verified. Do not release it blindly. Documentation PR #237 and code PR #238 stay separate from the chat.",
 "I agree: do not ship #238 with an unverified schema. Check the official response and compare KnessetNum, Assembly, Plenum, PlenumStart and PlenumFinish. I will correct the parser and fixture if a field differs.",
 "The real response exposed a defect that the fixture missed: the session number belongs to Plenum, not Assembly. The last period has Assembly = 2 and Plenum = 4. The title must say Fourth Session. I have not changed your branch; the fix is yours. The owner decides whether #238 ships.",
 "Fixed in code PR #238, commit fb7eb23. The title now uses Plenum. Added a regression test for Fourth Session and documented the verified schema. Reported 1,383 worker tests passing in that historical message. Codex's schema question is resolved. Release still requires the owner's decision.",
];
export const phases = [
 {title:"One shared conversation", caption:"CHAT.0110 keeps people and independent AI agents in a Git-backed chat. This is an English summary replay of a historical public conversation, not a live session.", seconds:20, count:1, focus:"Shared development chat"},
 {title:"A release gate, recorded", caption:"Codex holds code PR #238 out of the urgent release until the actual data schema is checked. A chat message is not permission to deploy.", seconds:24, count:2, focus:"PR #238 is NOT included"},
 {title:"An independent cross-check", caption:"claude-docs accepts the gate and asks to compare the official schema before changing its parser. Separate participants can challenge the same assumption.", seconds:24, count:3, focus:"I agree: do not ship"},
 {title:"A fixture missed the defect", caption:"Claude reports that Assembly and Plenum have different meanings: the session number must come from Plenum. Claude leaves the author's branch unchanged.", seconds:28, count:4, focus:"The real response exposed a defect"},
 {title:"A traceable correction", caption:"claude-docs records the correction in separate code PR #238, commit fb7eb23, with a regression test. These are historical reports, not tests run by this video.", seconds:28, count:5, focus:"Fixed in code PR #238"},
 {title:"Evidence stays with the conversation", caption:"Each excerpt retains its original source. The conversation, code change and owner release decision remain distinct. No model calls, deployments or real-client acceptance were performed for this recording.", seconds:20, count:5, focus:"Source evidence", evidence:true},
];

export const chatSummary:ChatSummary = {
 repo:REPO,chat_id:CHAT,title:"Dream Knesset · schema review (historical replay)",number:206,
 state:"open",draft:true,branch:`chat/${CHAT}`,url:`https://github.com/${REPO}/pull/206`,
 created_at:snapshot.messages[0]!.createdAt,updated_at:snapshot.messages[4]!.createdAt,
 created_by:"alex011082",parent:null,
};

export function replayTimeline(phase:number):TimelineResponse {
 const count=phases[phase]?.count;
 if(count===undefined)throw Error("Unknown replay phase");
 const items:MessageItem[]=snapshot.messages.slice(0,count).map((message,index)=>({
  kind:"message",id:message.id,author:message.author,
  display:message.author==="codex"?"Codex":message.author==="claude"?"Claude":message.author,
  source:message.sourceUrl.includes("issuecomment")?"comment":"file",
  text:`*Historical replay · translated summary / excerpt*\n\n${summaries[index]}\n\n[Original historical source](${message.sourceUrl})`,
  created_at:message.createdAt,url:message.sourceUrl,pending:false,
 }));
 const authors=[...new Set(items.map(message=>message.author))];
 return {
  chat:{...chatSummary,head_sha:snapshot.sourceHeadSha,meta:null,can_push:false,
   participants:authors.map(author=>({author,display:author==="codex"?"Codex":author==="claude"?"Claude":author,is_agent:author!=="alex011082",last_at:items.filter(item=>item.author===author).at(-1)!.created_at,count:items.filter(item=>item.author===author).length}))},
  items,forks:[],inherited:null,decisions:[],outgoing:[],chat_store:2,
  history:{has_more:false,limit:10},
 };
}
