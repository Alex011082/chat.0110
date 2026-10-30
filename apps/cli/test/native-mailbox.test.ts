import {test,expect} from "bun:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ContextMailbox,readLocalContext} from "../src/native-mailbox.ts";

test("helper получает контекст от listener без токена и собственного HTTP",async()=>{
 const root=mkdtempSync(join(tmpdir(),"native-context-"));let calls=0;
 const box=new ContextMailbox(root,async task=>{calls++;if(task!=="allowed")throw Error("Нет текущего задания");return {items:[{text:"cleaned context"}]};});
 try{expect(await readLocalContext(root,"allowed",1000)).toEqual({items:[{text:"cleaned context"}]});await expect(readLocalContext(root,"other",1000)).rejects.toThrow("Контекст");expect(calls).toBe(2);}
 finally{box.close();rmSync(root,{recursive:true,force:true});}
});
test("без живого listener helper не подменяет контекст и не начинает работу",async()=>{
 const root=mkdtempSync(join(tmpdir(),"native-context-timeout-"));try{await expect(readLocalContext(root,"task",15)).rejects.toThrow("listener");}finally{rmSync(root,{recursive:true,force:true});}
});
