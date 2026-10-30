import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConnectorState } from "./connector-state.ts";

export interface PublicationJob { session_id:string;task:{id:string;claim:string} }
export class NativePublicationRetryable extends Error {}
/** HTTP complete идемпотентен, в отличие от повторной доставки prompt в inbox. */
export async function recoverNativeAnswer(root: string, job: PublicationJob, complete: (payload: Record<string, unknown>) => Promise<unknown>): Promise<boolean> {
  const id=job.task.id, answerPath=join(root,`${id}.answer.json`), donePath=join(root,`${id}.done.json`);
  if (existsSync(donePath)) return true;
  if (!existsSync(answerPath)) return false;
  const answer=JSON.parse(readFileSync(answerPath,"utf8"));
  if (typeof answer.text!=="string" || !answer.text.trim() || answer.text.length>60_000 || !["continue","complete","needs_owner"].includes(answer.outcome)) throw new Error("Неверный сохранённый ответ");
  let state: ConnectorState;
  try { state=new ConnectorState(root,`publication:${id}`); }
  catch(error) {
    if(error instanceof Error && error.message.includes("already has a running connector")) return false;
    throw error;
  }
  try {
    const old=state.value.current;
    if (old && (old.answer!==answer.text || old.outcome!==answer.outcome || old.task.claim!==job.task.claim)) throw new Error("Сохранённый ответ нельзя менять при повторе");
    if (!old) state.value.current={task:job.task,answer:answer.text,outcome:answer.outcome,attempts:0};
    const current=state.value.current!;
    const attempts=typeof current.attempts==="number" ? current.attempts : 0;
    if (attempts>=3) throw new Error("Три попытки complete исчерпаны; нужна сверка владельца");
    current.attempts=attempts+1;state.save();
    try { await complete({session_id:job.session_id,task_id:id,claim:job.task.claim,text:answer.text,outcome:answer.outcome}); }
    catch { throw new NativePublicationRetryable("Ответ complete потерян; можно повторить только сохранённый результат"); }
    const tmp=`${donePath}.${randomUUID()}.tmp`;
    writeFileSync(tmp,JSON.stringify({done:true}),{mode:0o600});renameSync(tmp,donePath);
    return true;
  } finally {state.close();}
}
