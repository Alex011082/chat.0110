import {test,expect} from "bun:test";
import {Database} from "bun:sqlite";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";

test("старый API разрешён только до первого переноса и неопределённой публикации; ошибка проверки закрывает доставку",async()=>{
 const root=mkdtempSync(join(tmpdir(),"chat-rollback-")),path=join(root,"state.sqlite");
 const run=async(file=path)=>{
  const p=Bun.spawn(["python3",new URL("../../../deploy/rollback-policy.py",import.meta.url).pathname,file],{stdout:"pipe",stderr:"pipe"});
  const [out,error,status]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {out,error,status};
 };
 try{
  let db=new Database(path);db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY)");db.close();
  expect((await run()).status).toBe(0);
  db=new Database(path);db.exec("CREATE TABLE channel_bindings(session_id TEXT,key_hash TEXT);CREATE TABLE channel_publications(task_id TEXT,session_id TEXT)");db.close();
  expect((await run()).status).toBe(0);
  db=new Database(path);db.exec("INSERT INTO channel_bindings VALUES ('one','private-key-fixture')");db.close();
  const blocked=await run();expect(blocked.status).toBe(2);expect(blocked.out+blocked.error).not.toContain("private-key-fixture");
  db=new Database(path);db.exec("DELETE FROM channel_bindings;INSERT INTO channel_publications VALUES ('task','one')");db.close();expect((await run()).status).toBe(2);
  expect((await run(join(root,"missing.sqlite"))).status).toBe(2);
  writeFileSync(join(root,"invalid.sqlite"),"not sqlite");expect((await run(join(root,"invalid.sqlite"))).status).toBe(2);
 }finally{rmSync(root,{recursive:true,force:true});}
});
