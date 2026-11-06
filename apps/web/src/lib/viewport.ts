/** Safari с клавиатурой меняет не только высоту, но и начало видимой области.
 * Перемещаем весь кадр, а не отдельно поле: лента остаётся между шапкой и вводом. */
export function watchViewport(host:Window,style:CSSStyleDeclaration,barHeight:()=>number){
 const keys=["--app-height","--stage-height","--app-top","--app-bottom-inset"];
 const previous=keys.map(key=>style.getPropertyValue?.(key)??"");
 const viewport=host.visualViewport;
 const refresh=()=>{
  // При увеличении страницы человек рассматривает её фрагмент; не перестраиваем
  // всю ленту под размер этого фрагмента и не мешаем жесту масштабирования.
  if(viewport&&viewport.scale!==1)return;
  const height=viewport?.height??host.innerHeight;
  style.setProperty("--app-height",`${height}px`);
  style.setProperty("--stage-height",`${Math.max(0,height-barHeight())}px`);
  style.setProperty("--app-top",`${viewport?.offsetTop??0}px`);
  style.setProperty("--app-bottom-inset",height<host.innerHeight-80?"0px":"env(safe-area-inset-bottom,0px)");
 };
 host.addEventListener("resize",refresh);
 viewport?.addEventListener("resize",refresh);viewport?.addEventListener("scroll",refresh);
 refresh();
 return Object.assign(()=>{
  host.removeEventListener("resize",refresh);
  viewport?.removeEventListener("resize",refresh);viewport?.removeEventListener("scroll",refresh);
  keys.forEach((key,i)=>{if(previous[i])style.setProperty(key,previous[i]!);else style.removeProperty(key);});
 },{refresh});
}
