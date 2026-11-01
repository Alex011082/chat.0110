import {mkdirSync,readFileSync,readdirSync,existsSync,realpathSync} from "node:fs";
import {dirname,join} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";

const root=resolveRoot(),version="0.3.0",downloads=join(root,"apps/web/public/downloads");
function resolveRoot(){return dirname(dirname(import.meta.path));}
mkdirSync(downloads,{recursive:true});mkdirSync(join(root,"plugins/claude-code/server"),{recursive:true});
const built=await Bun.build({entrypoints:[join(root,"apps/cli/src/connector.ts")],target:"bun",minify:true,outdir:join(root,"plugins/claude-code/server"),naming:"connector.js"});
if(!built.success)throw Error("Plugin MCP build failed");

// Полные тексты лицензий зависимостей включаются даже для tree-shaken частей SDK.
const visited=new Set<string>();const notices:string[]=[];
function packageRoot(entry:string,name:string):string|null{
 let dir=dirname(realpathSync(entry));while(dir!==dirname(dir)){
  const file=join(dir,"package.json");if(existsSync(file)){try{if(JSON.parse(readFileSync(file,"utf8")).name===name)return dir;}catch{}}
  dir=dirname(dir);
 }return null;
}
function collect(name:string,from:string){
 let entry:string;try{entry=Bun.resolveSync(name,from);}catch{return;}
 const dir=packageRoot(entry,name);if(!dir||visited.has(dir))return;visited.add(dir);
 const pkg=JSON.parse(readFileSync(join(dir,"package.json"),"utf8"));
 const licenseFiles=readdirSync(dir).filter(n=>/^licen[sc]e(?:[.-].*)?$/i.test(n));
 notices.push(`## ${pkg.name} ${pkg.version} (${pkg.license??"see source"})\n`+licenseFiles.map(n=>readFileSync(join(dir,n),"utf8")).join("\n"));
 for(const dependency of Object.keys(pkg.dependencies??{}).sort())collect(dependency,dir);
}
collect("@modelcontextprotocol/sdk/server/index.js",join(root,"apps/cli"));
// SDK exports a subpath; find its package before walking ordinary dependencies.
if(!notices.length){
 const entry=Bun.resolveSync("@modelcontextprotocol/sdk/server/index.js",join(root,"apps/cli"));
 const sdk=packageRoot(entry,"@modelcontextprotocol/sdk");
 if(!sdk)throw Error("Cannot locate SDK license");
 const pkg=JSON.parse(readFileSync(join(sdk,"package.json"),"utf8"));
 notices.push(`## @modelcontextprotocol/sdk ${pkg.version}\n${readFileSync(join(sdk,"LICENSE"),"utf8")}`);
 for(const dependency of Object.keys(pkg.dependencies??{}).sort())collect(dependency,sdk);
}
const index=[];
for(const [folder,id,name,file] of [["codex","codex","Codex","chat0110-codex"],["claude-code","claude","Claude Code","chat0110-claude-code"]]){
 const source=join(root,"plugins",folder!);
 await Bun.write(join(source,"REVIEW.md"),readFileSync(join(root,"plugins/REVIEW.md")));
 if(folder==="claude-code")await Bun.write(join(source,"THIRD_PARTY_NOTICES.txt"),notices.join("\n\n"));
 const filename=`${file}-${version}.zip`,output=join(downloads,filename);
 const zip=spawnSync("python3",[join(root,"scripts/plugin-zip.py"),source,output],{encoding:"utf8"});
 if(zip.status!==0)throw Error(`Cannot package ${folder}: ${zip.stderr}`);
 const bytes=readFileSync(output),sha256=createHash("sha256").update(bytes).digest("hex");
 await Bun.write(output+".sha256",`${sha256}  ${filename}\n`);
 index.push({id,name,version,url:`/downloads/${filename}`,sha256,bytes:bytes.length,status:"not-submitted",official:false});
}
await Bun.write(join(downloads,"plugins.json"),JSON.stringify({version,plugins:index},null,2)+"\n");
console.log(JSON.stringify({plugins:index.map(p=>({name:p.name,bytes:p.bytes,sha256:p.sha256}))}));
