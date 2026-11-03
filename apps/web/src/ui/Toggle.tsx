import {cx} from "./kit.tsx";

export function Toggle({checked,disabled,label,onChange}:{checked:boolean;disabled?:boolean;label:string;onChange:()=>void}){
 return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className="toggle-hit">
  <span aria-hidden="true" className={cx("toggle-track",checked&&"is-on")}><span className="toggle-thumb"/></span>
 </button>;
}
