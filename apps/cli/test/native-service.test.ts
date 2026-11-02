import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeServiceStatus,requestNativeStop,readNativeStatus} from '../src/native-service.ts';

test('stop адресуется поколению даже при устаревшей квитанции зависшего процесса',()=>{
 const root=mkdtempSync(join(tmpdir(),'native-stale-'));
 try{
  writeFileSync(join(root,'status.json'),JSON.stringify({nonce:'paused-generation',state:'waiting',updated_at:Date.now()-60_000}),{mode:0o600});
  requestNativeStop(root);
  expect(existsSync(join(root,'stop.request.json'))).toBe(true);
  expect(JSON.parse(readFileSync(join(root,'stop.request.json'),'utf8')).nonce).toBe('paused-generation');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('управление своим listener: status, stop по nonce и устаревшая готовность',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-service-'));
 let stopped=0;
 const status=new NativeServiceStatus(root,()=>stopped++);
 try{
  status.set('waiting');
  expect(readNativeStatus(root)).toMatchObject({state:'waiting',alive:true});
  writeFileSync(join(root,'stop.request.json'),JSON.stringify({nonce:'another-generation'}));
  await Bun.sleep(600);expect(stopped).toBe(0);
  requestNativeStop(root);
  await Bun.sleep(600);expect(stopped).toBe(1);
  status.close('stopped');expect(readNativeStatus(root).alive).toBe(false);
  const file=join(root,'status.json');const stale=JSON.parse(readFileSync(file,'utf8'));
  writeFileSync(file,JSON.stringify({...stale,state:'waiting',updated_at:Date.now()-60_000}));
  expect(readNativeStatus(root).alive).toBe(false);
 }finally{status.close('stopped');rmSync(root,{recursive:true,force:true});}
});
