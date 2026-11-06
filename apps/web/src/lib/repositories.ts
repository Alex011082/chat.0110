import type {RepoInfo} from "@chat0110/chat-protocol";

export function findRepositories(repos:RepoInfo[],query:string,recent:string[]){
 const q=query.trim().toLocaleLowerCase(),allowed=new Map(repos.map(repo=>[repo.full_name.toLowerCase(),repo]));
 const all=repos.filter(repo=>repo.full_name.toLocaleLowerCase().includes(q));
 const seen=new Set<string>();
 return {all,recent:q?[]:recent.flatMap(name=>{
  const key=name.toLowerCase(),repo=allowed.get(key);if(!repo||seen.has(key))return [];
  seen.add(key);return [repo];
 }).slice(0,3)};
}
