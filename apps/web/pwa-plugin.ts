import type {Plugin} from "vite";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
export const workerSource=(version:string)=>String.raw`
const CACHE='chat0110-public-${version}';
const PUBLIC=['/offline.html','/offline.css','/manifest.webmanifest','/app-192.png','/app-512.png','/apple-touch-icon.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC.map(url=>new Request(url,{credentials:'omit'}))))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('chat0110-public-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',e=>{if(e.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==self.location.origin||r.headers.has('Authorization')||/^\/(api|auth|oauth|mcp|webhook|health)(\/|$)/.test(u.pathname))return;
 if(r.mode==='navigate'){e.respondWith(fetch(r).catch(async()=>await(await caches.open(CACHE)).match('/offline.html')||new Response('Offline',{status:503})));return;}
 if(PUBLIC.includes(u.pathname)&&!u.search)e.respondWith(caches.open(CACHE).then(async cache=>await cache.match(u.pathname)||fetch(r)));
});`;
export function pwaVersion(bundleNames:string[],resources:Uint8Array[]):string {const hash=createHash("sha256").update(bundleNames.sort().join("\n"));for(const bytes of resources)hash.update(bytes);return hash.digest("hex").slice(0,12);}
export function pwaPlugin():Plugin{return{name:"chat0110-public-pwa",generateBundle(_options,bundle){const resources=["offline.html","offline.css","manifest.webmanifest","app-192.png","app-512.png","apple-touch-icon.png"].map(file=>readFileSync(new URL(`public/${file}`,import.meta.url)));const version=pwaVersion(Object.keys(bundle),resources);this.emitFile({type:"asset",fileName:"sw.js",source:workerSource(version)});}};}
