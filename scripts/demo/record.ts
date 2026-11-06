import {mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve, join} from "node:path";
import {APP_BASE, notice, phases, sourceSnapshot} from "./fixture.ts";
import {allowedBrowserRequest, startReplay} from "./server.ts";

// Запись допускается только на одноразовом CI runner, без профиля пользователя.
if(process.env.GITHUB_ACTIONS!=="true")throw Error("Recording is CI-only");
const modulePath=process.env.PLAYWRIGHT_MODULE;
if(!modulePath||!modulePath.startsWith("/"))throw Error("Pinned Playwright module path is required");
const {chromium}=await import(modulePath);
const output=resolve("artifacts/review-video");
await mkdir(output,{recursive:true});
const sha=(data:Uint8Array|string)=>createHash("sha256").update(data).digest("hex");
const command=async(args:string[])=>{
 const process=Bun.spawn(args,{stdout:"pipe",stderr:"pipe"});
 const [stdout,stderr,exit]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);
 if(exit!==0)throw Error(`${args[0]} failed: ${stderr.slice(-1500)}`);
 return stdout.trim();
};
const checkoutSha=await command(["git","rev-parse","HEAD"]);
const sourceSha=process.env.CHAT0110_RECORDING_SOURCE_SHA??checkoutSha;
if(!/^[a-f0-9]{40}$/.test(sourceSha))throw Error("Invalid source SHA");
// В отличие от макета, ролик показывает неизменённый web код указанной базы.
await command(["git","diff","--exit-code",APP_BASE,"--","apps/web","apps/api","packages"]);
const fixtureSha=sha(await readFile(new URL("./pr206-sources.json",import.meta.url)));
const replay=await startReplay();
const browser=await chromium.launch({headless:true,args:["--disable-background-networking","--disable-component-update","--disable-domain-reliability","--no-pings"]});
const context=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1,locale:"en-US",colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block",recordVideo:{dir:join(output,"raw"),size:{width:1440,height:1080}}});
const allowed=new Set<string>(),blocked=new Set<string>(),errors:string[]=[];
await context.route("**/*",async(route:any)=>{
 const request=route.request(),url=request.url();
 if(allowedBrowserRequest(url,request.method(),replay.origin,replay.assets)){
  allowed.add(new URL(url).pathname);await route.continue();
 }else{
  // Не записываем query/body, даже если новый код попробует отправить их наружу.
  const target=new URL(url);blocked.add(`${request.method()} ${target.origin}${target.pathname}`);await route.abort("blockedbyclient");
 }
});
await context.routeWebSocket("**/*",(socket:any)=>{blocked.add("WebSocket");socket.close();});
await context.addInitScript(()=>{localStorage.setItem("chat0110.locale","en");localStorage.setItem("chat0110.design","light");});
const page=await context.newPage();
page.on("pageerror",(error:Error)=>errors.push(error.message));
const video=page.video();
try{
 await page.goto(`${replay.origin}/__recording`,{waitUntil:"domcontentloaded"});
 const frame=page.frameLocator("iframe");
 await frame.getByText(phases[0]!.focus,{exact:false}).last().waitFor({state:"visible"});
 for(let index=0;index<phases.length;index++){
  const phase=phases[index]!;
  await page.locator("#phase-title").evaluate((element:HTMLElement,text:string)=>{element.textContent=text;},phase.title);
  await page.locator("#caption").evaluate((element:HTMLElement,text:string)=>{element.textContent=text;},phase.caption);
  replay.setPhase(index);
  if(phase.evidence)await page.locator("iframe").evaluate((element:HTMLIFrameElement)=>{element.src="/__evidence";});
  const target=frame.getByText(phase.focus,{exact:false}).last();
  await target.waitFor({state:"visible"});
  await target.scrollIntoViewIfNeeded();
  // Пауза — длительность кадра для зрителя; готовность проверяется выше.
  await page.waitForTimeout(phase.seconds*1000);
 }
 await context.close();
 const raw=await video.path();
 if(blocked.size||errors.length)throw Error(`Replay network/page check failed: ${JSON.stringify({blocked:[...blocked],errors})}`);
 await command(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",raw,"-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart","-an",join(output,"chat0110-pr206-replay.mp4")]);
 await command(["ffmpeg","-hide_banner","-loglevel","error","-y","-ss","92","-i",join(output,"chat0110-pr206-replay.mp4"),"-frames:v","1",join(output,"poster.png")]);
 const probe=JSON.parse(await command(["ffprobe","-v","error","-show_format","-show_streams","-of","json",join(output,"chat0110-pr206-replay.mp4")]));
 const duration=Number(probe.format.duration),stream=probe.streams.find((item:any)=>item.codec_type==="video");
 if(duration<120||duration>180||stream?.width!==1440||stream?.height!==1080)throw Error("Invalid media dimensions/duration");
 const media=await Promise.all(["chat0110-pr206-replay.mp4","poster.png"].map(async file=>({file,bytes:(await stat(join(output,file))).size,sha256:sha(await readFile(join(output,file)))})));
 const receipt={schemaVersion:1,kind:"historical-public-source-replay",notice,recordedAt:new Date().toISOString(),appBaseSha:APP_BASE,appWebTree:await command(["git","rev-parse",`${APP_BASE}:apps/web`]),sourceSha,checkoutSha,sourceRepository:sourceSnapshot.sourceRepository,sourcePullRequest:206,sourceHeadSha:sourceSnapshot.sourceHeadSha,fixtureSha256:fixtureSha,liveModels:false,realClientAcceptance:false,productionAccess:false,mutationsAllowed:false,playwrightVersion:"1.56.1",viewport:{width:1440,height:1080},durationSeconds:duration,codec:stream.codec_name,media,network:{policy:"GET only; exact loopback origin and static/API allowlist; service workers blocked; WebSockets blocked",allowedPaths:[...allowed].sort(),blockedRequests:[...blocked]},phases:phases.map(phase=>({title:phase.title,seconds:phase.seconds})),sources:sourceSnapshot.messages.map(({id,author,sourceUrl})=>({id,author,sourceUrl}))};
 await writeFile(join(output,"receipt.json"),JSON.stringify(receipt,null,2)+"\n");
 const files=[...media,{file:"receipt.json",sha256:sha(await readFile(join(output,"receipt.json")))}];
 await writeFile(join(output,"SHA256SUMS"),files.map(file=>`${file.sha256}  ${file.file}`).join("\n")+"\n");
 console.log(JSON.stringify({sourceSha,durationSeconds:duration,media,blockedRequests:blocked.size}));
}finally{
 await context.close().catch(()=>{});await browser.close();replay.stop();
}
