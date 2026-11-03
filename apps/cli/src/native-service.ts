import {readFileSync,writeFileSync,renameSync,mkdirSync,lstatSync,existsSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {claudeInboxPath} from './claude-inbox.ts';
import {ConnectorState} from './connector-state.ts';

type State='starting'|'waiting'|'working'|'reconnecting'|'stopped'|'needs_attention';
type Status={nonce:string;state:State;updated_at:number};
function privateRoot(root:string){
 mkdirSync(root,{recursive:true,mode:0o700});
 const st=lstatSync(root);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0)throw Error('Нужна приватная папка собственного listener (0700)');
}
function json(path:string):any{
 const st=lstatSync(path);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.uid!==process.getuid?.()||st.size>32_768||(st.mode&0o077)!==0)throw Error('Неверный приватный файл listener');
 return JSON.parse(readFileSync(path,'utf8'));
}
function save(path:string,value:unknown){const tmp=`${path}.${randomUUID()}.tmp`;writeFileSync(tmp,JSON.stringify(value),{mode:0o600});renameSync(tmp,path);}
export function readNativeStatus(root:string):Status&{alive:boolean}{
 privateRoot(root);
 if(!existsSync(join(root,'status.json')))return {nonce:'',state:'stopped',updated_at:0,alive:false};
 const s=json(join(root,'status.json')) as Status;
 if(typeof s.nonce!=='string'||!['starting','waiting','working','reconnecting','stopped','needs_attention'].includes(s.state)||typeof s.updated_at!=='number')throw Error('Неверный status listener');
 return {...s,alive:!['stopped','needs_attention'].includes(s.state)&&Date.now()-s.updated_at<5000&&s.updated_at<=Date.now()+1000};
}
export function requestNativeStop(root:string){const s=readNativeStatus(root);if(s.nonce&&!['stopped','needs_attention'].includes(s.state))save(join(root,'stop.request.json'),{nonce:s.nonce});}
/** Остановка адресована поколению listener: никакого kill по устаревшему PID. */
export class NativeServiceStatus{
 private state:State='starting';private nonce=randomUUID();private timer:ReturnType<typeof setInterval>;private closed=false;private stopSeen=false;
 constructor(private root:string,private stop:()=>void){privateRoot(root);this.publish();this.timer=setInterval(()=>{
  if(existsSync(join(root,'stop.request.json'))){
   try{if(!this.stopSeen&&json(join(root,'stop.request.json')).nonce===this.nonce){this.stopSeen=true;this.stop();}}catch{/* Незавершённая чужая запись не управляет listener. */}
  }
  this.publish();
 },250);}
 set(state:State){this.state=state;this.publish();}
 private publish(){if(!this.closed)save(join(this.root,'status.json'),{nonce:this.nonce,state:this.state,updated_at:Date.now()});}
 close(state:State){if(this.closed)return;clearInterval(this.timer);this.state=state;this.publish();this.closed=true;}
}
export async function startNativeListener(root:string,bindingFile:string){
 privateRoot(root);
 const old=readNativeStatus(root);if(old.alive)return old;
 const check=new ConnectorState(root,'native-listener');check.close();
 const binding=json(bindingFile);
 if(binding.transport&&binding.transport!=='claude-inbox')throw Error('Постоянный запуск здесь разрешён только для Claude inbox');
 claudeInboxPath(binding.target);
 const saved=join(root,'service-binding.json');
 if(existsSync(saved)&&JSON.stringify(json(saved))!==JSON.stringify(binding))throw Error('Нужна отдельная папка состояния для другой привязки');
 save(saved,binding);
 const runtime=join(root,'runtime');privateRoot(runtime);
 for(const name of ['native-desktop.ts','native-service.ts','native-delivery.ts','native-publication.ts','native-mailbox.ts','connector-state.ts','claude-inbox.ts','codex-tool-transport.ts']){
  const to=join(runtime,name);
  if(existsSync(to)&&lstatSync(to).isSymbolicLink())throw Error('Неверный файл собственного runtime');
  copyFileSync(resolve(import.meta.dir,name),to);
 }
 // Собственная копия переживает завершение текущего executor и удаление worktree.
 const inherited=['PATH','HOME','USER','LOGNAME','TMPDIR','LANG','LC_ALL','GH_HOST','GH_CONFIG_DIR','GH_TOKEN','GITHUB_TOKEN','SSL_CERT_FILE','SSL_CERT_DIR','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'];
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>inherited.includes(key)));
 const child=Bun.spawn([process.execPath,join(runtime,'native-desktop.ts'),'listen','--state',root,'--binding',saved],{cwd:root,env,stdin:'ignore',stdout:'ignore',stderr:'ignore',detached:true});
 child.unref();
 const until=Date.now()+3000;
 while(Date.now()<until){
  const status=readNativeStatus(root);if(status.nonce!==old.nonce&&status.alive)return status;
  if(child.exitCode!==null)throw Error('Listener не запустился; проверь привязку и приватное состояние');
  await Bun.sleep(50);
 }
 throw Error('Запуск listener не подтверждён; повторно проверь status');
}
