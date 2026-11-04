import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";

test("следующий релиз сохраняет прежний пакет, но не старый manifest и не изменённые байты того же номера",async()=>{
 const root=mkdtempSync(join(tmpdir(),"chat0110-downloads-")),old=join(root,"old"),next=join(root,"next");mkdirSync(old);mkdirSync(next);
 const run=async()=>{
  const child=Bun.spawn(["python3",new URL("../../../deploy/preserve-downloads.py",import.meta.url).pathname,old,next],{stdout:"pipe",stderr:"pipe"});
  const [out,error,status]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {out,error,status};
 };
 try{
  writeFileSync(join(old,"chat0110-mcp-0.4.0.tgz"),"published-bytes");writeFileSync(join(old,"mcp.json"),"old-manifest");writeFileSync(join(old,"private.env"),"fixture-private");
  writeFileSync(join(next,"mcp.json"),"current-manifest");writeFileSync(join(next,"chat0110-mcp-0.4.1.tgz"),"next-version");
  expect((await run()).status).toBe(0);expect(readFileSync(join(next,"chat0110-mcp-0.4.0.tgz"),"utf8")).toBe("published-bytes");expect(readFileSync(join(next,"mcp.json"),"utf8")).toBe("current-manifest");expect(existsSync(join(next,"private.env"))).toBe(false);
  writeFileSync(join(next,"chat0110-mcp-0.4.0.tgz"),"different-bytes");const conflict=await run();expect(conflict.status).not.toBe(0);expect(conflict.error).toContain("Подними версию");expect(readFileSync(join(old,"chat0110-mcp-0.4.0.tgz"),"utf8")).toBe("published-bytes");
 }finally{rmSync(root,{recursive:true,force:true});}
});
