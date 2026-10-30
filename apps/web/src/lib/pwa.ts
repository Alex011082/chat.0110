import {useSyncExternalStore} from "react";
export const installPlatform=(ua:string,touch:number):"ios"|"mac"|"other"=>/iPhone|iPad|iPod/.test(ua)||(/Macintosh|MacIntel/.test(ua)&&touch>1)?"ios":/Macintosh|MacIntel/.test(ua)?"mac":"other";
const subscribe=(fn:()=>void)=>{window.addEventListener("online",fn);window.addEventListener("offline",fn);return()=>{window.removeEventListener("online",fn);window.removeEventListener("offline",fn);};};
export const useOnline=()=>useSyncExternalStore(subscribe,()=>navigator.onLine,()=>true);
