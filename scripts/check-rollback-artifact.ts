import assert from "node:assert/strict";
import {Database} from "bun:sqlite";
import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {checkChannelGuard} from "../deploy/check-channel-guard.ts";

const root=resolve(import.meta.dir,".."),output=resolve(process.argv[2]??"artifacts");
const build=JSON.parse(readFileSync(join(output,"rollback-build.json"),"utf8"));
const archive=join(output,build.archive),dir=mkdtempSync(join(tmpdir(),"chat-rollback-ci-"));
const run=async(args:string[],env:NodeJS.ProcessEnv=process.env)=>{
 const p=Bun.spawn(args,{cwd:root,env,stdout:"pipe",stderr:"pipe"});
 const [out,error,status]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {out,error,status};
};
const okay=async(args:string[])=>{const result=await run(args);assert.equal(result.status,0,result.error);return result;};
try{
 console.log("rollback: проверка digest и распаковка");
 const sha256=createHash("sha256").update(readFileSync(archive)).digest("hex");assert.equal(sha256,build.sha256);
 const extracted=join(dir,"artifact");await okay(["python3",join(root,"scripts/rollback-tar.py"),"extract",archive,extracted]);
 const manifest=JSON.parse(readFileSync(join(extracted,"rollback-manifest.json"),"utf8"));
 for(const field of ["api_revision","source_revision","frontend_revision","mcp_version"])assert.equal(manifest[field],build[field]);
 // Выполняем именно распакованный API и Node MCP из архива, не текущий checkout.
 const proof=await checkChannelGuard(extracted);
 console.log("rollback: положительный API/MCP probe завершён");
 const incompatible=join(dir,"incompatible");cpSync(extracted,incompatible,{recursive:true});
 rmSync(join(incompatible,"apps/api/src"),{recursive:true});
 const legacyRevision="b690559660c4e3920e2a21dac35c8982b1801e13";
 const oldTar=join(dir,"old-api.tar");
 await okay(["git","archive","--format=tar","--output",oldTar,legacyRevision,"apps/api/src"]);await okay(["tar","-xf",oldTar,"-C",incompatible]);
 await assert.rejects(()=>checkChannelGuard(incompatible));
 console.log("rollback: несовместимый API отвергнут");
 const changed=join(dir,"changed");cpSync(extracted,changed,{recursive:true});
 writeFileSync(join(changed,"apps/api/src/dispatch.ts"),"invalid synthetic file\n");
 const corrupt=join(dir,"corrupt.tar.gz");await okay(["python3",join(root,"scripts/rollback-tar.py"),"pack",changed,corrupt]);
 assert.notEqual((await run(["python3",join(root,"scripts/rollback-tar.py"),"extract",corrupt,join(dir,"must-not-extract")])).status,0);
 assert.equal(existsSync(join(dir,"must-not-extract")),false);

 // Граница host подменена только для CI: systemctl не управляет настоящими сервисами.
 // INSERT в stop имитирует последний commit переноса, завершившийся прямо при остановке.
 const bin=join(dir,"bin"),trace=join(dir,"host-trace"),envFile=join(dir,"service.env");mkdirSync(bin);writeFileSync(envFile,"GITHUB_APP_CLIENT_ID=fixture\n");
 writeFileSync(join(bin,"sudo"),'#!/usr/bin/env bash\nset -euo pipefail\nif [ "${1:-}" = -u ]; then shift 2; fi\nexec "$@"\n',{mode:0o755});
 writeFileSync(join(bin,"systemctl"),`#!/usr/bin/env python3
import os,sqlite3,sys
if sys.argv[1] == "show":
    values={"EnvironmentFiles":os.environ["GUARD_ENVFILE"]+" (ignore_errors=no)","PassEnvironment":"", "Environment":"CHAT0110_PUBLIC_URL=https://chat.0110.digital", "DropInPaths":"", "NeedDaemonReload":"no", "FragmentPath":os.environ["GUARD_UNITFILE"]}
    if os.environ.get("GUARD_OVERRIDE") == "direct": values["Environment"] += " CHAT0110_DISPATCH_DB=/other.sqlite"
    if os.environ.get("GUARD_OVERRIDE") == "envfile": values["EnvironmentFiles"] += " /other.env (ignore_errors=no)"
    if os.environ.get("GUARD_OVERRIDE") == "pass": values["PassEnvironment"] = "CHAT0110_DISPATCH_DB"
    if os.environ.get("GUARD_OVERRIDE") == "dropin": values["DropInPaths"] = "/etc/systemd/system/chat0110.service.d/override.conf"
    if os.environ.get("GUARD_OVERRIDE") == "unloaded": values["NeedDaemonReload"] = "yes"
    if os.environ.get("GUARD_OVERRIDE") == "fragment": values["FragmentPath"] = os.environ["GUARD_ENVFILE"]
    print(values[sys.argv[3].split("=",1)[1]])
    sys.exit(0)
assert sys.argv[1:] == ["stop","chat0110"]
with open(os.environ["GUARD_TRACE"],"a") as f: f.write("stop\\n")
if os.environ.get("GUARD_RACE") == "1":
    with sqlite3.connect(os.environ["GUARD_DATABASE"]) as db:
        db.execute("INSERT INTO channel_bindings VALUES ('fixture','fixture')")
`,{mode:0o755});
 writeFileSync(join(bin,"bun"),`#!/usr/bin/env bash
set -euo pipefail
printf 'probe\\n' >> "$GUARD_TRACE"
exec '${process.execPath.replaceAll("'","'\\''")}' "$@"
`,{mode:0o755});
 const schema=`CREATE TABLE sessions(id TEXT,uid INTEGER,repo TEXT,chat TEXT,external TEXT,alias TEXT,author TEXT);
 CREATE TABLE chains(id TEXT,uid INTEGER,repo TEXT,chat TEXT,route TEXT,step INTEGER,status TEXT);
 CREATE TABLE tasks(id TEXT,chain_id TEXT,session_id TEXT,step INTEGER,status TEXT,claim TEXT,answer_id TEXT);
 CREATE TABLE agent_pulls(session_id TEXT,request_id TEXT,task_id TEXT);
 CREATE TABLE channel_bindings(session_id TEXT,key_hash TEXT);`;
 const selector=async(file:string,target:string,race=false,override="")=>{
  writeFileSync(trace,"");const r=await run(["bash",join(extracted,"deploy/select-rollback.sh"),extracted,target,file,envFile],{...process.env,PATH:bin+":"+process.env.PATH,GUARD_TRACE:trace,GUARD_DATABASE:file,GUARD_ENVFILE:envFile,GUARD_UNITFILE:join(extracted,"deploy/chat0110.service"),GUARD_OVERRIDE:override,GUARD_RACE:race?"1":"0"});
  return {...r,trace:readFileSync(trace,"utf8")};
 };
 const makeQueue=(name:string)=>{const file=join(dir,name+".sqlite"),db=new Database(file);db.exec(schema);db.close();return file;};
 const legacy=await selector(makeQueue("legacy"),incompatible);assert.equal(legacy.status,0);assert.equal(legacy.trace,"stop\n");
 const foreignUnit=join(dir,"foreign-unit");cpSync(extracted,foreignUnit,{recursive:true});writeFileSync(join(foreignUnit,"deploy/chat0110.service"),"[Service]\nEnvironment=CHAT0110_DISPATCH_DB=/other.sqlite\n");
 const unitDenied=await selector(makeQueue("unit-override"),foreignUnit);assert.equal(unitDenied.status,3);assert.equal(unitDenied.trace,"stop\n");
 const denied=await selector(makeQueue("race-bad"),incompatible,true);assert.equal(denied.status,2);assert.equal(denied.trace,"stop\nprobe\n");
 const permitted=await selector(makeQueue("race-good"),extracted,true);assert.equal(permitted.status,0,permitted.error);assert.equal(permitted.trace,"stop\nprobe\n");
 console.log("rollback: selector и гонка stop проверены");
 const invalid=[join(dir,"missing.sqlite"),join(dir,"invalid.sqlite"),join(dir,"zero.sqlite"),join(dir,"foreign.sqlite")];
 writeFileSync(invalid[1]!,"not sqlite");writeFileSync(invalid[2]!,"");const foreign=new Database(invalid[3]!);foreign.exec("CREATE TABLE unrelated(id TEXT)");foreign.close();
 for(const file of invalid){const result=await selector(file,extracted);assert.equal(result.status,3);assert.equal(result.trace,"stop\n","Неподтверждённая очередь дошла до совместимого кандидата");}
 assert.equal(existsSync(invalid[0]!),false,"Missing DB была создана проверкой");
 for(const override of ["direct","envfile","pass","dropin","unloaded","fragment"]){const result=await selector(makeQueue("override-"+override),extracted,false,override);assert.equal(result.status,3);assert.equal(result.trace,"stop\n");}
 writeFileSync(envFile,"CHAT0110_DISPATCH_DB=/other.sqlite\n");const envDenied=await selector(makeQueue("override-content"),extracted);assert.equal(envDenied.status,3);assert.equal(envDenied.trace,"stop\n");
 const receipt={...build,...proof,archive_sha256:sha256,verified_from_archive:true,incompatible_api_rejected:true,legacy_negative_revision:legacyRevision,corrupt_archive_rejected:true,stop_before_policy_race_verified:true,unverified_queue_closed:["missing","corrupt","zero","foreign-schema"],runtime_override_closed:true,candidate_unit_override_closed:true};
 writeFileSync(join(output,"rollback-verification.json"),JSON.stringify(receipt,null,2)+"\n");console.log(JSON.stringify(receipt));
}finally{rmSync(dir,{recursive:true,force:true});}
