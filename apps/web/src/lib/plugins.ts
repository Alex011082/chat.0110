export const pluginVersion="0.3.0";
export const pluginPackages=[
 {id:"codex",name:"Codex",file:"chat0110-codex"},
 {id:"claude",name:"Claude Code",file:"chat0110-claude-code"},
] as const;
export const pluginDownload=(file:string)=>`/downloads/${file}-${pluginVersion}.zip`;
