import {createHash} from "node:crypto";

type Tool = {name:string;inputSchema?:{properties?:Record<string,{type?:unknown}>;required?:unknown}};
/** Каталог клиента и каталог сервера — независимые свидетельства; готовность сессии отсюда не следует. */
export function inspectMcpCatalog(value:unknown) {
  const body=(value as any)?.result??value;
  const raw=Array.isArray(body)?body:body?.tools;
  if(!Array.isArray(raw)||raw.length>2000)throw Error("Нужен JSON-каталог tools/list.");
  const tools=new Map<string,Tool>();
  for(const item of raw)if(item&&typeof item.name==="string"&&/^chat0110_[a-z_]+$/.test(item.name))tools.set(item.name,item);
  const hasLocal=tools.has("chat0110_next"),hasRemote=tools.has("chat0110_pending")||tools.has("chat0110_take");
  const surface=hasLocal&&hasRemote?"mixed":hasLocal?"stdio":hasRemote?"remote":"unknown";
  const missing:string[]=[];
  const requireTool=(name:string)=>{if(!tools.has(name))missing.push(name);};
  const requireField=(name:string,field:string,type:string)=>{
    const tool=tools.get(name);if(!tool)return;
    const schema=tool.inputSchema;
    if(schema?.properties?.[field]?.type!==type||!Array.isArray(schema.required)||!schema.required.includes(field))missing.push(`${name}.${field}`);
  };
  const accepts=(name:string,fields:string[])=>{
    const schema=tools.get(name)?.inputSchema;if(!schema)return;
    if(schema.required!==undefined&&!Array.isArray(schema.required))missing.push(`${name}.required`);
    else if(Array.isArray(schema.required)&&schema.required.some(field=>typeof field!=="string"||!fields.includes(field)))missing.push(`${name}.unsupported_required`);
  };
  for(const name of ["connect","status","set_auto_reply","context","reply"])requireTool(`chat0110_${name}`);
  for(const field of ["repo","chat_id","author"])requireField("chat0110_connect",field,"string");
  requireField("chat0110_set_auto_reply","enabled","boolean");
  requireField("chat0110_reply","task_id","string");requireField("chat0110_reply","text","string");
  if(surface==="remote"){
    requireTool("chat0110_pending");requireTool("chat0110_take");
    for(const name of ["pending","status","set_auto_reply"])requireField(`chat0110_${name}`,"session_id","string");
    requireField("chat0110_take","task_id","string");
    for(const field of ["task_id","claim"])requireField("chat0110_context",field,"string");
    requireField("chat0110_reply","claim","string");
    accepts("chat0110_pending",["session_id","author","wait"]);accepts("chat0110_take",["task_id"]);
    accepts("chat0110_status",["session_id"]);accepts("chat0110_set_auto_reply",["session_id","enabled"]);
    accepts("chat0110_context",["task_id","claim"]);accepts("chat0110_reply",["task_id","claim","text","outcome"]);
  }else if(surface==="stdio"){
    requireTool("chat0110_next");
    for(const name of ["next","context","status"]){
      const required=tools.get(`chat0110_${name}`)?.inputSchema?.required;
      if(Array.isArray(required)&&required.length)missing.push(`chat0110_${name}.stateful`);
    }
    accepts("chat0110_set_auto_reply",["enabled"]);accepts("chat0110_reply",["task_id","text","outcome"]);
  }
  else if(surface==="mixed")missing.push("single_transport_catalog");
  else missing.push("chat0110_next|chat0110_pending");
  accepts("chat0110_connect",["repo","chat_id","author","alias","name","model"]);
  const compatible=missing.length===0;
  const contract=[...tools.values()].map(t=>({name:t.name,required:Array.isArray(t.inputSchema?.required)?[...t.inputSchema.required].sort():[],fields:Object.entries(t.inputSchema?.properties??{}).map(([name,p])=>({name,type:p?.type})).sort((a,b)=>a.name.localeCompare(b.name))})).sort((a,b)=>a.name.localeCompare(b.name));
  return {compatible,surface,missing,flow:compatible?(surface==="stdio"?["chat0110_next","chat0110_context","chat0110_reply"]:["chat0110_pending","chat0110_take","chat0110_context","chat0110_reply"]):[],client_session:"not_verified",action:compatible?"verify_client_session":surface==="remote"?"refresh_apps_catalog":surface==="mixed"?"select_one_mcp_server":"reload_local_mcp",catalog_sha256:createHash("sha256").update(JSON.stringify(contract)).digest("hex")};
}

export async function inspectPublicMcp(origin:string) {
  const res=await fetch(new URL("/mcp",origin),{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}}),signal:AbortSignal.timeout(15000),redirect:"error"});
  if(!res.ok)throw Error("Не удалось прочитать публичный каталог CHAT.0110. Регистрация не выполнялась.");
  const raw=await res.text();if(raw.length>1024*1024)throw Error("Слишком большой каталог MCP.");
  return inspectMcpCatalog(JSON.parse(raw).result);
}
