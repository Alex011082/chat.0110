import {canonicalMention,type AgentSession,type Participant} from "@chat0110/chat-protocol";
import {agentSessionName,mergeAgentParticipants} from "./auto-replies.ts";

export interface ParticipantTarget {id:string;name:string;author:string;participant:Participant;session?:AgentSession}
/** Кружок представляет конкретную сессию, если она есть, а не всю модель. */
export function participantTargets(history:Participant[],sessions:AgentSession[]):ParticipantTarget[]{
 const seen=new Set<string>();
 return mergeAgentParticipants(history,sessions).flatMap(participant=>{
  if(!participant.is_agent)return[{id:`human:${participant.author}`,name:participant.display,author:participant.author,participant}];
  const author=canonicalMention(participant.author);
  if(seen.has(author))return[];seen.add(author);
  const matches=sessions.filter(session=>canonicalMention(session.author)===author);
  return matches.length?matches.map(session=>({id:session.id,name:agentSessionName(session),author:session.author,participant,session})):[{id:`history:${author}`,name:participant.display,author,participant}];
 });
}
