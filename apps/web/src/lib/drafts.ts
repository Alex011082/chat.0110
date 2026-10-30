interface Draft {text:string;replyTo?:string}
export class DraftStore {
 private owner:number|null=null;
 private values=new Map<string,Draft>();
 pending=false;
 get(key:string):Draft{return this.values.get(key)??{text:""};}
 set(key:string,text:string,replyTo?:string){if(text||replyTo)this.values.set(key,{text,...(replyTo?{replyTo}:{})});else this.values.delete(key);}
 activate(owner:number){if(this.owner!==owner){this.clear();this.owner=owner;}}
 canUpdate(){return !this.pending&&this.values.size===0;}
 clear(){this.owner=null;this.values.clear();this.pending=false;}
}
export const drafts=new DraftStore();
