import {MCP_PACKAGE_VERSION} from "@chat0110/chat-protocol";
export const pluginVersion=MCP_PACKAGE_VERSION;
export const pluginPackages=[
 {id:"codex",name:"ChatGPT / Codex",file:"chat0110-codex"},
 {id:"claude",name:"Claude Code",file:"chat0110-claude-code"},
] as const;
export const pluginDownload=(file:string)=>`/downloads/${file}-${pluginVersion}.zip`;
