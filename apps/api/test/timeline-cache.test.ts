import {expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {TimelineCache} from "../src/timeline-cache.ts";

test("снимок переживает перезапуск, изолирован по пользователю и политике, зашифрован",()=>{
 const db=new Database(":memory:"),key=new Uint8Array(32).fill(7);
 const cache=new TimelineCache(db,key,"policy-a");
 const value={items:[{text:"[PERSON_1]"}]} as any;
 cache.put("user1/repo/chat/10","rev",value);
 expect(new TimelineCache(db,key,"policy-a").get("user1/repo/chat/10","rev")).toEqual(value);
 expect(cache.get("user2/repo/chat/10","rev")).toBeNull();
 expect(cache.get("user1/repo/chat/10","new-rev")).toBeNull();
 expect(new TimelineCache(db,key,"policy-b").get("user1/repo/chat/10","rev")).toBeNull();
 expect(JSON.stringify(db.query("SELECT * FROM timeline_checked").all())).not.toContain("PERSON");
 db.query("UPDATE timeline_checked SET sealed='broken'").run();
 expect(cache.get("user1/repo/chat/10","rev")).toBeNull();
});
