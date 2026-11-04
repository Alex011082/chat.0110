import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,readdirSync,symlinkSync} from "node:fs";
import {join,resolve,relative,dirname} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {MCP_PACKAGE_VERSION} from "../packages/chat-protocol/src/mcp-install.ts";

const root=resolve(import.meta.dir,".."),ref=process.argv[2],output=resolve(process.argv[3]??"artifacts");
if(!ref||!/^[a-f0-9]{40}$/.test(ref))throw Error("Нужен точный frontend SHA");
const run=async(args:string[],cwd=root)=>{const p=Bun.spawn(args,{cwd,stdout:"pipe",stderr:"pipe"});const [out,err,status]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(status)throw Error(`${args.join(" ")}: ${err}\n${out}`);return out.trim();};
const temp=mkdtempSync(join(tmpdir(),"chat-rollback-build-"));
try{
 console.log("rollback: сборка прежнего frontend с текущим протоколом");
 const frontend=join(temp,"frontend"),bundle=join(temp,"bundle");mkdirSync(frontend);mkdirSync(bundle);
 // Внешний вид берём из предыдущей ревизии, протокол и MCP — из проверяемой новой.
 const archived=join(temp,"frontend.tar");
 await run(["git","archive","--format=tar","--output",archived,ref,"apps/web"]);
 await run(["tar","-xf",archived,"-C",frontend]);
 console.log("rollback: исходники frontend извлечены");
 for(const name of ["package.json","packages"])cpSync(join(root,name),join(frontend,name),{recursive:true});
 symlinkSync(join(root,"node_modules"),join(frontend,"node_modules"),"dir");
 // Bun хранит зависимости workspace рядом с web, а не в корневом node_modules.
 symlinkSync(join(root,"apps/web/node_modules"),join(frontend,"apps/web/node_modules"),"dir");
 await run([process.execPath,"run","build"],join(frontend,"apps/web"));
 console.log("rollback: сборка API/MCP bundle и manifest");
 for(const name of ["package.json","apps/api","packages/chat-protocol","deploy"]) {
  const src=join(root,name),dest=join(bundle,name);mkdirSync(dirname(dest),{recursive:true});
  cpSync(src,dest,{recursive:true,filter:path=>!path.includes("node_modules")&&!path.includes("/test/")});
 }
 mkdirSync(join(bundle,"apps/web"),{recursive:true});cpSync(join(frontend,"apps/web/dist"),join(bundle,"apps/web/dist"),{recursive:true});
 rmSync(join(bundle,"apps/web/dist/downloads"),{recursive:true,force:true});
 cpSync(join(root,"apps/web/dist/downloads"),join(bundle,"apps/web/dist/downloads"),{recursive:true});
 mkdirSync(join(bundle,"node_modules/@chat0110"),{recursive:true});cpSync(join(root,"packages/chat-protocol"),join(bundle,"node_modules/@chat0110/chat-protocol"),{recursive:true});
 const api=await run(["git","rev-parse","HEAD"]),files:Record<string,string>={};
 const walk=(path:string)=>{for(const entry of readdirSync(path,{withFileTypes:true})){const p=join(path,entry.name);if(entry.isDirectory())walk(p);else if(entry.isFile())files[relative(bundle,p)]=createHash("sha256").update(readFileSync(p)).digest("hex");else throw Error("Неверный тип файла bundle");}};walk(bundle);
 const source=process.env.CHAT0110_SOURCE_REVISION??api;
 if(!/^[a-f0-9]{40}$/.test(source))throw Error("Нужен точный source SHA");
 const manifest={format:1,source_revision:source,api_revision:api,frontend_revision:ref,shared_protocol_revision:api,mcp_version:MCP_PACKAGE_VERSION,files};
 writeFileSync(join(bundle,"rollback-manifest.json"),JSON.stringify(manifest,null,2)+"\n");mkdirSync(output,{recursive:true});
 const name=`chat0110-rollback-${api.slice(0,12)}.tar.gz`,archive=join(output,name);
 await run(["python3",join(root,"scripts/rollback-tar.py"),"pack",bundle,archive]);
 const sha256=createHash("sha256").update(readFileSync(archive)).digest("hex");writeFileSync(archive+".sha256",`${sha256}  ${name}\n`);
 writeFileSync(join(output,"rollback-build.json"),JSON.stringify({archive:name,sha256,source_revision:source,api_revision:api,frontend_revision:ref,mcp_version:MCP_PACKAGE_VERSION},null,2)+"\n");
 console.log(JSON.stringify({archive:name,sha256,source_revision:source,api_revision:api,frontend_revision:ref}));
}finally{rmSync(temp,{recursive:true,force:true});}
