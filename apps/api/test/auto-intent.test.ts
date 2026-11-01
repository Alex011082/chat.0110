import {test,expect} from "bun:test";
import {DispatchStore} from "../src/dispatch.ts";

test("кнопка сохраняет запрос автора до установки, подключение наследует off и изоляцию чата",()=>{
 const q=new DispatchStore(":memory:");
 try{
  q.requestAuto(7,"a/b","20261031-abcd","claude",true);
  expect(q.list(7,"a/b","20261031-abcd").auto_requests).toEqual([{author:"claude",enabled:true}]);
  expect(q.list(8,"a/b","20261031-abcd").auto_requests).toEqual([]);
  q.requestAuto(7,"a/b","20261031-abcd","claude",false);
  const a=q.register(7,"a/b","20261031-abcd","native-a","claude","Claude");
  expect(a.auto_enabled).toBe(0);
  const other=q.register(7,"a/b","20261031-efgh","native-b","claude","Claude");expect(other.auto_enabled).toBe(1);
  q.requestAuto(7,"a/b","20261031-abcd","claude",true);expect(q.session(a.id,7).auto_enabled).toBe(0);
  q.setAutoEnabled(7,a.id,true);expect(q.session(a.id,7).auto_enabled).toBe(1);
  const unselected=q.register(7,"a/b","20261031-abcd","unknown-new","other-claude","Other Claude","claude");expect(unselected.auto_enabled).toBe(0);
  q.enqueue("request",7,"a/b","20261031-abcd","m","q",[a.id]);
  q.requestAuto(7,"a/b","20261031-abcd","claude",false);
  expect(q.chain("request",7)?.status).toBe("cancelled");
  expect(q.register(7,"a/b","20261031-abcd","native-a","claude","Claude").auto_enabled).toBe(0);
  q.requestAuto(7,"a/b","20261031-abcd","claude",true);expect(q.claim(a.id)).toBeNull();
 }finally{q.close();}
});
